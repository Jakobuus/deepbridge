"""Live graph event stream (Erick's lane): SSE /graph/stream (live + speed replay) and /graph/events (full log)."""
import asyncio
import json
import queue
from datetime import datetime

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from .. import events

router = APIRouter()

PING_EVERY = 15.0
POLL = 0.05
MAX_SPEED = 64.0
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


async def _live(request: Request, session_id: str, from_seq: int):
    q = events.subscribe(session_id)  # subscribe BEFORE reading the backlog: no gaps; dedupe by seq
    try:
        last = from_seq
        for e in events.events(session_id, from_seq):
            last = max(last, e['seq'])
            yield _sse(e)
        idle, since_check = 0.0, 0.0
        while True:
            try:
                e = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(POLL)
                idle += POLL
                since_check += POLL
                if since_check >= 1.0:
                    since_check = 0.0
                    if await request.is_disconnected():
                        return
                if idle >= PING_EVERY:
                    idle = 0.0
                    yield ': ping\n\n'
                continue
            if e['seq'] <= last:
                continue
            last = e['seq']
            idle = 0.0
            yield _sse(e)
    finally:
        events.unsubscribe(session_id, q)


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
def graph_events(session_id: str):
    events.ensure_recorded(session_id)
    return sorted(events.events(session_id), key=lambda e: e['seq'])


@router.get('/graph/stream')
async def graph_stream(request: Request, session_id: str, speed: float = Query(1.0, gt=0), from_seq: int = 0):
    events.ensure_recorded(session_id)
    try:
        from_seq = max(from_seq, int(request.headers.get('last-event-id', '')))
    except ValueError:
        pass
    speed = min(speed, MAX_SPEED)
    gen = _live(request, session_id, from_seq) if speed <= 1 else _replay(request, session_id, from_seq, speed)
    return StreamingResponse(gen, media_type='text/event-stream', headers=HEADERS)
