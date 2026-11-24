from fastapi import APIRouter, HTTPException, Response
from ..store import store
from ..models import Edge, Evidence, GraphResponse, NameCheckRequest
from ..lanes.erick import build, pull

router = APIRouter()


def computed_founder(founder_id):
    try:
        return pull.resolve_founder(founder_id)
    except pull.OpenAlexUnavailable as exc:
        raise HTTPException(503, str(exc), headers={'Retry-After': '60'}) from None
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from None


@router.get('/graph', response_model=GraphResponse)
def graph(response: Response, founder_id: str | None = None):
    if founder_id is None or founder_id in (store.founder.id, store.founder.openalex_id,
                                            (store.founder.openalex_id or '').rsplit('/', 1)[-1]):
        response.headers['X-Graph-Data'] = 'Lightmatter fixture replay'
        return {name: list(getattr(store, name).values()) for name in ['people', 'orgs', 'edges', 'evidence']}
    fid = computed_founder(founder_id)
    if fid == store.founder.id:
        return graph(response, fid)
    try:
        people, orgs, edges, evidence = build.build_graph(fid)
        data = pull.load_dataset(fid)
    except pull.OpenAlexUnavailable as exc:
        raise HTTPException(503, str(exc), headers={'Retry-After': '60'}) from None
    response.headers['X-Graph-Data'] = 'computed from cached OpenAlex responses'
    response.headers['X-Graph-Partial'] = str(bool(data.get('warnings'))).lower()
    response.headers['X-Graph-Warnings'] = '; '.join(data.get('warnings', [])).encode('ascii', 'replace').decode()[:1800]
    return dict(people=people, orgs=orgs, edges=edges, evidence=evidence)


@router.post('/name-check', response_model=Edge)
def name_check(body: NameCheckRequest):
    with pull._STATE_LOCK:
        if body.edge_id in build.COMPUTED_EDGES:
            edge = build.COMPUTED_EDGES[body.edge_id]
            build.NAME_CHECKS[edge.id] = body.decision
            edge.name_check = body.decision
            return edge
    return store.update_name_check(body.edge_id, body.decision)


@router.get('/evidence/{id}', response_model=Evidence)
def evidence(id: str):
    if id in build.COMPUTED_EVIDENCE:
        return build.COMPUTED_EVIDENCE[id]
    return store.get('evidence', id)
