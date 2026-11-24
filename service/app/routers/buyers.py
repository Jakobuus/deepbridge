import json
import logging

from fastapi import APIRouter, Depends
from pydantic import ValidationError

from ..models import BuyersResponse, Evidence
from ..store import FIXTURES, store
from .common import check_founder

router = APIRouter(dependencies=[Depends(check_founder)])
COMPUTED = FIXTURES / 'buyers_computed.json'
LOG = logging.getLogger(__name__)


@router.get('/buyers', response_model=BuyersResponse)
def buyers():
    """Serve the replayable computed snapshot, falling back to original fixtures."""
    if COMPUTED.exists():
        try:
            data = json.loads(COMPUTED.read_text())
            if data['_meta']['founder_id'] == store.founder.id:
                result = BuyersResponse.model_validate(data)
                evidence = [Evidence.model_validate(e) for e in data['evidence']]
                known = set(store.evidence) | {e.id for e in evidence}
                org_ids = {o.id for o in result.orgs}
                if any(s.org_id not in org_ids or not s.evidence_ids or
                       not set(s.evidence_ids) <= known for s in result.signals):
                    raise ValueError('Computed buyer signal has missing evidence or organization')
                with store.lock:
                    store.evidence.update({e.id: e for e in evidence})
                    store.orgs.update({o.id: o for o in result.orgs})
                    store.signals.update({s.id: s for s in result.signals})
                return {'orgs': sorted(result.orgs, key=lambda o: (-(o.buyer_score or 0), o.name)),
                        'signals': result.signals}
        except (OSError, ValueError, KeyError, ValidationError) as exc:
            LOG.warning('Computed buyers unavailable; using original fixtures: %s', exc)
    orgs = [o for o in store.orgs.values() if o.is_buyer]
    return {'orgs': sorted(orgs, key=lambda o: (-(o.buyer_score or 0), o.name)),
            'signals': [s for s in store.signals.values() if s.org_id in {o.id for o in orgs}]}
