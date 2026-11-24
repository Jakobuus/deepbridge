"use client";

import { ArrowRight, Bot, User } from "lucide-react";
import * as React from "react";
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
  found: "Found",
  path_checked: "Path checked",
  draft: "Drafted",
  approved: "Approved",
  intro_asked: "Intro asked",
  intro_made: "Intro made",
  pilot: "Pilot",
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

  const costPerLead = metrics?.cost_per_lead_credits ?? metrics?.cost_per_lead ?? null;

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md border border-red-400/40 px-4 py-2 text-xs text-red-200">{error}</div>}

      {/* Numbers first: conversion, cost per lead, who did what */}
      {metrics && (
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {metrics.conversion.map((c) => (
            <div key={`${c.from}-${c.to}`}>
              <div className="text-2xl font-semibold tabular-nums">{Math.round(c.rate * 100)}%</div>
              <div className="text-[11px] text-muted-foreground">
                {STAGE_LABELS[c.from] ?? c.from} → {STAGE_LABELS[c.to] ?? c.to}
              </div>
            </div>
          ))}
          {costPerLead != null && (
            <div>
              <div className="text-2xl font-semibold tabular-nums">{costPerLead}</div>
              <div className="text-[11px] text-muted-foreground">cost per lead (credits)</div>
            </div>
          )}
          <div>
            <div className="flex items-center gap-3 text-2xl font-semibold tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Bot className="size-4 text-sky-300" />
                {metrics.by_actor.filter((a) => a.actor_kind === "agent").reduce((n, a) => n + a.actions, 0)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <User className="size-4 text-emerald-300" />
                {metrics.by_actor.filter((a) => a.actor_kind === "human").reduce((n, a) => n + a.actions, 0)}
              </span>
            </div>
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer list-none">agent / human actions</summary>
              <div className="mt-1 space-y-0.5">
                {metrics.by_actor.map((a) => (
                  <div key={`${a.actor}-${a.actor_kind}`} className="flex justify-between gap-4">
                    <span>{a.actor}</span>
                    <span>{a.actions}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}

      {/* 7-stage pipeline */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((stage) => {
          const stageCards = cardsByStage[stage];
          const nextStage = STAGES[STAGES.indexOf(stage) + 1] ?? null;
          return (
            <div key={stage} className="flex min-h-[280px] flex-col">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="text-foreground">{STAGE_LABELS[stage]}</span>
                <span className="tabular-nums text-muted-foreground">{stageCards.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {stageCards.map((card) => {
                  const path = pathsMap[card.path_id];
                  const org = path ? orgsMap[path.buyer_org_id] : null;
                  const bridge = path ? peopleMap[path.bridge_id] : null;
                  const lastEvent = card.history[card.history.length - 1];
                  const isExpanded = expandedCardId === card.id;
                  return (
                    <div key={card.id} className="group rounded-md bg-white/[0.04] p-2.5 space-y-1.5">
                      <div className="text-xs font-medium text-foreground">{org?.name ?? card.path_id}</div>
                      <div className="text-[11px] text-muted-foreground">via {bridge?.name ?? path?.bridge_id ?? "bridge"}</div>
                      {lastEvent && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {lastEvent.actor_kind === "human" ? (
                            <User className="size-3 shrink-0 text-emerald-300" />
                          ) : (
                            <Bot className="size-3 shrink-0 text-sky-300" />
                          )}
                          <span className="truncate">{lastEvent.actor}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground opacity-0 transition group-hover:opacity-100">
                        <button type="button" onClick={() => setExpandedCardId(isExpanded ? null : card.id)} className="hover:text-foreground">
                          {isExpanded ? "Hide log" : `Log (${card.history.length})`}
                        </button>
                        <button type="button" onClick={() => onOpenPathInDrafts(card.path_id)} className="hover:text-foreground">
                          Draft
                        </button>
                        {nextStage && (
                          <button
                            type="button"
                            disabled={advancingId === card.id}
                            onClick={() => void handleAdvance(card)}
                            className="ml-auto inline-flex items-center gap-0.5 hover:text-foreground"
                          >
                            Advance <ArrowRight className="size-3" />
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="space-y-0.5 pt-1 text-[10px]">
                          {card.history.map((h, i) => (
                            <div key={i} className="flex items-center justify-between gap-1">
                              <span className={h.actor_kind === "human" ? "text-emerald-300" : "text-sky-300"}>{h.stage}</span>
                              <span className="max-w-[75px] truncate text-white/50">{h.actor}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Earlier stage history is seeded demo data; actions in this session are live. No real outreach was sent.
      </p>
    </div>
  );
}
