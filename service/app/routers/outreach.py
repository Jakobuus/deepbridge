from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import ApprovalRequest, Draft, DraftEdit, DraftRequest
router = APIRouter(dependencies=[Depends(check_founder)])

@router.post('/drafts', response_model=list[Draft])
def drafts(body: DraftRequest):
    return store.generate_drafts(body.path_id)

@router.put('/drafts/{id}', response_model=Draft)
def edit(id: str, body: DraftEdit):
    return store.edit_draft(id, body.subject, body.body)

@router.post('/approve', response_model=Draft)
def approve(body: ApprovalRequest):
    return store.approve(body.draft_id, body.content_hash, body.decision)
