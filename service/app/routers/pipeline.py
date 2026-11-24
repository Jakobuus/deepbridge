from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import AdvanceRequest, Card, Metrics
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/pipeline', response_model=list[Card])
def pipeline():
    return list(store.cards.values())

@router.post('/pipeline/{card_id}/advance', response_model=Card)
def advance(card_id: str, body: AdvanceRequest):
    return store.advance_card(card_id, body.stage, body.actor)

@router.get('/metrics', response_model=Metrics)
def metrics():
    return store.metrics()
