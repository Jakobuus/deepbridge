from fastapi import APIRouter, Depends
from datetime import datetime
from statistics import median
from ..activity import log
from ..store import store
from ..lanes.jakob.credits import credits as read_credits
from .common import check_founder
from ..models import AdvanceRequest, Card, Metrics, STAGES
from fastapi import HTTPException
from collections import Counter
router = APIRouter()

HOPO_ID = 'person:openalex:A5043992375'
# HACK: HOPO cards live in fixtures/cards.json with the id prefix card:hopo:; the founder
# scope is this prefix filter, selected by ?founder_id or the active intake founder.
def _is_hopo(founder_id):
    selected = founder_id or getattr(store, 'jakob_active_founder_id', store.founder.id)
    if selected == HOPO_ID:
        return True
    if selected == store.founder.id:
        return False
    raise HTTPException(404, 'Founder not in cached demo')

def _cards(hopo):
    return [c for c in store.cards.values() if c.id.startswith('card:hopo:') == hopo]

@router.get('/pipeline', response_model=list[Card])
def pipeline(founder_id: str | None = None):
    return _cards(_is_hopo(founder_id))

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


def _metrics(cards):
    # HACK: HOPO paths are computed (not in store.paths); all HOPO demo paths are co_author.
    kind_of = lambda c: store.paths[c.path_id].kind if c.path_id in store.paths else 'co_author'
    counts = Counter(c.stage for c in cards)
    reached = {s: sum(n for st, n in counts.items() if STAGES.index(st) >= i) for i, s in enumerate(STAGES)}
    actors = Counter((h.actor, h.actor_kind) for c in cards for h in c.history)
    return Metrics.model_validate(dict(
        per_stage={s: counts[s] for s in STAGES},
        conversion=[{'from': a, 'to': b, 'rate': reached[b] / reached[a] if reached[a] else 0}
                    for a, b in zip(STAGES, STAGES[1:])],
        by_path_kind=[dict(kind=k, count=sum(kind_of(c) == k for c in cards),
                           approved=sum(kind_of(c) == k and STAGES.index(c.stage) >= 3 for c in cards))
                      for k in sorted({kind_of(c) for c in cards})],
        by_actor=[dict(actor=a, actor_kind=k, actions=n) for (a, k), n in sorted(actors.items())])).model_dump()


class ActivityMetrics(Metrics):
    # Completed visits only; null means no observed exit from that stage.
    median_hours_per_stage: dict[str, float | None]
    # Flexprice meters (computed, not invented): cost per lead = credits spent / leads (pipeline cards)
    meters: dict[str, int] = {}
    credits_spent: float = 0
    leads: int = 0
    cost_per_lead: float | None = None
    meter_source: str = 'local'


@router.get('/metrics', response_model=ActivityMetrics)
def metrics(founder_id: str | None = None):
    hopo = _is_hopo(founder_id)
    with store.lock:
        cards = _cards(hopo)
        durations = {stage: [] for stage in STAGES}
        for card in cards:
            for start, end in zip(card.history, card.history[1:]):
                elapsed = (datetime.fromisoformat(end.at.replace('Z', '+00:00')) -
                           datetime.fromisoformat(start.at.replace('Z', '+00:00'))).total_seconds()
                if elapsed >= 0:
                    durations[start.stage].append(elapsed / 3600)
        base = _metrics(cards)
        used = read_credits()
        spent = used.spent or 0
        return ActivityMetrics(**base, median_hours_per_stage={
            stage: median(values) if values else None for stage, values in durations.items()
        }, meters=used.meters, credits_spent=spent, leads=len(cards),
            cost_per_lead=round(spent / len(cards), 3) if cards else None, meter_source=used.source)
