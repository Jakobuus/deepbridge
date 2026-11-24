from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Founder, Icp, IntakeRequest
router = APIRouter(dependencies=[Depends(check_founder)])

@router.post('/intake', response_model=Founder)
def intake(body: IntakeRequest):
    query = body.query.strip().casefold()
    terms = [store.founder.name.casefold(), store.founder.company.casefold(), 'nicholas harris',
             'a5102978866', '10.1038/nphoton.2017.93']
    if not query or not any(query in t or t in query for t in terms):
        raise HTTPException(404, 'Only the cached Lightmatter / Nicholas C. Harris case is available')
    return store.founder

@router.get('/icp', response_model=Icp)
def icp():
    return store.icp
