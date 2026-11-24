"use client";

import { ArrowRight, Bot, ChevronDown, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  path_checked: "Verified",
  draft: "Drafted",
  approved: "Approved",
  intro_asked: "Intro Asked",
  intro_made: "Intro Made",
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
  const [dragCardId, setDragCardId] = React.useState<Id | null>(null);
  const [dragOverStage, setDragOverStage] = React.useState<Stage | null>(null);
  const [showAnalytics, setShowAnalytics] = React.useState(false);
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

  const moveCardToStage = async (cardId: Id, targetStage: Stage) => {
    setAdvancingId(cardId);
    setError(null);
    try {
      await api.advanceCard(cardId, targetStage, "Human Reviewer");
      await onCardUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move card");
    } finally {
      setAdvancingId(null);
    }
  };

  return (
    <div className="space-y-8 py-2">
      {/* HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-6">
        <div className="space-y-1.5">
          <div className="font-mono text-xs uppercase tracking-widest text-sky-400">
            05 · Warm-Intro Pipeline
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {cards.length} Tracked Warm Paths · Agent &amp; Human Attribution
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="border border-amber-400/35 bg-[#2b1d05]/60 px-3 py-1.5 font-mono text-xs text-amber-200">
            Seeded replay + live session actions
          </span>
          {metrics && (
            <button
              type="button"
              onClick={() => setShowAnalytics((v) => !v)}
              className="inline-flex items-center gap-2 border border-white/20 bg-[#0f1117] px-4 py-2 text-sm font-medium text-foreground hover:border-sky-400"
            >
              <span>Conversion Telemetry</span>
              <ChevronDown
                className={`size-4 transition-transform ${showAnalytics ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-l-2 border-red-400 bg-[#2d0a0e] px-4 py-2.5 font-mono text-xs text-red-200">
          {error}
        </div>
      )}

      {/* FLAT 7-COLUMN DRAG-AND-DROP KANBAN BOARD */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((stage, stageIdx) => {
          const stageCards = cardsByStage[stage];
          const nextStage = STAGES[stageIdx + 1] ?? null;
          const isDropTarget = dragOverStage === stage;

          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                if (dragCardId) {
                  void moveCardToStage(dragCardId, stage);
                  setDragCardId(null);
                }
              }}
              className={`flex min-h-[380px] flex-col border-t-2 pt-3 transition-colors ${
                isDropTarget ? "border-sky-400 bg-[#0b2536]/30" : "border-white/20"
              }`}
            >
              <div className="mb-4 flex items-baseline justify-between px-1">
                <span className="text-base font-bold text-white">{STAGE_LABELS[stage]}</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {stageCards.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-3">
                {stageCards.map((card) => {
                  const path = pathsMap[card.path_id];
                  const org = path ? orgsMap[path.buyer_org_id] : null;
                  const bridge = path ? peopleMap[path.bridge_id] : null;
                  const lastEvent = card.history[card.history.length - 1];
                  const isExpanded = expandedCardId === card.id;

                  return (
                    <motion.div
                      layout
                      key={card.id}
                      draggable
                      onDragStart={() => setDragCardId(card.id)}
                      onDragEnd={() => {
                        setDragCardId(null);
                        setDragOverStage(null);
                      }}
                      onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                      className="group cursor-pointer border border-white/15 bg-[#0f1117] p-3.5 space-y-2.5 transition-colors hover:border-sky-400/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-base font-bold leading-snug text-white">
                          {org?.name ?? card.path_id}
                        </div>
                        {path && (
                          <span className="font-mono text-xs font-bold text-emerald-300">
                            {path.score}
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-muted-foreground">
                        via {bridge?.name ?? path?.bridge_id ?? "Bridge"}
                      </div>

                      {lastEvent && (
                        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {lastEvent.actor_kind === "human" ? (
                            <User className="size-3.5 text-emerald-300 shrink-0" />
                          ) : (
                            <Bot className="size-3.5 text-sky-300 shrink-0" />
                          )}
                          <span className="truncate">{lastEvent.actor}</span>
                        </div>
                      )}

                      {/* HOVER-REVEAL QUICK ACTIONS */}
                      <div
                        className="flex items-center justify-between gap-2 pt-1 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenPathInDrafts(card.path_id)}
                          className="font-mono text-xs text-sky-300 hover:underline"
                        >
                          Draft ↗
                        </button>
                        {nextStage && (
                          <Button
                            size="xs"
                            flat
                            disabled={advancingId === card.id}
                            onClick={() => void moveCardToStage(card.id, nextStage)}
                            className="border border-white/25 font-mono text-xs"
                          >
                            Advance <ArrowRight className="size-3" />
                          </Button>
                        )}
                      </div>

                      {/* CLICK-TO-EXPAND AUDIT HISTORY */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-t border-white/10 pt-2.5 space-y-1 font-mono text-xs"
                          >
                            {card.history.map((h, i) => (
                              <div key={i} className="flex items-center justify-between gap-2">
                                <span
                                  className={
                                    h.actor_kind === "human" ? "text-emerald-300" : "text-sky-300"
                                  }
                                >
                                  {STAGE_LABELS[h.stage] ?? h.stage}
                                </span>
                                <span className="truncate text-muted-foreground">{h.actor}</span>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* EXPANDABLE CONVERSION & ACTOR TELEMETRY */}
      <AnimatePresence initial={false}>
        {showAnalytics && metrics && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-8 border-t border-white/15 pt-6 lg:grid-cols-3">
              <div className="space-y-3">
                <div className="font-mono text-xs uppercase tracking-wider text-sky-300">
                  Stage Conversion
                </div>
                {metrics.conversion.map((c) => {
                  const pct = Math.round(c.rate * 100);
                  return (
                    <div key={`${c.from}-${c.to}`} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {STAGE_LABELS[c.from] ?? c.from} → {STAGE_LABELS[c.to] ?? c.to}
                        </span>
                        <span className="font-mono font-bold text-white">{pct}%</span>
                      </div>
                      <div className="h-1 w-full bg-white/10">
                        <div className="h-full bg-sky-400" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                <div className="font-mono text-xs uppercase tracking-wider text-emerald-300">
                  By Warm-Path Type
                </div>
                {metrics.by_path_kind.map((row) => (
                  <div
                    key={row.kind}
                    className="flex items-center justify-between border-b border-white/10 pb-2 text-sm"
                  >
                    <span className="capitalize text-white">{row.kind.replace(/_/g, " ")}</span>
                    <span className="font-mono text-muted-foreground">
                      {row.approved} approved / {row.count}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <div className="font-mono text-xs uppercase tracking-wider text-amber-300">
                  Agent vs Human Actions
                </div>
                {metrics.by_actor.map((a) => (
                  <div
                    key={`${a.actor}-${a.actor_kind}`}
                    className="flex items-center justify-between border-b border-white/10 pb-2 text-sm"
                  >
                    <span className="text-white">{a.actor}</span>
                    <Badge
                      flat
                      className={`font-mono text-xs uppercase ${
                        a.actor_kind === "human"
                          ? "border-emerald-400/40 bg-[#07291e] text-emerald-200"
                          : "border-sky-400/40 bg-[#0b2536] text-sky-200"
                      }`}
                    >
                      {a.actor_kind} · {a.actions}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
