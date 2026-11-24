from fastapi import APIRouter, HTTPException, Query, Response
from ..store import store
from ..models import Path
from ..lanes.erick import pull
from ..lanes.erick.paths import find_paths
from .graph import computed_founder

router = APIRouter()


@router.get('/paths', response_model=list[Path])
def paths(response: Response, founder_id: str | None = None,
          buyer_org_ids: list[str] | None = Query(default=None)):
    if founder_id is None or founder_id in (store.founder.id, store.founder.openalex_id,
                                            (store.founder.openalex_id or '').rsplit('/', 1)[-1]):
        response.headers['X-Graph-Data'] = 'Lightmatter fixture replay'
        return [p for p in store.paths.values() if buyer_org_ids is None or p.buyer_org_id in buyer_org_ids]
    fid = computed_founder(founder_id)
    if fid == store.founder.id:
        return paths(response, fid, buyer_org_ids)
    try:
        result = find_paths(fid, buyer_org_ids)
        data = pull.load_dataset(fid)
    except pull.OpenAlexUnavailable as exc:
        raise HTTPException(503, str(exc), headers={'Retry-After': '60'}) from None
    response.headers['X-Graph-Data'] = 'computed from cached OpenAlex responses; scores are heuristics'
    response.headers['X-Graph-Partial'] = str(bool(data.get('warnings'))).lower()
    response.headers['X-Graph-Warnings'] = '; '.join(data.get('warnings', [])).encode('ascii', 'replace').decode()[:1800]
    return result
