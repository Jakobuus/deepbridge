"""Live graph event stream (Erick's lane): SSE /graph/stream (live + speed replay) and /graph/events (full log)."""
import asyncio
import json
import queue
import re
import threading
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import events

router = APIRouter()

PING_EVERY = 15.0
POLL = 0.05
MAX_SPEED = 64.0
MAX_LIVE = 64
_active = 0  # live + replay streams
BATCH = 50
MIN_SLEEP, MAX_SLEEP = 0.02, 2.0
HEADERS = {'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}


def _sse(e: dict) -> str:
    return f"id: {e['seq']}\nevent: graph\ndata: {json.dumps(e, separators=(',', ':'), default=str)}\n\n"


def _gap(prev: dict, cur: dict, speed: float) -> float:
    try:
        secs = (datetime.fromisoformat(str(cur['at'])) - datetime.fromisoformat(str(prev['at']))).total_seconds()
    except (KeyError, ValueError, TypeError):
        return 0.1
    return min(MAX_SLEEP, max(MIN_SLEEP, secs / speed))


async def _live(request: Request, session_id: str, from_seq: int, q: queue.Queue):
    """The queue is only a wakeup; events are read from the log in seq order, only when woken (+1 s safety)."""
    last = from_seq
    ping_at = time.monotonic() + PING_EVERY
    check_at = time.monotonic() + 1.0
    reread_at = 0.0
    while True:
        woke = False
        try:
            while True:
                q.get_nowait()  # drain wakeups
                woke = True
        except queue.Empty:
            pass
        now = time.monotonic()
        if woke or now >= reread_at:
            reread_at = now + 1.0
            while batch := events.events(session_id, last, BATCH):
                for e in batch:
                    last = e['seq']
                    yield _sse(e)
                    if time.monotonic() >= ping_at:
                        ping_at = time.monotonic() + PING_EVERY
                        yield ': ping\n\n'
        now = time.monotonic()
        if now >= check_at:
            check_at = now + 1.0
            if await request.is_disconnected():
                return
        if now >= ping_at:
            ping_at = now + PING_EVERY
            yield ': ping\n\n'
        await asyncio.sleep(POLL)


class _CleanupResponse(StreamingResponse):
    """Always closes the generator and releases the subscription, even if the client vanishes mid-write."""

    def __init__(self, gen, on_close, **kw):
        super().__init__(gen, **kw)
        self._gen, self._on_close = gen, on_close

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            try:
                await self._gen.aclose()
            finally:
                self._on_close()


async def _replay(request: Request, session_id: str, from_seq: int, speed: float):
    end_seq = events.last_seq(session_id)
    last = pos = max(from_seq, 0)
    prev = None
    ping_at = time.monotonic() + PING_EVERY
    while pos < end_seq:
        batch = events.events(session_id, pos, min(BATCH, end_seq - pos))
        if not batch:
            break
        for e in batch:
            if prev is not None:
                await asyncio.sleep(_gap(prev, e, speed))
                if await request.is_disconnected():
                    return
            if time.monotonic() >= ping_at:
                ping_at = time.monotonic() + PING_EVERY
                yield ': ping\n\n'
            prev = e
            last = pos = e['seq']
            yield _sse(e)
    yield f"event: end\ndata: {json.dumps({'session_id': session_id, 'last_seq': last})}\n\n"


@router.get('/graph/events')
async def graph_events(session_id: str):
    await asyncio.to_thread(events.ensure_recorded, session_id)
    return sorted(events.events(session_id), key=lambda e: e['seq'])


@router.get('/graph/stream')
async def graph_stream(request: Request, session_id: str, speed: float = Query(1.0, gt=0), from_seq: int = 0):
    global _active
    await asyncio.to_thread(events.ensure_recorded, session_id)
    try:
        from_seq = max(from_seq, int(request.headers.get('last-event-id', '')))
    except ValueError:
        pass
    speed = min(speed, MAX_SPEED)
    if _active >= MAX_LIVE:
        raise HTTPException(503, 'too many streams')
    _active += 1
    q = events._subscribe_bounded(session_id, 1) if speed <= 1 else None
    done = False

    def on_close():
        global _active
        nonlocal done
        if done:
            return
        done = True
        _active -= 1
        if q is not None:
            events.unsubscribe(session_id, q)

    try:
        gen = (_live(request, session_id, from_seq, q) if q is not None
               else _replay(request, session_id, from_seq, speed))
        return _CleanupResponse(gen, on_close, media_type='text/event-stream', headers=HEADERS)
    except BaseException:
        on_close()
        raise


_SID = re.compile(r'[A-Za-z0-9_-]{1,64}')
_running: set[str] = set()
_running_lock = threading.Lock()


def _run_discovery(session_id: str, evs: list[dict], pace: float):
    try:
        events.publish(session_id, 'discovery', 'status', 'category', status='Finding buyers and warm paths…')
        for e in evs:
            time.sleep(pace)
            events.publish(session_id, e['phase'], e['kind'], e['layer'],
                           **{k: v for k, v in e.items() if k not in ('phase', 'kind', 'layer')})
    finally:
        with _running_lock:
            _running.discard(session_id)


@router.post('/graph/discover', status_code=202)
async def graph_discover(session_id: str, founder_id: str = 'person:openalex:A5043992375', pace: float = 0.4):
    from ..lanes.erick import record_log
    if not _SID.fullmatch(session_id):
        raise HTTPException(422, 'invalid session_id')
    if founder_id not in record_log.founder_sessions():
        raise HTTPException(404, 'unsupported founder_id')
    pace = min(2.0, max(0.05, pace))
    with _running_lock:
        if session_id in _running:
            raise HTTPException(409, 'discovery already running')
        _running.add(session_id)
    try:
        await asyncio.to_thread(events.ensure_recorded, session_id)
        if any(e.get('phase') in ('discovery', 'paths') for e in events.events(session_id)):
            raise HTTPException(409, 'already has discovery events')
        evs = await asyncio.to_thread(record_log.discovery_events, founder_id)
        threading.Thread(target=_run_discovery, args=(session_id, evs, pace), daemon=True).start()
    except BaseException:
        with _running_lock:
            _running.discard(session_id)
        raise
    n = len(evs) + 1
    return {'session_id': session_id, 'founder_id': founder_id, 'queued': n, 'pace': pace, 'eta_s': round(n * pace, 1)}
