"use client";

import {
  ArrowRight,
  CheckCircle2,
  Orbit,
  ShieldCheck,
  Table2,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, API_BASE, HOPO_DISPLAY, HOPO_FOUNDER_ID } from "@/lib/api";
import { useGraphStream, useStreamSessionParam } from "@/lib/useGraphStream";
import type {
  BuyerCategory,
  Edge,
  Evidence,
  Founder,
  Icp,
  Id,
  KnowledgeGraph,
  Org,
  Path,
  Person,
  Signal,
} from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";
import { ParticleOrb } from "./particle-orb";

type LeadsViewMode = "graph" | "table";

const CAT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];

// Short display names for graph categories (full name stays in the <title> tooltip).
const CATEGORY_SHORT_NAMES: [RegExp, string][] = [
  [/^radiation/i, "Radiation"],
  [/^radiopharmaceutical|89zr pet/i, "PET imaging"],
  [/^gadolinium/i, "Gadolinium"],
  [/^lead\b/i, "Lead"],
];
function shortCategoryName(name: string): string {
  for (const [re, short] of CATEGORY_SHORT_NAMES) if (re.test(name)) return short;
  return name.split(/[:(]/)[0].trim();
}

function resolveCatColor(tokenOrHex: string | undefined, idx: number): string {
  if (!tokenOrHex) return CAT_COLORS[idx % CAT_COLORS.length];
  const map: Record<string, string> = {
    "--cat-1": "#38bdf8",
    "--cat-2": "#a78bfa",
    "--cat-3": "#34d399",
    "--cat-4": "#fbbf24",
    "--cat-5": "#f472b6",
  };
  return map[tokenOrHex] ?? (tokenOrHex.startsWith("#") ? tokenOrHex : CAT_COLORS[idx % CAT_COLORS.length]);
}

interface ScreenLeadsProps {
  founder: Founder | null;
  icp: Icp | null;
  knowledgeGraph: KnowledgeGraph | null;
  paths: Path[];
  people: Person[];
  orgs: Org[];
  edges: Edge[];
  signals: Signal[];
  peopleMap: Record<Id, Person>;
  orgsMap: Record<Id, Org>;
  edgesMap: Record<Id, Edge>;
  signalsMap: Record<Id, Signal>;
  evidenceMap: Record<Id, Evidence>;
  selectedPathId: Id | null;
  orgFilterId: Id | null;
  onSelectPath: (pathId: Id) => void;
  onClearOrgFilter: () => void;
  onInspectEvidence: (evidenceId: Id) => void;
  onInspectEdge: (edgeId: Id) => void;
  onInspectPerson: (personId: Id) => void;
  onEdgeUpdated: (edge: Edge) => void;
  onDraftForPath: (pathId: Id) => void;
}

const KIND_LABELS: Record<Path["kind"], string> = {
  dual_affiliation: "DUAL AFFILIATION",
  advisor_lab: "ADVISOR LAB (2-HOP)",
  lab_mate: "MIT LAB MATE",
  board: "SHARED BOARD",
  co_author: "CO-AUTHOR",
  aligned: "CITATION / ALIGNED",
  personal: "PERSONAL NETWORK",
};

export function ScreenLeads({
  founder: founderProp,
  icp,
  knowledgeGraph: knowledgeGraphProp,
  paths: pathsProp,
  orgs: orgsProp,
  edges: edgesProp,
  peopleMap: peopleMapProp,
  orgsMap: orgsMapProp,
  edgesMap: edgesMapProp,
  signalsMap,
  evidenceMap: evidenceMapProp,
  selectedPathId: selectedPathIdProp,
  orgFilterId,
  onSelectPath,
  onClearOrgFilter,
  onInspectEvidence,
  onInspectEdge,
  onInspectPerson,
  onEdgeUpdated,
  onDraftForPath,
}: ScreenLeadsProps) {
  // Live replay from GET /graph/stream when the URL has ?session=<id> (or ?stream=1).
  // While connecting/streaming/done the graph grows from the stream; on error (or no param) the static props render.
  const streamSessionId = useStreamSessionParam();
  const stream = useGraphStream(streamSessionId);
  const live = stream.status === "connecting" || stream.status === "streaming" || stream.status === "done";

  // "Find buyers": asks the backend to publish buyer orgs + warm paths into this live session (POST /graph/discover).
  const [discover, setDiscover] = React.useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const runDiscover = async () => {
    if (!streamSessionId) return;
    setDiscover({ busy: true, note: null });
    try {
      const res = await fetch(`${API_BASE}/graph/discover?session_id=${encodeURIComponent(streamSessionId)}`, { method: "POST" });
      if (res.status === 202) {
        const body = (await res.json().catch(() => ({}))) as { eta_s?: number };
        setDiscover({ busy: false, note: `discovering… ~${Math.round(body.eta_s ?? 10)}s` });
      } else if (res.status === 409) {
        setDiscover({ busy: false, note: "buyers already found" });
      } else {
        setDiscover({ busy: false, note: `discover unavailable (${res.status})` });
      }
    } catch {
      setDiscover({ busy: false, note: "discover unavailable" });
    }
  };

  const founder = React.useMemo<Founder | null>(() => {
    if (!live) return founderProp;
    if (!stream.founderPersonId) return null;
    if (founderProp?.id === stream.founderPersonId) return founderProp;
    return {
      id: stream.founderPersonId,
      name: stream.founderName ?? "",
      company: "Berkeley Lab", // HACK: demo-hopo founder affiliation; not in the stream payload
      openalex_id: null,
      topics: [],
      summary: "",
      evidence_ids: [],
    };
  }, [live, founderProp, stream.founderPersonId, stream.founderName]);
  const knowledgeGraph = React.useMemo<KnowledgeGraph | null>(() => {
    if (!live) return knowledgeGraphProp;
    // Only categories are read from it; an empty list falls back to synthesized ones, so pass a stub.
    return { ...(knowledgeGraphProp ?? ({} as KnowledgeGraph)), categories: stream.categories };
  }, [live, knowledgeGraphProp, stream.categories]);
  const paths = live ? stream.paths : pathsProp;
  const orgs = live ? stream.orgs : orgsProp;
  const edges = live ? stream.edges : edgesProp;
  const peopleMap = React.useMemo(() => {
    if (!live) return peopleMapProp;
    const m: Record<Id, Person> = {};
    for (const p of stream.people) m[p.id] = p;
    return m;
  }, [live, peopleMapProp, stream.people]);
  const orgsMap = React.useMemo(() => {
    if (!live) return orgsMapProp;
    const m: Record<Id, Org> = { ...orgsMapProp };
    for (const o of stream.orgs) m[o.id] = o;
    return m;
  }, [live, orgsMapProp, stream.orgs]);
  const edgesMap = React.useMemo(() => {
    if (!live) return edgesMapProp;
    const m: Record<Id, Edge> = {};
    for (const e of stream.edges) m[e.id] = e;
    return m;
  }, [live, edgesMapProp, stream.edges]);
  const evidenceMap = React.useMemo(() => {
    if (!live) return evidenceMapProp;
    const m: Record<Id, Evidence> = { ...evidenceMapProp };
    for (const ev of stream.evidence) m[ev.id] = ev;
    return m;
  }, [live, evidenceMapProp, stream.evidence]);
  // While streaming, light the newest warm path; once done, the best path (user clicks still win).
  const selectedPathId = !live
    ? selectedPathIdProp
    : stream.status === "done"
      ? (selectedPathIdProp && stream.paths.some((p) => p.id === selectedPathIdProp)
          ? selectedPathIdProp
          : stream.bestPathId)
      : stream.latestPathId;

  const [viewMode, setViewMode] = React.useState<LeadsViewMode>("graph");
  const showCategoryLayer = true;
  const kindFilter = "all";
  const [selectedCatId, setSelectedCatId] = React.useState<Id | null>(null);
  const [checkingEdgeId, setCheckingEdgeId] = React.useState<Id | null>(null);

  // Derive Buyer Categories from GET /knowledge-graph when available, or synthesize cleanly from ICP industries + buyers
  const categories = React.useMemo<BuyerCategory[]>(() => {
    if (knowledgeGraph?.categories?.length) {
      return knowledgeGraph.categories;
    }
    const buyerOrgs = orgs.filter((o) => o.is_buyer);
    const industries = icp?.industries ?? [];
    if (industries.length === 0) return [];
    return industries.slice(0, 4).map((ind, idx) => {
      const assignedOrgs = buyerOrgs
        .filter((_, oIdx) => oIdx % Math.min(4, industries.length) === idx)
        .map((o) => o.id);
      return {
        id: `cat:derived:${idx + 1}`,
        name: ind.name,
        problem_set: icp?.needs?.[idx] ? [icp.needs[idx].text] : [ind.why],
        value_prop: ind.why,
        colour: `--cat-${idx + 1}`,
        org_ids: assignedOrgs.length > 0 ? assignedOrgs : buyerOrgs.slice(0, 2).map((o) => o.id),
        problem_node_ids: [],
        evidence_ids: ind.evidence_ids,
      };
    });
  }, [knowledgeGraph, icp, orgs]);

  const activeCategory = categories.find((c) => c.id === selectedCatId) ?? null;

  const sortedPaths = React.useMemo(() => {
    return [...paths]
      .filter((p) => (orgFilterId ? p.buyer_org_id === orgFilterId : true))
      .filter((p) => (activeCategory ? activeCategory.org_ids.includes(p.buyer_org_id) : true))
      .filter((p) => (kindFilter === "all" ? true : p.kind === kindFilter))
      .sort((a, b) => b.score - a.score);
  }, [paths, orgFilterId, activeCategory, kindFilter]);

  const activePath = React.useMemo(() => {
    return (
      sortedPaths.find((p) => p.id === selectedPathId) ??
      paths.find((p) => p.id === selectedPathId) ??
      sortedPaths[0] ??
      null
    );
  }, [sortedPaths, paths, selectedPathId]);


  // Compute clean Deep-Space graph coordinates (Core -> Optional Category Ring -> Bridges -> Buyer Orgs)
  const graphLayout = React.useMemo(() => {
    const founderNodeId = founder?.id ?? paths[0]?.founder_id ?? "person:openalex:A5102978866";

    const bridgeIds: Id[] = [];
    const secondHopIds: Id[] = [];
    const buyerOrgIds: Id[] = [];

    const sortedAllPaths = [...paths].sort((a, b) => b.score - a.score);
    for (const p of sortedAllPaths) {
      if (!bridgeIds.includes(p.bridge_id) && p.bridge_id !== founderNodeId) {
        bridgeIds.push(p.bridge_id);
      }
      if (
        p.buyer_person_id &&
        p.buyer_person_id !== p.bridge_id &&
        p.buyer_person_id !== founderNodeId &&
        !secondHopIds.includes(p.buyer_person_id)
      ) {
        secondHopIds.push(p.buyer_person_id);
      }
      if (!buyerOrgIds.includes(p.buyer_org_id)) {
        buyerOrgIds.push(p.buyer_org_id);
      }
    }

    for (const o of orgs) {
      if (o.is_buyer && !buyerOrgIds.includes(o.id)) {
        buyerOrgIds.push(o.id);
      }
    }

    // Radial two-ring layout. viewBox is fixed; rings are fractions of min(width, height).
    const width = 1300;
    const height = 1000;
    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height);
    const R_INNER = base * 0.28;
    const R_BRIDGE = base * 0.36;
    const R_HOP2 = base * 0.4;
    const R_OUTER = base * 0.44;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const polar = (deg: number, r: number) => ({ x: cx + r * Math.cos(rad(deg)), y: cy + r * Math.sin(rad(deg)) });
    const coords: Record<
      Id,
      {
        x: number;
        y: number;
        col: "founder" | "cat" | "bridge" | "hop2" | "org";
        angle?: number;
        arcRank?: number;
      }
    > = {};

    // HOPO: Hannah/HOPO is the centre (orb); the scientist (founder node) is a satellite right next to it.
    const hopoCentre = founderNodeId === HOPO_FOUNDER_ID;
    coords[founderNodeId] = hopoCentre ? { x: cx + 190, y: cy, col: "founder" } : { x: cx, y: cy, col: "founder" };

    // Group orgs into category arcs (first matching category wins; leftovers go to an unlabelled "other" arc).
    const orgCat: Record<Id, number> = {};
    categories.forEach((cat, idx) => {
      for (const oid of cat.org_ids) if (buyerOrgIds.includes(oid) && orgCat[oid] === undefined) orgCat[oid] = idx;
    });
    const groups: Id[][] = categories.map(() => []);
    const otherOrgs: Id[] = [];
    for (const oid of buyerOrgIds) {
      if (orgCat[oid] !== undefined) groups[orgCat[oid]].push(oid);
      else otherOrgs.push(oid);
    }
    const arcList: { catIdx: number; ids: Id[] }[] = groups.map((ids, catIdx) => ({ catIdx, ids }));
    if (otherOrgs.length > 0) arcList.push({ catIdx: -1, ids: otherOrgs });
    const activeArcs = arcList.filter((a) => a.ids.length > 0);
    const GAP = activeArcs.length > 1 ? 8 : 0; // degrees between arcs
    const totalOrgs = activeArcs.reduce((s, a) => s + a.ids.length, 0);
    const usable = 360 - GAP * activeArcs.length;
    let cursor = -90 + GAP / 2; // start at the top, go clockwise: first categories land top/right
    const catAngle: Record<number, number> = {};
    const orgAngle: Record<Id, number> = {};
    const labelledOrgIds = new Set<Id>();
    for (const arc of activeArcs) {
      const span = (usable * arc.ids.length) / Math.max(1, totalOrgs);
      const step = span / arc.ids.length;
      arc.ids.forEach((oid, i) => {
        const a = cursor + step * (i + 0.5);
        orgAngle[oid] = a;
        coords[oid] = { ...polar(a, R_OUTER), col: "org", angle: a, arcRank: i };
        if (i < 4) labelledOrgIds.add(oid); // top orgs per arc (buyerOrgIds is score-ordered)
      });
      if (arc.catIdx >= 0) catAngle[arc.catIdx] = cursor + span / 2;
      cursor += span + GAP;
    }
    // Categories with no orgs: spread into the remaining free angles at the end of the circle.
    categories.forEach((cat, idx) => {
      const a = catAngle[idx] ?? -90 + (360 * idx) / Math.max(1, categories.length);
      coords[cat.id] = { ...polar(a, R_INNER), col: "cat", angle: a };
    });

    // People sit on intermediate rings at the angle of the org they lead to (small offsets keep siblings apart).
    const personAngle = (pid: Id): number => {
      const p = sortedAllPaths.find((x) => x.bridge_id === pid || x.buyer_person_id === pid);
      return (p && orgAngle[p.buyer_org_id]) ?? -90;
    };
    const used: Record<string, number> = {};
    const placePerson = (id: Id, r: number, col: "bridge" | "hop2") => {
      const a0 = personAngle(id);
      const key = `${col}:${Math.round(a0 * 2)}`;
      const k = used[key] ?? 0;
      used[key] = k + 1;
      const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.6;
      const a = a0 + off;
      coords[id] = { ...polar(a, r), col, angle: a };
    };
    bridgeIds.forEach((id) => placePerson(id, R_BRIDGE, "bridge"));
    secondHopIds.forEach((id) => placePerson(id, R_HOP2, "hop2"));

    // Map each org to its first matching category color
    const orgCatColor: Record<Id, string> = {};
    categories.forEach((cat, idx) => {
      const col = resolveCatColor(cat.colour, idx);
      for (const oid of cat.org_ids) {
        if (!orgCatColor[oid]) orgCatColor[oid] = col;
      }
    });

    for (const oid of buyerOrgIds) {
      const o = orgs.find((x) => x.id === oid);
      if (o && /bayer/i.test(o.name)) labelledOrgIds.add(oid);
    }

    return {
      founderNodeId,
      hopoCentre,
      labelledOrgIds,
      bridgeIds,
      secondHopIds,
      buyerOrgIds,
      coords,
      orgCatColor,
      cx,
      cy,
      rInner: R_INNER,
      rOuter: R_OUTER,
      width,
      height,
    };
  }, [founder?.id, paths, orgs, categories, showCategoryLayer]);

  // Quadratic curve whose control point is pulled toward the centre, so edges bow inward.
  const curveD = (a: { x: number; y: number }, b: { x: number; y: number }, pull = 0.55) => {
    const { cx, cy } = graphLayout;
    const qx = (a.x + b.x) / 2;
    const qy = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} Q ${qx + (cx - qx) * pull} ${qy + (cy - qy) * pull} ${b.x} ${b.y}`;
  };
  // Radial label geometry: rotate along the radius, flip on the left half so text is never upside down.
  const radialLabel = (pos: { x: number; y: number }, angle: number, name: string, gap = 12, fontPx = 12) => {
    const c = Math.cos((angle * Math.PI) / 180);
    const s = Math.sin((angle * Math.PI) / 180);
    const right = c >= 0;
    const tx = c > 0.001 ? (graphLayout.width - pos.x) / c : c < -0.001 ? pos.x / -c : Infinity;
    const ty = s > 0.001 ? (graphLayout.height - pos.y) / s : s < -0.001 ? pos.y / -s : Infinity;
    const avail = Math.min(tx, ty) - gap - 6;
    const maxChars = Math.max(6, Math.floor(avail / (fontPx * 0.55)));
    const text = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
    return { text, rot: right ? angle : angle + 180, anchor: (right ? "start" : "end") as "start" | "end", x: right ? gap : -gap };
  };

  const activeHopSet = React.useMemo(() => new Set(activePath?.hops ?? []), [activePath]);

  const activeNodeSet = React.useMemo(() => {
    const s = new Set<Id>();
    if (!activePath) return s;
    s.add(activePath.founder_id);
    s.add(activePath.bridge_id);
    if (activePath.buyer_person_id) s.add(activePath.buyer_person_id);
    s.add(activePath.buyer_org_id);
    for (const eid of activePath.hops) {
      const edge = edgesMap[eid];
      if (edge) {
        s.add(edge.from);
        s.add(edge.to);
      }
    }
    return s;
  }, [activePath, edgesMap]);

  const handleQuickNameCheck = async (edgeId: Id, decision: "ok" | "rejected") => {
    setCheckingEdgeId(edgeId);
    try {
      const updated = await api.nameCheck(edgeId, decision);
      onEdgeUpdated(updated);
    } finally {
      setCheckingEdgeId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* One switch: Graph (full, tall stage) or Table. HACK: "split" mode removed; it showed the same graph as "graph", so the switch looked dead. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-white/15 p-0.5">
          {(["graph", "table"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => setViewMode(mode)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs transition ${
                viewMode === mode ? "bg-white/10 text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "graph" ? <Orbit className="size-3.5" /> : <Table2 className="size-3.5" />}
              {mode === "graph" ? "Deep graph" : "Table"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
          {live && (
            <span className={stream.status === "done" ? "text-muted-foreground" : "text-sky-300"}>
              {stream.status === "done" ? "replay done" : "● live"} · {stream.count} events
            </span>
          )}
          <span>{paths.length} warm paths</span>
          {streamSessionId && (
            <button
              type="button"
              onClick={() => void runDiscover()}
              disabled={discover.busy}
              className="rounded border border-sky-400/50 px-2.5 py-1 font-sans text-xs text-sky-200 transition hover:bg-sky-400/10 disabled:opacity-50"
            >
              {discover.busy ? "Finding buyers…" : "Find buyers"}
            </button>
          )}
          {discover.note && <span className="text-sky-300">{discover.note}</span>}
          {orgFilterId && (
            <button type="button" onClick={onClearOrgFilter} className="hover:text-foreground">
              {orgsMap[orgFilterId]?.name ?? orgFilterId} ✕
            </button>
          )}
        </div>
      </div>

      {viewMode === "graph" && (
        <section className="db-cosmos relative overflow-hidden rounded-lg p-4">
          {categories.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {categories.map((cat, idx) => {
                const color = resolveCatColor(cat.colour, idx);
                const isCatSelected = selectedCatId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    title={cat.name}
                    onClick={() => setSelectedCatId(isCatSelected ? null : cat.id)}
                    className={`inline-flex items-center gap-1.5 text-[11px] transition ${
                      isCatSelected ? "text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    <span>{shortCategoryName(cat.name)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
              style={{ height: Math.min(graphLayout.height, 760) }}
              className={`min-w-[960px] w-full select-none${live ? " db-stream-on" : ""}`}
            >
              <defs>
                <radialGradient id="founderHalo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Ring guides */}
              <circle cx={graphLayout.cx} cy={graphLayout.cy} r={graphLayout.rInner} fill="none" stroke="#ffffff" strokeOpacity={0.05} />
              <circle cx={graphLayout.cx} cy={graphLayout.cy} r={graphLayout.rOuter} fill="none" stroke="#ffffff" strokeOpacity={0.05} />

              {/* Soft fans: category → its orgs (low opacity, category colour); founder → category at ~0.5 */}
              {categories.map((cat, idx) => {
                const cPos = graphLayout.coords[cat.id];
                if (!cPos) return null;
                const centre = { x: graphLayout.cx, y: graphLayout.cy };
                const color = resolveCatColor(cat.colour, idx);
                const isCatSelected = selectedCatId === cat.id;
                return (
                  <g key={`cat-links-${cat.id}`}>
                    <path d={curveD(centre, cPos, 0.2)} fill="none" stroke={color} strokeWidth={1} strokeOpacity={isCatSelected ? 0.8 : 0.5} />
                    {cat.org_ids.map((oid) => {
                      const oPos = graphLayout.coords[oid];
                      if (!oPos || graphLayout.orgCatColor[oid] !== color) return null;
                      return (
                        <path
                          key={`${cat.id}-${oid}`}
                          d={curveD(cPos, oPos, 0.6)}
                          fill="none"
                          stroke={color}
                          strokeWidth={0.8}
                          strokeOpacity={isCatSelected ? 0.35 : 0.11}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* Edges: faint by default; the lit warm path in the accent, weakest hop in amber */}
              {edges.map((edge) => {
                const fromPos = graphLayout.coords[edge.from];
                const toPos = graphLayout.coords[edge.to];
                if (!fromPos || !toPos) return null;
                const isLit = activeHopSet.has(edge.id);
                const isWeakest = isLit && activePath?.weakest_edge_id === edge.id;
                const curvePath = curveD(fromPos, toPos, 0.45);
                const strokeColor = isWeakest
                  ? "#fbbf24"
                  : edge.name_check === "rejected"
                    ? "#f87171"
                    : isLit
                      ? "#38bdf8"
                      : "rgba(148, 163, 184, 0.07)";
                return (
                  <g key={edge.id} onClick={() => onInspectEdge(edge.id)} className="cursor-pointer">
                    <title>{edge.label}</title>
                    <path d={curvePath} fill="none" stroke="transparent" strokeWidth={10} />
                    <path
                      d={curvePath}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isLit ? 2.6 : 1}
                      className={isLit ? "db-edge-active" : undefined}
                    />
                  </g>
                );
              })}

              {/* HOPO centre: Hannah Weber · HOPO Therapeutics, with "science from" edge to the scientist */}
              {graphLayout.hopoCentre &&
                (() => {
                  const fPos = graphLayout.coords[graphLayout.founderNodeId];
                  if (!fPos) return null;
                  const cx = graphLayout.cx;
                  return (
                    <g>
                      <line x1={cx + 50} y1={fPos.y} x2={fPos.x - 10} y2={fPos.y} stroke="#38bdf8" strokeWidth={1.5} strokeOpacity={0.7} />
                      <text x={(cx + fPos.x) / 2 + 20} y={fPos.y - 7} textAnchor="middle" className="fill-slate-400 font-sans text-[10px]" stroke="#020510" strokeWidth={3} paintOrder="stroke">
                        science from
                      </text>
                      <g transform={`translate(${cx}, ${graphLayout.cy})`}>
                        {/* Graph core: particle orb (Mark) that kicks once per incoming stream event. */}
                        <foreignObject x={-48} y={-48} width={96} height={96} style={{ overflow: "visible" }}>
                          <ParticleOrb
                            size={96}
                            state={stream.status === "streaming" || stream.status === "connecting" ? "thinking" : "idle"}
                            pulseKey={stream.count}
                            pulseStrength={0.12}
                            count={320}
                            label="Hannah Weber, HOPO Therapeutics: graph core"
                          />
                        </foreignObject>
                        <text y={58} textAnchor="middle" className="fill-white font-sans text-[15px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                          {HOPO_DISPLAY.name}
                        </text>
                        <text y={75} textAnchor="middle" className="fill-sky-200 font-sans text-[12px]" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                          {HOPO_DISPLAY.company}
                        </text>
                      </g>
                    </g>
                  );
                })()}

              {/* Founder */}
              {(() => {
                const fPos = graphLayout.coords[graphLayout.founderNodeId];
                if (!fPos) return null;
                if (graphLayout.hopoCentre)
                  return (
                    <g
                      transform={`translate(${fPos.x}, ${fPos.y})`}
                      onClick={() => onInspectPerson(graphLayout.founderNodeId)}
                      className="cursor-pointer"
                    >
                      <circle r={8} fill="#0b2536" stroke="#38bdf8" strokeWidth={1.5} />
                      <circle r={3} fill="#ffffff" />
                      <text y={24} textAnchor="middle" className="fill-slate-200 font-sans text-[10px]" stroke="#020510" strokeWidth={3} paintOrder="stroke">
                        {HOPO_DISPLAY.scientist} · Berkeley Lab
                      </text>
                      <text y={37} textAnchor="middle" className="fill-slate-400 font-sans text-[10px]" stroke="#020510" strokeWidth={3} paintOrder="stroke">
                        (HOPO&apos;s science)
                      </text>
                    </g>
                  );
                return (
                  <g
                    transform={`translate(${fPos.x}, ${fPos.y})`}
                    onClick={() => onInspectPerson(graphLayout.founderNodeId)}
                    className="cursor-pointer"
                  >
                    {/* Graph core: particle orb that kicks once per incoming stream event. */}
                    <foreignObject x={-48} y={-48} width={96} height={96} style={{ overflow: "visible" }}>
                      <ParticleOrb
                        size={96}
                        state={stream.status === "streaming" || stream.status === "connecting" ? "thinking" : "idle"}
                        pulseKey={stream.count}
                        pulseStrength={0.12}
                        count={320}
                        label="Knowledge graph core"
                      />
                    </foreignObject>
                    <text y={54} textAnchor="middle" className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                      {founder?.name ?? "Nicholas C. Harris"}
                    </text>
                  </g>
                );
              })()}

              {/* Categories: dot + label */}
              {categories.map((cat, idx) => {
                const pos = graphLayout.coords[cat.id];
                if (!pos) return null;
                const color = resolveCatColor(cat.colour, idx);
                const isCatSelected = selectedCatId === cat.id;
                return (
                  <g
                    key={cat.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => setSelectedCatId(isCatSelected ? null : cat.id)}
                    className="cursor-pointer"
                  >
                    <title>{cat.name}</title>
                    <circle r={isCatSelected ? 7 : 5.5} fill={color} />
                    {(() => {
                      const ang = pos.angle ?? 0;
                      const c = Math.cos((ang * Math.PI) / 180);
                      const sn = Math.sin((ang * Math.PI) / 180);
                      return (
                        <text
                          x={c * 14}
                          y={sn * 14 + 4}
                          textAnchor={Math.abs(c) < 0.3 ? "middle" : c > 0 ? "start" : "end"}
                          dy={Math.abs(c) < 0.3 ? (sn < 0 ? -4 : 8) : 0}
                          className="fill-slate-200 font-sans text-[11px]"
                          stroke="#020510"
                          strokeWidth={4}
                          paintOrder="stroke"
                        >
                          {shortCategoryName(cat.name)}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* People: label only on the lit path; others on hover */}
              {[...graphLayout.bridgeIds, ...graphLayout.secondHopIds].map((pid) => {
                const pos = graphLayout.coords[pid];
                const person = peopleMap[pid];
                if (!pos || !person) return null;
                const isLit = activeNodeSet.has(pid);
                const matchingPath = paths.find((p) => p.bridge_id === pid || p.buyer_person_id === pid);
                return (
                  <g
                    key={pid}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => {
                      if (matchingPath) onSelectPath(matchingPath.id);
                      onInspectPerson(pid);
                    }}
                    className="cursor-pointer"
                  >
                    <title>
                      {person.name}
                      {person.affiliation_asof ? ` · as of ${person.affiliation_asof.slice(0, 4)}` : ""}
                    </title>
                    <circle
                      r={isLit ? 7 : 4}
                      fill={isLit ? "#38bdf8" : "#334155"}
                      stroke={isLit ? "#e0f2fe" : "none"}
                      strokeWidth={isLit ? 1.5 : 0}
                    />
                    {isLit && (() => {
                      const lb = radialLabel(pos, pos.angle ?? 0, person.name, 12);
                      return (
                        <text x={lb.x} y={4} transform={`rotate(${lb.rot})`} textAnchor={lb.anchor} className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                          {lb.text}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}

              {/* Buyer orgs: category-coloured dot; label for top buyers + the lit org; others on hover */}
              {graphLayout.buyerOrgIds.map((oid) => {
                const pos = graphLayout.coords[oid];
                const org = orgsMap[oid];
                if (!pos || !org) return null;
                const isLit = activeNodeSet.has(oid);
                const catColor = graphLayout.orgCatColor[oid] ?? "#64748b";
                const showLabel = isLit || graphLayout.labelledOrgIds.has(oid);
                const orgTopPath = paths
                  .filter((p) => p.buyer_org_id === oid)
                  .sort((a, b) => b.score - a.score)[0];
                return (
                  <g
                    key={oid}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => {
                      if (orgTopPath) onSelectPath(orgTopPath.id);
                    }}
                    className="cursor-pointer"
                  >
                    <title>{org.name}</title>
                    <circle r={isLit ? 7 : 4.5} fill={catColor} stroke={isLit ? "#ffffff" : "none"} strokeWidth={1.5} />
                    {showLabel && (() => {
                      const lb = radialLabel(pos, pos.angle ?? 0, org.name, 12);
                      return (
                        <text
                          x={lb.x}
                          y={4}
                          transform={`rotate(${lb.rot})`}
                          textAnchor={lb.anchor}
                          className={`font-sans text-[12px] ${isLit ? "fill-white font-semibold" : "fill-slate-300"}`} stroke="#020510" strokeWidth={4} paintOrder="stroke"
                        >
                          {lb.text}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Selected warm path: one line + one primary action; hops below with sources and check */}
          {activePath && (
            <div className="mt-3 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {activePath.score}
                  </span>
                  <span>
                    {founder?.id === HOPO_FOUNDER_ID
                      ? `${HOPO_DISPLAY.name} · ${HOPO_DISPLAY.company} → ${HOPO_DISPLAY.scientist} (science)`
                      : founder?.name ?? "Nicholas C. Harris"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <button
                    type="button"
                    onClick={() => onInspectPerson(activePath.bridge_id)}
                    className="underline decoration-white/30 underline-offset-4 hover:decoration-sky-400"
                  >
                    {peopleMap[activePath.bridge_id]?.name ?? activePath.bridge_id}
                  </button>
                  {activePath.buyer_person_id && activePath.buyer_person_id !== activePath.bridge_id && (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <button
                        type="button"
                        onClick={() => onInspectPerson(activePath.buyer_person_id!)}
                        className="underline decoration-white/30 underline-offset-4 hover:decoration-sky-400"
                      >
                        {peopleMap[activePath.buyer_person_id]?.name ?? activePath.buyer_person_id}
                      </button>
                    </>
                  )}
                  <span className="text-muted-foreground">→</span>
                  <span>{orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}</span>
                </div>
                <Button size="sm" variant="default" flat onClick={() => onDraftForPath(activePath.id)}>
                  Draft intro request
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {activePath.hops.map((eid) => {
                  const edge = edgesMap[eid];
                  if (!edge) return null;
                  const isWeakest = activePath.weakest_edge_id === eid;
                  return (
                    <div key={eid} className="group flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className={isWeakest ? "text-amber-300" : "text-slate-200"}>
                        {edge.label}
                        {isWeakest && <span className="ml-1.5 text-[10px] text-amber-300/80">weakest</span>}
                      </span>
                      {edge.evidence_ids.map((evId) => (
                        <EvidenceChip
                          key={evId}
                          evidenceMap={evidenceMap}
                          evidenceId={evId}
                          onInspect={onInspectEvidence}
                          compact
                        />
                      ))}
                      <span
                        className={`font-mono text-[10px] ${
                          edge.name_check === "ok"
                            ? "text-emerald-300"
                            : edge.name_check === "rejected"
                              ? "text-red-300"
                              : "text-muted-foreground"
                        }`}
                      >
                        {edge.name_check === "ok" ? "✓ checked" : edge.name_check}
                      </span>
                      <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={checkingEdgeId === edge.id}
                          onClick={() => void handleQuickNameCheck(edge.id, "ok")}
                          className="inline-flex items-center gap-1 px-1 text-[10px] text-emerald-300 hover:underline"
                        >
                          <CheckCircle2 className="size-3" />
                          OK
                        </button>
                        <button
                          type="button"
                          disabled={checkingEdgeId === edge.id}
                          onClick={() => void handleQuickNameCheck(edge.id, "rejected")}
                          className="inline-flex items-center gap-1 px-1 text-[10px] text-red-300 hover:underline"
                        >
                          <XCircle className="size-3" />
                          Reject
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* FLAT NEO-BRUTALIST LEADS & WARM PATHS TABLE */}
      {viewMode === "table" && (
        <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
          <CardHeader className="px-5 pb-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                                <span>Warm paths ({sortedPaths.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            <Table flat scrollX>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[11px] uppercase">Score</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Buyer</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Bridge</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Dated hops</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Check</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPaths.map((path) => {
                  const isSelected = activePath?.id === path.id;
                  const bridge = peopleMap[path.bridge_id];
                  const org = orgsMap[path.buyer_org_id];
                  const weakest = edgesMap[path.weakest_edge_id];

                  return (
                    <TableRow
                      key={path.id}
                      data-state={isSelected ? "selected" : undefined}
                      onClick={() => onSelectPath(path.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-muted-foreground" title={KIND_LABELS[path.kind] ?? path.kind}>
                        {path.score}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {org?.name ?? path.buyer_org_id}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPath(path.id);
                            onInspectPerson(path.bridge_id);
                          }}
                          className="text-left hover:underline"
                        >
                          <div className="font-medium text-foreground">
                            {bridge?.name ?? path.bridge_id}
                          </div>
                          {bridge?.affiliation_asof && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              as of {bridge.affiliation_asof}
                            </div>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                          {path.hops.map((eid, i) => {
                            const edge = edgesMap[eid];
                            return (
                              <React.Fragment key={eid}>
                                {i > 0 && <span className="text-muted-foreground">→</span>}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onInspectEdge(eid);
                                  }}
                                  className="text-left text-[11px] text-slate-300 hover:text-white hover:underline"
                                >
                                  {edge?.label ?? eid}
                                </button>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {weakest && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectEdge(weakest.id);
                            }}
                            className="inline-flex items-center gap-1 font-mono text-[11px]"
                          >
                            <ShieldCheck
                              className={`size-3.5 ${
                                weakest.name_check === "ok"
                                  ? "text-emerald-400"
                                  : weakest.name_check === "rejected"
                                    ? "text-red-400"
                                    : "text-amber-300"
                              }`}
                            />
                            <span className="uppercase">{weakest.name_check}</span>
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant={isSelected ? "default" : "glass"}
                          flat
                          onClick={(e) => {
                            e.stopPropagation();
                            onDraftForPath(path.id);
                          }}
                        >
                          Draft Intro →
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
