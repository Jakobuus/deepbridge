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
import { Button } from "@/components/ui/button";
import {
  API_BASE,
  ApiError,
  api,
  GOLDEN_FOUNDER_ID,
  HOPO_DISPLAY,
  HOPO_FOUNDER_ID,
  LIGHTMATTER_DISPLAY,
  resolveDemoCase,
} from "@/lib/api";
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

// HACK: /integrations/status shape not fixed yet; accept a list or a name-keyed object.
function parseIntegrations(data: unknown): { name: string; live: boolean; detail?: string }[] {
  const pretty: Record<string, string> = { band: "Band", flexprice: "Flexprice", moss: "Moss" };
  const isLive = (v: unknown): boolean => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return /ok|live|up|connected|active|true/i.test(v);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["live", "ok", "connected", "active", "up"]) if (typeof o[k] === "boolean") return o[k] as boolean;
      if (typeof o.status === "string") return isLive(o.status);
    }
    return false;
  };
  const detailOf = (v: unknown): string | undefined =>
    v && typeof v === "object" && typeof (v as Record<string, unknown>).detail === "string"
      ? ((v as Record<string, unknown>).detail as string)
      : undefined;
  const root =
    data && typeof data === "object" && "integrations" in (data as Record<string, unknown>)
      ? (data as Record<string, unknown>).integrations
      : data;
  const out: { name: string; live: boolean; detail?: string }[] = [];
  if (Array.isArray(root)) {
    for (const it of root) {
      if (!it || typeof it !== "object") continue;
      const name = String((it as Record<string, unknown>).name ?? "");
      if (name) out.push({ name: pretty[name.toLowerCase()] ?? name, live: isLive(it), detail: detailOf(it) });
    }
  } else if (root && typeof root === "object") {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      if (!(k.toLowerCase() in pretty)) continue;
      out.push({ name: pretty[k.toLowerCase()], live: isLive(v), detail: detailOf(v) });
    }
  }
  return out;
}

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

  // Integration live dots (GET /integrations/status). Missing endpoint → render nothing.
  const [integrations, setIntegrations] = React.useState<{ name: string; live: boolean; detail?: string }[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/integrations/status`);
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled) setIntegrations(parseIntegrations(data));
      } catch {
        // endpoint not there yet: show nothing
      }
    };
    void load();
    const t = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

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
    async (rawFounder: Founder) => {
      // HACK: OpenAlex has no affiliation for the HOPO scientist; show her lab.
      const resolvedFounder =
        rawFounder.id === HOPO_FOUNDER_ID && !rawFounder.company
          ? { ...rawFounder, company: "Berkeley Lab" }
          : rawFounder;
      setFounder(resolvedFounder);
      setReplayNotice(null);

      const icpRes = await api.getIcp(resolvedFounder.id);
      setIcp(icpRes);

      const buyersParam =
        resolvedFounder.id === GOLDEN_FOUNDER_ID || resolvedFounder.id === HOPO_FOUNDER_ID
          ? resolvedFounder.id
          : undefined;

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

      if (resolvedFounder.id !== GOLDEN_FOUNDER_ID && resolvedFounder.id !== HOPO_FOUNDER_ID) {
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
      const demoCase = await resolveDemoCase();
      const f = await api.intake({
        query: demoCase === "hopo" ? HOPO_DISPLAY.intakeQuery : LIGHTMATTER_DISPLAY.intakeQuery,
      });
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
      <aside className="flex w-full shrink-0 flex-col justify-between border-b border-white/10 bg-[#060709] lg:w-56 lg:border-b-0 lg:border-r">
        <div>
          <div className="px-5 py-5 text-sm font-semibold tracking-tight">DeepBridge</div>

          <nav className="flex flex-row gap-1 overflow-x-auto p-3 lg:flex-col">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveScreen(item.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-w-[150px] items-center gap-3 rounded-md px-3 py-2 text-left transition lg:min-w-0 ${
                    isActive
                      ? "bg-white/[0.07] text-white"
                      : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
                  }`}
                >
                  <Icon className={`size-4 shrink-0 ${isActive ? "text-sky-300" : "text-muted-foreground"}`} />
                  <div className="min-w-0 truncate text-sm">
                    <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{item.step}</span>
                    {item.label}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden p-5 text-[11px] leading-relaxed text-muted-foreground lg:block">
          Every claim cites a source. Nothing is sent without your approval.
        </div>
      </aside>

      {/* MAIN WORKSPACE COLUMN — FLAT SOLID HEADER (NO FROSTED BLUR) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#090a0d] px-6 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-sm font-medium">
              {founder
                ? founder.id === HOPO_FOUNDER_ID
                  ? `${HOPO_DISPLAY.name} · ${HOPO_DISPLAY.company}`
                  : `${founder.name} · ${founder.company}`
                : "Loading..."}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {founder?.id === HOPO_FOUNDER_ID
                ? `science: ${HOPO_DISPLAY.science} · cached research replay`
                : founder?.id === GOLDEN_FOUNDER_ID
                  ? "cached research replay"
                  : "live OpenAlex graph"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {integrations.length > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {integrations.map((it) => (
                  <span key={it.name} className="inline-flex items-center gap-1.5" title={it.detail ?? it.name}>
                    <span className={`size-1.5 rounded-full ${it.live ? "bg-emerald-400" : "bg-slate-600"}`} />
                    {it.name}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setActiveScreen("drafts")}
              title={`Credits metered by ${credits?.source ?? "local"}`}
              className={`inline-flex items-center gap-1.5 text-xs transition ${
                credits && credits.balance <= 0 ? "text-red-300" : "text-foreground hover:text-amber-200"
              }`}
            >
              <Coins className="size-3.5 text-amber-300" />
              <span>
                {credits?.source === "local" ? "Credits" : "Flexprice"} · {credits?.balance ?? "—"} credits
              </span>
            </button>

            <Button
              size="icon-sm"
              variant="ghost"
              flat
              title={`Sources (${Object.keys(evidenceMap).length})`}
              onClick={() => {
                const defaultEv =
                  founder?.evidence_ids?.[0] ?? Object.keys(evidenceMap)[0] ?? null;
                setInspectorTarget({
                  personId: selectedPathId ? pathsMap[selectedPathId]?.bridge_id : null,
                  evidenceId: defaultEv,
                });
                setDrawerOpen(true);
              }}
            >
              <FileSearch className="size-4" />
            </Button>

            <Button
              size="icon-sm"
              variant="ghost"
              flat
              title="Reload"
              onClick={() => void boot()}
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
              Loading cached research graph & provenance store...
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
