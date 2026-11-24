"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Columns2,
  Filter,
  GitBranch,
  Orbit,
  ShieldCheck,
  Table2,
  UserCheck,
  XCircle,
  Zap,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/lib/api";
import type { Edge, Evidence, Founder, Id, Org, Path, Person, Signal } from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

type LeadsViewMode = "split" | "graph" | "table";

interface ScreenLeadsProps {
  founder: Founder | null;
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
  founder,
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
  const [viewMode, setViewMode] = React.useState<LeadsViewMode>("split");
  const [kindFilter, setKindFilter] = React.useState<string>("all");
  const [checkingEdgeId, setCheckingEdgeId] = React.useState<Id | null>(null);

  const sortedPaths = React.useMemo(() => {
    return [...paths]
      .filter((p) => (orgFilterId ? p.buyer_org_id === orgFilterId : true))
      .filter((p) => (kindFilter === "all" ? true : p.kind === kindFilter))
      .sort((a, b) => b.score - a.score);
  }, [paths, orgFilterId, kindFilter]);

  const activePath = React.useMemo(() => {
    return (
      sortedPaths.find((p) => p.id === selectedPathId) ??
      paths.find((p) => p.id === selectedPathId) ??
      sortedPaths[0] ??
      null
    );
  }, [sortedPaths, paths, selectedPathId]);

  const availableKinds = React.useMemo(() => {
    const set = new Set<Path["kind"]>();
    for (const p of paths) set.add(p.kind);
    return Array.from(set);
  }, [paths]);

  // Compute clean 4-column Deep-Space graph coordinates
  const graphLayout = React.useMemo(() => {
    const founderNodeId = founder?.id ?? paths[0]?.founder_id ?? "person:openalex:A5102978866";

    // Gather nodes referenced by paths + edges so every visible path renders cleanly
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

    // Also include any other buyer orgs
    for (const o of orgs) {
      if (o.is_buyer && !buyerOrgIds.includes(o.id)) {
        buyerOrgIds.push(o.id);
      }
    }

    const height = 560;
    const coords: Record<Id, { x: number; y: number; col: "founder" | "bridge" | "hop2" | "org" }> = {};

    coords[founderNodeId] = { x: 115, y: height / 2, col: "founder" };

    const distributeY = (count: number, idx: number, padTop = 52, padBottom = 52) => {
      if (count <= 1) return height / 2;
      const usable = height - padTop - padBottom;
      return padTop + (usable * idx) / (count - 1);
    };

    bridgeIds.forEach((id, idx) => {
      coords[id] = { x: 430, y: distributeY(bridgeIds.length, idx, 44, 44), col: "bridge" };
    });

    secondHopIds.forEach((id, idx) => {
      coords[id] = { x: 700, y: distributeY(secondHopIds.length, idx, 130, 130), col: "hop2" };
    });

    buyerOrgIds.forEach((id, idx) => {
      coords[id] = { x: 955, y: distributeY(buyerOrgIds.length, idx, 54, 54), col: "org" };
    });

    return { founderNodeId, bridgeIds, secondHopIds, buyerOrgIds, coords, width: 1080, height };
  }, [founder?.id, paths, orgs]);

  const activeHopSet = React.useMemo(() => {
    return new Set(activePath?.hops ?? []);
  }, [activePath]);

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
    <div className="space-y-5">
      {/* TOP CONTROL DECK: VIEW SWITCHER + FILTERS */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/15 bg-white/[0.025] p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-1">
            Surface Mode:
          </span>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "split"}
            onClick={() => setViewMode("split")}
            className="border border-white/20 font-mono text-xs"
          >
            <Columns2 className="size-3.5 text-sky-300" />
            Split Stage (Graph + Table)
          </Button>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "graph"}
            onClick={() => setViewMode("graph")}
            className="border border-white/20 font-mono text-xs"
          >
            <Orbit className="size-3.5 text-sky-300" />
            Deep-Space Graph Only
          </Button>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "table"}
            onClick={() => setViewMode("table")}
            className="border border-white/20 font-mono text-xs"
          >
            <Table2 className="size-3.5 text-emerald-300" />
            Neo-Brutalist Leads Table
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="size-3.5 text-muted-foreground mr-1" />
          <button
            type="button"
            onClick={() => setKindFilter("all")}
            className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
              kindFilter === "all"
                ? "border-sky-400 bg-sky-500/20 text-sky-100"
                : "border-white/15 bg-white/5 text-muted-foreground hover:text-foreground"
            }`}
          >
            ALL ({paths.length})
          </button>
          {availableKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
                kindFilter === kind
                  ? "border-sky-400 bg-sky-500/20 text-sky-100"
                  : "border-white/15 bg-white/5 text-muted-foreground hover:text-foreground"
              }`}
            >
              {KIND_LABELS[kind] ?? kind.toUpperCase()}
            </button>
          ))}
          {orgFilterId && (
            <Badge
              flat
              className="ml-1 cursor-pointer border-amber-400/50 bg-amber-500/20 font-mono text-[11px] text-amber-100"
              onClick={onClearOrgFilter}
            >
              ORG: {orgsMap[orgFilterId]?.name ?? orgFilterId} ✕
            </Badge>
          )}
        </div>
      </div>

      {/* DEEP-SPACE KNOWLEDGE GRAPH — THE ONE SISTINE CRYSTAL + SAPPHIRE EXCEPTION */}
      {(viewMode === "split" || viewMode === "graph") && (
        <section
          data-glass="crystal"
          data-glass-tint="sapphire"
          data-gloss="white"
          data-gloss-shape="frame"
          className="db-cosmos relative overflow-hidden rounded-md border border-sky-400/35 p-4"
        >
          {/* Deep-space HUD overlay header */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Badge className="border-sky-300/40 bg-sky-500/25 font-mono text-[10px] tracking-widest text-sky-100">
                ✦ DEEP-SPACE TOPOLOGY · CRYSTAL SAPPHIRE
              </Badge>
              <span className="font-mono text-xs text-sky-100/80">
                Publication-dated edges only — click any node or hop to inspect verbatim citation & Moss verification
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-sky-200/80">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
                Active Warm Path
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                Weakest Hop (Verify)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-400" />
                Buyer Org
              </span>
            </div>
          </div>

          {/* Interactive SVG Cosmos Graph */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
              className="h-[460px] min-w-[920px] w-full select-none"
            >
              <defs>
                <radialGradient id="founderHalo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.48" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                </radialGradient>
                <filter id="neonGlow" x="-25%" y="-25%" width="150%" height="150%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Subtle orbital guide arcs */}
              <ellipse
                cx="115"
                cy={graphLayout.height / 2}
                rx="315"
                ry="250"
                fill="none"
                stroke="rgba(56, 189, 248, 0.12)"
                strokeDasharray="3 7"
              />
              <ellipse
                cx="115"
                cy={graphLayout.height / 2}
                rx="585"
                ry="270"
                fill="none"
                stroke="rgba(99, 102, 241, 0.10)"
                strokeDasharray="3 9"
              />

              {/* Column headers */}
              <text x="115" y="22" textAnchor="middle" className="fill-sky-300/60 font-mono text-[10px] tracking-widest">
                FOUNDER CORE
              </text>
              <text x="430" y="22" textAnchor="middle" className="fill-sky-300/60 font-mono text-[10px] tracking-widest">
                1ST-HOP BRIDGES (DATED PAPERS / BOARD)
              </text>
              {graphLayout.secondHopIds.length > 0 && (
                <text x="700" y="22" textAnchor="middle" className="fill-sky-300/60 font-mono text-[10px] tracking-widest">
                  2ND-HOP BRIDGE
                </text>
              )}
              <text x="955" y="22" textAnchor="middle" className="fill-emerald-300/70 font-mono text-[10px] tracking-widest">
                COMMERCIAL BUYERS
              </text>

              {/* Render all edges with Coordinates */}
              {edges.map((edge) => {
                const fromPos = graphLayout.coords[edge.from];
                const toPos = graphLayout.coords[edge.to];
                if (!fromPos || !toPos) return null;

                const isLit = activeHopSet.has(edge.id);
                const isWeakest = activePath?.weakest_edge_id === edge.id;
                const midX = (fromPos.x + toPos.x) / 2;
                const midY = (fromPos.y + toPos.y) / 2;
                const dx = toPos.x - fromPos.x;
                const curvePath = `M ${fromPos.x} ${fromPos.y} C ${fromPos.x + dx * 0.42} ${fromPos.y}, ${toPos.x - dx * 0.42} ${toPos.y}, ${toPos.x} ${toPos.y}`;

                const strokeColor = isWeakest
                  ? "#fbbf24"
                  : edge.name_check === "rejected"
                    ? "#f87171"
                    : isLit
                      ? "#38bdf8"
                      : "rgba(148, 163, 184, 0.18)";

                return (
                  <g
                    key={edge.id}
                    onClick={() => onInspectEdge(edge.id)}
                    className="cursor-pointer"
                  >
                    {/* Invisible wider hit target */}
                    <path d={curvePath} fill="none" stroke="transparent" strokeWidth={14} />
                    <path
                      d={curvePath}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isLit ? 2.8 : 1.15}
                      filter={isLit ? "url(#neonGlow)" : undefined}
                      className={isLit ? "db-edge-active" : "transition-opacity hover:opacity-80"}
                    />
                    {isLit && (
                      <g transform={`translate(${midX}, ${midY - 10})`}>
                        <rect
                          x={-98}
                          y={-11}
                          width={196}
                          height={20}
                          rx={3}
                          fill={isWeakest ? "rgba(69, 26, 3, 0.92)" : "rgba(7, 24, 54, 0.92)"}
                          stroke={isWeakest ? "#fbbf24" : "#38bdf8"}
                          strokeWidth={1}
                        />
                        <text
                          x={0}
                          y={2.5}
                          textAnchor="middle"
                          className="fill-white font-mono text-[9.5px] font-medium"
                        >
                          {edge.label.slice(0, 32)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Founder Node */}
              {(() => {
                const fPos = graphLayout.coords[graphLayout.founderNodeId];
                if (!fPos) return null;
                return (
                  <g
                    transform={`translate(${fPos.x}, ${fPos.y})`}
                    onClick={() => onInspectPerson(graphLayout.founderNodeId)}
                    className="cursor-pointer"
                  >
                    <circle r={44} fill="url(#founderHalo)" className="db-pulse-slow" />
                    <circle
                      r={18}
                      fill="#0c4a6e"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      filter="url(#neonGlow)"
                    />
                    <circle r={6} fill="#e0f2fe" />
                    <text
                      y={32}
                      textAnchor="middle"
                      className="fill-white font-sans text-[12px] font-bold"
                    >
                      {founder?.name ?? "Nicholas C. Harris"}
                    </text>
                    <text
                      y={46}
                      textAnchor="middle"
                      className="fill-sky-300 font-mono text-[10px]"
                    >
                      {founder?.company ?? "Lightmatter"}
                    </text>
                  </g>
                );
              })()}

              {/* Bridge & 2nd-Hop Person Nodes */}
              {[...graphLayout.bridgeIds, ...graphLayout.secondHopIds].map((pid) => {
                const pos = graphLayout.coords[pid];
                const person = peopleMap[pid];
                if (!pos || !person) return null;
                const isLit = activeNodeSet.has(pid);
                const matchingPath = paths.find(
                  (p) => p.bridge_id === pid || p.buyer_person_id === pid,
                );

                return (
                  <g
                    key={pid}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => {
                      if (matchingPath) onSelectPath(matchingPath.id);
                      onInspectPerson(pid);
                    }}
                    className="cursor-pointer"
                    opacity={activePath && !isLit ? 0.5 : 1}
                  >
                    {isLit && (
                      <circle
                        r={19}
                        fill="rgba(56, 189, 248, 0.18)"
                        stroke="#38bdf8"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                    )}
                    <circle
                      r={isLit ? 10 : 7.5}
                      fill={isLit ? "#0284c7" : "#0f172a"}
                      stroke={isLit ? "#7dd3fc" : "#64748b"}
                      strokeWidth={isLit ? 2.2 : 1.4}
                    />
                    <text
                      x={15}
                      y={3}
                      className={`font-sans text-[11.5px] ${
                        isLit ? "fill-white font-bold" : "fill-slate-300 font-medium"
                      }`}
                    >
                      {person.name}
                    </text>
                    {person.affiliation_asof && (
                      <text x={15} y={15} className="fill-sky-300/75 font-mono text-[9.5px]">
                        as of {person.affiliation_asof.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Buyer Organization Nodes */}
              {graphLayout.buyerOrgIds.map((oid) => {
                const pos = graphLayout.coords[oid];
                const org = orgsMap[oid];
                if (!pos || !org) return null;
                const isLit = activeNodeSet.has(oid);
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
                    opacity={activePath && !isLit ? 0.55 : 1}
                  >
                    <rect
                      x={-58}
                      y={-15}
                      width={116}
                      height={30}
                      rx={4}
                      fill={isLit ? "rgba(6, 78, 59, 0.88)" : "rgba(15, 23, 42, 0.85)"}
                      stroke={isLit ? "#34d399" : "rgba(148, 163, 184, 0.38)"}
                      strokeWidth={isLit ? 2 : 1.2}
                      filter={isLit ? "url(#neonGlow)" : undefined}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      className={`font-mono text-[10.5px] ${
                        isLit ? "fill-emerald-100 font-bold" : "fill-slate-200 font-medium"
                      }`}
                    >
                      {org.name.slice(0, 15)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* SELECTED WARM PATH TELEMETRY DECK */}
          {activePath && (
            <div className="mt-3 rounded border border-sky-300/30 bg-slate-950/85 p-4 backdrop-blur-md">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge flat className="border-sky-400/50 bg-sky-500/20 font-mono text-[10px] text-sky-100">
                      ACTIVE PATH · SCORE {activePath.score}/100
                    </Badge>
                    <Badge flat className="border-white/20 bg-white/10 font-mono text-[10px]">
                      {KIND_LABELS[activePath.kind] ?? activePath.kind}
                    </Badge>
                    {activePath.why_now_signal_ids.map((sid) => {
                      const sig = signalsMap[sid];
                      if (!sig) return null;
                      return (
                        <Badge
                          key={sid}
                          flat
                          className="border-amber-400/40 bg-amber-500/15 font-mono text-[10px] text-amber-200"
                        >
                          <Zap className="mr-1 size-3" />
                          {sig.title.slice(0, 44)}
                        </Badge>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-sm font-semibold text-white">
                    <span>{founder?.name ?? "Nicholas C. Harris"}</span>
                    <span className="font-mono text-xs text-sky-300">→</span>
                    <button
                      type="button"
                      onClick={() => onInspectPerson(activePath.bridge_id)}
                      className="underline decoration-sky-400/60 underline-offset-4 hover:text-sky-200"
                    >
                      {peopleMap[activePath.bridge_id]?.name ?? activePath.bridge_id}
                    </button>
                    {activePath.buyer_person_id &&
                      activePath.buyer_person_id !== activePath.bridge_id && (
                        <>
                          <span className="font-mono text-xs text-sky-300">→</span>
                          <button
                            type="button"
                            onClick={() => onInspectPerson(activePath.buyer_person_id!)}
                            className="underline decoration-sky-400/60 underline-offset-4 hover:text-sky-200"
                          >
                            {peopleMap[activePath.buyer_person_id]?.name ?? activePath.buyer_person_id}
                          </button>
                        </>
                      )}
                    <span className="font-mono text-xs text-emerald-300">→</span>
                    <span className="text-emerald-300">
                      {orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    flat
                    onClick={() => onInspectPerson(activePath.bridge_id)}
                    className="border border-sky-400/40 bg-sky-500/15 font-mono text-xs text-sky-100"
                  >
                    <UserCheck className="size-3.5" />
                    Moss Contact Card
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    flat
                    onClick={() => onDraftForPath(activePath.id)}
                  >
                    <span>04 · Draft Intro Request</span>
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Hop-by-hop breakdown + Weakest Link Name-Check */}
              <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                {activePath.hops.map((eid, idx) => {
                  const edge = edgesMap[eid];
                  if (!edge) return null;
                  const isWeakest = activePath.weakest_edge_id === eid;
                  return (
                    <div
                      key={eid}
                      className={`rounded border p-3 space-y-2 ${
                        isWeakest
                          ? "border-amber-400/50 bg-amber-950/25"
                          : "border-white/15 bg-black/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                        <span className="text-sky-300">
                          HOP {idx + 1} · {edge.type}
                        </span>
                        {isWeakest && (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                            <AlertTriangle className="size-3" />
                            WEAKEST LINK
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-semibold text-white">{edge.label}</div>

                      <div className="flex flex-wrap gap-1">
                        {edge.evidence_ids.map((evId) => (
                          <EvidenceChip
                            key={evId}
                            evidenceId={evId}
                            evidenceMap={evidenceMap}
                            onInspect={onInspectEvidence}
                            compact
                          />
                        ))}
                      </div>

                      <div className="flex items-center justify-between border-t border-white/10 pt-2">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          Check:{" "}
                          <strong
                            className={
                              edge.name_check === "ok"
                                ? "text-emerald-300"
                                : edge.name_check === "rejected"
                                  ? "text-red-300"
                                  : "text-amber-200"
                            }
                          >
                            {edge.name_check}
                          </strong>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={checkingEdgeId === edge.id}
                            onClick={() => void handleQuickNameCheck(edge.id, "ok")}
                            className="inline-flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/25"
                          >
                            <CheckCircle2 className="size-2.5" />
                            OK
                          </button>
                          <button
                            type="button"
                            disabled={checkingEdgeId === edge.id}
                            onClick={() => void handleQuickNameCheck(edge.id, "rejected")}
                            className="inline-flex items-center gap-1 rounded border border-red-400/40 bg-red-500/15 px-2 py-0.5 font-mono text-[10px] text-red-200 hover:bg-red-500/25"
                          >
                            <XCircle className="size-2.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* FLAT NEO-BRUTALIST LEADS & WARM PATHS TABLE */}
      {(viewMode === "split" || viewMode === "table") && (
        <Card flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
          <CardHeader className="px-5 pb-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <GitBranch className="size-4 text-emerald-300" />
                <span>Ranked Warm-Path Leads Table ({sortedPaths.length})</span>
              </CardTitle>
              <span className="font-mono text-[11px] text-muted-foreground">
                Click any row to illuminate its trajectory in the Deep-Space Graph
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            <Table flat scrollX>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[11px] uppercase">Score</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Target Buyer</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Bridge Connector</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Path Kind</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Dated Hop Chain (Never &ldquo;Knows&rdquo;)</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase">Weakest Hop Check</TableHead>
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
                      <TableCell className="font-mono font-bold text-emerald-300">
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
                      <TableCell>
                        <Badge flat className="font-mono text-[10px]">
                          {KIND_LABELS[path.kind] ?? path.kind}
                        </Badge>
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
                                  className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[11px] hover:border-sky-400/50"
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
