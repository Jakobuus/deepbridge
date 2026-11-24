"""Cache-first prospecting: no outbound messages, at most $0.50 per live task."""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..lanes.jakob.contacts import ContactResolutionError
from ..lanes.jakob.prospect import cached_prospects, find_prospects
from ..store import store
from .common import check_founder

router = APIRouter(dependencies=[Depends(check_founder)])
_live_lock = asyncio.Lock()


class ProspectRequest(BaseModel):
    org_id: str = Field(min_length=1)
    topic: str = Field(min_length=1, max_length=500, pattern=r'\S')


@router.post('/prospect')
async def prospect(request: ProspectRequest):
    store.get('orgs', request.org_id)
    async with _live_lock:
        cached = cached_prospects(request.org_id, request.topic)
        if cached:
            return cached[-1]
        try:
            return await find_prospects(request.org_id, request.topic.strip())
        except (ContactResolutionError, TimeoutError):
            raise HTTPException(503, 'Live Moss prospecting unavailable; no cached result for this topic') from None
        except Exception:
            raise HTTPException(502, 'Moss returned unavailable or invalid prospect data') from None


@router.get('/prospects')
def prospects(org_id: str):
    store.get('orgs', org_id)
    return cached_prospects(org_id)
