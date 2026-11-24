from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import BuyersResponse
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/buyers', response_model=BuyersResponse)
def buyers():
    return {'orgs': [o for o in store.orgs.values() if o.is_buyer], 'signals': list(store.signals.values())}
