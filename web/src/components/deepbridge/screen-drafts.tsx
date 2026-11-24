"use client";

import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  FileEdit,
  Hash,
  Lock,
  MailCheck,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  intro_request: "1 · Ask Bridge For Intro",
  forwardable_note: "2 · Forwardable Buyer Blurb",
  direct_fallback: "3 · Direct Citation Fallback",
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

  // Local editable buffers keyed by draft.id
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
          `HTTP 402 Payment / Credit Gate Blocked: "${err.detail}". Balance is 0 credits — outbound draft synthesis halted cleanly.`,
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
      // If user has unsaved edits in buffer, save first so content_hash matches what is on screen!
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
        setActionError(`HTTP 409 Hash Conflict: ${err.detail}. Save edits first to bind approval to the new SHA-256 digest.`);
      } else {
        setActionError(err instanceof Error ? err.message : "Approval failed");
      }
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* HONESTY & SAFETY BANNER */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-emerald-400/35 bg-emerald-950/20 px-4 py-2.5 font-mono text-xs text-emerald-100">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-emerald-300" />
          <span>
            <strong>HUMAN-IN-THE-LOOP APPROVAL ONLY:</strong> Nothing is sent to real people. Approvals bind to the exact SHA-256{" "}
            <code>content_hash</code>; any post-approval edit flips status to <code>stale</code>.
          </span>
        </div>
        <Button size="xs" flat onClick={onGoToPipeline} className="border border-emerald-400/40 font-mono">
          05 · Pipeline Kanban <ArrowRight className="size-3" />
        </Button>
      </div>

      {/* HTTP 402 CREDIT GATE BLOCKED BANNER */}
      {(creditBlocked402 || (credits && credits.balance <= 0)) && (
        <div className="rounded border-2 border-red-500/70 bg-red-950/40 p-4 space-y-1.5">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-red-200">
            <AlertOctagon className="size-4 text-red-400" />
            <span>Metered Credit Gate Active — HTTP 402 Out of Credits</span>
          </div>
          <p className="font-mono text-xs text-red-100/90">
            {creditBlocked402 ??
              "Credit balance is 0. New POST /drafts calls will be blocked with HTTP 402 until credits are replenished."}
          </p>
        </div>
      )}

      {actionError && (
        <div className="rounded border border-amber-400/50 bg-amber-950/30 p-3 font-mono text-xs text-amber-100">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT COLUMN: PATH SELECTOR + LIVE CREDITS LEDGER */}
        <div className="xl:col-span-4 space-y-5">
          <Card flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
            <CardHeader className="px-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-sky-300">
                  1 · Select Warm Path
                </span>
                <Badge flat className="font-mono text-[10px]">
                  -1 CREDIT / PATH
                </Badge>
              </div>
              <CardTitle className="text-base">Warm Paths Ready for Outreach</CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-2 max-h-[360px] overflow-y-auto">
              {sortedPaths.map((p) => {
                const isSelected = activePath?.id === p.id;
                const hasLoadedDrafts = Boolean(draftsByPath[p.id]?.length);
                const org = orgsMap[p.buyer_org_id];
                const bridge = peopleMap[p.bridge_id];

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPath(p.id)}
                    className={`w-full rounded border p-3 text-left transition ${
                      isSelected
                        ? "border-sky-400 bg-sky-500/15"
                        : "border-white/15 bg-black/35 hover:border-white/35"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-foreground">
                        {org?.name ?? p.buyer_org_id}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {hasLoadedDrafts && (
                          <Badge flat className="border-emerald-400/40 bg-emerald-500/15 font-mono text-[9px] text-emerald-200">
                            LOADED
                          </Badge>
                        )}
                        <span className="font-mono text-xs font-bold text-sky-300">{p.score}</span>
                      </div>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      via {bridge?.name ?? p.bridge_id} ({p.kind})
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* CREDITS METER + AUDIT EVENTS */}
          <Card flat border className="border-white/15 bg-white/[0.02] py-4 gap-3">
            <CardHeader className="px-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-300">
                  <Coins className="size-3.5" />
                  <span>Credit Gate Meter</span>
                </span>
                <Badge flat className="font-mono text-[10px] uppercase">
                  source: {credits?.source ?? "local"}
                </Badge>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <CardTitle className="text-3xl font-mono font-bold">
                  {credits?.balance ?? "—"}{" "}
                  <span className="text-sm font-normal text-muted-foreground">credits left</span>
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Each <code>POST /drafts</code> debits 1 credit. At 0 credits, the API enforces <code>HTTP 402</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 space-y-1.5 max-h-48 overflow-y-auto">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">
                Meter Events ({credits?.events.length ?? 0})
              </div>
              {[...(credits?.events ?? [])].reverse().map((ev, i) => (
                <div
                  key={`${ev.at}-${i}`}
                  className={`flex items-center justify-between rounded border px-2.5 py-1.5 font-mono text-[11px] ${
                    ev.blocked
                      ? "border-red-400/50 bg-red-500/15 text-red-200"
                      : "border-white/10 bg-black/35 text-muted-foreground"
                  }`}
                >
                  <span className="truncate max-w-[180px]">{ev.action}</span>
                  <span className="font-semibold">
                    {ev.blocked ? "BLOCKED (402)" : ev.delta > 0 ? `+${ev.delta}` : ev.delta}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: DRAFT GENERATOR + DUAL-NOTE EDITOR + HITL APPROVE */}
        <div className="xl:col-span-8 space-y-4">
          {activePath && (
            <Card flat border className="border-white/15 bg-white/[0.025] py-5 gap-4">
              <CardHeader className="px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-wider text-sky-300">
                      Selected Warm Path · {activePath.id}
                    </div>
                    <CardTitle className="text-xl font-bold mt-0.5">
                      Bridge:{" "}
                      <button
                        type="button"
                        onClick={() => onInspectPerson(activePath.bridge_id)}
                        className="underline decoration-sky-400/60 underline-offset-4 hover:text-sky-200"
                      >
                        {peopleMap[activePath.bridge_id]?.name ?? activePath.bridge_id}
                      </button>{" "}
                      → Buyer:{" "}
                      <span className="text-emerald-300">
                        {orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}
                      </span>
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-xs text-muted-foreground">
                      {activePath.hops.map((eid) => (
                        <span key={eid} className="rounded border border-white/15 bg-black/40 px-2 py-0.5">
                          {edgesMap[eid]?.label ?? eid}
                        </span>
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="default"
                    flat
                    disabled={generating}
                    onClick={() => void handleGenerateDrafts(activePath.id)}
                  >
                    <Sparkles className="size-4" />
                    {generating
                      ? "Generating..."
                      : currentDrafts.length > 0
                        ? "Reload / Debit Drafts (-1 cr)"
                        : "Generate Evidence-Cited Drafts (-1 cr)"}
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="px-6">
                {currentDrafts.length === 0 ? (
                  <div className="rounded border border-dashed border-white/20 bg-black/30 p-10 text-center space-y-3">
                    <MailCheck className="mx-auto size-8 text-sky-300/70" />
                    <div className="text-sm font-semibold">
                      No drafts loaded yet for {orgsMap[activePath.buyer_org_id]?.name ?? activePath.id}
                    </div>
                    <p className="mx-auto max-w-md text-xs text-muted-foreground">
                      Click <strong>Generate Evidence-Cited Drafts (-1 cr)</strong> above to debit 1 credit via{" "}
                      <code>POST /drafts</code> and load both the Bridge Intro Request and the Forwardable Buyer Note.
                    </p>
                  </div>
                ) : (
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList flat className="border border-white/15 bg-black/50">
                      {currentDrafts.map((d) => (
                        <TabsTrigger key={d.id} value={d.kind} className="font-mono text-xs">
                          <span>{DRAFT_KIND_TITLES[d.kind] ?? d.kind}</span>
                          <Badge
                            flat
                            className={`ml-2 text-[9px] uppercase ${
                              d.status === "approved"
                                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                                : d.status === "stale"
                                  ? "border-amber-400/60 bg-amber-500/25 text-amber-100"
                                  : d.status === "rejected"
                                    ? "border-red-400/50 bg-red-500/20 text-red-200"
                                    : "border-white/20"
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
                        <TabsContent key={draft.id} value={draft.kind} className="space-y-4">
                          {/* STALE RE-APPROVAL WARNING */}
                          {draft.status === "stale" && (
                            <div className="flex items-center gap-2.5 rounded border border-amber-400/60 bg-amber-500/15 p-3 font-mono text-xs text-amber-100">
                              <AlertTriangle className="size-4 shrink-0 text-amber-300" />
                              <div>
                                <strong>STALE — EDITED AFTER APPROVAL:</strong> Content changed after human sign-off, invalidating the prior SHA-256 approval signature. Re-approval is required.
                              </div>
                            </div>
                          )}

                          {draft.status === "approved" && !isDirty && (
                            <div className="flex items-center gap-2.5 rounded border border-emerald-400/50 bg-emerald-500/15 p-3 font-mono text-xs text-emerald-100">
                              <ShieldCheck className="size-4 shrink-0 text-emerald-300" />
                              <div>
                                <strong>HUMAN APPROVED:</strong> Bound to SHA-256{" "}
                                <code>{draft.content_hash.slice(0, 16)}…</code> (stage-only; nothing sent externally).
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                            <span>
                              TO:{" "}
                              <strong className="text-foreground">
                                {peopleMap[draft.to_person_id]?.name ?? draft.to_person_id}
                              </strong>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Hash className="size-3 text-sky-300" />
                              content_hash: <code>{draft.content_hash.slice(0, 20)}…</code>
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <label className="font-mono text-[11px] uppercase text-muted-foreground">
                              Subject Line
                            </label>
                            <Input
                              value={buffer.subject}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [draft.id]: { ...buffer, subject: e.target.value },
                                }))
                              }
                              className="font-medium text-sm"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="font-mono text-[11px] uppercase text-muted-foreground">
                                Message Body (Editable — Try editing after approval to test Stale guard)
                              </label>
                              {isDirty && (
                                <span className="font-mono text-[11px] text-amber-300">
                                  ● Unsaved local edits
                                </span>
                              )}
                            </div>
                            <Textarea
                              value={buffer.body}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [draft.id]: { ...buffer, body: e.target.value },
                                }))
                              }
                              rows={9}
                              className="font-mono text-xs leading-relaxed"
                            />
                          </div>

                          {/* INLINE EVIDENCE CHIPS */}
                          <div className="rounded border border-white/15 bg-black/35 p-3 space-y-2">
                            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              Inline Cited Evidence ({draft.evidence_ids.length} — zero uncited claims)
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {draft.evidence_ids.map((eid) => (
                                <EvidenceChip
                                  key={eid}
                                  evidenceId={eid}
                                  evidenceMap={evidenceMap}
                                  onInspect={onInspectEvidence}
                                />
                              ))}
                            </div>
                          </div>

                          {/* ACTION BAR: SAVE EDITS + APPROVE / REJECT */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-3">
                            <Button
                              size="sm"
                              flat
                              disabled={!isDirty || savingId === draft.id}
                              onClick={() => void handleSaveEdit(draft)}
                              className="border border-white/25 font-mono text-xs"
                            >
                              {savingId === draft.id ? (
                                "Saving..."
                              ) : (
                                <>
                                  <Save className="size-3.5" />
                                  <FileEdit className="size-3.5" />
                                  Save Edits (PUT /drafts)
                                </>
                              )}
                            </Button>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                flat
                                disabled={approvingId === draft.id}
                                onClick={() => void handleApproveDecision(draft, "reject")}
                              >
                                <XCircle className="size-4" />
                                Reject Draft
                              </Button>
                              <Button
                                size="sm"
                                variant="default"
                                flat
                                disabled={approvingId === draft.id}
                                onClick={() => void handleApproveDecision(draft, "approve")}
                              >
                                <CheckCircle2 className="size-4" />
                                {draft.status === "stale" ? "Re-Approve Hash" : "Approve Draft (HITL)"}
                              </Button>
                            </div>
                          </div>
                        </TabsContent>
                      );
                    })}
                  </Tabs>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
