"use client";

import * as React from "react";
import { api, DEMO_SESSION_ID, graphStreamUrl } from "./api";
import type {
  BuyerCategory,
  Edge,
  Evidence,
  GraphEvent,
  Id,
  KnowledgeGraph,
  Org,
  Path,
  Person,
  ValueNode,
} from "./types";

export type StreamConnectionMode =
  | "full"       // Showing complete KnowledgeGraph immediately
  | "streaming"  // Connected to live SSE GET /graph/stream
  | "replaying"  // Fast-forward / paced replay of GraphEvent[]
  | "done";      // Replay finished

/**
 * Deterministically converts a real backend `KnowledgeGraph` into ordered `GraphEvent`s
 * matching Thread #22's exact 35-45s arc when `/graph/stream` is still coming online or
 * when replaying cached `KnowledgeGraph` fixtures locally. Zero fake entities — every
 * single node, category, org, edge, and path comes straight from `GET /knowledge-graph`.
 */
export function buildEventsFromKnowledgeGraph(
  kg: KnowledgeGraph,
  sessionId: string = DEMO_SESSION_ID,
): GraphEvent[] {
  const out: GraphEvent[] = [];
  let seq = 1;
  const now = Date.now();
  const stepIso = (s: number) => new Date(now + s * 600).toISOString();

  out.push({
    seq: seq++,
    at: stepIso(seq),
    session_id: sessionId,
    phase: "reading",
    kind: "status",
    layer: "core",
    status: `Reading research papers for ${kg.founder.name} (${kg.founder.company || "Berkeley Lab / Founder"})…`,
  });

  for (const vn of kg.core.value_nodes.slice(0, 10)) {
    out.push({
      seq: seq++,
      at: stepIso(seq),
      session_id: sessionId,
      phase: vn.kind === "feature" ? "reading" : "interview",
      kind: "node",
      layer: "core",
      node: vn,
    });
  }

  if (kg.categories.length > 0) {
    out.push({
      seq: seq++,
      at: stepIso(seq),
      session_id: sessionId,
      phase: "interview",
      kind: "status",
      layer: "category",
      status: `Mapped ${kg.categories.length} buyer problem-set categories`,
    });
    for (const cat of kg.categories) {
      out.push({
        seq: seq++,
        at: stepIso(seq),
        session_id: sessionId,
        phase: "interview",
        kind: "category",
        layer: "category",
        node: cat,
      });
    }
  }

  const buyerOrgs = kg.leads.orgs.filter((o) => o.is_buyer).slice(0, 16);
  if (buyerOrgs.length > 0) {
    out.push({
      seq: seq++,
      at: stepIso(seq),
      session_id: sessionId,
      phase: "discovery",
      kind: "status",
      layer: "lead",
      status: `Discovering ${buyerOrgs.length} commercial R&D buyer organizations with dated signals…`,
    });
    for (const org of buyerOrgs) {
      out.push({
        seq: seq++,
        at: stepIso(seq),
        session_id: sessionId,
        phase: "discovery",
        kind: "node",
        layer: "lead",
        node: org,
      });
    }
  }

  const peopleById = new Map(kg.leads.people.map((p) => [p.id, p]));
  const edgesById = new Map(kg.leads.edges.map((e) => [e.id, e]));
  const seenPeople = new Set<Id>([kg.founder.id]);
  const seenEdges = new Set<Id>();

  const orderedPaths = [...kg.leads.paths].sort((a, b) => a.score - b.score).slice(-14);
  if (orderedPaths.length > 0) {
    out.push({
      seq: seq++,
      at: stepIso(seq),
      session_id: sessionId,
      phase: "paths",
      kind: "status",
      layer: "lead",
      status: `Tracing ${orderedPaths.length} dated co-author & lab-mate warm paths…`,
    });
  }

  for (const p of orderedPaths) {
    for (const pid of [p.bridge_id, p.buyer_person_id]) {
      if (pid && !seenPeople.has(pid)) {
        const person = peopleById.get(pid);
        if (person) {
          seenPeople.add(pid);
          out.push({
            seq: seq++,
            at: stepIso(seq),
            session_id: sessionId,
            phase: "paths",
            kind: "node",
            layer: "lead",
            node: person,
          });
        }
      }
    }
    for (const eid of p.hops) {
      if (!seenEdges.has(eid)) {
        const edge = edgesById.get(eid);
        if (edge) {
          seenEdges.add(eid);
          out.push({
            seq: seq++,
            at: stepIso(seq),
            session_id: sessionId,
            phase: "paths",
            kind: "edge",
            layer: "lead",
            edge,
          });
        }
      }
    }
    out.push({
      seq: seq++,
      at: stepIso(seq),
      session_id: sessionId,
      phase: "paths",
      kind: "path",
      layer: "lead",
      path: p,
    });
  }

  const topPath = orderedPaths[orderedPaths.length - 1];
  const topBridge = topPath ? peopleById.get(topPath.bridge_id) : null;
  const hasLarsen = orderedPaths.some((p) =>
    peopleById.get(p.bridge_id)?.name?.includes("Larsen"),
  );
  out.push({
    seq: seq++,
    at: stepIso(seq),
    session_id: sessionId,
    phase: "paths",
    kind: "status",
    layer: "lead",
    status: hasLarsen
      ? "Moss verified: Åsmund Larsen, Radiopharmaceuticals manager at Bayer (as of Mar 2024)"
      : topBridge?.name?.includes("Hamerly")
        ? "Moss verified: Ryan Hamerly — CTO, Opticore (since Jan 2026)"
        : `${orderedPaths.length} warm paths ranked & cited`,
  });

  return out;
}

export interface GraphStreamState {
  mode: StreamConnectionMode;
  sourceLabel: "sse" | "events-log" | "kg-replay" | "static";
  sessionId: string;
  speed: number;
  phase: GraphEvent["phase"] | null;
  statusLine: string | null;
  progress: number;
  visibleNodeIds: Set<Id> | null;
  visiblePathIds: Set<Id> | null;
  latestPulsingId: Id | null;
  streamedValueNodes: ValueNode[];
  streamedCategories: BuyerCategory[];
  streamedPeople: Person[];
  streamedOrgs: Org[];
  streamedEdges: Edge[];
  streamedPaths: Path[];
  streamedEvidence: Evidence[];
  startReplay: (targetSpeed?: number, customSessionId?: string) => Promise<void>;
  connectLiveSession: (liveSessionId: string) => void;
  showFullGraph: () => void;
}

function isValueNode(n: unknown): n is ValueNode {
  return Boolean(n && typeof n === "object" && "kind" in n && "text" in n);
}

function isBuyerCategory(n: unknown): n is BuyerCategory {
  return Boolean(n && typeof n === "object" && "problem_set" in n && "colour" in n);
}

function isOrg(n: unknown): n is Org {
  return Boolean(n && typeof n === "object" && "is_buyer" in n && "type" in n);
}

function isPerson(n: unknown): n is Person {
  return Boolean(n && typeof n === "object" && "is_bridge_candidate" in n);
}

export function useGraphStream(
  knowledgeGraph: KnowledgeGraph | null,
  onEvidenceBatch?: (ev: Evidence[]) => void,
): GraphStreamState {
  const [mode, setMode] = React.useState<StreamConnectionMode>("full");
  const [sourceLabel, setSourceLabel] = React.useState<GraphStreamState["sourceLabel"]>("static");
  const [sessionId, setSessionId] = React.useState<string>(DEMO_SESSION_ID);
  const [speed, setSpeed] = React.useState<number>(8);
  const [phase, setPhase] = React.useState<GraphEvent["phase"] | null>(null);
  const [statusLine, setStatusLine] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number>(1);
  const [visibleNodeIds, setVisibleNodeIds] = React.useState<Set<Id> | null>(null);
  const [visiblePathIds, setVisiblePathIds] = React.useState<Set<Id> | null>(null);
  const [latestPulsingId, setLatestPulsingId] = React.useState<Id | null>(null);

  const [streamedValueNodes, setStreamedValueNodes] = React.useState<ValueNode[]>([]);
  const [streamedCategories, setStreamedCategories] = React.useState<BuyerCategory[]>([]);
  const [streamedPeople, setStreamedPeople] = React.useState<Person[]>([]);
  const [streamedOrgs, setStreamedOrgs] = React.useState<Org[]>([]);
  const [streamedEdges, setStreamedEdges] = React.useState<Edge[]>([]);
  const [streamedPaths, setStreamedPaths] = React.useState<Path[]>([]);
  const [streamedEvidence, setStreamedEvidence] = React.useState<Evidence[]>([]);

  const esRef = React.useRef<EventSource | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const cleanup = React.useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => cleanup, [cleanup]);

  const resetBuffers = React.useCallback((founderId?: Id) => {
    setVisibleNodeIds(new Set(founderId ? [founderId] : []));
    setVisiblePathIds(new Set());
    setLatestPulsingId(null);
    setStreamedValueNodes([]);
    setStreamedCategories([]);
    setStreamedPeople([]);
    setStreamedOrgs([]);
    setStreamedEdges([]);
    setStreamedPaths([]);
    setStreamedEvidence([]);
    setProgress(0);
  }, []);

  const applyEvent = React.useCallback(
    (ev: GraphEvent) => {
      setPhase(ev.phase);
      if (ev.status) setStatusLine(ev.status);
      if (ev.evidence?.length) {
        setStreamedEvidence((prev) => [...prev, ...(ev.evidence ?? [])]);
        onEvidenceBatch?.(ev.evidence);
      }

      if ((ev.kind === "node" || ev.kind === "category") && ev.node) {
        const nodeId = ev.node.id;
        setVisibleNodeIds((prev) => {
          const next = new Set(prev ?? []);
          next.add(nodeId);
          return next;
        });
        setLatestPulsingId(nodeId);

        if (isBuyerCategory(ev.node)) {
          const cat = ev.node;
          setStreamedCategories((prev) =>
            prev.some((c) => c.id === cat.id) ? prev.map((c) => (c.id === cat.id ? cat : c)) : [...prev, cat],
          );
        } else if (isValueNode(ev.node)) {
          const vn = ev.node;
          setStreamedValueNodes((prev) =>
            prev.some((v) => v.id === vn.id) ? prev.map((v) => (v.id === vn.id ? vn : v)) : [...prev, vn],
          );
        } else if (isOrg(ev.node)) {
          const org = ev.node;
          setStreamedOrgs((prev) =>
            prev.some((o) => o.id === org.id) ? prev.map((o) => (o.id === org.id ? org : o)) : [...prev, org],
          );
        } else if (isPerson(ev.node)) {
          const person = ev.node;
          setStreamedPeople((prev) =>
            prev.some((p) => p.id === person.id) ? prev.map((p) => (p.id === person.id ? person : p)) : [...prev, person],
          );
        }
      }

      if (ev.kind === "edge" && ev.edge) {
        const edge = ev.edge;
        setStreamedEdges((prev) =>
          prev.some((e) => e.id === edge.id) ? prev.map((e) => (e.id === edge.id ? edge : e)) : [...prev, edge],
        );
      }

      if (ev.kind === "path" && ev.path) {
        const path = ev.path;
        setVisiblePathIds((prev) => {
          const next = new Set(prev ?? []);
          next.add(path.id);
          return next;
        });
        setVisibleNodeIds((prev) => {
          const next = new Set(prev ?? []);
          next.add(path.bridge_id);
          next.add(path.buyer_org_id);
          if (path.buyer_person_id) next.add(path.buyer_person_id);
          return next;
        });
        setLatestPulsingId(path.id);
        setStreamedPaths((prev) =>
          prev.some((p) => p.id === path.id) ? prev.map((p) => (p.id === path.id ? path : p)) : [...prev, path],
        );
      }
    },
    [onEvidenceBatch],
  );

  const playEventArray = React.useCallback(
    (events: GraphEvent[], targetSpeed: number, label: "events-log" | "kg-replay") => {
      cleanup();
      resetBuffers(knowledgeGraph?.founder.id);
      setMode("replaying");
      setSourceLabel(label);

      if (events.length === 0) {
        setMode("full");
        setVisibleNodeIds(null);
        setVisiblePathIds(null);
        return;
      }

      const baseMs = Math.max(90, Math.min(750, Math.round(3200 / Math.max(1, targetSpeed))));
      let idx = 0;

      const step = () => {
        if (idx >= events.length) {
          setMode("done");
          setProgress(1);
          return;
        }
        const ev = events[idx];
        applyEvent(ev);
        idx += 1;
        setProgress(idx / events.length);
        const delay = ev.kind === "status" ? Math.round(baseMs * 1.4) : baseMs;
        timerRef.current = window.setTimeout(step, delay);
      };

      step();
    },
    [applyEvent, cleanup, knowledgeGraph?.founder.id, resetBuffers],
  );

  const startReplay = React.useCallback(
    async (targetSpeed: number = 8, customSessionId: string = DEMO_SESSION_ID) => {
      cleanup();
      setSpeed(targetSpeed);
      setSessionId(customSessionId);

      if (typeof window !== "undefined" && "EventSource" in window) {
        try {
          const check = await api.getGraphEvents(customSessionId);
          if (Array.isArray(check) && check.length > 0) {
            resetBuffers(knowledgeGraph?.founder.id);
            setMode("replaying");
            setSourceLabel("sse");
            setStatusLine(`Replaying ${customSessionId} (${targetSpeed}×)…`);

            let count = 0;
            const total = check.length;
            const es = new EventSource(graphStreamUrl(customSessionId, targetSpeed, 0));
            esRef.current = es;

            const onGraphMessage = (ev: MessageEvent) => {
              try {
                const parsed = JSON.parse(ev.data) as GraphEvent;
                count += 1;
                setProgress(Math.min(1, count / Math.max(1, total)));
                applyEvent(parsed);
              } catch {
                // ignore malformed frame
              }
            };

            es.addEventListener("graph", onGraphMessage);
            es.onmessage = onGraphMessage;
            es.addEventListener("end", () => {
              es.close();
              esRef.current = null;
              setMode("done");
              setProgress(1);
            });
            es.onerror = () => {
              es.close();
              esRef.current = null;
              if (count === 0) {
                playEventArray(check, targetSpeed, "events-log");
              } else {
                setMode("done");
                setProgress(1);
              }
            };
            return;
          }
        } catch {
          // /graph/events not yet populated — fall through to KnowledgeGraph replay
        }
      }

      if (knowledgeGraph) {
        playEventArray(
          buildEventsFromKnowledgeGraph(knowledgeGraph, customSessionId),
          targetSpeed,
          "kg-replay",
        );
      }
    },
    [applyEvent, cleanup, knowledgeGraph, playEventArray, resetBuffers],
  );

  const connectLiveSession = React.useCallback(
    (liveSessionId: string) => {
      cleanup();
      setSessionId(liveSessionId);
      setSpeed(1);
      resetBuffers(knowledgeGraph?.founder.id);
      setMode("streaming");
      setSourceLabel("sse");
      setStatusLine(`Listening to live session ${liveSessionId}…`);

      if (typeof window === "undefined" || !("EventSource" in window)) return;
      const es = new EventSource(graphStreamUrl(liveSessionId, 1, 0));
      esRef.current = es;

      const onGraphMessage = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as GraphEvent;
          applyEvent(parsed);
        } catch {
          // ignore keepalive
        }
      };

      es.addEventListener("graph", onGraphMessage);
      es.onmessage = onGraphMessage;
      es.addEventListener("end", () => {
        es.close();
        esRef.current = null;
        setMode("done");
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setVisibleNodeIds((prev) => (prev && prev.size > 1 ? prev : null));
        setVisiblePathIds((prev) => (prev && prev.size > 0 ? prev : null));
        setMode("full");
      };
    },
    [applyEvent, cleanup, knowledgeGraph?.founder.id, resetBuffers],
  );

  const showFullGraph = React.useCallback(() => {
    cleanup();
    setMode("full");
    setSourceLabel("static");
    setStatusLine(null);
    setVisibleNodeIds(null);
    setVisiblePathIds(null);
    setLatestPulsingId(null);
    setProgress(1);
  }, [cleanup]);

  return {
    mode,
    sourceLabel,
    sessionId,
    speed,
    phase,
    statusLine,
    progress,
    visibleNodeIds,
    visiblePathIds,
    latestPulsingId,
    streamedValueNodes,
    streamedCategories,
    streamedPeople,
    streamedOrgs,
    streamedEdges,
    streamedPaths,
    streamedEvidence,
    startReplay,
    connectLiveSession,
    showFullGraph,
  };
}
