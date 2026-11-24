"use client";

import * as React from "react";
import { API_BASE } from "@/lib/api";
import type { BuyerCategory, Edge, Evidence, Id, Org, Path, Person, ValueNode } from "@/lib/types";

// Replays GET /graph/stream (SSE, event name "graph", then "end") and grows a graph from it.
// No reconnect: on error the caller falls back to the static /knowledge-graph render.

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
}

function upsert<T extends { id: Id }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function apply(s: GraphStreamState, e: GraphEvent): GraphStreamState {
  let next: GraphStreamState = { ...s, status: "streaming", count: s.count + 1 };
  if (e.evidence?.length) {
    let ev = next.evidence;
    for (const x of e.evidence) ev = upsert(ev, x);
    next.evidence = ev;
  }
  switch (e.kind) {
    case "status":
      next.statusText = e.status ?? next.statusText;
      break;
    case "category":
      if (e.node) next.categories = upsert(next.categories, e.node as unknown as BuyerCategory);
      break;
    case "node": {
      const n = e.node;
      if (!n) break;
      const id = String(n.id);
      if (id.startsWith("person:")) {
        next.people = upsert(next.people, n as unknown as Person);
        // HACK: the first person in the core layer is the founder
        if (!next.founderPersonId && e.layer === "core") {
          next.founderPersonId = id;
          next.founderName = String(n.name ?? "");
        }
      } else if (id.startsWith("org:")) {
        next.orgs = upsert(next.orgs, n as unknown as Org);
      } else if (id.startsWith("value:")) {
        next.valueNodes = upsert(next.valueNodes, n as unknown as ValueNode);
      }
      break;
    }
    case "edge":
      if (e.edge) next.edges = upsert(next.edges, e.edge);
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

export function useGraphStream(sessionId: string | null, speed = 8): GraphStreamState {
  const [state, setState] = React.useState<GraphStreamState>(EMPTY);

  React.useEffect(() => {
    if (!sessionId) {
      setState(EMPTY);
      return;
    }
    setState({ ...EMPTY, status: "connecting" });
    const url = `${API_BASE}/graph/stream?session_id=${encodeURIComponent(sessionId)}&speed=${speed}`;
    const es = new EventSource(url);
    let finished = false;

    es.addEventListener("graph", (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as GraphEvent;
        setState((s) => apply(s, ev));
      } catch {
        // ignore malformed event
      }
    });
    es.addEventListener("end", () => {
      finished = true;
      es.close();
      setState((s) => ({ ...s, status: "done" }));
    });
    es.onerror = () => {
      if (finished) return;
      es.close(); // reconnect-free
      setState((s) => ({ ...s, status: "error" })); // caller falls back to static graph
    };
    return () => {
      finished = true;
      es.close();
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
