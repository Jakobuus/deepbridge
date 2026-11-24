"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Columns2,
  Filter,
  GitBranch,
  Layers,
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

type LeadsViewMode = "split" | "graph" | "table";

const CAT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];

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
  founder,
  icp,
  knowledgeGraph,
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
  const [showCategoryLayer, setShowCategoryLayer] = React.useState<boolean>(true);
  const [kindFilter, setKindFilter] = React.useState<string>("all");
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

  const availableKinds = React.useMemo(() => {
    const set = new Set<Path["kind"]>();
    for (const p of paths) set.add(p.kind);
    return Array.from(set);
  }, [paths]);

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

    const width = 1140;
    const height = 560;
    const coords: Record<
      Id,
      { x: number; y: number; col: "founder" | "cat" | "bridge" | "hop2" | "org" }
    > = {};

    coords[founderNodeId] = { x: 105, y: height / 2, col: "founder" };

    const distributeY = (count: number, idx: number, padTop = 52, padBottom = 52) => {
      if (count <= 1) return height / 2;
      const usable = height - padTop - padBottom;
      return padTop + (usable * idx) / (count - 1);
    };

    if (showCategoryLayer && categories.length > 0) {
      categories.forEach((cat, idx) => {
        coords[cat.id] = {
          x: 315,
          y: distributeY(categories.length, idx, 90, 90),
          col: "cat",
        };
      });
    }

    const bridgeX = showCategoryLayer && categories.length > 0 ? 565 : 435;
    const hop2X = showCategoryLayer && categories.length > 0 ? 795 : 715;
    const orgX = 1015;

    bridgeIds.forEach((id, idx) => {
      coords[id] = { x: bridgeX, y: distributeY(bridgeIds.length, idx, 44, 44), col: "bridge" };
    });

    secondHopIds.forEach((id, idx) => {
      coords[id] = { x: hop2X, y: distributeY(secondHopIds.length, idx, 130, 130), col: "hop2" };
    });

    buyerOrgIds.forEach((id, idx) => {
      coords[id] = { x: orgX, y: distributeY(buyerOrgIds.length, idx, 52, 52), col: "org" };
    });

    // Map each org to its first matching category color
    const orgCatColor: Record<Id, string> = {};
    categories.forEach((cat, idx) => {
      const col = resolveCatColor(cat.colour, idx);
      for (const oid of cat.org_ids) {
        if (!orgCatColor[oid]) orgCatColor[oid] = col;
      }
    });

    return {
      founderNodeId,
      bridgeIds,
      secondHopIds,
      buyerOrgIds,
      coords,
      orgCatColor,
      bridgeX,
      hop2X,
      orgX,
      width,
      height,
    };
  }, [founder?.id, paths, orgs, categories, showCategoryLayer]);

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
    <div className="space-y-5">
      {/* TOP CONTROL DECK: FLAT NEO-BRUTALIST VIEW SWITCHER + FILTERS */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/20 bg-[#0f1117] p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-1">
            View Switch:
          </span>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "split"}
            onClick={() => setViewMode("split")}
            className="border border-white/25 font-mono text-xs"
          >
            <Columns2 className="size-3.5 text-sky-300" />
            Split Stage
          </Button>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "graph"}
            onClick={() => setViewMode("graph")}
            className="border border-white/25 font-mono text-xs"
          >
            <Orbit className="size-3.5 text-sky-300" />
            Deep-Space Graph
          </Button>
          <Button
            size="sm"
            flat
            aria-pressed={viewMode === "table"}
            onClick={() => setViewMode("table")}
            className="border border-white/25 font-mono text-xs"
          >
            <Table2 className="size-3.5 text-emerald-300" />
            Flat Leads Table
          </Button>

          {viewMode !== "table" && (
            <Button
              size="sm"
              flat
              aria-pressed={showCategoryLayer}
              onClick={() => setShowCategoryLayer((v) => !v)}
              className="ml-1 border border-white/25 font-mono text-xs"
            >
              <Layers className="size-3.5 text-purple-300" />
              {showCategoryLayer ? "3-Ring Value + Categories ON" : "Show Category Ring"}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="size-3.5 text-muted-foreground mr-1" />
          <button
            type="button"
            onClick={() => {
              setKindFilter("all");
              setSelectedCatId(null);
            }}
            className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
              kindFilter === "all" && !selectedCatId
                ? "border-sky-400 bg-[#0b2536] text-sky-100"
                : "border-white/20 bg-[#151922] text-muted-foreground hover:text-foreground"
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
                  ? "border-sky-400 bg-[#0b2536] text-sky-100"
                  : "border-white/20 bg-[#151922] text-muted-foreground hover:text-foreground"
              }`}
            >
              {KIND_LABELS[kind] ?? kind.toUpperCase()}
            </button>
          ))}
          {orgFilterId && (
            <Badge
              flat
              className="ml-1 cursor-pointer border-amber-400/60 bg-[#2b1d05] font-mono text-[11px] text-amber-100"
              onClick={onClearOrgFilter}
            >
              ORG: {orgsMap[orgFilterId]?.name ?? orgFilterId} ✕
            </Badge>
          )}
        </div>
      </div>

      {/* DEEP-SPACE LAYERED KNOWLEDGE GRAPH — STRICT FLAT CHROME AROUND SLEEK #020510 COSMOS */}
      {(viewMode === "split" || viewMode === "graph") && (
        <section className="db-cosmos relative overflow-hidden rounded border-2 border-sky-400/40 p-4">
          {/* Header + Category Color Legend (--cat-1..5) */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge flat className="border-sky-400/50 bg-[#0b2536] font-mono text-[10px] tracking-widest text-sky-100">
                ✦ DEEP-SPACE KNOWLEDGE GRAPH · CORE → CATEGORIES → WARM PATHS
              </Badge>
              {categories.map((cat, idx) => {
                const color = resolveCatColor(cat.colour, idx);
                const isCatSelected = selectedCatId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCatId(isCatSelected ? null : cat.id)}
                    className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] transition ${
                      isCatSelected
                        ? "border-white bg-white/15 text-white"
                        : "border-white/20 bg-[#071430] text-slate-200 hover:border-white/45"
                    }`}
                  >
                    <span
                      className="size-2 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span>{cat.name.slice(0, 26)}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px] text-sky-200/85">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-sky-400" />
                Lit Warm Path
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-amber-400" />
                Weakest Hop
              </span>
            </div>
          </div>

          {/* Interactive SVG Cosmos Graph */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
              className="h-[460px] min-w-[960px] w-full select-none"
            >
              <defs>
                <radialGradient id="founderHalo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.42" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Concentric Deep-Space Layer Rings */}
              <ellipse
                cx="105"
                cy={graphLayout.height / 2}
                rx={showCategoryLayer ? 210 : 330}
                ry="240"
                fill="none"
                stroke="rgba(56, 189, 248, 0.14)"
                strokeDasharray="3 7"
              />
              <ellipse
                cx="105"
                cy={graphLayout.height / 2}
                rx={graphLayout.bridgeX - 105}
                ry="265"
                fill="none"
                stroke="rgba(167, 139, 250, 0.13)"
                strokeDasharray="3 8"
              />

              {/* Layer Headers */}
              <text x="105" y="22" textAnchor="middle" className="fill-sky-300/75 font-mono text-[10px] tracking-widest">
                CORE · VALUE MAP
              </text>
              {showCategoryLayer && categories.length > 0 && (
                <text x="315" y="22" textAnchor="middle" className="fill-purple-300/80 font-mono text-[10px] tracking-widest">
                  BUYER CATEGORIES
                </text>
              )}
              <text
                x={graphLayout.bridgeX}
                y="22"
                textAnchor="middle"
                className="fill-sky-300/75 font-mono text-[10px] tracking-widest"
              >
                DATED BRIDGES
              </text>
              {graphLayout.secondHopIds.length > 0 && (
                <text
                  x={graphLayout.hop2X}
                  y="22"
                  textAnchor="middle"
                  className="fill-sky-300/75 font-mono text-[10px] tracking-widest"
                >
                  2ND HOP
                </text>
              )}
              <text
                x={graphLayout.orgX}
                y="22"
                textAnchor="middle"
                className="fill-emerald-300/80 font-mono text-[10px] tracking-widest"
              >
                BUYER ORGS
              </text>

              {/* Category FITS arcs (Core -> Category -> Org) */}
              {showCategoryLayer &&
                categories.map((cat, idx) => {
                  const cPos = graphLayout.coords[cat.id];
                  const fPos = graphLayout.coords[graphLayout.founderNodeId];
                  if (!cPos || !fPos) return null;
                  const color = resolveCatColor(cat.colour, idx);
                  const isHighlighted = !selectedCatId || selectedCatId === cat.id;

                  return (
                    <g key={`cat-links-${cat.id}`} opacity={isHighlighted ? 0.45 : 0.12}>
                      <line
                        x1={fPos.x}
                        y1={fPos.y}
                        x2={cPos.x}
                        y2={cPos.y}
                        stroke={color}
                        strokeWidth={1.2}
                        strokeDasharray="2 5"
                      />
                      {cat.org_ids.map((oid) => {
                        const oPos = graphLayout.coords[oid];
                        if (!oPos) return null;
                        return (
                          <path
                            key={`${cat.id}-${oid}`}
                            d={`M ${cPos.x} ${cPos.y} C ${cPos.x + 220} ${cPos.y}, ${oPos.x - 220} ${oPos.y}, ${oPos.x} ${oPos.y}`}
                            fill="none"
                            stroke={color}
                            strokeWidth={0.9}
                            strokeDasharray="2 6"
                          />
                        );
                      })}
                    </g>
                  );
                })}

              {/* Warm-Path Publication / Affiliation Edges */}
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
                      : "rgba(148, 163, 184, 0.22)";

                return (
                  <g
                    key={edge.id}
                    onClick={() => onInspectEdge(edge.id)}
                    className="cursor-pointer"
                  >
                    <path d={curvePath} fill="none" stroke="transparent" strokeWidth={14} />
                    <path
                      d={curvePath}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isLit ? 2.8 : 1.15}
                      className={isLit ? "db-edge-active" : "transition-opacity hover:opacity-85"}
                    />
                    {isLit && (
                      <g transform={`translate(${midX}, ${midY - 10})`}>
                        <rect
                          x={-98}
                          y={-11}
                          width={196}
                          height={20}
                          rx={2}
                          fill={isWeakest ? "#2b1d05" : "#071430"}
                          stroke={isWeakest ? "#fbbf24" : "#38bdf8"}
                          strokeWidth={1.2}
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

              {/* Founder Core Node */}
              {(() => {
                const fPos = graphLayout.coords[graphLayout.founderNodeId];
                if (!fPos) return null;
                return (
                  <g
                    transform={`translate(${fPos.x}, ${fPos.y})`}
                    onClick={() => onInspectPerson(graphLayout.founderNodeId)}
                    className="cursor-pointer"
                  >
                    <circle r={42} fill="url(#founderHalo)" />
                    <circle r={17} fill="#0b2536" stroke="#38bdf8" strokeWidth={2.5} />
                    <circle r={5.5} fill="#ffffff" />
                    <text y={31} textAnchor="middle" className="fill-white font-sans text-[12px] font-bold">
                      {founder?.name ?? "Nicholas C. Harris"}
                    </text>
                    <text y={45} textAnchor="middle" className="fill-sky-300 font-mono text-[10px]">
                      {founder?.company ?? "Lightmatter"}
                    </text>
                  </g>
                );
              })()}

              {/* Buyer Category Nodes (--cat-1..5) */}
              {showCategoryLayer &&
                categories.map((cat, idx) => {
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
                      <rect
                        x={-72}
                        y={-15}
                        width={144}
                        height={30}
                        rx={3}
                        fill="#071430"
                        stroke={color}
                        strokeWidth={isCatSelected ? 2.4 : 1.4}
                      />
                      <text
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        className="fill-white font-mono text-[9.5px] font-semibold"
                      >
                        {cat.name.slice(0, 21)}
                      </text>
                    </g>
                  );
                })}

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
                    opacity={activePath && !isLit ? 0.52 : 1}
                  >
                    {isLit && (
                      <circle
                        r={17}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={1.2}
                        strokeDasharray="3 3"
                      />
                    )}
                    <circle
                      r={isLit ? 9.5 : 7}
                      fill={isLit ? "#0284c7" : "#0f172a"}
                      stroke={isLit ? "#7dd3fc" : "#64748b"}
                      strokeWidth={isLit ? 2.2 : 1.4}
                    />
                    <text
                      x={14}
                      y={3}
                      className={`font-sans text-[11.5px] ${
                        isLit ? "fill-white font-bold" : "fill-slate-300 font-medium"
                      }`}
                    >
                      {person.name}
                    </text>
                    {person.affiliation_asof && (
                      <text x={14} y={15} className="fill-sky-300/80 font-mono text-[9.5px]">
                        as of {person.affiliation_asof.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Buyer Organization Nodes (tinted with Category border color) */}
              {graphLayout.buyerOrgIds.map((oid) => {
                const pos = graphLayout.coords[oid];
                const org = orgsMap[oid];
                if (!pos || !org) return null;
                const isLit = activeNodeSet.has(oid);
                const catStroke = graphLayout.orgCatColor[oid] ?? "#34d399";
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
                    opacity={activePath && !isLit ? 0.58 : 1}
                  >
                    <rect
                      x={-58}
                      y={-15}
                      width={116}
                      height={30}
                      rx={3}
                      fill={isLit ? "#07291e" : "#0f172a"}
                      stroke={isLit ? "#34d399" : catStroke}
                      strokeWidth={isLit ? 2.2 : 1.3}
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

          {/* SELECTED WARM PATH TELEMETRY DECK (FLAT SOLID ONYX, ZERO BLUR) */}
          {activePath && (
            <div className="mt-3 rounded border border-sky-400/40 bg-[#090a0d] p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge flat className="border-sky-400/55 bg-[#0b2536] font-mono text-[10px] text-sky-100">
                      ACTIVE PATH · SCORE {activePath.score}/100
                    </Badge>
                    <Badge flat className="border-white/25 bg-[#151922] font-mono text-[10px]">
                      {KIND_LABELS[activePath.kind] ?? activePath.kind}
                    </Badge>
                    {activePath.why_now_signal_ids.map((sid) => {
                      const sig = signalsMap[sid];
                      if (!sig) return null;
                      return (
                        <Badge
                          key={sid}
                          flat
                          className="border-amber-400/50 bg-[#2b1d05] font-mono text-[10px] text-amber-200"
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
                      className="underline decoration-sky-400/70 underline-offset-4 hover:text-sky-200"
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
                            className="underline decoration-sky-400/70 underline-offset-4 hover:text-sky-200"
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
                    className="border border-sky-400/50 bg-[#0b2536] font-mono text-xs text-sky-100"
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
                          ? "border-amber-400/60 bg-[#2b1d05]"
                          : "border-white/20 bg-[#0f1117]"
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
                            evidenceMap={evidenceMap}
                            evidenceId={evId}
                            onInspect={onInspectEvidence}
                            compact
                          />
                        ))}
                      </div>

                      <div className="flex items-center justify-between border-t border-white/15 pt-2">
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
                            className="inline-flex items-center gap-1 rounded border border-emerald-400/50 bg-[#07291e] px-2 py-0.5 font-mono text-[10px] text-emerald-200"
                          >
                            <CheckCircle2 className="size-2.5" />
                            OK
                          </button>
                          <button
                            type="button"
                            disabled={checkingEdgeId === edge.id}
                            onClick={() => void handleQuickNameCheck(edge.id, "rejected")}
                            className="inline-flex items-center gap-1 rounded border border-red-400/50 bg-[#2d0a0e] px-2 py-0.5 font-mono text-[10px] text-red-200"
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
        <Card flat border className="border-white/20 bg-[#0f1117] py-4 gap-3">
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
                                  className="rounded border border-white/20 bg-[#151922] px-2 py-0.5 text-[11px] hover:border-sky-400/60"
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
