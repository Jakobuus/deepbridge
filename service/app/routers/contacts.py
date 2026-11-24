"""Verified contact resolution (Jakob's lane, J6 replaces the body). Stub: cached person data, no email."""
from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import Contact
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/contacts/{person_id}', response_model=Contact)
def contact(person_id: str):
    person = store.people.get(person_id)
    if person is None:
        raise HTTPException(404, 'unknown person')
    org = store.orgs[person.org_id].name if person.org_id in store.orgs else None
    return Contact(person_id=person.id, current_role=person.role, current_org=org,
                   current_asof=person.affiliation_asof, email=None, email_status='none', profiles=[],
                   assessment='Cached publication affiliation only; current role not yet verified.',
                   source='cache', evidence_ids=[])
