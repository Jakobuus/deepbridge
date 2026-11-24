import type {
  Briefing,
  BuyerCategory,
  BuyersBundle,
  Card,
  ConnectorStatus,
  Contact,
  Credits,
  Draft,
  Edge,
  Evidence,
  FetchedConnectorDoc,
  Founder,
  GraphBundle,
  GraphEvent,
  Icp,
  Id,
  IntakeForm,
  InterviewResponse,
  KnowledgeGraph,
  Metrics,
  Path,
  SearchBundle,
  Stage,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const HOPO_FOUNDER_ID = "person:openalex:A5043992375";
export const GOLDEN_FOUNDER_ID = "person:openalex:A5102978866";
export const DEMO_SESSION_ID = "demo-hopo";
export const FALLBACK_SESSION_ID = "demo-lightmatter";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function withFounder(path: string, founderId?: string | null): string {
  if (!founderId) return `${API_BASE}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${sep}founder_id=${encodeURIComponent(founderId)}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") {
        detail = data.detail;
      } else if (data?.detail) {
        detail = JSON.stringify(data.detail);
      }
    } catch {
      // ignore non-json error bodies
    }
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
}

/** Mask email addresses on stage per honesty & privacy rules. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "No public email (masked)";
  const trimmed = email.trim();
  if (trimmed.includes("*")) return trimmed;
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return "•••@•••";
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visibleLocal = local.length <= 2 ? local[0] ?? "•" : `${local.slice(0, 2)}`;
  return `${visibleLocal}••••@${domain}`;
}

export function graphStreamUrl(sessionId: string, speed?: number, fromSeq?: number): string {
  const params = new URLSearchParams({ session_id: sessionId });
  if (speed && speed > 0) params.set("speed", String(speed));
  if (fromSeq !== undefined && fromSeq >= 0) params.set("from_seq", String(fromSeq));
  return `${API_BASE}/graph/stream?${params.toString()}`;
}

export const api = {
  health: () =>
    request<{ status: string; data: string; case: string }>(`${API_BASE}/health`),

  getConnectors: () =>
    request<ConnectorStatus[]>(`${API_BASE}/connectors`),

  fetchConnector: (id: "notion" | "gdrive", url: string) =>
    request<FetchedConnectorDoc>(`${API_BASE}/connectors/${id}/fetch`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  createBriefing: (
    body: {
      founder_name: string;
      startup_name?: string;
      paper_links: string[];
      website?: string;
      notes?: string;
      notion_urls?: string[];
      gdoc_urls?: string[];
      mode: "stage" | "full";
    },
    sessionId?: string,
  ) =>
    request<Briefing>(`${API_BASE}/interview/brief`, {
      method: "POST",
      headers: sessionId ? { "X-Interview-Session-Id": sessionId } : undefined,
      body: JSON.stringify(body),
    }),

  getBriefing: (sessionId: string) =>
    request<Briefing>(`${API_BASE}/interview/brief/${encodeURIComponent(sessionId)}`),

  submitInterviewTurn: (body: {
    session_id: string;
    role: "founder" | "interviewer";
    text: string;
  }) =>
    request<{ ok: true }>(`${API_BASE}/interview/turn`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getGraphEvents: (sessionId: string) =>
    request<GraphEvent[]>(
      `${API_BASE}/graph/events?session_id=${encodeURIComponent(sessionId)}`,
    ),

  interview: (body: {
    session_id?: string | null;
    answer?: string | null;
    paper_links?: string[];
    founder_id?: string | null;
  }) =>
    request<InterviewResponse>(`${API_BASE}/interview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  intake: (body: IntakeForm | { query: string }) =>
    request<Founder>(`${API_BASE}/intake`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getIcp: (founderId?: string | null) =>
    request<Icp>(withFounder("/icp", founderId)),

  getBuyers: (founderId?: string | null) =>
    request<BuyersBundle>(withFounder("/buyers", founderId)),

  getGraph: (founderId?: string | null) =>
    request<GraphBundle>(withFounder("/graph", founderId)),

  getPaths: (founderId?: string | null) =>
    request<Path[]>(withFounder("/paths", founderId)),

  getCategories: (founderId?: string | null) =>
    request<BuyerCategory[]>(withFounder("/categories", founderId)),

  getKnowledgeGraph: (founderId?: string | null) =>
    request<KnowledgeGraph>(withFounder("/knowledge-graph", founderId)),

  nameCheck: (edgeId: Id, decision: "ok" | "rejected") =>
    request<Edge>(`${API_BASE}/name-check`, {
      method: "POST",
      body: JSON.stringify({ edge_id: edgeId, decision }),
    }),

  generateDrafts: (pathId: Id) =>
    request<Draft[]>(`${API_BASE}/drafts`, {
      method: "POST",
      body: JSON.stringify({ path_id: pathId }),
    }),

  editDraft: (draftId: Id, subject: string, body: string) =>
    request<Draft>(`${API_BASE}/drafts/${encodeURIComponent(draftId)}`, {
      method: "PUT",
      body: JSON.stringify({ subject, body }),
    }),

  approveDraft: (draftId: Id, contentHash: string, decision: "approve" | "reject") =>
    request<Draft>(`${API_BASE}/approve`, {
      method: "POST",
      body: JSON.stringify({
        draft_id: draftId,
        content_hash: contentHash,
        decision,
      }),
    }),

  getPipeline: () => request<Card[]>(`${API_BASE}/pipeline`),

  advanceCard: (cardId: Id, stage: Stage, actor: string) =>
    request<Card>(`${API_BASE}/pipeline/${encodeURIComponent(cardId)}/advance`, {
      method: "POST",
      body: JSON.stringify({ stage, actor }),
    }),

  getMetrics: () => request<Metrics>(`${API_BASE}/metrics`),

  getCredits: () => request<Credits>(`${API_BASE}/credits`),

  searchPeople: (q: string) =>
    request<SearchBundle>(`${API_BASE}/search?q=${encodeURIComponent(q)}`),

  getEvidence: (evidenceId: Id) =>
    request<Evidence>(`${API_BASE}/evidence/${encodeURIComponent(evidenceId)}`),

  getContact: (personId: Id) =>
    request<Contact>(`${API_BASE}/contacts/${encodeURIComponent(personId)}`),

  refreshContact: (personId: Id) =>
    request<Contact>(`${API_BASE}/contacts/${encodeURIComponent(personId)}/refresh`, {
      method: "POST",
    }),
};
