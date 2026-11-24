"use client";

import {
  Building2,
  Coins,
  FileSearch,
  FlaskConical,
  GitBranch,
  Kanban,
  MailCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import {
  EvidenceDrawer,
  type InspectorTarget,
} from "@/components/deepbridge/evidence-drawer";
import { ScreenBuyers } from "@/components/deepbridge/screen-buyers";
import { ScreenDrafts } from "@/components/deepbridge/screen-drafts";
import { ScreenIntake } from "@/components/deepbridge/screen-intake";
import { ScreenLeads } from "@/components/deepbridge/screen-leads";
import { ScreenPipeline } from "@/components/deepbridge/screen-pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_BASE, ApiError, api, GOLDEN_FOUNDER_ID } from "@/lib/api";
import type {
  Card,
  Credits,
  Draft,
  Edge,
  Evidence,
  Founder,
  Icp,
  Id,
  IntakeForm,
  KnowledgeGraph,
  Metrics,
  Org,
  Path,
  Person,
  Signal,
} from "@/lib/types";

type ScreenKey = "intake" | "buyers" | "leads" | "drafts" | "pipeline";

const NAV_ITEMS: {
  key: ScreenKey;
  step: string;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "intake",
    step: "01",
    label: "Founder Intake",
    sub: "Voice Grilling → Value Map",
    icon: FlaskConical,
  },
  {
    key: "buyers",
    step: "02",
    label: "ICP & Buyers",
    sub: "Why-Now Signals + Search",
    icon: Building2,
  },
  {
    key: "leads",
    step: "03",
    label: "Knowledge Graph",
    sub: "3-Ring Cosmos ↔ Flat Table",
    icon: GitBranch,
  },
  {
    key: "drafts",
    step: "04",
    label: "Draft & Approve",
    sub: "HITL Hash + Credit Gate",
    icon: MailCheck,
  },
  {
    key: "pipeline",
    step: "05",
    label: "Pipeline & Metrics",
    sub: "7-Stage Kanban + Audit",
    icon: Kanban,
  },
];

export default function DeepBridgeWorkspace() {
  const [activeScreen, setActiveScreen] = React.useState<ScreenKey>("intake");

  // Core Domain State
  const [founder, setFounder] = React.useState<Founder | null>(null);
  const [icp, setIcp] = React.useState<Icp | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = React.useState<KnowledgeGraph | null>(null);
  const [orgs, setOrgs] = React.useState<Org[]>([]);
  const [signals, setSignals] = React.useState<Signal[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [graphOrgs, setGraphOrgs] = React.useState<Org[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [evidenceMap, setEvidenceMap] = React.useState<Record<Id, Evidence>>({});
  const [paths, setPaths] = React.useState<Path[]>([]);
  const [cards, setCards] = React.useState<Card[]>([]);
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);
  const [credits, setCredits] = React.useState<Credits | null>(null);
  const [draftsByPath, setDraftsByPath] = React.useState<Record<Id, Draft[]>>({});

  // UI Selection & Drawer State
  const [selectedPathId, setSelectedPathId] = React.useState<Id | null>(null);
  const [orgFilterId, setOrgFilterId] = React.useState<Id | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [inspectorTarget, setInspectorTarget] = React.useState<InspectorTarget | null>(null);

  // Loading & Error Flags
  const [booting, setBooting] = React.useState(true);
  const [loadingIntake, setLoadingIntake] = React.useState(false);
  const [intakeError, setIntakeError] = React.useState<string | null>(null);
  const [apiOfflineError, setApiOfflineError] = React.useState<string | null>(null);
  const [replayNotice, setReplayNotice] = React.useState<string | null>(null);

  // Lookup Maps
  const peopleMap = React.useMemo(() => {
    const m: Record<Id, Person> = {};
    for (const p of people) m[p.id] = p;
    return m;
  }, [people]);

  const orgsMap = React.useMemo(() => {
    const m: Record<Id, Org> = {};
    for (const o of graphOrgs) m[o.id] = o;
    for (const o of orgs) m[o.id] = o;
    return m;
  }, [graphOrgs, orgs]);

  const edgesMap = React.useMemo(() => {
    const m: Record<Id, Edge> = {};
    for (const e of edges) m[e.id] = e;
    return m;
  }, [edges]);

  const signalsMap = React.useMemo(() => {
    const m: Record<Id, Signal> = {};
    for (const s of signals) m[s.id] = s;
    return m;
  }, [signals]);

  const pathsMap = React.useMemo(() => {
    const m: Record<Id, Path> = {};
    for (const p of paths) m[p.id] = p;
    return m;
  }, [paths]);

  const mergeEvidenceList = React.useCallback((list: Evidence[]) => {
    setEvidenceMap((prev) => {
      const next = { ...prev };
      for (const ev of list) next[ev.id] = ev;
      return next;
    });
  }, []);

  const refreshCreditsAndPipeline = React.useCallback(async () => {
    const [cr, pl, mt] = await Promise.all([
      api.getCredits(),
      api.getPipeline(),
      api.getMetrics(),
    ]);
    setCredits(cr);
    setCards(pl);
    setMetrics(mt);
  }, []);

  const loadWorkspaceForFounder = React.useCallback(
    async (resolvedFounder: Founder) => {
      setFounder(resolvedFounder);
      setReplayNotice(null);

      const icpRes = await api.getIcp(resolvedFounder.id);
      setIcp(icpRes);

      const buyersParam =
        resolvedFounder.id === GOLDEN_FOUNDER_ID ? resolvedFounder.id : undefined;

      const [buyersRes, graphRes, pathsRes, kgRes, pipelineRes, metricsRes, creditsRes] =
        await Promise.all([
          api.getBuyers(buyersParam).catch(() => api.getBuyers()),
          api.getGraph(resolvedFounder.id).catch(() => api.getGraph()),
          api.getPaths(resolvedFounder.id).catch(() => api.getPaths()),
          api.getKnowledgeGraph(resolvedFounder.id).catch(() => null),
          api.getPipeline(),
          api.getMetrics(),
          api.getCredits(),
        ]);

      if (resolvedFounder.id !== GOLDEN_FOUNDER_ID) {
        setReplayNotice(
          `Live OpenAlex Intake, ICP, and computed Warm-Path Graph loaded for ${resolvedFounder.name}. Buyer why-now signals & pipeline cards show cached Lightmatter fixtures.`,
        );
      }

      setKnowledgeGraph(kgRes);
      setOrgs(buyersRes.orgs);
      setSignals(buyersRes.signals);
      setPeople(kgRes?.leads.people ?? graphRes.people);
      setGraphOrgs(kgRes?.leads.orgs ?? graphRes.orgs);
      setEdges(kgRes?.leads.edges ?? graphRes.edges);
      mergeEvidenceList(kgRes?.evidence ?? graphRes.evidence);
      setPaths(kgRes?.leads.paths ?? pathsRes);
      setCards(pipelineRes);
      setMetrics(metricsRes);
      setCredits(creditsRes);

      for (const eid of resolvedFounder.evidence_ids) {
        try {
          const ev = await api.getEvidence(eid);
          mergeEvidenceList([ev]);
        } catch {
          // ignore
        }
      }

      const activePaths = kgRes?.leads.paths ?? pathsRes;
      const topPath = [...activePaths].sort((a, b) => b.score - a.score)[0];
      setSelectedPathId(topPath ? topPath.id : null);
    },
    [mergeEvidenceList],
  );

  const boot = React.useCallback(async () => {
    setBooting(true);
    setApiOfflineError(null);
    try {
      const f = await api.intake({ query: "Nicholas C. Harris" });
      await loadWorkspaceForFounder(f);
    } catch (err) {
      setApiOfflineError(
        err instanceof Error
          ? `${err.message} (Verify FastAPI service is running at ${API_BASE})`
          : `Cannot reach FastAPI backend at ${API_BASE}`,
      );
    } finally {
      setBooting(false);
    }
  }, [loadWorkspaceForFounder]);

  React.useEffect(() => {
    void boot();
  }, [boot]);

  const handleIntakeQuery = async (query: string) => {
    setLoadingIntake(true);
    setIntakeError(null);
    try {
      const f = await api.intake({ query });
      await loadWorkspaceForFounder(f);
    } catch (err) {
      setIntakeError(err instanceof ApiError ? err.detail : "Intake lookup failed");
    } finally {
      setLoadingIntake(false);
    }
  };

  const handleIntakeForm = async (form: IntakeForm) => {
    setLoadingIntake(true);
    setIntakeError(null);
    try {
      const f = await api.intake(form);
      await loadWorkspaceForFounder(f);
    } catch (err) {
      setIntakeError(err instanceof ApiError ? err.detail : "Intake submission failed");
    } finally {
      setLoadingIntake(false);
    }
  };

  const openEvidence = React.useCallback((evidenceId: Id) => {
    setInspectorTarget({ evidenceId });
    setDrawerOpen(true);
  }, []);

  const openEdge = React.useCallback(
    (edgeId: Id) => {
      const edge = edgesMap[edgeId];
      setInspectorTarget({
        edgeId,
        evidenceId: edge?.evidence_ids?.[0] ?? null,
      });
      setDrawerOpen(true);
    },
    [edgesMap],
  );

  const openPerson = React.useCallback((personId: Id) => {
    setInspectorTarget({ personId });
    setDrawerOpen(true);
  }, []);

  const handleEdgeUpdated = React.useCallback((updated: Edge) => {
    setEdges((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }, []);

  const handleEvidenceLoaded = React.useCallback((ev: Evidence) => {
    setEvidenceMap((prev) => ({ ...prev, [ev.id]: ev }));
  }, []);

  const handleDraftsLoaded = React.useCallback((pathId: Id, list: Draft[]) => {
    setDraftsByPath((prev) => ({ ...prev, [pathId]: list }));
  }, []);

  const handleDraftUpdated = React.useCallback((updated: Draft) => {
    setDraftsByPath((prev) => {
      const list = prev[updated.path_id] ?? [];
      const exists = list.some((d) => d.id === updated.id);
      return {
        ...prev,
        [updated.path_id]: exists
          ? list.map((d) => (d.id === updated.id ? updated : d))
          : [...list, updated],
      };
    });
  }, []);

  return (
    <div className="db-grid-bg flex min-h-screen flex-col lg:flex-row">
      {/* LEFT NAVIGATION RAIL — STRICT FLAT LUCITE ONYX */}
      <aside className="flex w-full shrink-0 flex-col justify-between border-b border-white/20 bg-[#060709] lg:w-64 lg:border-b-0 lg:border-r">
        <div>
          <div className="border-b border-white/20 px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded border-2 border-sky-400 bg-[#0b2536] font-mono text-xs font-bold text-sky-200">
                  DB
                </div>
                <div>
                  <div className="text-sm font-bold tracking-tight">DEEPBRIDGE</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Onyx · Lucite · Flat
                  </div>
                </div>
              </div>
            </div>
          </div>

          <nav className="flex flex-row gap-1 overflow-x-auto p-3 lg:flex-col">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveScreen(item.key)}
                  className={`flex min-w-[165px] items-start gap-3 rounded border px-3 py-2.5 text-left transition lg:min-w-0 ${
                    isActive
                      ? "border-2 border-sky-400 bg-[#0b2536] text-white"
                      : "border-transparent text-muted-foreground hover:border-white/20 hover:bg-[#0f1117] hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${
                      isActive ? "text-sky-300" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-sky-300">{item.step}</span>
                      <span className="truncate text-xs font-semibold">{item.label}</span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {item.sub}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden border-t border-white/20 p-4 space-y-2.5 lg:block">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
            <ShieldCheck className="size-3.5" />
            <span>Stage Guardrails Active</span>
          </div>
          <ul className="space-y-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <li>• Every claim cites source URL</li>
            <li>• Affiliations carry &ldquo;as of&rdquo; date</li>
            <li>• Emails masked; 0 emails sent</li>
            <li>• Cached replay labeled honestly</li>
          </ul>
        </div>
      </aside>

      {/* MAIN WORKSPACE COLUMN — FLAT SOLID HEADER (NO FROSTED BLUR) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/20 bg-[#090a0d] px-6 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge flat className="border-white/25 bg-[#0f1117] font-mono text-[11px]">
              CASE: {founder ? `${founder.name} · ${founder.company}` : "Loading..."}
            </Badge>
            <Badge
              flat
              className="border-emerald-400/50 bg-[#07291e] font-mono text-[10px] text-emerald-200"
            >
              {founder?.id === GOLDEN_FOUNDER_ID
                ? "CACHED RESEARCH REPLAY"
                : "LIVE OPENALEX COMPUTED GRAPH"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveScreen("drafts")}
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs transition ${
                credits && credits.balance <= 0
                  ? "border-2 border-red-400 bg-[#2d0a0e] text-red-100"
                  : "border-amber-400/50 bg-[#2b1d05] text-amber-100 hover:border-amber-300"
              }`}
            >
              <Coins className="size-3.5 text-amber-300" />
              <span>CREDITS: {credits?.balance ?? "—"}</span>
              <span className="text-[10px] opacity-80">({credits?.source ?? "local"})</span>
            </button>

            <Button
              size="sm"
              flat
              onClick={() => {
                const defaultEv =
                  founder?.evidence_ids?.[0] ?? Object.keys(evidenceMap)[0] ?? null;
                setInspectorTarget({
                  personId: selectedPathId ? pathsMap[selectedPathId]?.bridge_id : null,
                  evidenceId: defaultEv,
                });
                setDrawerOpen(true);
              }}
              className="border border-white/25 font-mono text-xs"
            >
              <FileSearch className="size-3.5 text-sky-300" />
              Proof Drawer ({Object.keys(evidenceMap).length})
            </Button>

            <Button
              size="icon-sm"
              flat
              title="Reload state from FastAPI"
              onClick={() => void boot()}
              className="border border-white/25"
            >
              <RefreshCw className={`size-3.5 ${booting ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6">
          {apiOfflineError ? (
            <div className="mx-auto max-w-2xl rounded border-2 border-red-500/60 bg-[#2d0a0e] p-6 space-y-3 font-mono text-xs text-red-100">
              <div className="text-sm font-bold uppercase text-red-300">
                FastAPI Backend Unreachable
              </div>
              <p>{apiOfflineError}</p>
              <p className="text-muted-foreground">
                Start the backend with:{" "}
                <code>cd service && uv run uvicorn app.main:app --port 8000</code>
              </p>
              <Button size="sm" variant="default" flat onClick={() => void boot()}>
                Retry Connection
              </Button>
            </div>
          ) : booting ? (
            <div className="flex h-64 items-center justify-center font-mono text-xs text-muted-foreground">
              Loading cached Lightmatter research graph & provenance store...
            </div>
          ) : (
            <>
              {activeScreen === "intake" && (
                <ScreenIntake
                  founder={founder}
                  icp={icp}
                  evidenceMap={evidenceMap}
                  loadingIntake={loadingIntake}
                  intakeError={intakeError}
                  onSubmitQuery={handleIntakeQuery}
                  onSubmitForm={handleIntakeForm}
                  onInspectEvidence={openEvidence}
                  onEvidenceLoaded={mergeEvidenceList}
                  onGoToBuyers={() => setActiveScreen("buyers")}
                />
              )}

              {activeScreen === "buyers" && (
                <ScreenBuyers
                  founder={founder}
                  icp={icp}
                  orgs={orgs}
                  signals={signals}
                  paths={paths}
                  orgsMap={orgsMap}
                  evidenceMap={evidenceMap}
                  replayNotice={replayNotice}
                  onInspectEvidence={openEvidence}
                  onInspectPerson={openPerson}
                  onSelectOrgForPaths={(orgId) => {
                    setOrgFilterId(orgId);
                    if (orgId) {
                      const bestForOrg = paths
                        .filter((p) => p.buyer_org_id === orgId)
                        .sort((a, b) => b.score - a.score)[0];
                      if (bestForOrg) setSelectedPathId(bestForOrg.id);
                    }
                    setActiveScreen("leads");
                  }}
                />
              )}

              {activeScreen === "leads" && (
                <ScreenLeads
                  founder={founder}
                  icp={icp}
                  knowledgeGraph={knowledgeGraph}
                  paths={paths}
                  people={people}
                  orgs={orgs}
                  edges={edges}
                  signals={signals}
                  peopleMap={peopleMap}
                  orgsMap={orgsMap}
                  edgesMap={edgesMap}
                  signalsMap={signalsMap}
                  evidenceMap={evidenceMap}
                  selectedPathId={selectedPathId}
                  orgFilterId={orgFilterId}
                  onSelectPath={(pid) => setSelectedPathId(pid)}
                  onClearOrgFilter={() => setOrgFilterId(null)}
                  onInspectEvidence={openEvidence}
                  onInspectEdge={openEdge}
                  onInspectPerson={openPerson}
                  onEdgeUpdated={handleEdgeUpdated}
                  onDraftForPath={(pid) => {
                    setSelectedPathId(pid);
                    setActiveScreen("drafts");
                  }}
                />
              )}

              {activeScreen === "drafts" && (
                <ScreenDrafts
                  paths={paths}
                  selectedPathId={selectedPathId}
                  peopleMap={peopleMap}
                  orgsMap={orgsMap}
                  edgesMap={edgesMap}
                  evidenceMap={evidenceMap}
                  credits={credits}
                  draftsByPath={draftsByPath}
                  onSelectPath={(pid) => setSelectedPathId(pid)}
                  onDraftsLoaded={handleDraftsLoaded}
                  onDraftUpdated={handleDraftUpdated}
                  onRefreshCreditsAndPipeline={refreshCreditsAndPipeline}
                  onInspectEvidence={openEvidence}
                  onInspectPerson={openPerson}
                  onGoToPipeline={() => setActiveScreen("pipeline")}
                />
              )}

              {activeScreen === "pipeline" && (
                <ScreenPipeline
                  cards={cards}
                  metrics={metrics}
                  pathsMap={pathsMap}
                  peopleMap={peopleMap}
                  orgsMap={orgsMap}
                  onCardUpdated={refreshCreditsAndPipeline}
                  onOpenPathInDrafts={(pid) => {
                    setSelectedPathId(pid);
                    setActiveScreen("drafts");
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>

      <EvidenceDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        target={inspectorTarget}
        evidenceMap={evidenceMap}
        edgesMap={edgesMap}
        peopleMap={peopleMap}
        orgsMap={orgsMap}
        onSelectEvidence={openEvidence}
        onEdgeUpdated={handleEdgeUpdated}
        onEvidenceLoaded={handleEvidenceLoaded}
      />
    </div>
  );
}
