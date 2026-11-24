"use client";

import * as React from "react";
import { API_BASE } from "@/lib/api";
import type { BuyerCategory, Edge, Evidence, Id, Org, Path, Person, ValueNode } from "@/lib/types";

// Replays GET /graph/stream (SSE, event name "graph", then "end") and grows a graph from it.
// After the replay ends it keeps following the same session live (speed=1, from_seq=last_seq), so interview
// updates from POST /graph/sharpen (confirm/fade, category weights, add_nodes, strengthen) appear as they happen.
// On a replay error the caller falls back to the static /knowledge-graph render.

export type GraphStreamStatus = "off" | "connecting" | "streaming" | "done" | "error";

export interface GraphStreamState {
  status: GraphStreamStatus;
  statusText: string | null;
  founderPersonId: Id | null;
  founderName: string | null;
  people: Person[];
  orgs: Org[];
  valueNodes: ValueNode[];
  categories: BuyerCategory[];
  edges: Edge[];
  paths: Path[];
  evidence: Evidence[];
  latestPathId: Id | null;
  bestPathId: Id | null;
  count: number;
  /** true once the replay is done and the live tail is connected (interview updates flow in). */
  live: boolean;
}

const EMPTY: GraphStreamState = {
  status: "off",
  statusText: null,
  founderPersonId: null,
  founderName: null,
  people: [],
  orgs: [],
  valueNodes: [],
  categories: [],
  edges: [],
  paths: [],
  evidence: [],
  latestPathId: null,
  bestPathId: null,
  count: 0,
  live: false,
};

interface GraphEvent {
  kind: "status" | "node" | "edge" | "category" | "path";
  layer?: string;
  status?: string;
  node?: Record<string, unknown> & { id: Id };
  edge?: Edge;
  path?: Path;
  evidence?: Evidence[];
  seq: number;
  // interview updates from POST /graph/sharpen
  action?: "add" | "strengthen";
  state?: "confirmed" | "faded";
  weight?: number;
  drop_in?: boolean;
  target?: Id;
}

// Merge, never replace: update events (e.g. {id, weight} or {id} + state) must not wipe an item's name/colour.
function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = { ...list[i], ...item };
  return next;
}

function apply(s: GraphStreamState, e: GraphEvent): GraphStreamState {
  let next: GraphStreamState = { ...s, status: s.status === "done" ? "done" : "streaming", count: s.count + 1 };
  if (e.evidence?.length) {
    let ev = next.evidence;
    for (const x of e.evidence) ev = upsert(ev, x);
    next.evidence = ev;
  }
  // Interview flags ride along on the item so the renderer can brighten/fade/drop in/resize.
  const flags: Record<string, unknown> = {};
  if (e.state) flags.state = e.state;
  if (typeof e.weight === "number") flags.weight = e.weight;
  if (e.drop_in) flags.drop_in = true;
  switch (e.kind) {
    case "status":
      next.statusText = e.status ?? next.statusText;
      break;
    case "category":
      if (e.node) next.categories = upsert(next.categories, { ...e.node, ...flags } as unknown as BuyerCategory);
      break;
    case "node": {
      const n = e.node ? { ...e.node, ...flags } : null;
      if (!n) break;
      const id = String(n.id);
      if (id.startsWith("interview:")) {
        // Nodes the founder named in the interview (POST /graph/sharpen add_nodes); labels are hers, verbatim.
        const kind = String(n.kind ?? "");
        const name = String(n.name ?? id);
        if (kind === "buyer") {
          next.orgs = upsert(next.orgs, {
            ...n, id, name, type: "company", is_buyer: true, buyer_score: null, openalex_id: null,
          } as unknown as Org);
        } else if (kind === "person") {
          next.people = upsert(next.people, {
            ...n, id, name, openalex_id: null, orcid: null, org_id: null, affiliation_asof: null, role: null,
            is_bridge_candidate: false, alignment: null,
          } as unknown as Person);
        } else {
          next.valueNodes = upsert(next.valueNodes, {
            ...n, id, kind: "value", text: name, source: "founder", evidence_ids: [],
          } as unknown as ValueNode);
        }
      } else if (id.startsWith("person:")) {
        next.people = upsert(next.people, n as unknown as Person);
        // HACK: the first person in the core layer is the founder
        if (!next.founderPersonId && e.layer === "core" && n.name) {
          next.founderPersonId = id;
          next.founderName = String(n.name ?? "");
        }
      } else if (id.startsWith("org:")) {
        next.orgs = upsert(next.orgs, n as unknown as Org);
      } else if (id.startsWith("value:")) {
        next.valueNodes = upsert(next.valueNodes, n as unknown as ValueNode);
      } else if (id.startsWith("category:")) {
        next.categories = upsert(next.categories, n as unknown as BuyerCategory);
      }
      break;
    }
    case "edge":
      if (e.edge) {
        const extra: Record<string, unknown> = {};
        if (e.action) extra.action = e.action;
        if (e.target) extra.target = e.target;
        next.edges = upsert(next.edges, { ...e.edge, ...extra } as Edge);
      }
      break;
    case "path":
      if (e.path) {
        const paths = upsert(next.paths, e.path);
        const best = paths.reduce((a, b) => (b.score > a.score ? b : a));
        next = { ...next, paths, latestPathId: e.path.id, bestPathId: best.id };
      }
      break;
  }
  return next;
}

export function useGraphStream(sessionId: string | null, speed = 24): GraphStreamState {
  const [state, setState] = React.useState<GraphStreamState>(EMPTY);

  React.useEffect(() => {
    if (!sessionId) {
      setState(EMPTY);
      return;
    }
    setState({ ...EMPTY, status: "connecting" });
    let closed = false;
    let lastSeq = 0;
    let live: EventSource | null = null;

    const onGraph = (msg: Event) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as GraphEvent;
        if (typeof ev.seq === "number") {
          if (ev.seq <= lastSeq) return; // no duplicates across replay -> live hand-over
          lastSeq = ev.seq;
        }
        setState((s) => apply(s, ev));
      } catch {
        // ignore malformed event
      }
    };

    const url = `${API_BASE}/graph/stream?session_id=${encodeURIComponent(sessionId)}&speed=${speed}`;
    const es = new EventSource(url);
    let replayDone = false;
    es.addEventListener("graph", onGraph);
    es.addEventListener("end", (msg) => {
      replayDone = true;
      es.close();
      try {
        const d = JSON.parse((msg as MessageEvent).data) as { last_seq?: number };
        if (typeof d.last_seq === "number") lastSeq = Math.max(lastSeq, d.last_seq);
      } catch {
        // keep lastSeq from the events
      }
      setState((s) => ({ ...s, status: "done" }));
      if (closed) return;
      // Live tail: follow new events for this session (interview sharpen updates). EventSource reconnects on its
      // own and the server resumes from Last-Event-ID, so a dropped connection doesn't lose events.
      live = new EventSource(
        `${API_BASE}/graph/stream?session_id=${encodeURIComponent(sessionId)}&speed=1&from_seq=${lastSeq}`,
      );
      live.addEventListener("graph", onGraph);
      live.onopen = () => setState((s) => ({ ...s, live: true }));
      live.onerror = () => setState((s) => ({ ...s, live: false }));
    });
    es.onerror = () => {
      if (replayDone || closed) return;
      es.close(); // replay failed: caller falls back to the static graph
      setState((s) => ({ ...s, status: "error" }));
    };
    return () => {
      closed = true;
      es.close();
      live?.close();
    };
  }, [sessionId, speed]);

  return state;
}

/** Reads ?session=<id> (or ?stream=1 → demo-hopo) from the URL, client-side only. */
export function useStreamSessionParam(): string | null {
  const [sid, setSid] = React.useState<string | null>(null);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("session") || (q.get("stream") === "1" ? "demo-hopo" : null);
    setSid(s);
  }, []);
  return sid;
}
