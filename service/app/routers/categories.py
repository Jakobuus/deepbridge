from fastapi import APIRouter, Depends, Response

from ..lanes.jakob.categories import CATEGORY_PREFIX, build_categories
from ..models import BuyerCategory, BuyersResponse
from ..store import store
from .buyers import buyers
from .common import check_founder

router = APIRouter(dependencies=[Depends(check_founder)])


def category_layer():
    """Return categories, category-to-buyer FITS edges, and their evidence."""
    with store.lock:
        result = BuyersResponse.model_validate(buyers())
        categories, edges, evidence = build_categories(result, store.icp, store.evidence)
        store.evidence.update({item.id: item for item in evidence})
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
def categories(response: Response):
    response.headers['X-Categories-Data'] = 'inferred from cached buyer evidence'
    return category_layer()[0]
