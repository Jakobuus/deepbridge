// Mirror of ../contracts/types.ts — do not diverge from shared contract shapes.

export type Iso = string;
export type Id = string;

export interface Evidence {
  id: Id;
  source_url: string;
  quote: string;
  source_date: Iso | null;
  observed_at: Iso;
  kind: "paper" | "affiliation" | "job_post" | "filing" | "grant" | "web" | "board_page";
}

export interface IntakeForm {
  name: string;
  expertise: string;
  paper_links: string[];
  startup_url: string | null;
  customer_persona: string;
  interview_transcript: string | null;
}

export interface Founder {
  id: Id;
  name: string;
  company: string;
  openalex_id: string | null;
  topics: string[];
  summary: string;
  evidence_ids: Id[];
}

export interface Icp {
  founder_id: Id;
  buyer_roles: { title: string; why: string; evidence_ids: Id[] }[];
  industries: { name: string; why: string; evidence_ids: Id[] }[];
  needs: { text: string; evidence_ids: Id[] }[];
  expansion_segments: { name: string; why: string; evidence_ids: Id[] }[];
}

export interface Org {
  id: Id;
  name: string;
  type: "company" | "university" | "lab" | "government" | "other";
  is_buyer: boolean;
  buyer_score: number | null;
  openalex_id: string | null;
}

export interface Person {
  id: Id;
  name: string;
  openalex_id: string | null;
  orcid: string | null;
  org_id: Id | null;
  affiliation_asof: Iso | null;
  role: string | null;
  is_bridge_candidate: boolean;
  alignment: number | null;
}

export type EdgeType =
  | "LAB_MATE"
  | "DUAL_AFFILIATION"
  | "ADVISOR_LAB"
  | "CO_AUTHORED"
  | "CITES"
  | "TOPIC_ALIGNED"
  | "AFFILIATED_AT"
  | "BOARD"
  | "PERSONAL"
  | "ENABLES"
  | "DELIVERS"
  | "SOLVES"
  | "FITS";

export interface Edge {
  id: Id;
  from: Id;
  to: Id;
  type: EdgeType;
  date: Iso | null;
  evidence_ids: Id[];
  confidence: number;
  name_check: "unchecked" | "ok" | "rejected";
  label: string;
}

export interface Path {
  id: Id;
  founder_id: Id;
  bridge_id: Id;
  buyer_person_id: Id | null;
  buyer_org_id: Id;
  hops: Id[];
  kind: "lab_mate" | "dual_affiliation" | "advisor_lab" | "co_author" | "aligned" | "board" | "personal";
  score: number;
  weakest_edge_id: Id;
  why_now_signal_ids: Id[];
  category_id?: Id | null;
}

export interface Signal {
  id: Id;
  org_id: Id;
  type: "paper_90d" | "job_post" | "cites_founder" | "letter_of_support" | "filing";
  title: string;
  date: Iso | null;
  evidence_ids: Id[];
}

export interface DraftCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Draft {
  id: Id;
  path_id: Id;
  to_person_id: Id;
  kind: "intro_request" | "forwardable_note" | "direct_fallback";
  subject: string;
  body: string;
  evidence_ids: Id[];
  content_hash: string;
  status: "draft" | "approved" | "rejected" | "stale";
  checks?: DraftCheck[];
}

export interface Contact {
  person_id: Id;
  current_role: string | null;
  current_org: string | null;
  current_asof: Iso | null;
  email: string | null;
  email_status: "verified" | "guessed" | "none";
  profiles: { kind: "linkedin" | "homepage" | "scholar" | "orcid" | "github" | "other"; url: string }[];
  assessment: string | null;
  source: "moss_task" | "hunter" | "pattern" | "cache";
  evidence_ids: Id[];
}

export interface Approval {
  draft_id: Id;
  content_hash: string;
  decision: "approve" | "reject";
  by: string;
  at: Iso;
}

export type Stage = "found" | "path_checked" | "draft" | "approved" | "intro_asked" | "intro_made" | "pilot";

export interface Card {
  id: Id;
  path_id: Id;
  stage: Stage;
  history: { stage: Stage; at: Iso; actor: string; actor_kind: "agent" | "human" }[];
}

export interface Credits {
  balance: number;
  unit: "credit";
  events: { at: Iso; action: string; delta: number; blocked: boolean }[];
  source: "flexprice" | "local";
}

export interface Metrics {
  per_stage: Record<Stage, number>;
  conversion: { from: Stage; to: Stage; rate: number }[];
  by_path_kind: { kind: Path["kind"]; count: number; approved: number }[];
  by_actor: { actor: string; actor_kind: "agent" | "human"; actions: number }[];
}

export interface ValueNode {
  id: Id;
  kind: "feature" | "benefit" | "value" | "problem";
  text: string;
  source: "paper" | "founder" | "inferred";
  evidence_ids: Id[];
}

export interface BuyerCategory {
  id: Id;
  name: string;
  problem_set: string[];
  value_prop: string;
  colour: string;
  org_ids: Id[];
  problem_node_ids: Id[];
  evidence_ids: Id[];
}

export interface KnowledgeGraph {
  founder: Founder;
  core: { value_nodes: ValueNode[]; edges: Edge[] };
  categories: BuyerCategory[];
  leads: {
    people: Person[];
    orgs: Org[];
    edges: Edge[];
    paths: Path[];
    signals?: Signal[];
  };
  evidence: Evidence[];
}

export interface GraphEvent {
  seq: number;
  at: Iso;
  session_id: string;
  phase: "reading" | "interview" | "discovery" | "paths";
  kind: "node" | "edge" | "path" | "category" | "status";
  layer: "core" | "category" | "lead";
  node?: ValueNode | Person | Org | BuyerCategory;
  edge?: Edge;
  path?: Path;
  evidence?: Evidence[];
  status?: string;
}

export interface SourceDoc {
  kind: "paper" | "website" | "notes" | "notion" | "gdoc";
  url: string | null;
  title: string;
  text: string;
}

export interface Briefing {
  session_id: string;
  founder: Founder;
  sources: { kind: SourceDoc["kind"]; url: string | null; title: string }[];
  understanding: string;
  claims: { text: string; source: SourceDoc["kind"]; evidence_ids: Id[] }[];
  gaps: string[];
  interviewer_instructions: string;
}

export interface ConnectorStatus {
  id: "notion" | "gdrive";
  name: string;
  connected: boolean;
  setup: string;
}

export interface FetchedConnectorDoc {
  title: string;
  url: string;
  text: string;
}

export interface ValueProposition {
  one_liner: string;
  for_whom: string;
  pain: string;
  proof_points: { text: string; source: string }[];
  buyer_roles: string[];
}

export interface InterviewResponse {
  session_id: string;
  question: string | null;
  form: Partial<IntakeForm>;
  done: boolean;
  ms: number;
  engine: "moss" | "script";
  value_proposition?: ValueProposition | null;
  founder?: Founder | null;
  paper_evidence?: Evidence[];
}

export interface GraphBundle {
  people: Person[];
  orgs: Org[];
  edges: Edge[];
  evidence: Evidence[];
}

export interface BuyersBundle {
  orgs: Org[];
  signals: Signal[];
}

export interface SearchBundle {
  people: Person[];
  ms: number;
  engine: "moss" | "cache";
}
