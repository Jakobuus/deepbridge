from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Edge, Evidence, GraphResponse, NameCheckRequest
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/graph', response_model=GraphResponse)
def graph():
    return {name: list(getattr(store, name).values()) for name in ['people', 'orgs', 'edges', 'evidence']}

@router.post('/name-check', response_model=Edge)
def name_check(body: NameCheckRequest):
    return store.update_name_check(body.edge_id, body.decision)

@router.get('/evidence/{id}', response_model=Evidence)
def evidence(id: str):
    return store.get('evidence', id)
