"""Python mirror of contracts/types.ts. API field names are preserved verbatim."""
from typing import Generic, Literal, TypeVar
from pydantic import BaseModel, ConfigDict, Field

Iso = str
Id = str
EdgeType = Literal['LAB_MATE', 'DUAL_AFFILIATION', 'ADVISOR_LAB', 'CO_AUTHORED', 'CITES', 'TOPIC_ALIGNED', 'AFFILIATED_AT', 'BOARD', 'PERSONAL']
Stage = Literal['found', 'path_checked', 'draft', 'approved', 'intro_asked', 'intro_made', 'pilot']
PathKind = Literal['lab_mate', 'dual_affiliation', 'advisor_lab', 'co_author', 'aligned', 'board', 'personal']
STAGES = ('found', 'path_checked', 'draft', 'approved', 'intro_asked', 'intro_made', 'pilot')

class Evidence(BaseModel):
    id: Id
    source_url: str
    quote: str
    source_date: Iso | None
    observed_at: Iso
    kind: Literal['paper', 'affiliation', 'job_post', 'filing', 'grant', 'web', 'board_page']

class Founder(BaseModel):
    id: Id
    name: str
    company: str
    openalex_id: str | None
    topics: list[str]
    summary: str
    evidence_ids: list[Id]

class BuyerRole(BaseModel):
    title: str
    why: str
    evidence_ids: list[Id]

class IcpSegment(BaseModel):
    name: str
    why: str
    evidence_ids: list[Id]

class IcpNeed(BaseModel):
    text: str
    evidence_ids: list[Id]

class Icp(BaseModel):
    founder_id: Id
    buyer_roles: list[BuyerRole]
    industries: list[IcpSegment]
    needs: list[IcpNeed]
    expansion_segments: list[IcpSegment]

class Org(BaseModel):
    id: Id
    name: str
    type: Literal['company', 'university', 'lab', 'government', 'other']
    is_buyer: bool
    buyer_score: float | None
    openalex_id: str | None

class Person(BaseModel):
    id: Id
    name: str
    openalex_id: str | None
    orcid: str | None
    org_id: Id | None
    affiliation_asof: Iso | None
    role: str | None
    is_bridge_candidate: bool
    alignment: float | None

class Edge(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    id: Id
    from_: Id = Field(alias='from')
    to: Id
    type: EdgeType
    date: Iso | None
    evidence_ids: list[Id]
    confidence: float
    name_check: Literal['unchecked', 'ok', 'rejected']
    label: str

class Path(BaseModel):
    id: Id
    founder_id: Id
    bridge_id: Id
    buyer_person_id: Id | None
    buyer_org_id: Id
    hops: list[Id]
    kind: PathKind
    score: float
    weakest_edge_id: Id
    why_now_signal_ids: list[Id]

class Signal(BaseModel):
    id: Id
    org_id: Id
    type: Literal['paper_90d', 'job_post', 'cites_founder', 'letter_of_support', 'filing']
    title: str
    date: Iso | None
    evidence_ids: list[Id]

class Draft(BaseModel):
    id: Id
    path_id: Id
    to_person_id: Id
    kind: Literal['intro_request', 'forwardable_note', 'direct_fallback']
    subject: str
    body: str
    evidence_ids: list[Id]
    content_hash: str
    status: Literal['draft', 'approved', 'rejected', 'stale']

class Approval(BaseModel):
    draft_id: Id
    content_hash: str
    decision: Literal['approve', 'reject']
    by: str
    at: Iso

class CardHistory(BaseModel):
    stage: Stage
    at: Iso
    actor: str
    actor_kind: Literal['agent', 'human']

class Card(BaseModel):
    id: Id
    path_id: Id
    stage: Stage
    history: list[CardHistory]

class CreditEvent(BaseModel):
    at: Iso
    action: str
    delta: float
    blocked: bool

class Credits(BaseModel):
    balance: float
    unit: Literal['credit']
    events: list[CreditEvent]
    source: Literal['flexprice', 'local']

class Conversion(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    from_: Stage = Field(alias='from')
    to: Stage
    rate: float

class PathKindMetrics(BaseModel):
    kind: PathKind
    count: int
    approved: int

class ActorMetrics(BaseModel):
    actor: str
    actor_kind: Literal['agent', 'human']
    actions: int

class Metrics(BaseModel):
    per_stage: dict[Stage, int]
    conversion: list[Conversion]
    by_path_kind: list[PathKindMetrics]
    by_actor: list[ActorMetrics]

class IntakeRequest(BaseModel):
    query: str

class NameCheckRequest(BaseModel):
    edge_id: Id
    decision: Literal['ok', 'rejected']

class DraftRequest(BaseModel):
    path_id: Id

class DraftEdit(BaseModel):
    subject: str
    body: str

class ApprovalRequest(BaseModel):
    draft_id: Id
    content_hash: str
    decision: Literal['approve', 'reject']

class AdvanceRequest(BaseModel):
    stage: Stage
    actor: str

class BuyersResponse(BaseModel):
    orgs: list[Org]
    signals: list[Signal]

class GraphResponse(BaseModel):
    people: list[Person]
    orgs: list[Org]
    edges: list[Edge]
    evidence: list[Evidence]

class SearchResponse(BaseModel):
    people: list[Person]
    ms: float
    engine: Literal['moss', 'cache']

# HTTP contract envelopes mirror every property of the TypeScript Api interface.
ResponseT = TypeVar('ResponseT')
RequestT = TypeVar('RequestT')

class ResponseEnvelope(BaseModel, Generic[ResponseT]):
    res: ResponseT

class BodyEnvelope(ResponseEnvelope[ResponseT], Generic[RequestT, ResponseT]):
    body: RequestT

class SearchQuery(BaseModel):
    q: str

class SearchEnvelope(ResponseEnvelope[SearchResponse]):
    query: SearchQuery

class Api(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)
    intake: BodyEnvelope[IntakeRequest, Founder] = Field(alias='POST /intake')
    icp: ResponseEnvelope[Icp] = Field(alias='GET /icp')
    buyers: ResponseEnvelope[BuyersResponse] = Field(alias='GET /buyers')
    graph: ResponseEnvelope[GraphResponse] = Field(alias='GET /graph')
    paths: ResponseEnvelope[list[Path]] = Field(alias='GET /paths')
    name_check: BodyEnvelope[NameCheckRequest, Edge] = Field(alias='POST /name-check')
    drafts: BodyEnvelope[DraftRequest, list[Draft]] = Field(alias='POST /drafts')
    edit_draft: BodyEnvelope[DraftEdit, Draft] = Field(alias='PUT /drafts/{id}')
    approve: BodyEnvelope[ApprovalRequest, Draft] = Field(alias='POST /approve')
    pipeline: ResponseEnvelope[list[Card]] = Field(alias='GET /pipeline')
    advance: BodyEnvelope[AdvanceRequest, Card] = Field(alias='POST /pipeline/{card_id}/advance')
    metrics: ResponseEnvelope[Metrics] = Field(alias='GET /metrics')
    credits: ResponseEnvelope[Credits] = Field(alias='GET /credits')
    search: SearchEnvelope = Field(alias='GET /search')
    evidence: ResponseEnvelope[Evidence] = Field(alias='GET /evidence/{id}')
