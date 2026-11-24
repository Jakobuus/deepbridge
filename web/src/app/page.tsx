"use client";

import {
  Building2,
  ChevronDown,
  Coins,
  FileSearch,
  FlaskConical,
  GitBranch,
  Kanban,
  MailCheck,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
import { Button } from "@/components/ui/button";
import {
  API_BASE,
  ApiError,
  api,
  DEMO_SESSION_ID,
  FALLBACK_SESSION_ID,
  GOLDEN_FOUNDER_ID,
  HOPO_FOUNDER_ID,
} from "@/lib/api";
import type {
  Briefing,
  BuyerCategory,
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
import { useGraphStream } from "@/lib/use-graph-stream";

type ScreenKey = "intake" | "buyers" | "leads" | "drafts" | "pipeline";

const NAV_ITEMS: {
  key: ScreenKey;
  step: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "intake", step: "01", label: "Intake", icon: FlaskConical },
  { key: "buyers", step: "02", label: "Buyers", icon: Building2 },
  { key: "leads", step: "03", label: "Graph", icon: GitBranch },
  { key: "drafts", step: "04", label: "Approve", icon: MailCheck },
  { key: "pipeline", step: "05", label: "Pipeline", icon: Kanban },
];

export default function DeepBridgeWorkspace() {
  const [activeScreen, setActiveScreen] = React.useState<ScreenKey>("intake");
  const [activeSessionId, setActiveSessionId] = React.useState<string>(DEMO_SESSION_ID);
  const [showGuardrails, setShowGuardrails] = React.useState(false);

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

  const mergeEvidenceList = React.useCallback((list: Evidence[]) => {
    setEvidenceMap((prev) => {
      const next = { ...prev };
      for (const ev of list) next[ev.id] = ev;
      return next;
    });
  }, []);

  // Assemble a complete KnowledgeGraph snapshot from real backend data even when
  // GET /knowledge-graph or cached value_map/categories aren't persisted yet for HOPO.
  const effectiveKnowledgeGraph = React.useMemo<KnowledgeGraph | null>(() => {
    if (!founder) return knowledgeGraph;
    const buyerOrgs = orgs.filter((o) => o.is_buyer);
    const derivedCategories: BuyerCategory[] = (icp?.industries ?? [])
      .slice(0, 4)
      .map((ind, idx) => ({
        id: `cat:derived:${idx + 1}`,
        name: ind.name,
        problem_set: icp?.needs?.[idx] ? [icp.needs[idx].text] : [ind.why],
        value_prop: ind.why,
        colour: `--cat-${idx + 1}`,
        org_ids: buyerOrgs
          .filter((_, oIdx) => oIdx % Math.max(1, Math.min(4, (icp?.industries ?? []).length)) === idx)
          .map((o) => o.id),
        problem_node_ids: [],
        evidence_ids: ind.evidence_ids,
      }));

    if (knowledgeGraph) {
      return {
        ...knowledgeGraph,
        categories:
          knowledgeGraph.categories.length > 0 ? knowledgeGraph.categories : derivedCategories,
      };
    }

    const allOrgsMap = new Map<Id, Org>();
    for (const o of graphOrgs) allOrgsMap.set(o.id, o);
    for (const o of orgs) allOrgsMap.set(o.id, o);

    return {
      founder,
      core: {
        value_nodes: (icp?.needs ?? []).slice(0, 6).map((n, i) => ({
          id: `vn:icp:${i + 1}`,
          kind: "problem" as const,
          text: n.text,
          source: "paper" as const,
          evidence_ids: n.evidence_ids,
        })),
        edges: [],
      },
      categories: derivedCategories,
      leads: {
        people,
        orgs: Array.from(allOrgsMap.values()),
        edges,
        paths,
        signals,
      },
      evidence: Object.values(evidenceMap),
    };
  }, [founder, knowledgeGraph, icp, orgs, graphOrgs, people, edges, paths, signals, evidenceMap]);

  const graphStream = useGraphStream(effectiveKnowledgeGraph, mergeEvidenceList);

  const mergedPeople = React.useMemo(() => {
    const map = new Map<Id, Person>();
    for (const p of people) map.set(p.id, p);
    for (const p of graphStream.streamedPeople) map.set(p.id, p);
    return Array.from(map.values());
  }, [people, graphStream.streamedPeople]);

  const mergedEdges = React.useMemo(() => {
    const map = new Map<Id, Edge>();
    for (const e of edges) map.set(e.id, e);
    for (const e of graphStream.streamedEdges) map.set(e.id, e);
    return Array.from(map.values());
  }, [edges, graphStream.streamedEdges]);

  const mergedPaths = React.useMemo(() => {
    const map = new Map<Id, Path>();
    for (const p of paths) map.set(p.id, p);
    for (const p of graphStream.streamedPaths) map.set(p.id, p);
    return Array.from(map.values());
  }, [paths, graphStream.streamedPaths]);

  const peopleMap = React.useMemo(() => {
    const m: Record<Id, Person> = {};
    for (const p of mergedPeople) m[p.id] = p;
    return m;
  }, [mergedPeople]);

  const orgsMap = React.useMemo(() => {
    const m: Record<Id, Org> = {};
    for (const o of graphOrgs) m[o.id] = o;
    for (const o of orgs) m[o.id] = o;
    for (const o of graphStream.streamedOrgs) m[o.id] = o;
    return m;
  }, [graphOrgs, orgs, graphStream.streamedOrgs]);

  const edgesMap = React.useMemo(() => {
    const m: Record<Id, Edge> = {};
    for (const e of mergedEdges) m[e.id] = e;
    return m;
  }, [mergedEdges]);

  const signalsMap = React.useMemo(() => {
    const m: Record<Id, Signal> = {};
    for (const s of signals) m[s.id] = s;
    return m;
  }, [signals]);

  const pathsMap = React.useMemo(() => {
    const m: Record<Id, Path> = {};
    for (const p of mergedPaths) m[p.id] = p;
    return m;
  }, [mergedPaths]);

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
    async (resolvedFounder: Founder, sessionOverride?: string) => {
      setFounder(resolvedFounder);
      setReplayNotice(null);
      if (sessionOverride) {
        setActiveSessionId(sessionOverride);
      } else if (resolvedFounder.id === HOPO_FOUNDER_ID) {
        setActiveSessionId(DEMO_SESSION_ID);
      } else if (resolvedFounder.id === GOLDEN_FOUNDER_ID) {
        setActiveSessionId(FALLBACK_SESSION_ID);
      }

      const icpRes = await api.getIcp(resolvedFounder.id);
      setIcp(icpRes);

      const [buyersRes, graphRes, pathsRes, kgRes, pipelineRes, metricsRes, creditsRes] =
        await Promise.all([
          api.getBuyers(resolvedFounder.id).catch(() => api.getBuyers()),
          api.getGraph(resolvedFounder.id).catch(() => api.getGraph()),
          api.getPaths(resolvedFounder.id).catch(() => api.getPaths()),
          api.getKnowledgeGraph(resolvedFounder.id).catch(() => null),
          api.getPipeline(),
          api.getMetrics(),
          api.getCredits(),
        ]);

      if (resolvedFounder.id === HOPO_FOUNDER_ID) {
        setReplayNotice(
          "Hannah Weber · HOPO Therapeutics — research graph grounded in Rebecca J. Abergel's group at Lawrence Berkeley National Lab (OpenAlex A5043992375).",
        );
      } else if (resolvedFounder.id !== GOLDEN_FOUNDER_ID) {
        setReplayNotice(
          `Computed live OpenAlex graph & buyers for ${resolvedFounder.name}. Pipeline stages reflect cached demo history.`,
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

  const bootCase = React.useCallback(
    async (query: string, sessionId: string) => {
      setBooting(true);
      setApiOfflineError(null);
      try {
        const f = await api.intake({ query });
        await loadWorkspaceForFounder(f, sessionId);
      } catch {
        // Fallback to Lightmatter if HOPO cache isn't loaded yet on local server
        try {
          const fallback = await api.intake({ query: "Nicholas C. Harris" });
          await loadWorkspaceForFounder(fallback, FALLBACK_SESSION_ID);
        } catch (err) {
          setApiOfflineError(
            err instanceof Error
              ? `${err.message} (Verify FastAPI service is running at ${API_BASE})`
              : `Cannot reach FastAPI backend at ${API_BASE}`,
          );
        }
      } finally {
        setBooting(false);
      }
    },
    [loadWorkspaceForFounder],
  );

  React.useEffect(() => {
    void bootCase("Rebecca J. Abergel", DEMO_SESSION_ID);
  }, [bootCase]);

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

  const handleBriefingCreated = React.useCallback(
    (brief: Briefing) => {
      setActiveSessionId(brief.session_id);
      graphStream.connectLiveSession(brief.session_id);
    },
    [graphStream],
  );

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

  const isHopo = founder?.id === HOPO_FOUNDER_ID;

  return (
    <div className="db-grid-bg flex min-h-screen flex-col lg:flex-row">
      {/* SLIM FLAT LEFT NAVIGATION RAIL */}
      <aside className="flex w-full shrink-0 flex-col justify-between border-b border-white/15 bg-[#060709] lg:w-56 lg:border-b-0 lg:border-r">
        <div>
          <div className="border-b border-white/15 px-5 py-5">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center border border-sky-400 bg-[#0b2536] font-mono text-xs font-bold text-sky-200">
                DB
              </div>
              <span className="text-base font-bold tracking-tight text-white">DEEPBRIDGE</span>
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
                  className={`relative flex min-w-[130px] items-center gap-3 px-3.5 py-3 text-left text-base font-medium transition-colors lg:min-w-0 ${
                    isActive
                      ? "bg-[#0b2536] text-white font-semibold"
                      : "text-muted-foreground hover:bg-[#0f1117] hover:text-white"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="db-active-nav"
                      className="absolute inset-y-0 left-0 w-0.5 bg-sky-400"
                    />
                  )}
                  <Icon className={`size-4 shrink-0 ${isActive ? "text-sky-300" : ""}`} />
                  <span className="font-mono text-xs text-sky-400/80">{item.step}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* PROGRESSIVE DISCLOSURE: COLLAPSED GUARDRAILS AT RAIL FOOTER */}
        <div className="hidden border-t border-white/15 p-4 lg:block">
          <button
            type="button"
            onClick={() => setShowGuardrails((v) => !v)}
            className="flex w-full items-center justify-between font-mono text-xs uppercase tracking-wider text-emerald-300 hover:text-white"
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" />
              <span>Guardrails</span>
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform ${showGuardrails ? "rotate-180" : ""}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {showGuardrails && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden pt-2.5 space-y-1 font-mono text-[11px] text-muted-foreground"
              >
                <li>• Cited source URL on every claim</li>
                <li>• Dated &ldquo;as of&rdquo; affiliations</li>
                <li>• Masked emails; 0 auto-sends</li>
                <li>• Cached replay labeled</li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </aside>

      {/* MAIN FLAT WORKSPACE */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/15 bg-[#090a0d] px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-white">
              {isHopo
                ? "Hannah Weber · HOPO Therapeutics"
                : founder
                  ? founder.name
                  : "Loading…"}
              {isHopo ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  (Berkeley Lab · R. Abergel)
                </span>
              ) : founder?.company ? (
                <span className="ml-2 text-muted-foreground font-normal">
                  · {founder.company}
                </span>
              ) : null}
            </span>

            {/* 1-CLICK DEMO CASE SWITCHER: HOPO (CANONICAL) <-> LIGHTMATTER (FALLBACK) */}
            <div className="inline-flex border border-white/15 bg-[#0f1117] font-mono text-[11px]">
              <button
                type="button"
                onClick={() => void bootCase("Rebecca J. Abergel", DEMO_SESSION_ID)}
                className={`px-2.5 py-1 transition-colors ${
                  isHopo ? "bg-sky-400 text-[#04131d] font-bold" : "text-muted-foreground hover:text-white"
                }`}
              >
                demo-hopo
              </button>
              <button
                type="button"
                onClick={() => void bootCase("Nicholas C. Harris", FALLBACK_SESSION_ID)}
                className={`px-2.5 py-1 transition-colors ${
                  founder?.id === GOLDEN_FOUNDER_ID
                    ? "bg-sky-400 text-[#04131d] font-bold"
                    : "text-muted-foreground hover:text-white"
                }`}
              >
                demo-lightmatter
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveScreen("leads");
                void graphStream.startReplay(8, activeSessionId);
              }}
              className="inline-flex items-center gap-1.5 border border-sky-400/40 bg-[#0b2536] px-3 py-1.5 font-mono text-xs font-medium text-sky-200 transition-colors hover:border-sky-300 hover:text-white"
            >
              <Play className="size-3 text-sky-300" />
              <span>Replay 8×</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveScreen("drafts")}
              className={`inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs transition-colors ${
                credits && credits.balance <= 0
                  ? "border-red-400 bg-[#2d0a0e] text-red-100"
                  : "border-white/20 bg-[#0f1117] text-amber-200 hover:border-amber-300"
              }`}
            >
              <Coins className="size-3.5 text-amber-300" />
              <span>{credits?.balance ?? "—"} cr</span>
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
              className="border border-white/20 bg-[#0f1117] font-mono text-xs"
            >
              <FileSearch className="size-3.5 text-sky-300" />
              Sources ({Object.keys(evidenceMap).length})
            </Button>

            <Button
              size="icon-sm"
              flat
              title="Reset & reload workspace"
              onClick={() => void bootCase("Rebecca J. Abergel", DEMO_SESSION_ID)}
              className="border border-white/20 bg-[#0f1117]"
            >
              <RefreshCw className={`size-3.5 ${booting ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6 sm:px-8">
          {apiOfflineError ? (
            <div className="mx-auto max-w-2xl border-2 border-red-500/60 bg-[#2d0a0e] p-6 space-y-3 font-mono text-sm text-red-100">
              <div className="font-bold uppercase text-red-300">FastAPI Backend Offline</div>
              <p>{apiOfflineError}</p>
              <Button
                size="sm"
                variant="default"
                flat
                onClick={() => void bootCase("Rebecca J. Abergel", DEMO_SESSION_ID)}
              >
                Retry Connection
              </Button>
            </div>
          ) : booting ? (
            <div className="flex h-64 items-center justify-center font-mono text-sm text-muted-foreground">
              Loading research graph…
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeScreen}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                {activeScreen === "intake" && (
                  <ScreenIntake
                    founder={founder}
                    icp={icp}
                    activeSessionId={activeSessionId}
                    valueNodes={
                      effectiveKnowledgeGraph?.core.value_nodes ?? graphStream.streamedValueNodes
                    }
                    evidenceMap={evidenceMap}
                    loadingIntake={loadingIntake}
                    intakeError={intakeError}
                    onSubmitQuery={handleIntakeQuery}
                    onSubmitForm={handleIntakeForm}
                    onInspectEvidence={openEvidence}
                    onEvidenceLoaded={mergeEvidenceList}
                    onBriefingCreated={handleBriefingCreated}
                    onGoToLeads={() => setActiveScreen("leads")}
                    onGoToBuyers={() => setActiveScreen("buyers")}
                  />
                )}

                {activeScreen === "buyers" && (
                  <ScreenBuyers
                    founder={founder}
                    icp={icp}
                    orgs={orgs}
                    signals={signals}
                    paths={mergedPaths}
                    orgsMap={orgsMap}
                    evidenceMap={evidenceMap}
                    replayNotice={replayNotice}
                    onInspectEvidence={openEvidence}
                    onInspectPerson={openPerson}
                    onSelectOrgForPaths={(orgId) => {
                      setOrgFilterId(orgId);
                      if (orgId) {
                        const bestForOrg = mergedPaths
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
                    knowledgeGraph={effectiveKnowledgeGraph}
                    graphStream={graphStream}
                    activeSessionId={activeSessionId}
                    paths={mergedPaths}
                    people={mergedPeople}
                    orgs={orgs}
                    edges={mergedEdges}
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
                    paths={mergedPaths}
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
              </motion.div>
            </AnimatePresence>
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
