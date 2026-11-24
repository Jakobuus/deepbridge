from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import SearchResponse
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/search', response_model=SearchResponse)
def search(q: str):
    from time import perf_counter
    start = perf_counter()
    needle = q.casefold()
    people = [p for p in store.people.values() if needle in p.name.casefold()]
    return {'people': people, 'ms': (perf_counter() - start) * 1000, 'engine': 'cache'}
