"use client";

import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type {
  Evidence,
  Founder,
  Icp,
  Id,
  Org,
  Path,
  Person,
  SearchBundle,
  Signal,
} from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

interface ScreenBuyersProps {
  founder: Founder | null;
  icp: Icp | null;
  orgs: Org[];
  signals: Signal[];
  paths: Path[];
  orgsMap: Record<Id, Org>;
  evidenceMap: Record<Id, Evidence>;
  replayNotice: string | null;
  onInspectEvidence: (evidenceId: Id) => void;
  onInspectPerson: (personId: Id) => void;
  onSelectOrgForPaths: (orgId: Id | null) => void;
}

export function ScreenBuyers({
  founder,
  icp,
  orgs,
  signals,
  paths,
  orgsMap,
  evidenceMap,
  replayNotice,
  onInspectEvidence,
  onInspectPerson,
  onSelectOrgForPaths,
}: ScreenBuyersProps) {
  const [expandedOrgId, setExpandedOrgId] = React.useState<Id | null>(null);
  const [showIcpDetail, setShowIcpDetail] = React.useState(false);
  const [showSearch, setShowSearch] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResult, setSearchResult] = React.useState<SearchBundle | null>(null);

  const runSearch = React.useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResult(null);
      return;
    }
    try {
      const res = await api.searchPeople(q.trim());
      setSearchResult(res);
    } catch {
      // ignore transient error
    }
  }, []);

  const signalsByOrg = React.useMemo(() => {
    const map: Record<Id, Signal[]> = {};
    for (const s of signals) {
      if (!map[s.org_id]) map[s.org_id] = [];
      map[s.org_id].push(s);
    }
    return map;
  }, [signals]);

  const pathCountByOrg = React.useMemo(() => {
    const map: Record<Id, number> = {};
    for (const p of paths) {
      map[p.buyer_org_id] = (map[p.buyer_org_id] ?? 0) + 1;
    }
    return map;
  }, [paths]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-2">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-6">
        <div className="space-y-1.5">
          <div className="font-mono text-xs uppercase tracking-widest text-sky-400">
            02 · Commercial Buyers &amp; Signals
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {orgs.length} R&amp;D Buyers Ranked for {founder?.company || founder?.name || "Founder"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            className="inline-flex items-center gap-2 border border-white/20 bg-[#0f1117] px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-sky-400"
          >
            <Search className="size-4 text-sky-300" />
            <span>Search Researchers</span>
          </button>

          <Button
            variant="default"
            flat
            onClick={() => onSelectOrgForPaths(null)}
            className="h-11 px-5 text-sm font-semibold"
          >
            <span>Open All {paths.length} Warm Paths</span>
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

      {replayNotice && (
        <div className="border-l-2 border-amber-400 bg-[#2b1d05]/40 px-4 py-2.5 font-mono text-xs text-amber-200">
          {replayNotice}
        </div>
      )}

      {/* COLLAPSIBLE RESEARCHER SEARCH (GET /search) */}
      <AnimatePresence initial={false}>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border border-white/15 bg-[#0f1117] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => void runSearch(e.target.value)}
                  placeholder="Search researchers ('Hamerly', 'Bandyopadhyay', 'Steinbrecher', 'Chen')…"
                  className="h-11 flex-1 text-base"
                />
                {["Hamerly", "Bandyopadhyay", "Steinbrecher"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => void runSearch(preset)}
                    className="border border-white/15 bg-[#090a0d] px-3 py-2 font-mono text-xs text-muted-foreground hover:border-sky-400 hover:text-white"
                  >
                    {preset}
                  </button>
                ))}
                {searchResult && (
                  <Badge flat className="border-emerald-400/40 bg-[#07291e] font-mono text-xs text-emerald-200">
                    {searchResult.ms.toFixed(1)}ms · {searchResult.engine}
                  </Badge>
                )}
              </div>

              {searchResult && (
                <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                  {searchResult.people.map((person: Person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => onInspectPerson(person.id)}
                      className="flex items-center justify-between border border-white/15 bg-[#090a0d] px-4 py-3 text-left transition-colors hover:border-sky-400"
                    >
                      <div>
                        <div className="text-base font-semibold text-white">{person.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {person.org_id ? orgsMap[person.org_id]?.name ?? person.org_id : "Researcher"}
                          {person.affiliation_asof ? ` · as of ${person.affiliation_asof}` : ""}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-sky-300">Verify ↗</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ULTRA-FLAT LARGE-TYPE BUYER ROWS (CLICK OR HOVER FOR PROGRESSIVE DISCLOSURE) */}
      <div className="divide-y divide-white/15 border-y border-white/15">
        {orgs.map((org) => {
          const orgSignals = signalsByOrg[org.id] ?? [];
          const leadSignal = orgSignals[0] ?? null;
          const warmPathsCount = pathCountByOrg[org.id] ?? 0;
          const score = org.buyer_score ?? 0;
          const isExpanded = expandedOrgId === org.id;

          return (
            <div key={org.id} className="group transition-colors hover:bg-white/[0.02]">
              <div
                onClick={() => setExpandedOrgId(isExpanded ? null : org.id)}
                className="flex cursor-pointer flex-wrap items-center justify-between gap-4 py-5 px-2"
              >
                <div className="flex items-baseline gap-5 min-w-[260px]">
                  <span className="w-12 font-mono text-2xl font-bold text-emerald-300">
                    {score}
                  </span>
                  <div>
                    <div className="text-2xl font-bold text-white">{org.name}</div>
                    {leadSignal ? (
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        <span className="font-mono text-xs uppercase text-amber-300 mr-2">
                          {leadSignal.date ?? "Recent"}
                        </span>
                        {leadSignal.title}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        Matched via dated co-author research graph
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="flex items-center gap-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {leadSignal?.evidence_ids[0] && (
                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                      <EvidenceChip
                        evidenceId={leadSignal.evidence_ids[0]}
                        evidenceMap={evidenceMap}
                        onInspect={onInspectEvidence}
                        compact
                      />
                    </div>
                  )}

                  <Button
                    flat
                    onClick={() => onSelectOrgForPaths(org.id)}
                    className="border border-white/20 bg-[#0f1117] px-4 py-2 text-sm font-medium transition-colors group-hover:border-sky-400 group-hover:bg-[#0b2536] group-hover:text-white"
                  >
                    {warmPathsCount > 0
                      ? `${warmPathsCount} Warm Path${warmPathsCount > 1 ? "s" : ""} →`
                      : "Inspect Graph →"}
                  </Button>

                  {orgSignals.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setExpandedOrgId(isExpanded ? null : org.id)}
                      className="p-2 text-muted-foreground hover:text-white"
                      title="Show all dated signals"
                    >
                      <ChevronDown
                        className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isExpanded && orgSignals.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 border-t border-white/10 bg-[#0f1117]/70 px-6 py-4">
                      {orgSignals.map((sig) => (
                        <div
                          key={sig.id}
                          className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-400/60 pl-4 py-1"
                        >
                          <div>
                            <span className="font-mono text-xs uppercase text-amber-300 mr-2">
                              {sig.type.replace(/_/g, " ")} · {sig.date ?? "Recent"}
                            </span>
                            <span className="text-base text-white">{sig.title}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {sig.evidence_ids.map((eid) => (
                              <EvidenceChip
                                key={eid}
                                evidenceId={eid}
                                evidenceMap={evidenceMap}
                                onInspect={onInspectEvidence}
                                compact
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* COLLAPSIBLE FULL ICP RATIONALE (CLEAN & TUCKED AWAY UNTIL CLICKED) */}
      {icp && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowIcpDetail((v) => !v)}
            className="flex w-full items-center justify-between border border-white/15 bg-[#0f1117] px-5 py-4 text-left transition-colors hover:border-white/35"
          >
            <div>
              <div className="text-lg font-bold text-white">
                Ideal Customer Profile Breakdown ({icp.buyer_roles.length} Roles ·{" "}
                {icp.industries.length} Verticals)
              </div>
              <div className="text-sm text-muted-foreground">
                Expand to inspect cited buyer roles, verticals, bottlenecks, and expansion segments
              </div>
            </div>
            <ChevronDown
              className={`size-5 text-sky-300 transition-transform ${showIcpDetail ? "rotate-180" : ""}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {showIcpDetail && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-8 border-x border-b border-white/15 bg-[#0f1117]/50 p-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div className="font-mono text-xs uppercase tracking-wider text-sky-300">
                      Target Buyer Personas
                    </div>
                    {icp.buyer_roles.map((role, i) => (
                      <div key={i} className="group space-y-1.5 border-l-2 border-sky-400/50 pl-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold text-white">{role.title}</span>
                          {role.evidence_ids[0] && (
                            <span className="opacity-0 transition-opacity group-hover:opacity-100">
                              <EvidenceChip
                                evidenceId={role.evidence_ids[0]}
                                evidenceMap={evidenceMap}
                                onInspect={onInspectEvidence}
                                compact
                              />
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{role.why}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="font-mono text-xs uppercase tracking-wider text-emerald-300">
                      Commercial Verticals
                    </div>
                    {icp.industries.map((ind, i) => (
                      <div key={i} className="group space-y-1.5 border-l-2 border-emerald-400/50 pl-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold text-white">{ind.name}</span>
                          {ind.evidence_ids[0] && (
                            <span className="opacity-0 transition-opacity group-hover:opacity-100">
                              <EvidenceChip
                                evidenceId={ind.evidence_ids[0]}
                                evidenceMap={evidenceMap}
                                onInspect={onInspectEvidence}
                                compact
                              />
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{ind.why}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
