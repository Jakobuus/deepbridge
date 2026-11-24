"""Cache-first contact resolution, with an explicit live refresh for the demo."""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Contact
from ..lanes.jakob.contacts import cached_contact, resolve_contact

router = APIRouter(dependencies=[Depends(check_founder)])
LIVE_TIMEOUT_SECONDS = 120
log = logging.getLogger(__name__)


def person_evidence(person_id):
    ids = {eid for edge in store.edges.values()
           if person_id in (edge.from_, edge.to) for eid in edge.evidence_ids}
    return [store.evidence[eid] for eid in sorted(ids) if eid in store.evidence]


def _stub(person):
    org = store.orgs[person.org_id].name if person.org_id in store.orgs else None
    return Contact(person_id=person.id, current_role=person.role, current_org=org,
        current_asof=person.affiliation_asof, email=None, email_status='none', profiles=[],
        assessment='Cached affiliation only; current employment not verified. Live Moss lookup unavailable.',
        source='cache', evidence_ids=[e.id for e in person_evidence(person.id)])


def _cached(person_id):
    try:
        return cached_contact(person_id)
    except Exception:
        log.warning('Contact cache unavailable; using publication fallback')
        return None


async def _contact(person_id, refresh=False):
    person = store.people.get(person_id)
    cached = _cached(person_id)
    if person is None:
        if cached is not None:  # HACK: HOPO contacts are only in the contact fixture, not the Lightmatter store
            return cached
        raise HTTPException(404, 'unknown person')
    if cached is not None and not refresh:
        return cached
    try:
        return await asyncio.wait_for(resolve_contact(person, person_evidence(person_id)),
                                      timeout=LIVE_TIMEOUT_SECONDS)
    except Exception as exc:
        # Log types only: provider errors may contain credential-bearing URLs.
        log.warning('Live contact lookup unavailable (%s); returning cache', type(exc).__name__)
        return cached if cached is not None else _stub(person)


@router.get('/contacts/{person_id}', response_model=Contact)
async def contact(person_id: str):
    return await _contact(person_id)


@router.post('/contacts/{person_id}/refresh', response_model=Contact)
async def refresh_contact(person_id: str):
    return await _contact(person_id, refresh=True)
