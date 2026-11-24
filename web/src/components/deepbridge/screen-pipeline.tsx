"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  History,
  Kanban,
  User,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card as UiCard, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { Card, Id, Metrics, Org, Path, Person, Stage } from "@/lib/types";

const STAGES: Stage[] = [
  "found",
  "path_checked",
  "draft",
  "approved",
  "intro_asked",
  "intro_made",
  "pilot",
];

const STAGE_LABELS: Record<Stage, string> = {
  found: "1 · Found",
  path_checked: "2 · Path Checked",
  draft: "3 · Drafted",
  approved: "4 · Approved",
  intro_asked: "5 · Intro Asked",
  intro_made: "6 · Intro Made",
  pilot: "7 · Pilot",
};

interface ScreenPipelineProps {
  cards: Card[];
  metrics: Metrics | null;
  pathsMap: Record<Id, Path>;
  peopleMap: Record<Id, Person>;
  orgsMap: Record<Id, Org>;
  onCardUpdated: () => Promise<void>;
  onOpenPathInDrafts: (pathId: Id) => void;
}

export function ScreenPipeline({
  cards,
  metrics,
  pathsMap,
  peopleMap,
  orgsMap,
  onCardUpdated,
  onOpenPathInDrafts,
}: ScreenPipelineProps) {
  const [advancingId, setAdvancingId] = React.useState<Id | null>(null);
  const [expandedCardId, setExpandedCardId] = React.useState<Id | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const cardsByStage = React.useMemo(() => {
    const grouped: Record<Stage, Card[]> = {
      found: [],
      path_checked: [],
      draft: [],
      approved: [],
      intro_asked: [],
      intro_made: [],
      pilot: [],
    };
    for (const c of cards) {
      grouped[c.stage]?.push(c);
    }
    return grouped;
  }, [cards]);

  const handleAdvance = async (card: Card) => {
    const idx = STAGES.indexOf(card.stage);
    if (idx < 0 || idx >= STAGES.length - 1) return;
    const nextStage = STAGES[idx + 1];
    setAdvancingId(card.id);
    setError(null);
    try {
      await api.advanceCard(card.id, nextStage, "Mark (Human Review)");
      await onCardUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance card");
    } finally {
      setAdvancingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* HONEST SIMULATION LABEL */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-400/35 bg-amber-500/10 px-4 py-2.5 font-mono text-xs text-amber-100">
        <div className="flex items-center gap-2">
          <History className="size-4 text-amber-300" />
          <span>
            <strong>SIMULATED DEMO PIPELINE HISTORY:</strong> Initial stage history is seeded fixture replay; approvals and stage advances performed in this session append live human/agent events. No real external outreach occurred.
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 font-mono text-xs text-red-200">
          {error}
        </div>
      )}

      {/* 7-STAGE KANBAN BOARD */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Kanban className="size-5 text-sky-300" />
            <span>7-Stage Warm-Intro Pipeline ({cards.length} Tracked Paths)</span>
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            Click any card&apos;s audit log to inspect agent vs. human actions
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {STAGES.map((stage) => {
            const stageCards = cardsByStage[stage];
            const nextStage = STAGES[STAGES.indexOf(stage) + 1] ?? null;

            return (
              <div
                key={stage}
                className="flex flex-col rounded border border-white/15 bg-white/[0.02] p-2.5 min-h-[320px]"
              >
                <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
                    {STAGE_LABELS[stage]}
                  </span>
                  <Badge flat className="font-mono text-[10px]">
                    {stageCards.length}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col gap-2.5">
                  {stageCards.map((card) => {
                    const path = pathsMap[card.path_id];
                    const org = path ? orgsMap[path.buyer_org_id] : null;
                    const bridge = path ? peopleMap[path.bridge_id] : null;
                    const lastEvent = card.history[card.history.length - 1];
                    const isExpanded = expandedCardId === card.id;

                    return (
                      <div
                        key={card.id}
                        className="rounded border border-white/15 bg-black/50 p-2.5 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div>
                            <div className="text-xs font-bold text-foreground">
                              {org?.name ?? card.path_id}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              via {bridge?.name ?? path?.bridge_id ?? "bridge"}
                            </div>
                          </div>
                          {path && (
                            <span className="font-mono text-[10px] font-bold text-emerald-300">
                              {path.score}
                            </span>
                          )}
                        </div>

                        {path && (
                          <Badge flat className="font-mono text-[9px] uppercase border-white/15">
                            {path.kind.replace("_", " ")}
                          </Badge>
                        )}

                        {lastEvent && (
                          <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                            {lastEvent.actor_kind === "human" ? (
                              <User className="size-3 text-emerald-300 shrink-0" />
                            ) : (
                              <Bot className="size-3 text-sky-300 shrink-0" />
                            )}
                            <span className="truncate">{lastEvent.actor}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/10">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCardId(isExpanded ? null : card.id)
                            }
                            className="font-mono text-[10px] text-sky-300 hover:underline"
                          >
                            {isExpanded ? "Hide Log" : `Log (${card.history.length})`}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenPathInDrafts(card.path_id)}
                            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Drafts ↗
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="space-y-1 rounded border border-white/10 bg-white/[0.03] p-2 font-mono text-[10px]">
                            {card.history.map((h, i) => (
                              <div key={i} className="flex items-center justify-between gap-1">
                                <span
                                  className={
                                    h.actor_kind === "human"
                                      ? "text-emerald-300"
                                      : "text-sky-300"
                                  }
                                >
                                  [{h.actor_kind[0].toUpperCase()}] {h.stage}
                                </span>
                                <span className="text-white/50 truncate max-w-[75px]">
                                  {h.actor}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {nextStage && (
                          <Button
                            size="xs"
                            flat
                            disabled={advancingId === card.id}
                            onClick={() => void handleAdvance(card)}
                            className="w-full border border-white/20 font-mono text-[10px]"
                          >
                            <span>Advance</span>
                            <ArrowRight className="size-2.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ANALYTICS & CONVERSION TELEMETRY (GET /metrics) */}
      {metrics && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 pt-2">
          {/* Stage Conversion */}
          <UiCard flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
            <CardHeader className="px-5">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-sky-300 flex items-center gap-2">
                <BarChart3 className="size-4" />
                <span>Stage-to-Stage Conversion</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 space-y-2.5">
              {metrics.conversion.map((c) => {
                const pct = Math.round(c.rate * 100);
                return (
                  <div key={`${c.from}-${c.to}`} className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-muted-foreground">
                        {c.from} → <span className="text-foreground">{c.to}</span>
                      </span>
                      <span className="font-bold text-sky-200">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </UiCard>

          {/* Warm Path Kind Performance */}
          <UiCard flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
            <CardHeader className="px-5">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                <Activity className="size-4" />
                <span>Performance by Warm-Path Kind</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 space-y-2.5">
              {metrics.by_path_kind.map((row) => (
                <div
                  key={row.kind}
                  className="flex items-center justify-between rounded border border-white/10 bg-black/35 px-3 py-2 font-mono text-xs"
                >
                  <span className="uppercase text-foreground">{row.kind.replace("_", " ")}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">total: {row.count}</span>
                    <Badge flat className="border-emerald-400/40 bg-emerald-500/15 text-emerald-200 font-mono text-[10px]">
                      approved+: {row.approved}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </UiCard>

          {/* Human vs Agent Audit Ledger */}
          <UiCard flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
            <CardHeader className="px-5">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-amber-300 flex items-center gap-2">
                <User className="size-4" />
                <span>Agent vs. Human Governance Ledger</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 space-y-2">
              {metrics.by_actor.map((actorRow) => (
                <div
                  key={`${actorRow.actor}-${actorRow.actor_kind}`}
                  className="flex items-center justify-between rounded border border-white/10 bg-black/35 px-3 py-2 font-mono text-xs"
                >
                  <div className="flex items-center gap-2">
                    {actorRow.actor_kind === "human" ? (
                      <User className="size-3.5 text-emerald-300" />
                    ) : (
                      <Bot className="size-3.5 text-sky-300" />
                    )}
                    <span className="text-foreground">{actorRow.actor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      flat
                      className={`font-mono text-[10px] uppercase ${
                        actorRow.actor_kind === "human"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                          : "border-sky-400/40 bg-sky-500/15 text-sky-200"
                      }`}
                    >
                      {actorRow.actor_kind}
                    </Badge>
                    <span className="font-bold">{actorRow.actions}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </UiCard>
        </div>
      )}
    </div>
  );
}
