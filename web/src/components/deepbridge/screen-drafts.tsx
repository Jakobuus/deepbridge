"use client";

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Hash,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const NO_DRAFTS: Draft[] = [];

export function ScreenDrafts({
  paths,
  selectedPathId,
  peopleMap,
  orgsMap,
  edgesMap: _edgesMap,
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

  // Stable reference: a fresh `[]` each render re-fired the effects below in a loop ("Maximum update depth").
  const currentDrafts = React.useMemo(
    () => (activePath ? draftsByPath[activePath.id] ?? NO_DRAFTS : NO_DRAFTS),
    [activePath, draftsByPath],
  );

  const [loadingIds, setLoadingIds] = React.useState<Record<Id, boolean>>({});
  const [loadFailed, setLoadFailed] = React.useState<Record<Id, boolean>>({});
  const requested = React.useRef<Set<Id>>(new Set());
  const [creditBlocked402, setCreditBlocked402] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [approvingId, setApprovingId] = React.useState<Id | null>(null);

  // Local editable buffers keyed by draft.id
  const [edits, setEdits] = React.useState<Record<Id, { subject: string; body: string }>>({});

  const handleGenerateDrafts = async (pathId: Id) => {
    requested.current.add(pathId);
    setLoadingIds((prev) => ({ ...prev, [pathId]: true }));
    setActionError(null);
    setCreditBlocked402(null);
    setLoadFailed((prev) => ({ ...prev, [pathId]: false }));
    try {
      // HACK: give up after 15 s so the stage never sits on a skeleton; the retry button asks again.
      const generated = await Promise.race([
        api.generateDrafts(pathId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
      onDraftsLoaded(pathId, generated);
      setEdits((prev) => {
        const next = { ...prev };
        for (const d of generated) {
          next[d.id] = { subject: d.subject, body: d.body };
        }
        return next;
      });
      await onRefreshCreditsAndPipeline();
    } catch (err) {
      await onRefreshCreditsAndPipeline();
      setLoadFailed((prev) => ({ ...prev, [pathId]: true }));
      if (err instanceof ApiError && err.status === 402) {
        setCreditBlocked402(
          `Flexprice blocked this draft: ${err.detail}.`,
        );
      }
    } finally {
      setLoadingIds((prev) => ({ ...prev, [pathId]: false }));
    }
  };

  // Selecting a path loads its intro ask straight away (cached replay, no click needed).
  const activePathId = activePath?.id ?? null;
  const hasDrafts = currentDrafts.length > 0;
  React.useEffect(() => {
    if (!activePathId || hasDrafts || requested.current.has(activePathId)) return;
    void handleGenerateDrafts(activePathId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePathId, hasDrafts]);

  // One Approve: the intro ask and the note to forward are approved together, each bound to its exact text.
  const handleApproveAll = async (drafts: Draft[]) => {
    for (const d of drafts) {
      if (d.status === "approved") continue;
      await handleApproveDecision(d, "approve");
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

        {/* RIGHT: warm intro ask from Hannah + HITL approve */}
        <div className="xl:col-span-8 space-y-5">
          {activePath && (() => {
            const bridgeName = peopleMap[activePath.bridge_id]?.name ?? "the bridge";
            const bridgeFirst = bridgeName.split(/\s+/)[0];
            const orgName = orgsMap[activePath.buyer_org_id]?.name ?? "the buyer";
            const intro = currentDrafts.find((d) => d.kind === "intro_request") ?? currentDrafts[0] ?? null;
            const note = currentDrafts.find((d) => d.kind === "forwardable_note" && d.id !== intro?.id) ?? null;
            const shown = [intro, note].filter(Boolean) as Draft[];
            const checks = intro?.checks ?? [];
            const passed = checks.filter((c) => c.ok).length;
            const review = shown.find((d) => (d.review?.steps?.length ?? 0) > 0)?.review ?? null;
            const steps = review?.steps ?? [];
            const allApproved = shown.length > 0 && shown.every((d) => d.status === "approved");
            const anyStale = shown.some((d) => d.status === "stale");
            const busy = shown.some((d) => approvingId === d.id);
            const failed = loadFailed[activePath.id];
            const loading = Boolean(loadingIds[activePath.id]) || (!failed && currentDrafts.length === 0);
            const setBuf = (d: Draft, patch: Partial<{ subject: string; body: string }>) =>
              setEdits((prev) => ({ ...prev, [d.id]: { ...(prev[d.id] ?? { subject: d.subject, body: d.body }), ...patch } }));
            return (
              <>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    From: <span className="text-foreground">Hannah Weber · HOPO Therapeutics</span>
                    <span className="mx-2">→</span>
                    To:{" "}
                    <button
                      type="button"
                      onClick={() => onInspectPerson(activePath.bridge_id)}
                      className="text-foreground underline decoration-white/30 underline-offset-4 hover:decoration-sky-400"
                    >
                      {bridgeName}
                    </button>
                  </div>
                  <div className="text-lg font-semibold">
                    Intro ask to {bridgeFirst}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">for {orgName}</span>
                  </div>
                </div>

                {failed ? (
                  <div className="flex items-center gap-3 rounded-md border border-white/10 px-4 py-3 text-sm text-muted-foreground">
                    <MailCheck className="size-4 shrink-0" />
                    The intro ask didn&apos;t load this time.
                    <Button size="sm" variant="glass" flat onClick={() => void handleGenerateDrafts(activePath.id)}>
                      Try again
                    </Button>
                  </div>
                ) : loading || !intro ? (
                  <div className="space-y-3" aria-label="Loading intro ask">
                    <div className="h-9 w-2/3 animate-pulse rounded-md bg-white/[0.06]" />
                    <div className="h-32 animate-pulse rounded-md bg-white/[0.05]" />
                    <div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                    <div className="h-20 animate-pulse rounded-md bg-white/[0.04]" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {anyStale && (
                      <div className="flex items-center gap-2 text-xs text-amber-200">
                        <AlertTriangle className="size-4 shrink-0 text-amber-300" />
                        Edited after approval. Approval no longer matches the text; approve again.
                      </div>
                    )}
                    {allApproved && (
                      <div className="flex items-center gap-2 text-xs text-emerald-200">
                        <ShieldCheck className="size-4 shrink-0 text-emerald-300" />
                        Approved by Hannah · bound to this exact text · nothing sent
                        <button type="button" onClick={onGoToPipeline} className="ml-2 underline underline-offset-4">
                          Pipeline →
                        </button>
                      </div>
                    )}

                    <Input
                      value={(edits[intro.id] ?? intro).subject}
                      onChange={(e) => setBuf(intro, { subject: e.target.value })}
                      className="font-medium text-sm"
                    />
                    <Textarea
                      value={(edits[intro.id] ?? intro).body}
                      onChange={(e) => setBuf(intro, { body: e.target.value })}
                      rows={8}
                      className="text-sm leading-relaxed"
                    />

                    {note && (
                      <div className="space-y-1.5">
                        <div className="text-xs text-muted-foreground">
                          Forwardable note · <span className="text-foreground">Note Hannah asks them to forward</span>
                        </div>
                        <Textarea
                          value={(edits[note.id] ?? note).body}
                          onChange={(e) => setBuf(note, { body: e.target.value })}
                          rows={6}
                          className="bg-white/[0.02] text-sm leading-relaxed"
                        />
                      </div>
                    )}

                    {shown.some((d) => d.evidence_ids.length) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-xs text-muted-foreground">Sources</span>
                        {[...new Set(shown.flatMap((d) => d.evidence_ids))].map((eid) => (
                          <EvidenceChip key={eid} evidenceId={eid} evidenceMap={evidenceMap} onInspect={onInspectEvidence} />
                        ))}
                      </div>
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
                          {allApproved
                            ? "approved by Hannah"
                            : review?.status === "in_review" && steps.length < 4
                              ? "reviewing…"
                              : "awaiting Hannah"}
                        </span>
                        {review?.room_url && (
                          <a href={review.room_url} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4 hover:text-foreground">
                            Open Band room
                          </a>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex items-center gap-3">
                        {checks.length > 0 && (
                          <details className="text-xs">
                            <summary
                              className={`cursor-pointer list-none rounded-full border px-2.5 py-0.5 ${
                                passed === checks.length ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"
                              }`}
                            >
                              {passed === checks.length ? "✓" : "!"} {passed}/{checks.length} checks pass
                            </summary>
                            <div className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
                              {checks.map((c, i) => (
                                <div key={`${c.name}-${i}`} className={c.ok ? "" : "text-amber-200"} title={c.detail ?? undefined}>
                                  {c.ok ? "✓" : "✗"} {c.name}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        <details className="text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer list-none">
                            <Hash className="mr-1 inline size-3" />
                            hash {intro.content_hash.slice(0, 10)}…
                          </summary>
                          <code className="break-all">{intro.content_hash}</code>
                        </details>
                      </div>
                      <Button variant="default" flat disabled={busy || allApproved} onClick={() => void handleApproveAll(shown)}>
                        <CheckCircle2 className="size-4" />
                        {allApproved ? "Approved" : anyStale ? "Approve again" : "Approve"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
