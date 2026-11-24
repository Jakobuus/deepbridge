"""Live graph event stream (Erick's lane): SSE /graph/stream (live + speed replay) and /graph/events (full log)."""
import asyncio
import json
import queue
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
_live_count = 0
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
    """The queue is only a wakeup; events are always read from the log in seq order."""
    last = from_seq
    ping_at = time.monotonic() + PING_EVERY
    check_at = time.monotonic() + 1.0
    while True:
        try:
            while True:
                q.get_nowait()  # drain wakeups
        except queue.Empty:
            pass
        for e in events.events(session_id, last):
            last = max(last, e['seq'])
            ping_at = time.monotonic() + PING_EVERY
            yield _sse(e)
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
    prev = None
    last = from_seq
    for e in events.events(session_id, from_seq):
        if prev is not None:
            await asyncio.sleep(_gap(prev, e, speed))
            if await request.is_disconnected():
                return
        prev = e
        last = e['seq']
        yield _sse(e)
    yield f"event: end\ndata: {json.dumps({'session_id': session_id, 'last_seq': last})}\n\n"


@router.get('/graph/events')
async def graph_events(session_id: str):
    await asyncio.to_thread(events.ensure_recorded, session_id)
    return sorted(events.events(session_id), key=lambda e: e['seq'])


@router.get('/graph/stream')
async def graph_stream(request: Request, session_id: str, speed: float = Query(1.0, gt=0), from_seq: int = 0):
    global _live_count
    await asyncio.to_thread(events.ensure_recorded, session_id)
    try:
        from_seq = max(from_seq, int(request.headers.get('last-event-id', '')))
    except ValueError:
        pass
    speed = min(speed, MAX_SPEED)
    if speed > 1:
        return StreamingResponse(_replay(request, session_id, from_seq, speed), media_type='text/event-stream',
                                 headers=HEADERS)
    if _live_count >= MAX_LIVE:
        raise HTTPException(503, 'too many live streams')
    _live_count += 1
    q = events.subscribe(session_id, maxsize=1)
    done = False

    def on_close():
        global _live_count
        nonlocal done
        if done:
            return
        done = True
        _live_count -= 1
        events.unsubscribe(session_id, q)

    try:
        return _CleanupResponse(_live(request, session_id, from_seq, q), on_close,
                                media_type='text/event-stream', headers=HEADERS)
    except BaseException:
        on_close()
        raise
