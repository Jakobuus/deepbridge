import subprocess
from fastapi import APIRouter, Depends, HTTPException
from ..store import store
from .common import check_founder
from ..models import ApprovalRequest, Draft, DraftEdit, DraftRequest, STAGES
from ..lanes.jakob.drafts import computed_path, write_drafts
from .. import band_review

router = APIRouter()

@router.post('/drafts', response_model=list[Draft])
def drafts(body: DraftRequest, founder_id: str | None = None):
    path = store.paths.get(body.path_id)
    computed = None
    if path is None:
        computed = computed_path(body.path_id, founder_id)
        if computed is None:
            raise HTTPException(404, f'paths: {body.path_id} not found')
        path, edges, evidence, founder = computed
    else:
        check_founder(founder_id)

    with store.lock:
        templates = [d for d in store.draft_templates if d.path_id == path.id]
        if computed is None and templates:
            return store.generate_drafts(path.id)
        if store.credits.balance < 1:
            store.credit_event('drafts:' + path.id, 0, True)
            raise HTTPException(402, 'No credits remaining')
        store.credit_event('drafts:' + path.id, -1)
        if not templates:
            if computed is None:
                edges, evidence = list(store.edges.values()), list(store.evidence.values())
                founder = store.founder
            try:
                templates = write_drafts(path, edges, evidence, list(store.signals.values()), founder)
            except (OSError, subprocess.SubprocessError, ValueError, RuntimeError, KeyError, TypeError) as exc:
                raise HTTPException(502, 'Draft generation failed; please retry') from exc
            store.draft_templates.extend(d.model_copy(deep=True) for d in templates)
            if computed is not None:
                used_ids = {eid for draft in templates for eid in draft.evidence_ids}
                store.evidence.update({item.id: item for item in evidence if item.id in used_ids})
        # Match cached creation: repeated requests retain edits and approval state.
        result = [store.drafts.get(d.id) or store.add_or_replace_draft(d.model_copy(deep=True))
                  for d in templates]
        card = next((c for c in store.cards.values() if c.path_id == path.id), None)
        if card and STAGES.index(card.stage) < STAGES.index('draft'):
            store.advance_card(card.id, 'draft', 'Draft agent', 'agent')
        band_review.maybe_start(result, founder_id)  # background, non-blocking, silent if Band is off
        return result

@router.put('/drafts/{id}', response_model=Draft, dependencies=[Depends(check_founder)])
def edit(id: str, body: DraftEdit):
    return store.edit_draft(id, body.subject, body.body)

@router.post('/approve', response_model=Draft, dependencies=[Depends(check_founder)])
def approve(body: ApprovalRequest):
    return store.approve(body.draft_id, body.content_hash, body.decision)
