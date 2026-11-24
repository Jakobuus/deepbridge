import type {
  BuyersBundle,
  Card,
  Contact,
  Credits,
  Draft,
  Edge,
  Evidence,
  Founder,
  GraphBundle,
  Icp,
  Id,
  IntakeForm,
  Metrics,
  Path,
  SearchBundle,
  Stage,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const GOLDEN_FOUNDER_ID = "person:openalex:A5102978866";

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
  if (!email) return "No public email (masked / unverified)";
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return "•••@•••";
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visibleLocal = local.length <= 2 ? local[0] ?? "•" : `${local.slice(0, 2)}`;
  return `${visibleLocal}••••@${domain}`;
}

export const api = {
  health: () =>
    request<{ status: string; data: string; case: string }>(`${API_BASE}/health`),

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
