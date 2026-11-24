// DeepBridge shared contract. Every lane builds against these shapes.
// Change only via the orchestrator (post on the board first). Python mirror: service/app/models.py.

export type Iso = string; // ISO date "2026-11-24" or datetime
export type Id = string;  // stable slug, e.g. "person:openalex:A5061412493", "org:openalex:I4210114444"

/** Every claim on screen points to one of these. Never shown without source_url. */
export interface Evidence {
  id: Id;
  source_url: string;          // where a human can check it
  quote: string;               // verbatim text or "field: value" from an API response
  source_date: Iso | null;     // date of the evidence itself (paper year, post date)
  observed_at: Iso;            // when we fetched it
  kind: "paper" | "affiliation" | "job_post" | "filing" | "grant" | "web" | "board_page";
}

/** Sign-up / intake form (Jakob 11:10: name, area of expertise, paper links, startup link, customer persona). */
export interface IntakeForm {
  name: string; expertise: string; paper_links: string[]; startup_url: string | null;
  customer_persona: string; interview_transcript: string | null; // optional voice interview (stretch)
}

export interface Founder {
  id: Id; name: string; company: string;
  openalex_id: string | null; topics: string[]; summary: string; evidence_ids: Id[];
}

export interface Icp {
  founder_id: Id;
  buyer_roles: { title: string; why: string; evidence_ids: Id[] }[];
  industries: { name: string; why: string; evidence_ids: Id[] }[];
  needs: { text: string; evidence_ids: Id[] }[];
  expansion_segments: { name: string; why: string; evidence_ids: Id[] }[];
}

export interface Org {
  id: Id; name: string; type: "company" | "university" | "lab" | "government" | "other";
  is_buyer: boolean; buyer_score: number | null; // 0-100, from on-topic papers + signals
  openalex_id: string | null;
}

export interface Person {
  id: Id; name: string; openalex_id: string | null; orcid: string | null;
  org_id: Id | null;            // affiliation as of affiliation_asof, NOT necessarily current job
  affiliation_asof: Iso | null;
  role: string | null;          // only when a dated source states it
  is_bridge_candidate: boolean;
  alignment: number | null;     // 0-1, topic passion/alignment (Moss + recent output)
}

export type EdgeType =
  | "LAB_MATE"          // co-authored while both at the founder's lab/university
  | "DUAL_AFFILIATION"  // same paper lists person at university AND company
  | "ADVISOR_LAB"       // reached via the founder's PhD advisor's co-authors
  | "CO_AUTHORED"       // any shared paper
  | "CITES"             // person's paper cites the founder's paper
  | "TOPIC_ALIGNED"     // publishes on the same topic (passion/alignment), no shared paper
  | "AFFILIATED_AT"     // person -> org, as of a date
  | "BOARD"             // shared board/advisor listing
  | "PERSONAL"          // from the owner's own network (Connect The Dots), labelled
  | "ENABLES"           // value map: feature -> benefit
  | "DELIVERS"          // value map: benefit -> value
  | "SOLVES"            // value map: value -> problem (a buyer category's problem set)
  | "FITS";             // buyer category -> org (this org has that problem set, with evidence)

export interface Edge {
  id: Id; from: Id; to: Id; type: EdgeType;
  date: Iso | null;             // date of the latest evidence
  evidence_ids: Id[];
  confidence: number;           // 0-1
  name_check: "unchecked" | "ok" | "rejected"; // human check of identity
  label: string;                // short UI text, e.g. "co-authored 2017 (MIT)" — never "knows"
}

export interface Path {
  id: Id; founder_id: Id; bridge_id: Id; buyer_person_id: Id | null; buyer_org_id: Id;
  hops: Id[];                   // edge ids in order founder -> ... -> buyer
  kind: "lab_mate" | "dual_affiliation" | "advisor_lab" | "co_author" | "aligned" | "board" | "personal";
  score: number;                // 0-100
  weakest_edge_id: Id;
  why_now_signal_ids: Id[];
}

export interface Signal {
  id: Id; org_id: Id; type: "paper_90d" | "job_post" | "cites_founder" | "letter_of_support" | "filing";
  title: string; date: Iso | null; evidence_ids: Id[];
}

export interface Draft {
  id: Id; path_id: Id; to_person_id: Id;
  kind: "intro_request" | "forwardable_note" | "direct_fallback";
  subject: string; body: string; evidence_ids: Id[];
  content_hash: string;         // sha256 of subject+"\n"+body; approval binds to this
  status: "draft" | "approved" | "rejected" | "stale"; // stale = edited after approval
}

/** Verified contact resolution for a bridge or buyer person (Moss Tasks API, then Hunter, then pattern). */
export interface Contact {
  person_id: Id; current_role: string | null; current_org: string | null; current_asof: Iso | null;
  email: string | null; email_status: "verified" | "guessed" | "none";
  profiles: { kind: "linkedin" | "homepage" | "scholar" | "orcid" | "github" | "other"; url: string }[];
  assessment: string | null; source: "moss_task" | "hunter" | "pattern" | "cache"; evidence_ids: Id[];
}

export interface Approval { draft_id: Id; content_hash: string; decision: "approve" | "reject"; by: string; at: Iso; }

export type Stage = "found" | "path_checked" | "draft" | "approved" | "intro_asked" | "intro_made" | "pilot";
export interface Card {
  id: Id; path_id: Id; stage: Stage;
  history: { stage: Stage; at: Iso; actor: string; actor_kind: "agent" | "human" }[];
}

export interface Credits { balance: number; unit: "credit"; events: { at: Iso; action: string; delta: number; blocked: boolean }[]; source: "flexprice" | "local"; }

export interface Metrics {
  per_stage: Record<Stage, number>;
  conversion: { from: Stage; to: Stage; rate: number }[];
  by_path_kind: { kind: Path["kind"]; count: number; approved: number }[];
  by_actor: { actor: string; actor_kind: "agent" | "human"; actions: number }[];
}

/** Layered knowledge graph (Jakob 12:12): one interface, core layer = founder + papers + value map,
 *  outer layers = buyer categories (colour per category, by problem set) -> leads/paths. */
export interface ValueNode {
  id: Id; kind: "feature" | "benefit" | "value" | "problem";
  text: string; source: "paper" | "founder" | "inferred"; evidence_ids: Id[];
}
export interface BuyerCategory {
  id: Id; name: string;               // e.g. "Hyperscale AI infrastructure"
  problem_set: string[];              // problems this category has
  value_prop: string;                 // how the founder's value fits these problems (one line, grounded)
  colour: string;                     // design token name, e.g. "--cat-1"; UI maps it to a colour
  org_ids: Id[]; problem_node_ids: Id[]; evidence_ids: Id[];
}
export interface KnowledgeGraph {
  founder: Founder;
  core: { value_nodes: ValueNode[]; edges: Edge[] };              // ENABLES / DELIVERS / SOLVES
  categories: BuyerCategory[];                                   // FITS edges are in leads.edges
  leads: { people: Person[]; orgs: Org[]; edges: Edge[]; paths: Path[] };
  evidence: Evidence[];
}

/** Live graph building (Jakob 12:35): while the AI reads the founder's sources and during the interview, the graph
 *  grows on screen and warm-path candidates light up. Every producer publishes GraphEvents; the UI follows the stream.
 *  Fast-forward = replay of a session's events at speed N (video / stage). */
export interface GraphEvent {
  seq: number; at: Iso; session_id: string;
  phase: "reading" | "interview" | "discovery" | "paths";
  kind: "node" | "edge" | "path" | "category" | "status";
  layer: "core" | "category" | "lead";
  node?: ValueNode | Person | Org | BuyerCategory; edge?: Edge; path?: Path; evidence?: Evidence[];
  status?: string;                    // short human line, e.g. "Reading paper: 'Deep learning with coherent…'"
}
export interface SourceDoc { kind: "paper" | "website" | "notes" | "notion" | "gdoc"; url: string | null; title: string; text: string; }
export interface Briefing {
  session_id: string; founder: Founder; sources: { kind: SourceDoc["kind"]; url: string | null; title: string }[];
  understanding: string;              // one sentence the interviewer reads back ("Here's how I read your paper…")
  claims: { text: string; source: SourceDoc["kind"]; evidence_ids: Id[] }[];
  gaps: string[];                     // what the sources don't say -> asked first in the interview
  interviewer_instructions: string;   // full system prompt for the live voice session (stage or full mode)
}

/** HTTP API (FastAPI, base http://localhost:8000). All GETs accept ?founder_id=. */
export interface Api {
  "POST /intake": { body: IntakeForm | { query: string }; res: Founder }; // form, or a name/DOI for "try any founder"
  "GET /icp": { res: Icp };
  "GET /buyers": { res: { orgs: Org[]; signals: Signal[] } };
  "GET /graph": { res: { people: Person[]; orgs: Org[]; edges: Edge[]; evidence: Evidence[] } };
  "GET /paths": { res: Path[] };
  "POST /name-check": { body: { edge_id: Id; decision: "ok" | "rejected" }; res: Edge };
  "POST /drafts": { body: { path_id: Id }; res: Draft[] };            // debits 1 credit; 402 when balance 0
  "PUT /drafts/{id}": { body: { subject: string; body: string }; res: Draft };
  "POST /approve": { body: { draft_id: Id; content_hash: string; decision: "approve" | "reject" }; res: Draft };
  "GET /pipeline": { res: Card[] };
  "POST /pipeline/{card_id}/advance": { body: { stage: Stage; actor: string }; res: Card };
  "GET /metrics": { res: Metrics };
  "GET /credits": { res: Credits };
  "GET /search": { query: { q: string }; res: { people: Person[]; ms: number; engine: "moss" | "cache" } };
  "GET /evidence/{id}": { res: Evidence };
  "GET /contacts/{person_id}": { res: Contact };
  "GET /value-map": { res: { value_nodes: ValueNode[]; edges: Edge[]; evidence: Evidence[] } }; // from papers + interview
  "POST /value-map": { body: { session_id?: string }; res: { value_nodes: ValueNode[]; edges: Edge[]; evidence: Evidence[] } };
  "GET /categories": { res: BuyerCategory[] };
  "GET /knowledge-graph": { res: KnowledgeGraph };                  // the one layered view
  "POST /interview/brief": { body: { founder_name: string; startup_name?: string; paper_links: string[]; website?: string;
      notes?: string; notion_urls?: string[]; gdoc_urls?: string[]; mode: "stage" | "full" }; res: Briefing }; // publishes "reading" events
  "GET /interview/brief/{session_id}": { res: Briefing };           // the voice app fetches its instructions here
  "POST /interview/turn": { body: { session_id: string; role: "founder" | "interviewer"; text: string }; res: { ok: true } }; // publishes "interview" events
  "POST /interview/transcript": { body: { session_id?: string; founder_name: string; startup_name?: string; paper_link?: string;
      abstract?: string; transcript: string | { role: string; text: string }[] }; res: { session_id: string; value_proposition: unknown } };
  "GET /graph/stream": { query: { session_id: string; speed?: number; from_seq?: number }; res: "text/event-stream of GraphEvent" };
  "GET /graph/events": { query: { session_id: string }; res: GraphEvent[] };  // full log for replay                    // shown masked on stage; nothing is sent
}
