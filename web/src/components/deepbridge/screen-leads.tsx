"use client";

import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Globe,
  Mic,
  MicOff,
  Play,
  Radio,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Table as TableIcon,
  UserSearch,
  Waypoints,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, HOPO_FOUNDER_ID } from "@/lib/api";
import type {
  BuyerCategory,
  Edge,
  EdgeType,
  Evidence,
  Founder,
  Icp,
  Id,
  InterviewResponse,
  KnowledgeGraph,
  Org,
  Path,
  Person,
  Signal,
} from "@/lib/types";
import type { GraphStreamState } from "@/lib/use-graph-stream";
import { EvidenceChip } from "./evidence-chip";

type LeadsViewMode = "cosmos_split" | "stage_live" | "cosmos_full" | "table";

const CAT_PALETTE: Record<string, string> = {
  "--cat-1": "#38bdf8",
  "--cat-2": "#a78bfa",
  "--cat-3": "#34d399",
  "--cat-4": "#fbbf24",
  "--cat-5": "#f472b6",
};

function resolveCatColor(token: string | undefined, idx: number): string {
  if (token && CAT_PALETTE[token]) return CAT_PALETTE[token];
  const keys = Object.values(CAT_PALETTE);
  return keys[idx % keys.length];
}

function withSessionParam(rawUrl: string, sessionId: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.includes("session=")) return trimmed;
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}session=${encodeURIComponent(sessionId)}`;
}

const EDGE_STROKES: Record<EdgeType, string> = {
  LAB_MATE: "#38bdf8",
  DUAL_AFFILIATION: "#c084fc",
  ADVISOR_LAB: "#818cf8",
  CO_AUTHORED: "#60a5fa",
  CITES: "#2dd4bf",
  TOPIC_ALIGNED: "#94a3b8",
  AFFILIATED_AT: "#64748b",
  BOARD: "#fbbf24",
  PERSONAL: "#fb923c",
  ENABLES: "#38bdf8",
  DELIVERS: "#818cf8",
  SOLVES: "#34d399",
  FITS: "#a78bfa",
};

interface ScreenLeadsProps {
  founder: Founder | null;
  icp: Icp | null;
  knowledgeGraph: KnowledgeGraph | null;
  graphStream: GraphStreamState;
  activeSessionId: string;
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

interface PolarPoint {
  x: number;
  y: number;
  ring: "founder" | "value" | "cat" | "bridge" | "org";
}

export function ScreenLeads({
  founder,
  icp,
  knowledgeGraph,
  graphStream,
  activeSessionId,
  paths,
  orgs,
  edges,
  peopleMap,
  orgsMap,
  edgesMap,
  signalsMap,
  evidenceMap,
  selectedPathId,
  orgFilterId,
  onSelectPath,
  onClearOrgFilter,
  onInspectEvidence,
  onInspectEdge,
  onInspectPerson,
  onEdgeUpdated,
  onDraftForPath,
}: ScreenLeadsProps) {
  const [viewMode, setViewMode] = React.useState<LeadsViewMode>("cosmos_split");
  const [selectedCatId, setSelectedCatId] = React.useState<Id | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = React.useState<Id | null>(null);
  const [expandedHops, setExpandedHops] = React.useState<boolean>(false);
  const [expandedRowId, setExpandedRowId] = React.useState<Id | null>(null);
  const [checkingEdgeId, setCheckingEdgeId] = React.useState<Id | null>(null);

  // Stage Live Voice Interview companion state (for 1:30 live on stage)
  const [stageInterview, setStageInterview] = React.useState<InterviewResponse | null>(null);
  const [stageAnswer, setStageAnswer] = React.useState("");
  const [stageBusy, setStageBusy] = React.useState(false);
  const [stageListening, setStageListening] = React.useState(false);
  const [hostedVoiceUrl, setHostedVoiceUrl] = React.useState(
    process.env.NEXT_PUBLIC_VOICE_APP_URL ?? "",
  );
  const [useHostedVoice, setUseHostedVoice] = React.useState(
    Boolean(process.env.NEXT_PUBLIC_VOICE_APP_URL),
  );

  const isStreamFiltering =
    graphStream.mode === "replaying" || graphStream.mode === "streaming";

  // Categories from live stream, GET /knowledge-graph, or derived ICP industries (--cat-1..4)
  const categories = React.useMemo<BuyerCategory[]>(() => {
    if (isStreamFiltering && graphStream.streamedCategories.length > 0) {
      return graphStream.streamedCategories;
    }
    if (knowledgeGraph?.categories?.length) {
      return knowledgeGraph.categories;
    }
    const buyerOrgs = orgs.filter((o) => o.is_buyer);
    const industries = icp?.industries ?? [];
    return industries.slice(0, 4).map((ind, idx) => ({
      id: `cat:derived:${idx + 1}`,
      name: ind.name,
      problem_set: icp?.needs?.[idx] ? [icp.needs[idx].text] : [ind.why],
      value_prop: ind.why,
      colour: `--cat-${idx + 1}`,
      org_ids: buyerOrgs
        .filter((_, oIdx) => oIdx % Math.max(1, Math.min(4, industries.length)) === idx)
        .map((o) => o.id),
      problem_node_ids: [],
      evidence_ids: ind.evidence_ids,
    }));
  }, [isStreamFiltering, graphStream.streamedCategories, knowledgeGraph, icp, orgs]);

  const activeCategory = categories.find((c) => c.id === selectedCatId) ?? null;

  const isNodeVisible = React.useCallback(
    (id: Id) => {
      if (!isStreamFiltering || !graphStream.visibleNodeIds) return true;
      return graphStream.visibleNodeIds.has(id);
    },
    [isStreamFiltering, graphStream.visibleNodeIds],
  );

  const sortedPaths = React.useMemo(() => {
    return [...paths]
      .filter((p) => (orgFilterId ? p.buyer_org_id === orgFilterId : true))
      .filter((p) =>
        activeCategory && activeCategory.org_ids.length > 0
          ? activeCategory.org_ids.includes(p.buyer_org_id)
          : activeCategory
            ? false
            : true,
      )
      .filter((p) =>
        isStreamFiltering && graphStream.visiblePathIds
          ? graphStream.visiblePathIds.has(p.id)
          : true,
      )
      .sort((a, b) => b.score - a.score);
  }, [paths, orgFilterId, activeCategory, isStreamFiltering, graphStream.visiblePathIds]);

  const activePath = React.useMemo(() => {
    return (
      sortedPaths.find((p) => p.id === selectedPathId) ??
      sortedPaths[0] ??
      paths.find((p) => p.id === selectedPathId) ??
      paths[0] ??
      null
    );
  }, [sortedPaths, paths, selectedPathId]);

  // Color the hero / active warm path by its buyer category (e.g. Category 3 emerald for Bayer / Gadolinium)
  const activePathCatColor = React.useMemo(() => {
    if (!activePath) return "#38bdf8";
    const catIdx = categories.findIndex(
      (c) =>
        (activePath.category_id && c.id === activePath.category_id) ||
        c.org_ids.includes(activePath.buyer_org_id),
    );
    if (catIdx >= 0) return resolveCatColor(categories[catIdx].colour, catIdx);
    return "#38bdf8";
  }, [activePath, categories]);

  // 3-Ring Radial Cosmos Layout (Core -> Category Ring -> Bridge Ring -> Outer Buyer Orgs)
  const cosmos = React.useMemo(() => {
    const width = 980;
    const height = 620;
    const cx = width / 2;
    const cy = height / 2;

    const founderNodeId = founder?.id ?? paths[0]?.founder_id ?? HOPO_FOUNDER_ID;
    const rawValueNodes =
      isStreamFiltering && graphStream.streamedValueNodes.length > 0
        ? graphStream.streamedValueNodes
        : knowledgeGraph?.core.value_nodes ?? [];
    const valueNodes = rawValueNodes.slice(0, 6);

    const bridgeIds: Id[] = [];
    const buyerOrgIds: Id[] = [];
    for (const p of [...paths].sort((a, b) => b.score - a.score)) {
      if (
        !bridgeIds.includes(p.bridge_id) &&
        p.bridge_id !== founderNodeId &&
        bridgeIds.length < 18
      ) {
        bridgeIds.push(p.bridge_id);
      }
      if (
        p.buyer_person_id &&
        p.buyer_person_id !== p.bridge_id &&
        p.buyer_person_id !== founderNodeId &&
        !bridgeIds.includes(p.buyer_person_id) &&
        bridgeIds.length < 18
      ) {
        bridgeIds.push(p.buyer_person_id);
      }
      if (!buyerOrgIds.includes(p.buyer_org_id) && buyerOrgIds.length < 18) {
        buyerOrgIds.push(p.buyer_org_id);
      }
    }
    const rankedBuyerOrgs = [...orgs]
      .filter((o) => o.is_buyer)
      .sort((a, b) => (b.buyer_score ?? 0) - (a.buyer_score ?? 0));
    for (const o of rankedBuyerOrgs) {
      if (!buyerOrgIds.includes(o.id) && buyerOrgIds.length < 18) {
        buyerOrgIds.push(o.id);
      }
    }

    const coords: Record<Id, PolarPoint> = {};
    coords[founderNodeId] = { x: cx, y: cy, ring: "founder" };

    const placeOnCircle = (
      ids: Id[],
      rx: number,
      ry: number,
      ring: PolarPoint["ring"],
      phaseOffsetRad: number = -Math.PI / 2,
    ) => {
      const n = ids.length;
      ids.forEach((id, idx) => {
        const angle = phaseOffsetRad + (idx / Math.max(1, n)) * Math.PI * 2;
        coords[id] = {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
          ring,
        };
      });
    };

    placeOnCircle(
      valueNodes.map((v) => v.id),
      92,
      74,
      "value",
      -Math.PI / 3,
    );
    placeOnCircle(
      categories.map((c) => c.id),
      188,
      148,
      "cat",
      -Math.PI / 4,
    );
    placeOnCircle(bridgeIds, 295, 215, "bridge", -Math.PI / 2 + 0.22);
    placeOnCircle(buyerOrgIds, 415, 262, "org", -Math.PI / 2);

    return {
      width,
      height,
      cx,
      cy,
      founderNodeId,
      valueNodes,
      bridgeIds,
      buyerOrgIds,
      coords,
    };
  }, [
    founder,
    paths,
    orgs,
    categories,
    knowledgeGraph,
    isStreamFiltering,
    graphStream.streamedValueNodes,
  ]);

  const activeHopSet = React.useMemo(() => new Set(activePath?.hops ?? []), [activePath]);

  const activeNodeSet = React.useMemo(() => {
    const s = new Set<Id>();
    if (!activePath) return s;
    s.add(activePath.founder_id);
    s.add(activePath.bridge_id);
    if (activePath.buyer_person_id) s.add(activePath.buyer_person_id);
    s.add(activePath.buyer_org_id);
    return s;
  }, [activePath]);

  const handleQuickNameCheck = async (edgeId: Id, decision: "ok" | "rejected") => {
    setCheckingEdgeId(edgeId);
    try {
      const updated = await api.nameCheck(edgeId, decision);
      onEdgeUpdated(updated);
    } finally {
      setCheckingEdgeId(null);
    }
  };

  const startStageInterview = async () => {
    setStageBusy(true);
    try {
      graphStream.connectLiveSession(activeSessionId);
      const res = await api.interview({
        founder_id: founder?.id ?? null,
      });
      setStageInterview(res);
    } finally {
      setStageBusy(false);
    }
  };

  const submitStageAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageInterview || !stageAnswer.trim()) return;
    const text = stageAnswer.trim();
    setStageBusy(true);
    try {
      void api
        .submitInterviewTurn({
          session_id: activeSessionId,
          role: "founder",
          text,
        })
        .catch(() => null);
      const res = await api.interview({
        session_id: stageInterview.session_id,
        answer: text,
      });
      setStageInterview(res);
      setStageAnswer("");
    } finally {
      setStageBusy(false);
    }
  };

  const toggleStageMic = () => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.onresult = (ev) => {
      const parts: string[] = [];
      for (let i = 0; i < ev.results.length; i++) parts.push(ev.results[i][0].transcript);
      setStageAnswer(parts.join(" "));
    };
    rec.onend = () => setStageListening(false);
    setStageListening(true);
    rec.start();
  };

  const isHopo = founder?.id === HOPO_FOUNDER_ID;
  const founderDisplayName = isHopo ? "HOPO · R. Abergel" : founder?.name ?? "Founder";
  const resolvedStageVoiceSrc = withSessionParam(hostedVoiceUrl, activeSessionId);

  const renderCosmosCanvas = (tall: boolean = false) => (
    <div className="db-cosmos relative overflow-hidden border border-white/15">
      {/* MINIMAL STREAM / REPLAY CAPTION OVERLAY */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#020510]/90 px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`size-2.5 shrink-0 rounded-full ${
              graphStream.mode === "replaying" || graphStream.mode === "streaming"
                ? "bg-emerald-400 animate-pulse"
                : "bg-sky-400"
            }`}
          />
          <span className="truncate text-base font-medium text-white">
            {graphStream.statusLine ??
              `${isHopo ? "Hannah Weber · HOPO Therapeutics" : founder?.name ?? "Founder"} · ${categories.length} buyer groups · ${paths.length} cited warm paths`}
          </span>
          {graphStream.mode !== "full" && (
            <Badge flat className="border-amber-400/40 bg-[#2b1d05] font-mono text-xs text-amber-200">
              {graphStream.sourceLabel === "sse"
                ? "LIVE STREAM"
                : `REPLAY · ${graphStream.speed}×`}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void graphStream.startReplay(8, activeSessionId)}
            className="inline-flex items-center gap-1.5 border border-sky-400/50 bg-[#0b2536] px-3 py-1.5 font-mono text-xs font-semibold text-sky-100 transition-colors hover:border-sky-300 hover:text-white"
          >
            <Play className="size-3.5 text-sky-300" />
            <span>Replay 8×</span>
          </button>
          <button
            type="button"
            onClick={() => void graphStream.startReplay(3, activeSessionId)}
            className="border border-white/15 bg-[#090d1c] px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-white/40 hover:text-white"
          >
            3×
          </button>
          {graphStream.mode !== "full" && (
            <button
              type="button"
              onClick={graphStream.showFullGraph}
              className="inline-flex items-center gap-1 border border-white/15 bg-[#090d1c] px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-white/40 hover:text-white"
            >
              <RotateCcw className="size-3" />
              <span>Show All</span>
            </button>
          )}
        </div>
      </div>

      {/* REPLAY PROGRESS HAIRLINE */}
      {graphStream.mode === "replaying" && (
        <div className="h-0.5 w-full bg-white/5">
          <motion.div
            className="h-full bg-sky-400"
            animate={{ width: `${Math.round(graphStream.progress * 100)}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      )}

      {/* BUYER CATEGORY RING FILTER PILLS (EXPANSION SEGMENTS DASHED & HONESTLY LABELED) */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setSelectedCatId(null)}
            className={`border px-3 py-1 text-xs font-medium transition-colors ${
              selectedCatId === null
                ? "border-white/50 bg-white/10 text-white"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            All Groups ({paths.length})
          </button>
          {categories.map((cat, idx) => {
            const isExpansion = cat.org_ids.length === 0;
            const color = isExpansion ? "#94a3b8" : resolveCatColor(cat.colour, idx);
            const active = selectedCatId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCatId(active ? null : cat.id)}
                title={
                  isExpansion
                    ? `${cat.name} — expansion segment: no buyer signal yet`
                    : cat.value_prop
                }
                className={`inline-flex items-center gap-2 px-3 py-1 text-xs font-medium transition-colors ${
                  isExpansion ? "border border-dashed opacity-75" : "border"
                }`}
                style={{
                  borderColor: active ? color : isExpansion ? "rgba(148,163,184,0.35)" : "rgba(255,255,255,0.12)",
                  backgroundColor: active ? `${color}22` : "transparent",
                  color: active ? "#ffffff" : isExpansion ? "#94a3b8" : "#cbd5e1",
                }}
              >
                <span
                  className={`size-2 rounded-full ${isExpansion ? "border border-slate-400 bg-transparent" : ""}`}
                  style={isExpansion ? undefined : { backgroundColor: color }}
                />
                <span>{cat.name}</span>
                {isExpansion && (
                  <span className="font-mono text-[10px] text-slate-400">
                    (expansion · no signal yet)
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 3-RING RADIAL SVG COSMOS */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${cosmos.width} ${cosmos.height}`}
          className={`w-full select-none ${tall ? "min-h-[580px]" : "min-h-[500px]"}`}
          role="img"
          aria-label="DeepBridge 3-ring layered knowledge graph"
        >
          <defs>
            <filter id="db-cosmos-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* SUBTLE ORBITAL RINGS: CORE -> CATEGORIES -> BRIDGES -> BUYERS */}
          {[
            { rx: 92, ry: 74, label: "CORE VALUE" },
            { rx: 188, ry: 148, label: "BUYER GROUPS" },
            { rx: 295, ry: 215, label: "WARM BRIDGES" },
            { rx: 415, ry: 262, label: "BUYER R&D" },
          ].map((orbit) => (
            <g key={orbit.label}>
              <ellipse
                cx={cosmos.cx}
                cy={cosmos.cy}
                rx={orbit.rx}
                ry={orbit.ry}
                fill="none"
                stroke="rgba(148, 163, 184, 0.12)"
                strokeWidth={1}
                strokeDasharray="3 6"
              />
              <text
                x={cosmos.cx}
                y={cosmos.cy - orbit.ry + 13}
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.35)"
                fontSize="9"
                fontFamily="monospace"
                letterSpacing="1.6"
              >
                {orbit.label}
              </text>
            </g>
          ))}

          {/* LAYER 1: CORE -> CATEGORY -> BUYER ORG SPOKES */}
          {categories.map((cat, idx) => {
            if (!isNodeVisible(cat.id)) return null;
            const cFounder = cosmos.coords[cosmos.founderNodeId];
            const cCat = cosmos.coords[cat.id];
            if (!cFounder || !cCat) return null;
            const isExpansion = cat.org_ids.length === 0;
            const color = isExpansion ? "#64748b" : resolveCatColor(cat.colour, idx);
            const active = selectedCatId === null || selectedCatId === cat.id;

            return (
              <g key={`spokes-${cat.id}`}>
                <line
                  x1={cFounder.x}
                  y1={cFounder.y}
                  x2={cCat.x}
                  y2={cCat.y}
                  stroke={color}
                  strokeWidth={active ? 1.6 : 0.8}
                  strokeOpacity={isExpansion ? 0.28 : active ? 0.55 : 0.14}
                  strokeDasharray={isExpansion ? "2 5" : "4 4"}
                />
                {cat.org_ids.map((oid) => {
                  if (!isNodeVisible(oid)) return null;
                  const cOrg = cosmos.coords[oid];
                  if (!cOrg) return null;
                  return (
                    <line
                      key={`fit-${cat.id}-${oid}`}
                      x1={cCat.x}
                      y1={cCat.y}
                      x2={cOrg.x}
                      y2={cOrg.y}
                      stroke={color}
                      strokeWidth={active ? 1.2 : 0.6}
                      strokeOpacity={active ? 0.3 : 0.08}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* LAYER 2: DATED RESEARCH & WARM-PATH EDGES */}
          {edges.map((edge) => {
            const p1 = cosmos.coords[edge.from];
            const p2 = cosmos.coords[edge.to];
            if (!p1 || !p2) return null;
            if (!isNodeVisible(edge.from) || !isNodeVisible(edge.to)) return null;

            const isLit = activeHopSet.has(edge.id);
            const isHovered = hoveredNodeId === edge.from || hoveredNodeId === edge.to;
            const isRejected = edge.name_check === "rejected";
            const stroke = isRejected
              ? "#ef4444"
              : isLit
                ? activePathCatColor
                : EDGE_STROKES[edge.type] ?? "#64748b";

            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2 - (isLit ? 16 : 6);
            const d = `M ${p1.x} ${p1.y} Q ${mx} ${my}, ${p2.x} ${p2.y}`;

            return (
              <g
                key={edge.id}
                onClick={() => onInspectEdge(edge.id)}
                className="cursor-pointer"
              >
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isLit ? 3.2 : isHovered ? 2 : 1.1}
                  strokeOpacity={isLit ? 0.98 : isHovered ? 0.65 : 0.22}
                  filter={isLit ? "url(#db-cosmos-glow)" : undefined}
                  className={isLit && !isRejected ? "db-edge-active" : undefined}
                />
                {/* Show dated edge pill ONLY on active path or hover — clean progressive disclosure! */}
                {(isLit || isHovered) && (
                  <g transform={`translate(${mx}, ${my - 6})`}>
                    <rect
                      x={-84}
                      y={-11}
                      width={168}
                      height={20}
                      rx={3}
                      fill="#050b1d"
                      stroke={stroke}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="10.5"
                      fontFamily="monospace"
                    >
                      {edge.label.length > 25 ? `${edge.label.slice(0, 24)}…` : edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* LAYER 3: INNER CORE VALUE SATELLITES (SUBTLE, REVEAL TEXT ON HOVER) */}
          {cosmos.valueNodes.map((vn) => {
            if (!isNodeVisible(vn.id)) return null;
            const pt = cosmos.coords[vn.id];
            if (!pt) return null;
            const hovered = hoveredNodeId === vn.id;
            return (
              <motion.g
                key={vn.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.28 }}
                transform={`translate(${pt.x}, ${pt.y})`}
                onMouseEnter={() => setHoveredNodeId(vn.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  if (vn.evidence_ids[0]) onInspectEvidence(vn.evidence_ids[0]);
                }}
                className="cursor-pointer"
              >
                <circle
                  r={hovered ? 7 : 4.5}
                  fill="#0b2536"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                />
                {hovered && (
                  <g transform="translate(0, -16)">
                    <rect
                      x={-120}
                      y={-14}
                      width={240}
                      height={22}
                      rx={3}
                      fill="#050b1d"
                      stroke="#38bdf8"
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={1}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="11"
                    >
                      {vn.text.length > 36 ? `${vn.text.slice(0, 35)}…` : vn.text}
                    </text>
                  </g>
                )}
              </motion.g>
            );
          })}

          {/* LAYER 4: BUYER CATEGORY NODES (--cat-1..4; EXPANSION DASHED WHEN NO BUYER SIGNAL) */}
          {categories.map((cat, idx) => {
            if (!isNodeVisible(cat.id)) return null;
            const pt = cosmos.coords[cat.id];
            if (!pt) return null;
            const isExpansion = cat.org_ids.length === 0;
            const color = isExpansion ? "#64748b" : resolveCatColor(cat.colour, idx);
            const active = selectedCatId === cat.id;
            const hovered = hoveredNodeId === cat.id;

            return (
              <motion.g
                key={cat.id}
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: isExpansion ? 0.72 : 1 }}
                transition={{ duration: 0.3 }}
                transform={`translate(${pt.x}, ${pt.y})`}
                onMouseEnter={() => setHoveredNodeId(cat.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedCatId(active ? null : cat.id)}
                className="cursor-pointer"
              >
                {(active || graphStream.latestPulsingId === cat.id) && (
                  <circle r={19} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={2} />
                )}
                <circle
                  r={11}
                  fill="#060d24"
                  stroke={color}
                  strokeWidth={active || hovered ? 2.8 : 2}
                  strokeDasharray={isExpansion ? "3 3" : undefined}
                />
                <text
                  x={0}
                  y={25}
                  textAnchor="middle"
                  fill={active || hovered ? "#ffffff" : isExpansion ? "#94a3b8" : "#cbd5e1"}
                  fontSize="11.5"
                  fontWeight="600"
                >
                  {cat.name.length > 24 ? `${cat.name.slice(0, 23)}…` : cat.name}
                </text>
                {isExpansion && (
                  <text
                    x={0}
                    y={38}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    expansion segment: no buyer signal yet
                  </text>
                )}
              </motion.g>
            );
          })}

          {/* LAYER 5: BRIDGE RESEARCHERS (LABELS CLEANLY SHOWN FOR ACTIVE / HOVERED) */}
          {cosmos.bridgeIds.map((pid) => {
            if (!isNodeVisible(pid)) return null;
            const pt = cosmos.coords[pid];
            if (!pt) return null;
            const person = peopleMap[pid];
            const isLit = activeNodeSet.has(pid);
            const hovered = hoveredNodeId === pid;
            const pulsing = graphStream.latestPulsingId === pid;

            return (
              <motion.g
                key={pid}
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.28 }}
                transform={`translate(${pt.x}, ${pt.y})`}
                onMouseEnter={() => setHoveredNodeId(pid)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  const pForBridge = sortedPaths.find(
                    (p) => p.bridge_id === pid || p.buyer_person_id === pid,
                  );
                  if (pForBridge) onSelectPath(pForBridge.id);
                  onInspectPerson(pid);
                }}
                className="cursor-pointer"
              >
                {(isLit || pulsing) && (
                  <circle
                    r={18}
                    fill="none"
                    stroke={isLit ? activePathCatColor : "#c084fc"}
                    strokeWidth={1.8}
                    strokeOpacity={0.55}
                  />
                )}
                <circle
                  r={isLit || hovered ? 10.5 : 7}
                  fill={isLit ? "#062c21" : "#0b1329"}
                  stroke={isLit || hovered ? activePathCatColor : "#94a3b8"}
                  strokeWidth={isLit || hovered ? 2.5 : 1.4}
                />
                {(isLit || hovered) && (
                  <g transform="translate(0, -16)">
                    <rect
                      x={-84}
                      y={-13}
                      width={168}
                      height={21}
                      rx={3}
                      fill="#050b1d"
                      stroke={activePathCatColor}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={2}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="12"
                      fontWeight="700"
                    >
                      {person?.name ?? pid}
                    </text>
                  </g>
                )}
              </motion.g>
            );
          })}

          {/* LAYER 6: OUTER COMMERCIAL BUYER ORGS (LARGE CRISP LABELS) */}
          {cosmos.buyerOrgIds.map((oid) => {
            if (!isNodeVisible(oid)) return null;
            const pt = cosmos.coords[oid];
            if (!pt) return null;
            const org = orgsMap[oid];
            const isLit = activeNodeSet.has(oid);
            const hovered = hoveredNodeId === oid;
            const catIdx = categories.findIndex((c) => c.org_ids.includes(oid));
            const catColor =
              catIdx >= 0 ? resolveCatColor(categories[catIdx].colour, catIdx) : "#34d399";

            return (
              <motion.g
                key={oid}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.32 }}
                transform={`translate(${pt.x}, ${pt.y})`}
                onMouseEnter={() => setHoveredNodeId(oid)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => {
                  const best = paths
                    .filter((p) => p.buyer_org_id === oid)
                    .sort((a, b) => b.score - a.score)[0];
                  if (best) onSelectPath(best.id);
                }}
                className="cursor-pointer"
              >
                {isLit && (
                  <rect
                    x={-58}
                    y={-21}
                    width={116}
                    height={42}
                    rx={6}
                    fill="none"
                    stroke={catColor}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={-52}
                  y={-16}
                  width={104}
                  height={32}
                  rx={4}
                  fill={isLit ? "#062c21" : "#071024"}
                  stroke={isLit ? catColor : hovered ? "#ffffff" : catColor}
                  strokeWidth={isLit || hovered ? 2.2 : 1.4}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12.5"
                  fontWeight="700"
                >
                  {(org?.name ?? oid).slice(0, 14)}
                </text>
              </motion.g>
            );
          })}

          {/* LAYER 7: FOUNDER CORE SUN */}
          {(() => {
            const pt = cosmos.coords[cosmos.founderNodeId];
            if (!pt) return null;
            return (
              <g
                transform={`translate(${pt.x}, ${pt.y})`}
                onClick={() => onInspectPerson(cosmos.founderNodeId)}
                className="cursor-pointer"
              >
                <circle r={30} fill="rgba(56, 189, 248, 0.14)" />
                <circle
                  r={19}
                  fill="#082f49"
                  stroke="#38bdf8"
                  strokeWidth={3}
                  filter="url(#db-cosmos-glow)"
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="800"
                  fontFamily="monospace"
                >
                  CORE
                </text>
                <text
                  x={0}
                  y={38}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="13.5"
                  fontWeight="700"
                >
                  {founderDisplayName}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );

  const bridgePerson = activePath ? peopleMap[activePath.bridge_id] : null;
  const isLarsenHero = Boolean(bridgePerson?.name?.includes("Larsen"));

  return (
    <div className="space-y-6">
      {/* FLAT TOP HEADER & MODE SWITCHER */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-5">
        <div className="space-y-1">
          <div className="font-mono text-xs uppercase tracking-widest text-sky-400">
            03 · Layered Knowledge Graph
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {activeCategory ? activeCategory.name : "Warm Paths to Technical Buyers"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {orgFilterId && (
            <button
              type="button"
              onClick={onClearOrgFilter}
              className="border border-sky-400/50 bg-[#0b2536] px-3 py-2 font-mono text-xs text-sky-200 hover:text-white"
            >
              Org: {orgsMap[orgFilterId]?.name ?? orgFilterId} ×
            </button>
          )}

          <div className="inline-flex border border-white/20 bg-[#0f1117]">
            {(
              [
                { key: "cosmos_split", label: "Cosmos + Path", icon: Sparkles },
                { key: "stage_live", label: "Stage Live", icon: Radio },
                { key: "cosmos_full", label: "Full Cosmos", icon: Waypoints },
                { key: "table", label: "Flat Table", icon: TableIcon },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const active = viewMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setViewMode(m.key)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-sky-400 text-[#04131d] font-semibold"
                      : "text-muted-foreground hover:text-white"
                  }`}
                >
                  <Icon className="size-4" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* MODE 1: STAGE LIVE (1:30 LIVE VOICE INTERVIEW BESIDE GROWING COSMOS) */}
      {viewMode === "stage_live" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="flex flex-col justify-between border border-white/15 bg-[#0f1117] p-6 xl:col-span-4 space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <motion.span
                    animate={{ scale: [1, 1.25, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="size-3 rounded-full bg-emerald-400"
                  />
                  <span className="text-lg font-bold text-white">Live Stage Interview</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseHostedVoice((v) => !v)}
                  className="border border-white/15 px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-white"
                >
                  <Globe className="inline size-3 mr-1" />
                  {useHostedVoice ? "Local Fallback" : "Voice App"}
                </button>
              </div>

              {useHostedVoice ? (
                <div className="space-y-2.5">
                  <Input
                    value={hostedVoiceUrl}
                    onChange={(e) => setHostedVoiceUrl(e.target.value)}
                    placeholder={`Hosted Lovable voice URL (?session=${activeSessionId})…`}
                    className="font-mono text-xs"
                  />
                  {resolvedStageVoiceSrc ? (
                    <iframe
                      src={resolvedStageVoiceSrc}
                      title="Stage Voice Interview"
                      allow="microphone; autoplay"
                      className="h-[420px] w-full border border-white/15 bg-black"
                    />
                  ) : (
                    <div className="flex h-[320px] items-center justify-center border border-dashed border-white/15 p-5 text-center text-sm text-muted-foreground">
                      Paste hosted voice URL above (?session={activeSessionId}), or click Local Fallback for browser voice + text.
                    </div>
                  )}
                </div>
              ) : !stageInterview ? (
                <div className="space-y-4 py-8">
                  <p className="text-xl font-medium leading-relaxed text-white">
                    Play the 75-second founder interview on stage while buyer groups and warm paths light up live on the right.
                  </p>
                  <Button
                    variant="default"
                    flat
                    disabled={stageBusy}
                    onClick={() => void startStageInterview()}
                    className="h-12 w-full text-base font-semibold"
                  >
                    <Mic className="size-4" />
                    {stageBusy ? "Starting…" : "Start Live Interview"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {stageInterview.question && (
                    <div className="text-xl font-semibold leading-snug text-white">
                      {stageInterview.question}
                    </div>
                  )}
                  {!stageInterview.done && (
                    <form onSubmit={(e) => void submitStageAnswer(e)} className="space-y-2.5">
                      <Input
                        value={stageAnswer}
                        onChange={(e) => setStageAnswer(e.target.value)}
                        placeholder="Speak or type founder answer…"
                        className="h-11 text-base"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          flat
                          onClick={toggleStageMic}
                          className="h-10 border border-white/25"
                        >
                          {stageListening ? <MicOff className="size-4 text-red-300" /> : <Mic className="size-4 text-sky-300" />}
                          {stageListening ? "Listening…" : "Mic"}
                        </Button>
                        <Button
                          type="submit"
                          variant="default"
                          flat
                          disabled={stageBusy || !stageAnswer.trim()}
                          className="h-10 flex-1"
                        >
                          <Send className="size-4" />
                          Answer
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-white/10 pt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Stage fallback ready ({activeSessionId})</span>
              <button
                type="button"
                onClick={() => void graphStream.startReplay(8, activeSessionId)}
                className="font-mono text-sky-300 hover:underline"
              >
                Switch to recorded replay →
              </button>
            </div>
          </div>

          <div className="xl:col-span-8">{renderCosmosCanvas(true)}</div>
        </div>
      )}

      {/* MODE 2: COSMOS + CLEAN SELECTED PATH PANEL */}
      {viewMode === "cosmos_split" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8">{renderCosmosCanvas(false)}</div>

          {/* RIGHT: ULTRA-FLAT SELECTED PATH INSPECTOR (PROGRESSIVE DISCLOSURE) */}
          <div className="flex flex-col justify-between border border-white/15 bg-[#0f1117] p-6 xl:col-span-4 space-y-6">
            {activeCategory && activeCategory.org_ids.length === 0 ? (
              <div className="space-y-4 py-8">
                <span className="inline-block border border-dashed border-slate-400/50 px-2.5 py-1 font-mono text-xs uppercase text-slate-300">
                  Expansion Segment · No Buyer Signal Yet
                </span>
                <h2 className="text-2xl font-bold text-white">{activeCategory.name}</h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  {activeCategory.value_prop}
                </p>
              </div>
            ) : activePath ? (
              <div className="space-y-6">
                <div className="space-y-2 border-b border-white/10 pb-5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-wider text-emerald-300">
                      {activePath.kind.replace(/_/g, " ")} · Score {activePath.score}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {sortedPaths.findIndex((p) => p.id === activePath.id) + 1} of {sortedPaths.length}
                    </span>
                  </div>

                  <h2 className="text-2xl font-bold text-white">
                    {orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}
                  </h2>

                  <div className="pt-1 text-base text-muted-foreground">
                    Warm bridge:{" "}
                    <button
                      type="button"
                      onClick={() => onInspectPerson(activePath.bridge_id)}
                      className="font-semibold text-sky-300 underline decoration-sky-400/50 underline-offset-4 hover:text-white"
                    >
                      {bridgePerson?.name ?? activePath.bridge_id}
                    </button>
                  </div>

                  {isLarsenHero && (
                    <div className="mt-2 border-l-2 border-emerald-400 bg-[#07291e]/70 px-3 py-2 font-mono text-xs text-emerald-100">
                      Moss verified: Åsmund Larsen, Radiopharmaceuticals manager at Bayer (as of Mar 2024)
                    </div>
                  )}
                </div>

                {/* MOSS CONTACT CHECK + WEAKEST LINK VERIFICATION */}
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => onInspectPerson(activePath.bridge_id)}
                    className="flex w-full items-center justify-between border border-white/15 bg-[#090a0d] px-4 py-3 text-left transition-colors hover:border-sky-400"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        Verify Current Role (Moss Agent)
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {isLarsenHero
                          ? "Moss verified: Radiopharmaceuticals manager at Bayer (as of Mar 2024)"
                          : bridgePerson?.affiliation_asof
                            ? `Paper affiliation as of ${bridgePerson.affiliation_asof}`
                            : "Check live role & masked email"}
                      </div>
                    </div>
                    <UserSearch className="size-4 text-sky-300 shrink-0" />
                  </button>

                  {(() => {
                    const weakEdge = edgesMap[activePath.weakest_edge_id];
                    if (!weakEdge) return null;
                    return (
                      <div className="space-y-2.5 border border-white/15 bg-[#090a0d] p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs uppercase text-amber-300 flex items-center gap-1.5">
                            <ShieldAlert className="size-3.5" />
                            Identity Check
                          </span>
                          <span className="font-mono text-xs uppercase text-muted-foreground">
                            {weakEdge.name_check}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-white">{weakEdge.label}</div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            flat
                            disabled={checkingEdgeId === weakEdge.id}
                            onClick={() => void handleQuickNameCheck(weakEdge.id, "ok")}
                            className="flex-1 border border-emerald-400/40 bg-[#07291e] text-emerald-100 hover:border-emerald-300"
                          >
                            <CheckCircle2 className="size-3.5" />
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            flat
                            disabled={checkingEdgeId === weakEdge.id}
                            onClick={() => void handleQuickNameCheck(weakEdge.id, "rejected")}
                            className="border border-red-400/40 bg-[#2d0a0e] text-red-200 hover:border-red-300"
                          >
                            <XCircle className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* PROGRESSIVE DISCLOSURE: EXPAND HOP CHAIN & WHY-NOW SIGNALS */}
                <div className="border-t border-white/10 pt-3">
                  <button
                    type="button"
                    onClick={() => setExpandedHops((v) => !v)}
                    className="flex w-full items-center justify-between py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-white"
                  >
                    <span>
                      Cited Hops ({activePath.hops.length}) &amp; Signals (
                      {activePath.why_now_signal_ids.length})
                    </span>
                    <ChevronDown
                      className={`size-4 transition-transform ${expandedHops ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {expandedHops && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden space-y-2.5 pt-3"
                      >
                        {activePath.hops.map((eid, idx) => {
                          const edge = edgesMap[eid];
                          if (!edge) return null;
                          return (
                            <div
                              key={eid}
                              className="flex items-center justify-between gap-2 border-l-2 border-sky-400/50 pl-3 py-1"
                            >
                              <div className="text-sm text-foreground">
                                <span className="font-mono text-xs text-sky-300 mr-1.5">
                                  #{idx + 1}
                                </span>
                                {edge.label}
                              </div>
                              {edge.evidence_ids[0] && (
                                <EvidenceChip
                                  evidenceId={edge.evidence_ids[0]}
                                  evidenceMap={evidenceMap}
                                  onInspect={onInspectEvidence}
                                  compact
                                />
                              )}
                            </div>
                          );
                        })}

                        {activePath.why_now_signal_ids.map((sid) => {
                          const sig = signalsMap[sid];
                          if (!sig) return null;
                          return (
                            <div
                              key={sid}
                              className="border-l-2 border-amber-400/50 pl-3 py-1 text-xs text-amber-100/90"
                            >
                              Why now: {sig.title}
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* COMPACT OTHER PATHS STRIP */}
                <div className="border-t border-white/10 pt-4 space-y-2">
                  <div className="font-mono text-xs uppercase text-muted-foreground">
                    Switch Warm Path
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-white/10 border border-white/10">
                    {sortedPaths.slice(0, 8).map((p) => {
                      const selected = p.id === activePath.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSelectPath(p.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? "bg-[#0b2536] text-white font-semibold"
                              : "text-muted-foreground hover:bg-white/[0.03] hover:text-white"
                          }`}
                        >
                          <span className="truncate">
                            {orgsMap[p.buyer_org_id]?.name ?? p.buyer_org_id} ·{" "}
                            {peopleMap[p.bridge_id]?.name ?? "Bridge"}
                          </span>
                          <span className="font-mono text-xs text-sky-300 ml-2">{p.score}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-base text-muted-foreground">
                Select a buyer node or run Replay 8× to light up warm paths.
              </div>
            )}

            {activePath && (!activeCategory || activeCategory.org_ids.length > 0) && (
              <Button
                variant="default"
                flat
                onClick={() => onDraftForPath(activePath.id)}
                className="h-12 w-full text-base font-semibold"
              >
                Draft Cited Intro <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* MODE 3: FULL-BLEED COSMOS (FOR 1:30 VIDEO CAPTURE) */}
      {viewMode === "cosmos_full" && renderCosmosCanvas(true)}

      {/* MODE 4: ULTRA-FLAT LARGE-TYPE TABLE WITH HOVER / CLICK EXPAND */}
      {viewMode === "table" && (
        <div className="border-y border-white/15">
          <Table flat>
            <TableHeader>
              <TableRow className="border-white/15 hover:bg-transparent">
                <TableHead className="py-4 font-mono text-xs uppercase">Score</TableHead>
                <TableHead className="py-4 font-mono text-xs uppercase">Buyer Organization</TableHead>
                <TableHead className="py-4 font-mono text-xs uppercase">Warm Bridge</TableHead>
                <TableHead className="py-4 font-mono text-xs uppercase">Dated Connection</TableHead>
                <TableHead className="py-4 text-right font-mono text-xs uppercase">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPaths.map((p) => {
                const org = orgsMap[p.buyer_org_id];
                const bridge = peopleMap[p.bridge_id];
                const firstEdge = edgesMap[p.hops[0]];
                const expanded = expandedRowId === p.id;

                return (
                  <React.Fragment key={p.id}>
                    <TableRow
                      onClick={() => {
                        onSelectPath(p.id);
                        setExpandedRowId(expanded ? null : p.id);
                      }}
                      className="group cursor-pointer border-white/10 transition-colors hover:bg-white/[0.03]"
                    >
                      <TableCell className="py-4 font-mono text-lg font-bold text-emerald-300">
                        {p.score}
                      </TableCell>
                      <TableCell className="py-4 text-lg font-semibold text-white">
                        {org?.name ?? p.buyer_org_id}
                      </TableCell>
                      <TableCell className="py-4">
                        <span className="text-base font-medium text-sky-300">
                          {bridge?.name ?? p.bridge_id}
                        </span>
                        {bridge?.affiliation_asof && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                            as of {bridge.affiliation_asof}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-4 font-mono text-sm text-muted-foreground">
                        {firstEdge?.label ?? p.kind.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell
                        className="py-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-2 opacity-60 transition-opacity group-hover:opacity-100">
                          <Button
                            size="sm"
                            flat
                            onClick={() => onInspectPerson(p.bridge_id)}
                            className="border border-white/20"
                          >
                            Verify Role
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            flat
                            onClick={() => onDraftForPath(p.id)}
                          >
                            Draft →
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <TableRow className="border-white/10 bg-[#0f1117]">
                          <TableCell colSpan={5} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden px-6 py-4 flex flex-wrap items-center justify-between gap-4"
                            >
                              <div className="flex flex-wrap items-center gap-3">
                                {p.hops.map((eid) => {
                                  const e = edgesMap[eid];
                                  if (!e) return null;
                                  return (
                                    <span
                                      key={eid}
                                      className="inline-flex items-center gap-2 border border-white/15 bg-[#090a0d] px-3 py-1.5 text-sm"
                                    >
                                      <span>{e.label}</span>
                                      {e.evidence_ids[0] && (
                                        <EvidenceChip
                                          evidenceId={e.evidence_ids[0]}
                                          evidenceMap={evidenceMap}
                                          onInspect={onInspectEvidence}
                                          compact
                                        />
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </motion.div>
                          </TableCell>
                        </TableRow>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
