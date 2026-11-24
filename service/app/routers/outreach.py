import subprocess
from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import ApprovalRequest, Draft, DraftEdit, DraftRequest, STAGES
router = APIRouter(dependencies=[Depends(check_founder)])

@router.post('/drafts', response_model=list[Draft])
def drafts(body: DraftRequest):
    with store.lock:
        path = store.get('paths', body.path_id)
        if any(d.path_id == path.id for d in store.draft_templates):
            return store.generate_drafts(path.id)
        if store.credits.balance < 1:
            store.credit_event('drafts:' + path.id, 0, True)
            raise HTTPException(402, 'No credits remaining')
        store.credit_event('drafts:' + path.id, -1)
        from ..lanes.jakob.drafts import write_drafts
        try:
            generated = write_drafts(path, list(store.edges.values()), list(store.evidence.values()),
                                     list(store.signals.values()), store.founder)
        except (OSError, subprocess.SubprocessError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            raise HTTPException(502, 'Draft generation failed; please retry') from exc
        store.draft_templates.extend(d.model_copy(deep=True) for d in generated)
        # Match cached creation: repeated requests retain edits and approval state.
        result = [store.drafts.get(d.id) or store.add_or_replace_draft(d) for d in generated]
        card = next((c for c in store.cards.values() if c.path_id == path.id), None)
        if card and STAGES.index(card.stage) < STAGES.index('draft'):
            store.advance_card(card.id, 'draft', 'Draft agent', 'agent')
        return result

@router.put('/drafts/{id}', response_model=Draft)
def edit(id: str, body: DraftEdit):
    return store.edit_draft(id, body.subject, body.body)

@router.post('/approve', response_model=Draft)
def approve(body: ApprovalRequest):
    return store.approve(body.draft_id, body.content_hash, body.decision)
