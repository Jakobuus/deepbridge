from fastapi import APIRouter, Depends
from datetime import datetime
from statistics import median
from ..activity import log
from ..store import store
from .common import check_founder
from ..models import AdvanceRequest, Card, Metrics, STAGES
router = APIRouter(dependencies=[Depends(check_founder)])

@router.get('/pipeline', response_model=list[Card])
def pipeline():
    return list(store.cards.values())

@router.post('/pipeline/{card_id}/advance', response_model=Card)
def advance(card_id: str, body: AdvanceRequest):
    with store.lock:
        previous = store.get('cards', card_id).stage
        card = store.advance_card(card_id, body.stage, body.actor)
        if card.stage != previous:
            history = card.history[-1]
            log(history.actor, history.actor_kind, 'pipeline.advance', card.id,
                f'Stage: {previous} → {card.stage}')
        return card


class ActivityMetrics(Metrics):
    # Completed visits only; null means no observed exit from that stage.
    median_hours_per_stage: dict[str, float | None]


@router.get('/metrics', response_model=ActivityMetrics)
def metrics():
    with store.lock:
        durations = {stage: [] for stage in STAGES}
        for card in store.cards.values():
            for start, end in zip(card.history, card.history[1:]):
                elapsed = (datetime.fromisoformat(end.at.replace('Z', '+00:00')) -
                           datetime.fromisoformat(start.at.replace('Z', '+00:00'))).total_seconds()
                if elapsed >= 0:
                    durations[start.stage].append(elapsed / 3600)
        return ActivityMetrics(**store.metrics().model_dump(), median_hours_per_stage={
            stage: median(values) if values else None for stage, values in durations.items()
        })
