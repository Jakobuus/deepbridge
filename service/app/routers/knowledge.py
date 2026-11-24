"""The core, buyer categories, and leads for a single founder."""
import json
from inspect import signature

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from ..lanes.erick.pull import load_dataset
from ..lanes.jakob.icp import load_research
from ..models import BuyerCategory, Edge, Evidence, Founder, Org, Path, Person, ValueNode
from ..store import FIXTURES, store
from . import categories, valuemap
from .graph import computed_founder, graph
from .paths import paths

router = APIRouter()


class KnowledgePath(Path):
    category_id: str | None


class KnowledgeCore(BaseModel):
    value_nodes: list[ValueNode]
    edges: list[Edge]


class KnowledgeLeads(BaseModel):
    people: list[Person]
    orgs: list[Org]
    edges: list[Edge]
    paths: list[KnowledgePath]


class KnowledgeGraph(BaseModel):
    founder: Founder
    core: KnowledgeCore
    categories: list[BuyerCategory]
    leads: KnowledgeLeads
    evidence: list[Evidence]


def _founder(founder_id):
    if founder_id == store.founder.id:
        return store.founder, []
    try:
        research = load_research(founder_id)
    except ValueError:
        # The graph lane can also resolve authors who have never used intake.
        data = load_dataset(founder_id)
        author = data['founder']
        papers = [Evidence(id='evidence:openalex:' + work['id'].rsplit('/', 1)[-1],
                           source_url=work['id'], quote=work['title'],
                           source_date=work.get('publication_date'), observed_at=data['observed_at'],
                           kind='paper') for work in data.get('works', []) if work.get('title')]
        if not papers:
            papers = [Evidence(id='evidence:openalex:' + author['id'].rsplit('/', 1)[-1],
                               source_url=author['id'], quote=author['display_name'], source_date=None,
                               observed_at=data['observed_at'], kind='web')]
        founder = Founder(id=founder_id, name=author['display_name'], company='',
                          openalex_id=author['id'], topics=[], summary='Cached OpenAlex author record.',
                          evidence_ids=[paper.id for paper in papers])
        return founder, papers
    return (Founder.model_validate(research['founder']),
            [Evidence.model_validate(item) for item in research['evidence']])


def _layer(name, module, founder_id):
    fixture = FIXTURES / (name.replace('-', '_') + '.json')
    if fixture.is_file():
        data = json.loads(fixture.read_text())
        metadata = data.get('_meta', {}) if isinstance(data, dict) else {}
        if metadata.get('founder_id', store.founder.id) == founder_id:
            return data

    # Reuse the lane's GET as soon as it is available, without a loopback HTTP call.
    for route in module.router.routes:
        if route.path == '/' + name and 'GET' in route.methods:
            parameters = signature(route.endpoint).parameters
            kwargs = {}
            if 'founder_id' in parameters:
                kwargs['founder_id'] = founder_id
            elif founder_id != store.founder.id:
                return None
            if 'response' in parameters:
                kwargs['response'] = Response()
            try:
                result = route.endpoint(**kwargs)
            except HTTPException as exc:
                if exc.status_code == 404:
                    return None
                raise
            return result.model_dump() if isinstance(result, BaseModel) else result
    return None


@router.get('/knowledge-graph', response_model=KnowledgeGraph)
def knowledge_graph(response: Response, founder_id: str | None = None):
    selected = computed_founder(founder_id) if founder_id is not None else store.founder.id
    graph_data = graph(response, selected)
    # Keep graph provenance and preserve the path scoring note on computed responses.
    lead_paths = paths(response, selected, buyer_org_ids=None)
    founder, founder_evidence = _founder(selected)

    value_map = _layer('value-map', valuemap, selected)
    if selected == store.founder.id:
        # The categories fixture stores plans, not the public payload: build the layer from the lane directly.
        cats, fits, _ = categories.category_layer()
        category_data = {'categories': [c.model_dump() for c in cats],
                         'edges': [e.model_dump(by_alias=True) for e in fits]}
    else:
        category_data = _layer('categories', categories, selected)
    notes = []
    if value_map is None:
        notes.append('Value map unavailable for this founder.')
    value_map = value_map or {}
    value_nodes = [ValueNode.model_validate(item) for item in value_map.get('value_nodes', [])]

    category_data = {'items': category_data} if isinstance(category_data, list) else category_data or {}
    buyer_categories = [BuyerCategory.model_validate(item) for item in
                        category_data.get('categories', category_data.get('items', []))]
    core_edges = []
    lead_edges = {edge.id: edge for edge in graph_data['edges']}
    for item in [*value_map.get('edges', []), *category_data.get('edges', []),
                 *category_data.get('fits_edges', [])]:
        edge = Edge.model_validate(item)
        if edge.type == 'FITS':
            lead_edges[edge.id] = edge
        else:
            core_edges.append(edge)

    category_by_org = {}
    for edge in lead_edges.values():
        if edge.type == 'FITS':
            category_by_org.setdefault(edge.to, edge.from_)
    if not buyer_categories:
        buyer_org_ids = {path.buyer_org_id for path in lead_paths}
        buyer_categories = [BuyerCategory(id='category:all-buyers', name='All buyers', problem_set=[],
                                          value_prop='', colour='--cat-1', problem_node_ids=[],
                                          org_ids=[org.id for org in graph_data['orgs']
                                                   if org.is_buyer or org.id in buyer_org_ids],
                                          evidence_ids=[])]
        notes.append('Buyer categories unavailable. Showing All buyers.')
    # Category membership is also part of the public category payload. Explicit FITS edges take precedence.
    for category in buyer_categories:
        for org_id in category.org_ids:
            category_by_org.setdefault(org_id, category.id)

    evidence = {item.id: item for item in [*graph_data['evidence'], *founder_evidence]}
    for item in [*value_map.get('evidence', []), *category_data.get('evidence', [])]:
        record = Evidence.model_validate(item)
        evidence[record.id] = record
    for item in [founder, *value_nodes, *buyer_categories, *core_edges, *lead_edges.values()]:
        for evidence_id in item.evidence_ids:
            if evidence_id not in evidence and (record := store.evidence.get(evidence_id)) is not None:
                evidence[evidence_id] = record

    if notes:
        response.headers['X-Knowledge-Graph-Notes'] = ' '.join(notes)
    return KnowledgeGraph(
        founder=founder,
        core=KnowledgeCore(value_nodes=value_nodes, edges=core_edges),
        categories=buyer_categories,
        leads=KnowledgeLeads(people=graph_data['people'], orgs=graph_data['orgs'], edges=list(lead_edges.values()),
                             paths=[KnowledgePath(**path.model_dump(), category_id=category_by_org.get(path.buyer_org_id))
                                    for path in lead_paths]),
        evidence=list(evidence.values()),
    )
