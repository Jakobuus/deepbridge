from threading import Lock

from fastapi import APIRouter, Response

from ..lanes.jakob.categories import CATEGORY_PREFIX, build_categories
from ..models import BuyerCategory
from ..store import store
from .buyers import buyers
from .icp import icp

router = APIRouter()
_category_locks = {}


def category_layer(founder_id: str | None = None):
    """Return categories, category-to-buyer FITS edges, and their evidence."""
    selected = founder_id if founder_id is not None else store.founder.id
    founder_icp = icp(selected)
    result = buyers(selected)
    with store.lock:
        sources = store.evidence.copy()
        lock = _category_locks.setdefault(selected, Lock())
    with lock:
        categories, edges, evidence = build_categories(result, founder_icp, sources)
    with store.lock:
        store.evidence.update({item.id: item for item in evidence})
        if selected != store.founder.id:
            return categories, edges, evidence
        current_ids = {edge.id for edge in edges}
        for edge_id, old in list(store.edges.items()):
            if old.type == 'FITS' and old.from_.startswith(CATEGORY_PREFIX) and edge_id not in current_ids:
                del store.edges[edge_id]
        for edge in edges:
            previous = store.edges.get(edge.id)
            if (previous and previous.from_ == edge.from_
                    and set(previous.evidence_ids) == set(edge.evidence_ids)):
                edge.name_check = previous.name_check
            store.edges[edge.id] = edge
    return categories, edges, evidence


@router.get('/categories', response_model=list[BuyerCategory])
def categories(response: Response, founder_id: str | None = None):
    selected = (founder_id if founder_id is not None
                else getattr(store, 'jakob_active_founder_id', store.founder.id))
    response.headers['X-Categories-Data'] = 'inferred from cached buyer evidence'
    return category_layer(selected)[0]
