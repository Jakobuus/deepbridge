"use client";

import {
  CheckCircle2,
  ExternalLink,
  FileSearch,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api, maskEmail } from "@/lib/api";
import type { Contact, Edge, Evidence, Id, Org, Person } from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

export interface InspectorTarget {
  evidenceId?: Id | null;
  edgeId?: Id | null;
  personId?: Id | null;
}

interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: InspectorTarget | null;
  evidenceMap: Record<Id, Evidence>;
  edgesMap: Record<Id, Edge>;
  peopleMap: Record<Id, Person>;
  orgsMap: Record<Id, Org>;
  onSelectEvidence: (evidenceId: Id) => void;
  onEdgeUpdated: (edge: Edge) => void;
  onEvidenceLoaded: (evidence: Evidence) => void;
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  target,
  evidenceMap,
  edgesMap,
  peopleMap,
  orgsMap,
  onSelectEvidence,
  onEdgeUpdated,
  onEvidenceLoaded,
}: EvidenceDrawerProps) {
  const [contact, setContact] = React.useState<Contact | null>(null);
  const [contactLoading, setContactLoading] = React.useState(false);
  const [refreshingMoss, setRefreshingMoss] = React.useState(false);
  const [nameCheckBusy, setNameCheckBusy] = React.useState(false);
  const [evidenceBusy, setEvidenceBusy] = React.useState(false);
  const [drawerError, setDrawerError] = React.useState<string | null>(null);

  const activeEdge = target?.edgeId ? edgesMap[target.edgeId] ?? null : null;
  const activePerson = target?.personId ? peopleMap[target.personId] ?? null : null;
  const activeEvidence = target?.evidenceId ? evidenceMap[target.evidenceId] ?? null : null;

  // Fetch missing evidence on demand (e.g. Moss task evidence IDs)
  React.useEffect(() => {
    const eid = target?.evidenceId;
    if (!open || !eid || evidenceMap[eid]) return;
    let cancelled = false;
    setEvidenceBusy(true);
    setDrawerError(null);
    api
      .getEvidence(eid)
      .then((ev) => {
        if (!cancelled) onEvidenceLoaded(ev);
      })
      .catch((err) => {
        if (!cancelled) setDrawerError(err instanceof Error ? err.message : "Could not load evidence");
      })
      .finally(() => {
        if (!cancelled) setEvidenceBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target?.evidenceId, evidenceMap, onEvidenceLoaded]);

  // Fetch Contact card whenever a person is inspected
  React.useEffect(() => {
    const pid = target?.personId;
    if (!open || !pid) {
      setContact(null);
      return;
    }
    let cancelled = false;
    setContactLoading(true);
    setDrawerError(null);
    api
      .getContact(pid)
      .then(async (c) => {
        if (cancelled) return;
        setContact(c);
        // Pre-fetch any newly attached Moss evidence IDs so chips resolve immediately
        for (const eid of c.evidence_ids) {
          if (!evidenceMap[eid]) {
            try {
              const ev = await api.getEvidence(eid);
              if (!cancelled) onEvidenceLoaded(ev);
            } catch {
              // ignore missing optional evidence
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setDrawerError(err instanceof Error ? err.message : "Contact lookup failed");
      })
      .finally(() => {
        if (!cancelled) setContactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target?.personId, evidenceMap, onEvidenceLoaded]);

  const handleNameCheck = async (decision: "ok" | "rejected") => {
    if (!activeEdge) return;
    setNameCheckBusy(true);
    setDrawerError(null);
    try {
      const updated = await api.nameCheck(activeEdge.id, decision);
      onEdgeUpdated(updated);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Name-check failed");
    } finally {
      setNameCheckBusy(false);
    }
  };

  const handleRefreshMoss = async () => {
    if (!activePerson) return;
    setRefreshingMoss(true);
    setDrawerError(null);
    try {
      const refreshed = await api.refreshContact(activePerson.id);
      setContact(refreshed);
      for (const eid of refreshed.evidence_ids) {
        if (!evidenceMap[eid]) {
          try {
            const ev = await api.getEvidence(eid);
            onEvidenceLoaded(ev);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Moss refresh failed");
    } finally {
      setRefreshingMoss(false);
    }
  };

  const personOrgName =
    activePerson?.org_id && orgsMap[activePerson.org_id]
      ? orgsMap[activePerson.org_id].name
      : activePerson?.org_id ?? "Unlisted";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        flat
        border
        className="w-full sm:max-w-xl overflow-y-auto border-l border-white/20 bg-[#0a0c10] p-6"
      >
        <SheetHeader className="border-b border-white/15 pb-4 text-left">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-sky-300">
            <FileSearch className="size-3.5" />
            <span>Provenance & Identity Inspector</span>
          </div>
          <SheetTitle className="text-xl font-bold tracking-tight">
            {activePerson
              ? activePerson.name
              : activeEdge
                ? activeEdge.label
                : activeEvidence
                  ? `Evidence · ${activeEvidence.kind.toUpperCase()}`
                  : "Verification Drawer"}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Every claim links to a dated source URL. Publication affiliations are historical evidence, never an unverified claim of current employment.
          </SheetDescription>
        </SheetHeader>

        {drawerError && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-200">
            {drawerError}
          </div>
        )}

        <div className="flex flex-col gap-5 py-2">
          {/* 1. EDGE INSPECTOR + HUMAN NAME-CHECK */}
          {activeEdge && (
            <div className="rounded border border-white/15 bg-white/[0.03] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Graph Edge · {activeEdge.type}
                </span>
                <Badge
                  flat
                  className={
                    activeEdge.name_check === "ok"
                      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200 font-mono"
                      : activeEdge.name_check === "rejected"
                        ? "border-red-400/50 bg-red-500/15 text-red-200 font-mono"
                        : "border-amber-400/50 bg-amber-500/15 text-amber-200 font-mono"
                  }
                >
                  NAME CHECK: {activeEdge.name_check.toUpperCase()}
                </Badge>
              </div>

              <div className="text-base font-semibold text-foreground">{activeEdge.label}</div>

              <div className="grid grid-cols-2 gap-2 font-mono text-xs text-muted-foreground">
                <div>
                  <span className="text-white/40">FROM:</span>{" "}
                  {peopleMap[activeEdge.from]?.name ?? orgsMap[activeEdge.from]?.name ?? activeEdge.from}
                </div>
                <div>
                  <span className="text-white/40">TO:</span>{" "}
                  {peopleMap[activeEdge.to]?.name ?? orgsMap[activeEdge.to]?.name ?? activeEdge.to}
                </div>
                <div>
                  <span className="text-white/40">EVIDENCE DATE:</span>{" "}
                  {activeEdge.date ?? "Year in quote/label"}
                </div>
                <div>
                  <span className="text-white/40">HEURISTIC CONF:</span>{" "}
                  {Math.round(activeEdge.confidence * 100)}%
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Backing Evidence ({activeEdge.evidence_ids.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeEdge.evidence_ids.map((eid) => (
                    <EvidenceChip
                      key={eid}
                      evidenceId={eid}
                      evidenceMap={evidenceMap}
                      onInspect={onSelectEvidence}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-200">
                  <UserCheck className="size-3.5" />
                  <span>Human Disambiguation Check (Common-Name Safety)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    flat
                    disabled={nameCheckBusy}
                    onClick={() => handleNameCheck("ok")}
                    className={
                      activeEdge.name_check === "ok"
                        ? "border border-emerald-400 bg-emerald-500/25 text-emerald-100"
                        : "border border-white/20"
                    }
                  >
                    <CheckCircle2 className="size-3.5 text-emerald-300" />
                    Confirm Same Person (OK)
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    flat
                    disabled={nameCheckBusy}
                    onClick={() => handleNameCheck("rejected")}
                  >
                    <XCircle className="size-3.5" />
                    Reject Collision
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 2. PERSON + MOSS VERIFIED CONTACT CARD */}
          {activePerson && (
            <div className="rounded border border-white/15 bg-white/[0.03] p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {activePerson.is_bridge_candidate ? "Bridge / Researcher Node" : "Person Node"}
                  </div>
                  <div className="text-lg font-bold">{activePerson.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-amber-200/90">
                    Published affiliation: {personOrgName}{" "}
                    {activePerson.affiliation_asof
                      ? `(as of ${activePerson.affiliation_asof})`
                      : "(dated in paper evidence)"}
                  </div>
                </div>
                {activePerson.openalex_id && (
                  <a
                    href={activePerson.openalex_id}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2.5 py-1 font-mono text-xs hover:border-white/40"
                  >
                    OpenAlex <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              <div className="rounded border border-sky-400/25 bg-sky-950/20 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-sky-300">
                    <Sparkles className="size-3.5" />
                    <span>Contact Resolution</span>
                    {contact && (
                      <Badge flat className="ml-1 border-sky-400/40 bg-sky-500/20 text-sky-100 font-mono text-[10px]">
                        SOURCE: {contact.source.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="xs"
                    flat
                    disabled={refreshingMoss || contactLoading}
                    onClick={handleRefreshMoss}
                    className="border border-sky-400/40 bg-sky-500/15 font-mono text-[11px] text-sky-100"
                  >
                    <RefreshCw className={`size-3 ${refreshingMoss ? "animate-spin" : ""}`} />
                    {refreshingMoss ? "Running Moss Task..." : "Verify via Moss"}
                  </Button>
                </div>

                {contactLoading ? (
                  <div className="font-mono text-xs text-muted-foreground">
                    Resolving verified contact card...
                  </div>
                ) : contact ? (
                  <div className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2 rounded border border-white/10 bg-black/30 p-2.5 font-mono">
                      <div>
                        <div className="text-[10px] text-white/45">VERIFIED ROLE</div>
                        <div className="font-semibold text-foreground">
                          {contact.current_role ?? "Not publicly verified"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-white/45">CURRENT ORG</div>
                        <div className="font-semibold text-foreground">
                          {contact.current_org ?? "Unverified"}
                          {contact.current_asof ? ` (as of ${contact.current_asof})` : ""}
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-white/10 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-white/45">STAGE-MASKED EMAIL</span>
                          <span className="text-[10px] uppercase text-emerald-300">
                            status: {contact.email_status}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-foreground">
                          {maskEmail(contact.email)}
                        </div>
                      </div>
                    </div>

                    {contact.assessment && (
                      <p className="leading-relaxed text-foreground/90">{contact.assessment}</p>
                    )}

                    {contact.profiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {contact.profiles.map((p, idx) => (
                          <a
                            key={`${p.url}-${idx}`}
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2 py-1 font-mono text-[11px] text-foreground hover:border-sky-400/50"
                          >
                            {p.kind.toUpperCase()}
                            <ExternalLink className="size-2.5" />
                          </a>
                        ))}
                      </div>
                    )}

                    {contact.evidence_ids.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Contact Evidence ({contact.evidence_ids.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {contact.evidence_ids.map((eid) => (
                            <EvidenceChip
                              key={eid}
                              evidenceId={eid}
                              evidenceMap={evidenceMap}
                              onInspect={onSelectEvidence}
                              compact
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="font-mono text-xs text-muted-foreground">
                    No contact record loaded.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. VERBATIM EVIDENCE RECORD */}
          {evidenceBusy && (
            <div className="rounded border border-white/15 p-4 font-mono text-xs text-muted-foreground">
              Fetching source evidence record...
            </div>
          )}

          {activeEvidence && (
            <div className="rounded border border-sky-400/35 bg-sky-500/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-sky-300">
                  <ShieldCheck className="size-4" />
                  <span>Primary Evidence Record</span>
                </div>
                <Badge flat className="font-mono text-[10px] uppercase">
                  {activeEvidence.kind}
                </Badge>
              </div>

              <div className="font-mono text-[11px] text-muted-foreground">
                ID: <span className="text-foreground">{activeEvidence.id}</span>
              </div>

              <blockquote className="rounded border-l-2 border-sky-400 bg-black/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {activeEvidence.quote}
              </blockquote>

              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-muted-foreground">
                <div>
                  <span className="text-white/45">SOURCE DATE:</span>{" "}
                  {activeEvidence.source_date ?? "Year in quote"}
                </div>
                <div>
                  <span className="text-white/45">OBSERVED AT:</span>{" "}
                  {activeEvidence.observed_at.slice(0, 10)}
                </div>
              </div>

              <a
                href={activeEvidence.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded border border-sky-400/50 bg-sky-500/20 px-3 py-2 font-mono text-xs font-semibold text-sky-100 transition hover:bg-sky-500/30"
              >
                <span>Open Verifiable Source URL</span>
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          )}

          {!activeEvidence && !activeEdge && !activePerson && !evidenceBusy && (
            <div className="rounded border border-white/10 p-6 text-center font-mono text-xs text-muted-foreground">
              <ShieldAlert className="mx-auto mb-2 size-5 text-muted-foreground" />
              Click any Evidence chip, Warm-Path hop, or Researcher node to inspect verbatim citations and run human disambiguation checks.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
