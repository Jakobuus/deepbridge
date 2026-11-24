"use client";

import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Coins,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import type { Credits, Draft, Edge, Evidence, Id, Org, Path, Person } from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

interface ScreenDraftsProps {
  paths: Path[];
  selectedPathId: Id | null;
  peopleMap: Record<Id, Person>;
  orgsMap: Record<Id, Org>;
  edgesMap: Record<Id, Edge>;
  evidenceMap: Record<Id, Evidence>;
  credits: Credits | null;
  draftsByPath: Record<Id, Draft[]>;
  onSelectPath: (pathId: Id) => void;
  onDraftsLoaded: (pathId: Id, drafts: Draft[]) => void;
  onDraftUpdated: (draft: Draft) => void;
  onRefreshCreditsAndPipeline: () => Promise<void>;
  onInspectEvidence: (evidenceId: Id) => void;
  onInspectPerson: (personId: Id) => void;
  onGoToPipeline: () => void;
}

const DRAFT_KIND_TITLES: Record<Draft["kind"], string> = {
  intro_request: "Ask Bridge For Intro",
  forwardable_note: "Forwardable 2-Line Note",
  direct_fallback: "Direct Fallback",
};

export function ScreenDrafts({
  paths,
  selectedPathId,
  peopleMap,
  orgsMap,
  edgesMap,
  evidenceMap,
  credits,
  draftsByPath,
  onSelectPath,
  onDraftsLoaded,
  onDraftUpdated,
  onRefreshCreditsAndPipeline,
  onInspectEvidence,
  onInspectPerson,
  onGoToPipeline,
}: ScreenDraftsProps) {
  const sortedPaths = React.useMemo(() => [...paths].sort((a, b) => b.score - a.score), [paths]);
  const activePath =
    sortedPaths.find((p) => p.id === selectedPathId) ?? sortedPaths[0] ?? null;

  const currentDrafts = activePath ? draftsByPath[activePath.id] ?? [] : [];

  const [generating, setGenerating] = React.useState(false);
  const [creditBlocked402, setCreditBlocked402] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>("intro_request");
  const [savingId, setSavingId] = React.useState<Id | null>(null);
  const [approvingId, setApprovingId] = React.useState<Id | null>(null);
  const [showCreditLedger, setShowCreditLedger] = React.useState(false);
  const [showCitations, setShowCitations] = React.useState(false);

  const [edits, setEdits] = React.useState<Record<Id, { subject: string; body: string }>>({});

  React.useEffect(() => {
    if (currentDrafts.length > 0 && !currentDrafts.some((d) => d.kind === activeTab)) {
      setActiveTab(currentDrafts[0].kind);
    }
  }, [currentDrafts, activeTab]);

  React.useEffect(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const d of currentDrafts) {
        if (!next[d.id]) {
          next[d.id] = { subject: d.subject, body: d.body };
        }
      }
      return next;
    });
  }, [currentDrafts]);

  const handleGenerateDrafts = async (pathId: Id) => {
    setGenerating(true);
    setActionError(null);
    setCreditBlocked402(null);
    try {
      const generated = await api.generateDrafts(pathId);
      onDraftsLoaded(pathId, generated);
      setEdits((prev) => {
        const next = { ...prev };
        for (const d of generated) {
          next[d.id] = { subject: d.subject, body: d.body };
        }
        return next;
      });
      if (generated[0]) setActiveTab(generated[0].kind);
      await onRefreshCreditsAndPipeline();
    } catch (err) {
      await onRefreshCreditsAndPipeline();
      if (err instanceof ApiError && err.status === 402) {
        setCreditBlocked402(
          `HTTP 402 Out of Credits: "${err.detail}". Balance is 0 — draft generation halted.`,
        );
      } else {
        setActionError(err instanceof Error ? err.message : "Failed to generate drafts");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdit = async (draft: Draft) => {
    const buffer = edits[draft.id];
    if (!buffer) return;
    setSavingId(draft.id);
    setActionError(null);
    try {
      const updated = await api.editDraft(draft.id, buffer.subject, buffer.body);
      onDraftUpdated(updated);
      setEdits((prev) => ({
        ...prev,
        [updated.id]: { subject: updated.subject, body: updated.body },
      }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save draft edits");
    } finally {
      setSavingId(null);
    }
  };

  const handleApproveDecision = async (draft: Draft, decision: "approve" | "reject") => {
    setApprovingId(draft.id);
    setActionError(null);
    try {
      let targetDraft = draft;
      const buffer = edits[draft.id];
      if (buffer && (buffer.subject !== draft.subject || buffer.body !== draft.body)) {
        targetDraft = await api.editDraft(draft.id, buffer.subject, buffer.body);
        onDraftUpdated(targetDraft);
      }
      const approved = await api.approveDraft(targetDraft.id, targetDraft.content_hash, decision);
      onDraftUpdated(approved);
      await onRefreshCreditsAndPipeline();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setActionError(`HTTP 409 Hash Conflict: ${err.detail}. Save edits first.`);
      } else {
        setActionError(err instanceof Error ? err.message : "Approval failed");
      }
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-2">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-6">
        <div className="space-y-1.5">
          <div className="font-mono text-xs uppercase tracking-widest text-sky-400">
            04 · Cited Intro &amp; Human Approval
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Approve exact text. Nothing is sent automatically.
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCreditLedger((v) => !v)}
            className="inline-flex items-center gap-2 border border-amber-400/40 bg-[#2b1d05] px-4 py-2.5 font-mono text-sm text-amber-100 transition-colors hover:border-amber-300"
          >
            <Coins className="size-4 text-amber-300" />
            <span>{credits?.balance ?? "—"} credits</span>
            <ChevronDown
              className={`size-3.5 transition-transform ${showCreditLedger ? "rotate-180" : ""}`}
            />
          </button>

          <Button
            flat
            onClick={onGoToPipeline}
            className="h-11 border border-white/25 bg-[#0f1117] px-5 text-sm font-medium hover:border-white/50"
          >
            Pipeline <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* EXPANDABLE FLEXPRICE / CREDIT METER LEDGER */}
      <AnimatePresence initial={false}>
        {showCreditLedger && credits && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border border-white/15 bg-[#0f1117] p-5">
              <div className="flex items-center justify-between font-mono text-xs uppercase text-amber-300">
                <span>Metered Credit Ledger ({credits.source})</span>
                <span>1 credit per warm-path draft · HTTP 402 at 0</span>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...credits.events].reverse().slice(0, 6).map((ev, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between border px-3 py-2 font-mono text-xs ${
                      ev.blocked
                        ? "border-red-400/50 bg-[#2d0a0e] text-red-200"
                        : "border-white/10 bg-[#090a0d] text-muted-foreground"
                    }`}
                  >
                    <span className="truncate">{ev.action}</span>
                    <span className="font-bold">
                      {ev.blocked ? "402 BLOCKED" : ev.delta > 0 ? `+${ev.delta}` : ev.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HTTP 402 OUT OF CREDITS BANNER */}
      {(creditBlocked402 || (credits && credits.balance <= 0)) && (
        <div className="flex items-center gap-3 border-2 border-red-500/70 bg-[#2d0a0e] p-4 font-mono text-sm text-red-100">
          <AlertOctagon className="size-5 shrink-0 text-red-400" />
          <span>
            {creditBlocked402 ??
              "Credit balance is 0 — new POST /drafts calls are blocked with HTTP 402."}
          </span>
        </div>
      )}

      {actionError && (
        <div className="border-l-2 border-amber-400 bg-[#2b1d05]/50 px-4 py-3 font-mono text-xs text-amber-100">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        {/* LEFT: FLAT WARM PATH LIST */}
        <div className="xl:col-span-4 space-y-3">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Warm Paths ({sortedPaths.length})
          </div>
          <div className="divide-y divide-white/10 border-y border-white/15">
            {sortedPaths.map((p) => {
              const selected = activePath?.id === p.id;
              const hasDrafts = Boolean(draftsByPath[p.id]?.length);
              const org = orgsMap[p.buyer_org_id];
              const bridge = peopleMap[p.bridge_id];

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectPath(p.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-4 text-left transition-colors ${
                    selected
                      ? "bg-[#0b2536] text-white"
                      : "text-foreground hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-lg font-bold text-white">
                      {org?.name ?? p.buyer_org_id}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      via {bridge?.name ?? p.bridge_id}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasDrafts && (
                      <span className="border border-emerald-400/40 bg-[#07291e] px-2 py-0.5 font-mono text-[10px] text-emerald-200">
                        READY
                      </span>
                    )}
                    <span className="font-mono text-base font-bold text-sky-300">{p.score}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT: LARGE-TYPE CLEAN DRAFT COMPOSER & APPROVAL */}
        <div className="xl:col-span-8">
          {activePath && (
            <div className="border border-white/15 bg-[#0f1117] p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                <div className="space-y-1">
                  <div className="font-mono text-xs uppercase tracking-wider text-sky-300">
                    {edgesMap[activePath.hops[0]]?.label ?? activePath.kind.replace(/_/g, " ")}
                  </div>
                  <h2 className="text-2xl font-bold text-white">
                    <button
                      type="button"
                      onClick={() => onInspectPerson(activePath.bridge_id)}
                      className="underline decoration-sky-400/50 underline-offset-4 hover:text-sky-300"
                    >
                      {peopleMap[activePath.bridge_id]?.name ?? activePath.bridge_id}
                    </button>{" "}
                    <span className="text-muted-foreground font-normal">→</span>{" "}
                    <span className="text-emerald-300">
                      {orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}
                    </span>
                  </h2>
                </div>

                <Button
                  variant="default"
                  flat
                  disabled={generating}
                  onClick={() => void handleGenerateDrafts(activePath.id)}
                  className="h-11 px-5 text-sm font-semibold"
                >
                  <Sparkles className="size-4" />
                  {generating
                    ? "Drafting…"
                    : currentDrafts.length > 0
                      ? "Regenerate (-1 cr)"
                      : "Generate Intro Draft (-1 cr)"}
                </Button>
              </div>

              {currentDrafts.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <p className="text-xl font-medium text-white">
                    Generate a grounded intro note to {peopleMap[activePath.bridge_id]?.name ?? "your bridge"}.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Debits 1 credit and produces both the warm-bridge request and a 2-sentence forwardable blurb.
                  </p>
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
                  <TabsList flat className="border border-white/15 bg-[#090a0d]">
                    {currentDrafts.map((d) => (
                      <TabsTrigger key={d.id} value={d.kind} className="px-4 py-2 text-sm">
                        <span>{DRAFT_KIND_TITLES[d.kind] ?? d.kind}</span>
                        <Badge
                          flat
                          className={`ml-2 font-mono text-[10px] uppercase ${
                            d.status === "approved"
                              ? "border-emerald-400/50 bg-[#07291e] text-emerald-200"
                              : d.status === "stale"
                                ? "border-amber-400/60 bg-[#2b1d05] text-amber-100"
                                : d.status === "rejected"
                                  ? "border-red-400/50 bg-[#2d0a0e] text-red-200"
                                  : "border-white/15"
                          }`}
                        >
                          {d.status}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {currentDrafts.map((draft) => {
                    const buffer = edits[draft.id] ?? { subject: draft.subject, body: draft.body };
                    const isDirty =
                      buffer.subject !== draft.subject || buffer.body !== draft.body;

                    return (
                      <TabsContent key={draft.id} value={draft.kind} className="space-y-5">
                        {draft.status === "stale" && (
                          <div className="flex items-center gap-2.5 border-l-2 border-amber-400 bg-[#2b1d05]/50 px-4 py-3 text-sm text-amber-100">
                            <AlertTriangle className="size-4 shrink-0 text-amber-300" />
                            <span>Edited after approval — prior hash invalidated. Re-approve below.</span>
                          </div>
                        )}

                        {draft.status === "approved" && !isDirty && (
                          <div className="group flex items-center justify-between border-l-2 border-emerald-400 bg-[#07291e]/60 px-4 py-3 text-sm text-emerald-100">
                            <span className="flex items-center gap-2 font-medium">
                              <ShieldCheck className="size-4 text-emerald-300" />
                              Approved by human reviewer (staged only; nothing sent)
                            </span>
                            <span className="font-mono text-xs text-emerald-300/70 opacity-0 transition-opacity group-hover:opacity-100">
                              sha256:{draft.content_hash.slice(0, 12)}
                            </span>
                          </div>
                        )}

                        {/* AUTOMATIC COPY CHECKS (D2 ✓ / ✗ CHIPS) */}
                        {draft.checks && draft.checks.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {draft.checks.map((chk, cIdx) => (
                              <span
                                key={`${chk.name}-${cIdx}`}
                                title={chk.detail ?? chk.name}
                                className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] ${
                                  chk.ok
                                    ? "border-emerald-400/40 bg-[#07291e] text-emerald-200"
                                    : "border-red-400/50 bg-[#2d0a0e] text-red-200"
                                }`}
                              >
                                <span>{chk.ok ? "✓" : "✗"}</span>
                                <span>{chk.name.replace(/_/g, " ")}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2">
                          <label className="font-mono text-xs uppercase text-muted-foreground">
                            Subject
                          </label>
                          <Input
                            value={buffer.subject}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [draft.id]: { ...buffer, subject: e.target.value },
                              }))
                            }
                            className="h-12 border-white/20 bg-[#090a0d] text-lg font-medium"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="font-mono text-xs uppercase text-muted-foreground">
                            Message
                          </label>
                          <Textarea
                            value={buffer.body}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [draft.id]: { ...buffer, body: e.target.value },
                              }))
                            }
                            rows={8}
                            className="border-white/20 bg-[#090a0d] text-base leading-relaxed"
                          />
                        </div>

                        {/* PROGRESSIVE DISCLOSURE: INLINE CITATIONS & HASH */}
                        <div className="border-t border-white/10 pt-3">
                          <button
                            type="button"
                            onClick={() => setShowCitations((v) => !v)}
                            className="flex items-center gap-2 font-mono text-xs text-muted-foreground hover:text-white"
                          >
                            <span>
                              {draft.evidence_ids.length} cited sources · sha256:
                              {draft.content_hash.slice(0, 10)}
                            </span>
                            <ChevronDown
                              className={`size-3.5 transition-transform ${
                                showCitations ? "rotate-180" : ""
                              }`}
                            />
                          </button>

                          <AnimatePresence initial={false}>
                            {showCitations && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden flex flex-wrap gap-2 pt-3"
                              >
                                {draft.evidence_ids.map((eid) => (
                                  <EvidenceChip
                                    key={eid}
                                    evidenceId={eid}
                                    evidenceMap={evidenceMap}
                                    onInspect={onInspectEvidence}
                                  />
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* ACTION FOOTER */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                          {isDirty ? (
                            <Button
                              flat
                              disabled={savingId === draft.id}
                              onClick={() => void handleSaveEdit(draft)}
                              className="h-11 border border-amber-400/50 bg-[#2b1d05] px-5 text-sm text-amber-100"
                            >
                              <Save className="size-4" />
                              {savingId === draft.id ? "Saving…" : "Save Edits & Recompute Hash"}
                            </Button>
                          ) : (
                            <div />
                          )}

                          <div className="flex items-center gap-3">
                            <Button
                              flat
                              disabled={approvingId === draft.id}
                              onClick={() => void handleApproveDecision(draft, "reject")}
                              className="h-12 border border-red-400/40 bg-[#2d0a0e] px-5 text-sm font-medium text-red-100 hover:border-red-300"
                            >
                              <XCircle className="size-4" />
                              Reject
                            </Button>
                            <Button
                              variant="default"
                              flat
                              disabled={approvingId === draft.id}
                              onClick={() => void handleApproveDecision(draft, "approve")}
                              className="h-12 px-7 text-base font-semibold"
                            >
                              <CheckCircle2 className="size-4" />
                              {approvingId === draft.id ? "Signing…" : "Approve Exact Text"}
                            </Button>
                          </div>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
