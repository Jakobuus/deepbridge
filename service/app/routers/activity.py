"""Recent attribution and a live Server-Sent Events feed."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import activity
from .common import check_founder


@asynccontextmanager
async def lifespan(app):
    activity.seed()
    yield


router = APIRouter(dependencies=[Depends(check_founder)], lifespan=lifespan)


@router.get('/activity', response_model=list[activity.Activity])
def recent(limit: int = Query(default=50, ge=0, le=1000)):
    return activity.recent(limit)


@router.get('/activity/stream')
async def stream(request: Request, last_event_id: str | None = Header(default=None)):
    cursor = activity.latest_id()
    if last_event_id is not None:
        try:
            cursor = int(last_event_id)
        except ValueError:
            raise HTTPException(400, 'Last-Event-ID must be a nonnegative integer')
        if cursor < 0 or cursor > activity.latest_id():
            raise HTTPException(400, 'Last-Event-ID is outside this process activity log')

    async def events():
        nonlocal cursor
        yield ': connected\n\n'
        idle_ticks = 0
        while not await request.is_disconnected():
            entries = activity.after(cursor)
            for entry in entries:
                yield f'id: {entry.id}\ndata: {entry.model_dump_json()}\n\n'
                cursor = entry.id
            idle_ticks = 0 if entries else idle_ticks + 1
            if idle_ticks >= 60:
                yield ': keepalive\n\n'
                idle_ticks = 0
            await asyncio.sleep(0.25)

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no',
    })
