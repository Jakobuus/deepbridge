"""Status badges: which sponsor integrations are really live right now (probes cached 30 s)."""
import os
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter

from .. import band_review
from ..lanes.jakob.credits import client, credits as read_credits
from ..openalex import with_key
from ..store import store

router = APIRouter()
_cache = {}


def _reachable(url, headers=None):
    try:
        urlopen(Request(url, headers=headers or {}), timeout=3).close()
        return True
    except HTTPError:
        return True  # the server answered
    except Exception:
        return False


def _cached(name, fn):
    hit = _cache.get(name)
    if hit and time.monotonic() - hit[1] < 30:
        return hit[0]
    value = fn()
    _cache[name] = (value, time.monotonic())
    return value


def _band_live():
    if not band_review.enabled():
        return False
    rest = os.getenv('BAND_REST_URL', 'https://api.band.ai').rstrip('/')
    return _reachable(f'{rest}/api/v1/agent/chats/{os.environ["BAND_ROOM_ID"]}/participants',
                      {'X-API-Key': os.environ['BAND_PLANNER_KEY']})


@router.get('/band/status')
def band_status(draft_id: str | None = None):
    draft = store.drafts.get(draft_id) if draft_id else None
    if draft is None and draft_id is None:  # newest reviewed draft
        draft = next((d for d in reversed(list(store.drafts.values())) if d.review), None)
    review = draft.review if draft else None
    return {'draft_id': draft.id if draft else draft_id, 'enabled': band_review.enabled(),
            'review': review, 'status': review['status'] if review else 'none',
            'approved_via': draft.approved_via if draft else None}


@router.get('/integrations/status')
def integrations_status():
    out = {}
    def fp():
        remote = client()
        c = read_credits() if remote else None
        live = bool(c and c.source == 'flexprice')
        host = urlparse(remote.base_url).hostname if remote else ''
        region = next((p for p in (host or '').split('.') if p in ('us', 'eu', 'in', 'ap', 'sg')), host or None)
        out['flexprice'] = {'live': live, 'balance': c.balance if live else None, 'region': region}
    def band():
        out['band'] = {'live': _cached('band', _band_live), 'room_url': band_review.room_url(), 'agents': 4}
    def moss():
        k = bool(os.getenv('MOSS_PROJECT_ID') and os.getenv('MOSS_PROJECT_KEY'))
        out['moss'] = {'live': k and _cached('moss', lambda: _reachable('https://inference.moss.dev/v1/models'))}
    def oa():
        out['openalex'] = {'live': _cached('openalex', lambda: _reachable(with_key('https://api.openalex.org/works?per-page=1')))}
    threads = [threading.Thread(target=f) for f in (fp, band, moss, oa)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    return out
