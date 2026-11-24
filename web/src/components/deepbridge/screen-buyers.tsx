"use client";

import {
  ArrowRight,
  Compass,
  Layers,
  Radar,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Evidence, Founder, Icp, Id, Org, Path, Person, SearchBundle, Signal } from "@/lib/types";
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
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResult, setSearchResult] = React.useState<SearchBundle | null>(null);
  const [searching, setSearching] = React.useState(false);

  const runSearch = React.useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResult(null);
      return;
    }
    setSearching(true);
    try {
      const res = await api.searchPeople(q.trim());
      setSearchResult(res);
    } catch {
      // ignore transient error
    } finally {
      setSearching(false);
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
    <div className="space-y-6">
      {replayNotice && (
        <div className="rounded border border-amber-400/40 bg-amber-500/10 px-4 py-3 font-mono text-xs text-amber-100">
          {replayNotice}
        </div>
      )}

      {/* RANKED COMMERCIAL BUYER ORGS + DATED WHY-NOW SIGNALS */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              
              <span>Buyers ({orgs.length})</span>
            </h2>

          </div>
          <Button variant="default" flat onClick={() => onSelectOrgForPaths(null)}>
            <span>See {paths.length} warm paths</span>
            <ArrowRight className="size-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {orgs.map((org) => {
            const orgSignals = signalsByOrg[org.id] ?? [];
            const warmPathsCount = pathCountByOrg[org.id] ?? 0;
            const score = org.buyer_score ?? 0;

            return (
              <Card
                key={org.id}
                flat
                border
                className="border-white/10 bg-white/[0.02] py-4 gap-3 justify-between"
              >
                <CardHeader className="px-4 pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <CardTitle className="text-base font-semibold">{org.name}</CardTitle>
                    <span className="font-mono text-xs text-muted-foreground" title="buyer fit 0–100">{score}</span>
                  </div>
                </CardHeader>

                <CardContent className="px-4 space-y-3">
                  {orgSignals.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-[11px] text-amber-300">
                        <Zap className="size-3" />
                        <span>Why now</span>
                      </div>
                      {orgSignals.slice(0, 1).map((sig) => (
                        <div
                          key={sig.id}
                          className="space-y-1.5"
                        >
                          <div className="text-[10px] text-muted-foreground">
                            {sig.type.replace(/_/g, " ")} · {sig.date ?? "recent"}
                          </div>
                          <div className="text-xs leading-snug text-foreground">{sig.title}</div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
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
                      {orgSignals.length > 1 && (
                        <div className="text-[11px] text-muted-foreground">+{orgSignals.length - 1} more signals</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      Matched via co-author affiliation graph (no separate 90d signal cached).
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    flat
                    onClick={() => onSelectOrgForPaths(org.id)}
                    className="w-full text-xs text-muted-foreground"
                  >
                    <span>
                      {warmPathsCount > 0
                        ? `Inspect ${warmPathsCount} Warm Path${warmPathsCount > 1 ? "s" : ""} →`
                        : "Open Warm-Path Graph →"}
                    </span>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* STRUCTURED 4-PART ICP WITH EVIDENCE CHIPS */}
      {icp && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                
                <span>Ideal customer profile</span>
              </h2>

            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Buyer Roles */}
            <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
              <CardHeader className="px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Compass className="size-4" />
                  <span>Buyer roles</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 space-y-3">
                {icp.buyer_roles.map((role, i) => (
                  <div key={`${role.title}-${i}`} className="space-y-1.5">
                    <div className="text-sm font-semibold">{role.title}</div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{role.why}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {role.evidence_ids.map((eid) => (
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
              </CardContent>
            </Card>

            {/* Industries */}
            <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
              <CardHeader className="px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Layers className="size-4" />
                  <span>Industries</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 space-y-3">
                {icp.industries.map((ind, i) => (
                  <div key={`${ind.name}-${i}`} className="space-y-1.5">
                    <div className="text-sm font-semibold">{ind.name}</div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{ind.why}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ind.evidence_ids.map((eid) => (
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
              </CardContent>
            </Card>

            {/* Technical Needs */}
            <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
              <CardHeader className="px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Radar className="size-4" />
                  <span>Needs</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 space-y-3">
                {icp.needs.map((need, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-xs leading-relaxed text-foreground">{need.text}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {need.evidence_ids.map((eid) => (
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
              </CardContent>
            </Card>

            {/* Expansion Segments */}
            <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
              <CardHeader className="px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Sparkles className="size-4" />
                  <span>Expansion segments</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 space-y-3">
                {icp.expansion_segments.map((seg, i) => (
                  <div key={`${seg.name}-${i}`} className="space-y-1.5">
                    <div className="text-sm font-semibold">{seg.name}</div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{seg.why}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seg.evidence_ids.map((eid) => (
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
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      {/* TOP BAR: INSTANT RESEARCHER / BRIDGE SEARCH (GET /search) */}
      <Card flat border className="border-white/10 bg-transparent py-4 gap-3">
        <CardContent className="px-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-sky-300">
              <Search className="size-3.5" />
              <span>Instant Researcher & Bridge Search (GET /search)</span>
            </div>
            {searchResult && (
              <div className="flex items-center gap-2 font-mono text-xs">
                <Badge flat className="border-emerald-400/40 bg-emerald-500/15 text-emerald-200 font-mono">
                  {searchResult.ms.toFixed(2)} ms
                </Badge>
                <Badge flat className="border-sky-400/40 bg-sky-500/15 text-sky-200 font-mono uppercase">
                  engine: {searchResult.engine}
                </Badge>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Input
                value={searchQuery}
                onChange={(e) => void runSearch(e.target.value)}
                placeholder="Search bridge researchers (try 'Hamerly', 'Bandyopadhyay', 'Steinbrecher', 'Chen', 'Englund')..."
                className="font-mono text-xs"
              />
            </div>
            {["Hamerly", "Bandyopadhyay", "Steinbrecher", "Follet"].map((preset) => (
              <Button
                key={preset}
                size="sm"
                flat
                onClick={() => void runSearch(preset)}
                className="border border-white/15 font-mono text-xs"
              >
                {preset}
              </Button>
            ))}
          </div>

          {searching && (
            <div className="font-mono text-xs text-muted-foreground">Querying index...</div>
          )}

          {searchResult && (
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-3">
              {searchResult.people.length === 0 ? (
                <div className="col-span-full font-mono text-xs text-muted-foreground">
                  0 researchers matched &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                searchResult.people.map((person: Person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => onInspectPerson(person.id)}
                    className="flex items-center justify-between rounded border border-white/15 bg-black/40 px-3 py-2 text-left transition hover:border-sky-400/50"
                  >
                    <div>
                      <div className="text-xs font-semibold text-foreground">{person.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {person.org_id ? orgsMap[person.org_id]?.name ?? person.org_id : "Researcher"}
                        {person.affiliation_asof ? ` · as of ${person.affiliation_asof}` : ""}
                      </div>
                    </div>
                    <Badge flat className="font-mono text-[10px]">
                      Inspect ↗
                    </Badge>
                  </button>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
