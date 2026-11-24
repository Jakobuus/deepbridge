"use client";

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Hash,
  MailCheck,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import * as React from "react";
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
  intro_request: "Intro request",
  forwardable_note: "Forwardable note",
  direct_fallback: "Direct fallback",
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
          `Flexprice blocked this draft: ${err.detail}.`,
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
      {/* HTTP 402: Flexprice credit gate */}
      {(creditBlocked402 || (credits && credits.balance <= 0)) && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/60 bg-red-950/30 px-4 py-3">
          <AlertOctagon className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="space-y-0.5 text-sm">
            <div className="font-semibold text-red-100">Out of Flexprice credits (HTTP 402)</div>
            <p className="text-xs text-red-100/80">
              {creditBlocked402 ?? "Drafting is blocked until credits are topped up."} Top up the Flexprice wallet to continue.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-amber-400/40 px-4 py-2 text-xs text-amber-100">{actionError}</div>
      )}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        {/* LEFT: warm paths */}
        <div className="xl:col-span-4 space-y-4">
          <div className="text-xs text-muted-foreground">Warm paths</div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
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
                  className={`w-full rounded-md px-3 py-2 text-left transition ${
                    isSelected ? "bg-white/[0.07]" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{org?.name ?? p.buyer_org_id}</span>
                    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      {hasLoadedDrafts && <span className="size-1.5 rounded-full bg-emerald-400" title="drafts loaded" />}
                      {p.score}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">via {bridge?.name ?? p.bridge_id}</div>
                </button>
              );
            })}
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none">
              <Coins className="mr-1.5 inline size-3.5 text-amber-300" />
              Flexprice · {credits?.balance ?? "—"} credits · 1 per draft
            </summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              {[...(credits?.events ?? [])].reverse().slice(0, 8).map((ev, i) => (
                <div key={`${ev.at}-${i}`} className={`flex justify-between ${ev.blocked ? "text-red-300" : ""}`}>
                  <span className="truncate max-w-[200px]">{ev.action}</span>
                  <span>{ev.blocked ? "402" : ev.delta > 0 ? `+${ev.delta}` : ev.delta}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* RIGHT: draft + HITL approve */}
        <div className="xl:col-span-8 space-y-5">
          {activePath && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-lg font-semibold">
                  <button
                    type="button"
                    onClick={() => onInspectPerson(activePath.bridge_id)}
                    className="underline decoration-white/30 underline-offset-4 hover:decoration-sky-400"
                  >
                    {peopleMap[activePath.bridge_id]?.name ?? activePath.bridge_id}
                  </button>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span>{orgsMap[activePath.buyer_org_id]?.name ?? activePath.buyer_org_id}</span>
                </div>
                <Button
                  variant={currentDrafts.length > 0 ? "glass" : "default"}
                  size={currentDrafts.length > 0 ? "sm" : "default"}
                  flat
                  disabled={generating}
                  onClick={() => void handleGenerateDrafts(activePath.id)}
                >
                  <Sparkles className="size-4" />
                  {generating ? "Generating..." : currentDrafts.length > 0 ? "Regenerate (1 credit)" : "Generate drafts (1 credit)"}
                </Button>
              </div>

              {currentDrafts.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  <MailCheck className="mx-auto mb-3 size-7 text-muted-foreground/60" />
                  No drafts yet. Nothing is ever sent without your approval.
                </div>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                  <TabsList flat className="bg-transparent">
                    {currentDrafts.map((d) => (
                      <TabsTrigger key={d.id} value={d.kind} className="text-xs">
                        <span>{DRAFT_KIND_TITLES[d.kind] ?? d.kind}</span>
                        <span
                          className={`ml-2 text-[10px] ${
                            d.status === "approved"
                              ? "text-emerald-300"
                              : d.status === "stale"
                                ? "text-amber-300"
                                : d.status === "rejected"
                                  ? "text-red-300"
                                  : "text-muted-foreground"
                          }`}
                        >
                          {d.status}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {currentDrafts.map((draft) => {
                    const buffer = edits[draft.id] ?? { subject: draft.subject, body: draft.body };
                    const isDirty = buffer.subject !== draft.subject || buffer.body !== draft.body;
                    const review = draft.review;
                    const steps = review?.steps ?? [];

                    return (
                      <TabsContent key={draft.id} value={draft.kind} className="space-y-4">
                        {draft.status === "stale" && (
                          <div className="flex items-center gap-2 text-xs text-amber-200">
                            <AlertTriangle className="size-4 shrink-0 text-amber-300" />
                            Edited after approval. Approval no longer matches the text; approve again.
                          </div>
                        )}
                        {draft.status === "approved" && !isDirty && (
                          <div className="flex items-center gap-2 text-xs text-emerald-200">
                            <ShieldCheck className="size-4 shrink-0 text-emerald-300" />
                            Approved by you · bound to this exact text · nothing sent
                            <button type="button" onClick={onGoToPipeline} className="ml-2 underline underline-offset-4">
                              Pipeline →
                            </button>
                          </div>
                        )}

                        <div className="text-xs text-muted-foreground">
                          To <span className="text-foreground">{peopleMap[draft.to_person_id]?.name ?? draft.to_person_id}</span>
                        </div>

                        <Input
                          value={buffer.subject}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [draft.id]: { ...buffer, subject: e.target.value } }))
                          }
                          className="font-medium text-sm"
                        />
                        <Textarea
                          value={buffer.body}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [draft.id]: { ...buffer, body: e.target.value } }))
                          }
                          rows={9}
                          className="text-sm leading-relaxed"
                        />

                        <div className={`flex flex-wrap items-center gap-1.5 ${draft.evidence_ids.length ? "" : "hidden"}`}>
                          <span className="mr-1 text-xs text-muted-foreground">Sources</span>
                          {draft.evidence_ids.map((eid) => (
                            <EvidenceChip
                              key={eid}
                              evidenceId={eid}
                              evidenceMap={evidenceMap}
                              onInspect={onInspectEvidence}
                            />
                          ))}
                        </div>

                        {(draft.checks?.length ?? 0) > 0 && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer list-none">
                              <span className={draft.checks!.every((c) => c.ok) ? "text-emerald-300" : "text-amber-300"}>
                                {draft.checks!.every((c) => c.ok) ? "✓" : "!"}
                              </span>{" "}
                              {draft.checks!.filter((c) => c.ok).length}/{draft.checks!.length} checks pass
                            </summary>
                            <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                              {draft.checks!.map((c) => (
                                <div key={c.name} className={c.ok ? "" : "text-amber-200"} title={c.detail ?? undefined}>
                                  {c.ok ? "✓" : "✗"} {c.name}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {/* Band review strip (only when the API returns draft.review) */}
                        {steps.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>Reviewed in Band:</span>
                            {steps.map((st, i) => {
                              const label = st.agent ?? `step ${i + 1}`;
                              const extra = label === "Reviewer" && st.verdict ? ` ${st.verdict}` : "";
                              return (
                                <React.Fragment key={`${label}-${i}`}>
                                  {i > 0 && <span>→</span>}
                                  <span className="text-foreground" title={st.verdict}>
                                    <span className="mr-0.5 text-emerald-300">✓</span>
                                    {label}
                                    {extra}
                                  </span>
                                </React.Fragment>
                              );
                            })}
                            <span>→</span>
                            <span className="text-amber-200">
                              {draft.status === "approved"
                                ? "approved by Jakob"
                                : review?.status === "in_review" && steps.length < 4
                                  ? "reviewing…"
                                  : "awaiting Jakob"}
                            </span>
                            {review?.room_url && (
                              <a
                                href={review.room_url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 underline underline-offset-4 hover:text-foreground"
                              >
                                Open Band room
                              </a>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                          <details className="text-[11px] text-muted-foreground">
                            <summary className="cursor-pointer list-none">
                              <Hash className="mr-1 inline size-3" />
                              hash {draft.content_hash.slice(0, 10)}…
                            </summary>
                            <code className="break-all">{draft.content_hash}</code>
                          </details>
                          <div className="flex items-center gap-2">
                            {isDirty && (
                              <Button
                                size="sm"
                                variant="ghost"
                                flat
                                disabled={savingId === draft.id}
                                onClick={() => void handleSaveEdit(draft)}
                              >
                                <Save className="size-3.5" />
                                {savingId === draft.id ? "Saving..." : "Save edits"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              flat
                              disabled={approvingId === draft.id}
                              onClick={() => void handleApproveDecision(draft, "reject")}
                              className="text-muted-foreground"
                            >
                              <XCircle className="size-4" />
                              Reject
                            </Button>
                            <Button
                              variant="default"
                              flat
                              disabled={approvingId === draft.id}
                              onClick={() => void handleApproveDecision(draft, "approve")}
                            >
                              <CheckCircle2 className="size-4" />
                              {draft.status === "stale" ? "Approve again" : "Approve"}
                            </Button>
                          </div>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
