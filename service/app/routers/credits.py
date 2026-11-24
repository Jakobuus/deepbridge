from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Credits
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/credits', response_model=Credits)
def credits():
    return store.credits
