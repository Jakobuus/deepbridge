from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Path
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/paths', response_model=list[Path])
def paths():
    return list(store.paths.values())
