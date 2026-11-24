import hashlib
import json
import logging
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..lanes.jakob.icp import load_research
from ..lanes.jakob.signals import CACHE, BuyerOrg, _write, buyer_inputs, rank_buyers
from ..models import BuyersResponse, Evidence, Founder
from ..store import FIXTURES, store

router = APIRouter()
COMPUTED = FIXTURES / 'buyers_computed.json'
LOG = logging.getLogger(__name__)
_LOCKS = {}
_LOCKS_GUARD = Lock()
_DISCOVERY_VERSION = 2


class BuyerDiscoveryResponse(BuyersResponse):
    orgs: list[BuyerOrg]


def _register(data):
    result = BuyerDiscoveryResponse.model_validate(data)
    evidence = [Evidence.model_validate(e) for e in data['evidence']]
    known = {e.id for e in evidence}
    org_ids = {o.id for o in result.orgs}
    if any(s.org_id not in org_ids or not s.evidence_ids or
           not set(s.evidence_ids) <= known for s in result.signals) or any(
               not set(o.evidence_ids) <= known for o in result.orgs):
        raise ValueError('Computed buyer signal has missing evidence or organization')
    with store.lock:
        store.evidence.update({e.id: e for e in evidence})
        store.orgs.update({o.id: o for o in result.orgs})
        store.signals.update({s.id: s for s in result.signals})
    result.orgs.sort(key=lambda o: -(o.buyer_score or 0))
    return result


@router.get('/buyers', response_model=BuyerDiscoveryResponse, response_model_exclude_unset=True)
def buyers(founder_id: str | None = None):
    """Instant Lightmatter replay; bounded live discovery cached per other founder."""
    selected = founder_id or getattr(store, 'jakob_active_founder_id', store.founder.id)
    if selected == store.founder.id:
        if COMPUTED.exists():
            try:
                data = json.loads(COMPUTED.read_text())
                if data['_meta']['founder_id'] == selected:
                    return _register(data)
            except (OSError, ValueError, KeyError, ValidationError) as exc:
                LOG.warning('Computed buyers unavailable; using original fixtures: %s', exc)
        # Read original fixtures, avoiding companies from a prior live founder call.
        raw_orgs = json.loads((FIXTURES / 'orgs.json').read_text())
        raw_signals = json.loads((FIXTURES / 'signals.json').read_text())
        orgs = [o for o in raw_orgs.get('items', []) if o['is_buyer']] if isinstance(raw_orgs, dict) else [o for o in raw_orgs if o['is_buyer']]
        ids = {o['id'] for o in orgs}
        signals = raw_signals.get('items', []) if isinstance(raw_signals, dict) else raw_signals
        return BuyerDiscoveryResponse(orgs=orgs, signals=[s for s in signals if s['org_id'] in ids])
    try:
        research = load_research(selected)
        founder = Founder.model_validate(research['founder'])
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(404, 'Founder research not found; submit intake first') from exc
    digest = hashlib.sha256(selected.encode()).hexdigest()[:24]
    path = CACHE / 'buyers' / (digest + '.json')
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(selected, Lock())
    # A simultaneous click must not queue another full 38 second computation.
    if not lock.acquire(timeout=1):
        raise HTTPException(503, 'Buyer discovery already running; retry shortly')
    try:
        icp, problems = buyer_inputs(founder)
        fingerprint = hashlib.sha256(json.dumps({
            'version': _DISCOVERY_VERSION,
            'research': research,
            'icp': icp.model_dump() if icp else None,
            'problems': problems,
        }, sort_keys=True).encode()).hexdigest()
        if path.exists():
            try:
                data = json.loads(path.read_text())
                if data.get('_meta', {}).get('fingerprint') == fingerprint:
                    return _register(data)
            except (OSError, ValueError, KeyError, ValidationError) as exc:
                LOG.warning('Ignoring invalid cached buyers: %s', exc)
        try:
            orgs, signals = rank_buyers(founder, [], inputs=(icp, problems))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        eids = {eid for item in [*orgs, *signals] for eid in item.evidence_ids}
        data = {'_meta': {'cached': True, 'founder_id': selected, 'fingerprint': fingerprint,
                         'notes': 'Heuristic buyer hypotheses; citation counts are lower bounds. '
                                  'Publication affiliations do not establish current employment.'},
                'orgs': [o.model_dump() for o in orgs], 'signals': [s.model_dump() for s in signals],
                'evidence': [store.evidence[eid].model_dump() for eid in sorted(eids)]}
        _write(path, data)
        return _register(data)
    finally:
        lock.release()
