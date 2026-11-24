"""Billing dependencies compose existing action routers without changing their lane files."""
import asyncio
from fastapi import APIRouter, Depends, Request
from ..store import store
from .common import check_founder
from ..models import Credits, DraftRequest
from ..lanes.jakob.credits import credits as read_credits, gate
from . import contacts, outreach, prospect
from ..lanes.jakob import prospect as prospect_lane

router = APIRouter(dependencies=[Depends(check_founder)])


@router.get('/credits', response_model=Credits)
def credits():
    return read_credits()


async def meter_action(request: Request, _=Depends(check_founder)):
    if request.method == 'POST' and request.url.path == '/drafts':
        # Let the endpoint return its normal validation error before metering bad input.
        try:
            body = DraftRequest.model_validate(await request.json())
        except ValueError:
            return
        with store.lock:
            store.get('paths', body.path_id)
        await asyncio.to_thread(gate, 'drafts:' + body.path_id, draft=True)
    elif request.method == 'POST' and request.url.path == '/prospect':
        try:
            body = await request.json()
            org_id, topic = str(body['org_id']), str(body['topic'])
        except (ValueError, KeyError, TypeError):
            return
        if not prospect_lane.cached_prospects(org_id, topic):
            await asyncio.to_thread(gate, 'prospect:' + org_id + ':' + topic[:80])
    elif request.url.path.startswith('/contacts/'):
        person_id = request.path_params.get('person_id')
        with store.lock:
            store.get('people', person_id)
        refresh = request.method == 'POST' and request.url.path.endswith('/refresh')
        if refresh or contacts._cached(person_id) is None:
            await asyncio.to_thread(gate, 'contacts:' + person_id)


def _metered(original):
    wrapped = APIRouter(dependencies=[Depends(meter_action)])
    wrapped.include_router(original)
    return wrapped


# main.py includes these router objects after importing this module. Public router
# composition keeps the credit gate outside contacts' provider-error fallback.
outreach.router = _metered(outreach.router)
contacts.router = _metered(contacts.router)
prospect.router = _metered(prospect.router)
