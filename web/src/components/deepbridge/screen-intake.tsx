"use client";

import {
  ArrowRight,
  ChevronDown,
  FileText,
  Globe,
  Link2,
  Mic,
  MicOff,
  Play,
  Send,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, DEMO_SESSION_ID, HOPO_FOUNDER_ID } from "@/lib/api";
import type {
  Briefing,
  ConnectorStatus,
  Evidence,
  Founder,
  Icp,
  Id,
  IntakeForm,
  InterviewResponse,
  ValueNode,
} from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

interface ScreenIntakeProps {
  founder: Founder | null;
  icp: Icp | null;
  activeSessionId: string;
  valueNodes: ValueNode[];
  evidenceMap: Record<Id, Evidence>;
  loadingIntake: boolean;
  intakeError: string | null;
  onSubmitQuery: (query: string) => Promise<void>;
  onSubmitForm: (form: IntakeForm) => Promise<void>;
  onInspectEvidence: (evidenceId: Id) => void;
  onEvidenceLoaded: (list: Evidence[]) => void;
  onBriefingCreated?: (briefing: Briefing) => void;
  onGoToLeads: () => void;
  onGoToBuyers: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function withSessionParam(rawUrl: string, sessionId: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.includes("session=")) return trimmed;
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}session=${encodeURIComponent(sessionId)}`;
}

export function ScreenIntake({
  founder,
  icp,
  activeSessionId,
  valueNodes,
  evidenceMap,
  loadingIntake,
  intakeError,
  onSubmitQuery,
  onSubmitForm,
  onInspectEvidence,
  onEvidenceLoaded,
  onBriefingCreated,
  onGoToLeads,
  onGoToBuyers,
}: ScreenIntakeProps) {
  const isHopo = founder?.id === HOPO_FOUNDER_ID || activeSessionId === DEMO_SESSION_ID;

  const [name, setName] = React.useState("Hannah Weber");
  const [paperLinksRaw, setPaperLinksRaw] = React.useState(
    "https://doi.org/10.1021/jm500389b, https://doi.org/10.1039/c7nj04559j, https://doi.org/10.1021/acs.inorgchem.8b02430",
  );
  const [startupUrl, setStartupUrl] = React.useState("https://hopotx.com");
  const [expertise, setExpertise] = React.useState(
    "Oral hydroxypyridinonate (3,4,3-LI(1,2-HOPO)) chelators for heavy metal & radionuclide decorporation, 89Zr PET imaging, and MRI gadolinium clearance",
  );
  const [customerPersona, setCustomerPersona] = React.useState(
    "Radiopharmaceutical R&D leads, BARDA/defense medical countermeasure buyers, MRI contrast safety teams, and heavy-metal therapeutics leaders",
  );
  const [notes, setNotes] = React.useState("");

  // Sync form presets when switching between demo-hopo and demo-lightmatter
  React.useEffect(() => {
    if (founder?.id === HOPO_FOUNDER_ID) {
      setName("Hannah Weber");
      setStartupUrl("https://hopotx.com");
      setPaperLinksRaw(
        "https://doi.org/10.1021/jm500389b, https://doi.org/10.1039/c7nj04559j, https://doi.org/10.1021/acs.inorgchem.8b02430",
      );
      setExpertise(
        "Oral hydroxypyridinonate (3,4,3-LI(1,2-HOPO)) chelators for heavy metal & radionuclide decorporation, 89Zr PET imaging, and MRI gadolinium clearance",
      );
      setCustomerPersona(
        "Radiopharmaceutical R&D leads, BARDA/defense medical countermeasure buyers, MRI contrast safety teams, and heavy-metal therapeutics leaders",
      );
    } else if (founder?.name === "Nicholas C. Harris") {
      setName("Nicholas C. Harris");
      setStartupUrl("https://lightmatter.co");
      setPaperLinksRaw("https://doi.org/10.1038/nphoton.2017.93");
      setExpertise(
        "Coherent nanophotonic circuits, silicon photonics, and optical interconnects for AI compute clusters",
      );
      setCustomerPersona(
        "Hyperscale AI infrastructure, optical interconnect architecture, and silicon photonics R&D leads",
      );
    }
  }, [founder?.id, founder?.name]);

  // Progressive disclosure toggles
  const [showExtraInputs, setShowExtraInputs] = React.useState(false);
  const [showBriefClaims, setShowBriefClaims] = React.useState(false);
  const [showValueMap, setShowValueMap] = React.useState(false);

  // Connectors (Notion & Google Drive — GET /connectors, POST /connectors/{id}/fetch)
  const [connectors, setConnectors] = React.useState<ConnectorStatus[]>([
    {
      id: "notion",
      name: "Notion",
      connected: false,
      setup: "Set NOTION_TOKEN and share the page with the integration.",
    },
    {
      id: "gdrive",
      name: "Google Drive",
      connected: false,
      setup: "Set GDRIVE_SA_FILE or paste a public Google Docs URL.",
    },
  ]);
  const [activeConnector, setActiveConnector] = React.useState<"notion" | "gdrive" | null>(null);
  const [connectorUrl, setConnectorUrl] = React.useState("");
  const [connectorMsg, setConnectorMsg] = React.useState<string | null>(null);
  const [connectorBusy, setConnectorBusy] = React.useState(false);

  // Briefing + Live Interview state
  const [briefing, setBriefing] = React.useState<Briefing | null>(null);
  const [briefingBusy, setBriefingBusy] = React.useState(false);
  const [interviewState, setInterviewState] = React.useState<InterviewResponse | null>(null);
  const [interviewAnswer, setInterviewAnswer] = React.useState("");
  const [interviewBusy, setInterviewBusy] = React.useState(false);
  const [interviewErr, setInterviewErr] = React.useState<string | null>(null);
  const [listening, setListening] = React.useState(false);
  const [voiceReadback, setVoiceReadback] = React.useState(true);
  const [hostedVoiceUrl, setHostedVoiceUrl] = React.useState(
    process.env.NEXT_PUBLIC_VOICE_APP_URL ?? "",
  );
  const [showHostedEmbed, setShowHostedEmbed] = React.useState(
    Boolean(process.env.NEXT_PUBLIC_VOICE_APP_URL),
  );

  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => {
    api
      .getConnectors()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setConnectors(list);
      })
      .catch(() => {
        // keep default offline connector status
      });
  }, []);

  // Preload cached grounded briefing fixture when available (e.g. demo-hopo)
  React.useEffect(() => {
    api
      .getBriefing(activeSessionId)
      .then((b) => setBriefing(b))
      .catch(() => {
        // no pre-cached briefing for this session yet
      });
  }, [activeSessionId]);

  const speakQuestion = React.useCallback(
    (text: string | null | undefined) => {
      if (!voiceReadback || !text || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    },
    [voiceReadback],
  );

  const parseLinks = () =>
    paperLinksRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleReadSourcesAndStart = async () => {
    setBriefingBusy(true);
    setInterviewBusy(true);
    setInterviewErr(null);
    const links = parseLinks();
    try {
      const briefPromise = briefing
        ? Promise.resolve(briefing)
        : api
            .createBriefing({
              founder_name: name.trim() || "Hannah Weber",
              startup_name: isHopo ? "HOPO Therapeutics" : founder?.company || "Startup",
              paper_links: links,
              website: startupUrl.trim() || undefined,
              notes: notes.trim() || undefined,
              mode: "stage",
            })
            .catch(() => null);

      const interviewPromise = api.interview({
        paper_links: links,
        founder_id: founder?.id ?? null,
      });

      const [briefRes, intRes] = await Promise.all([briefPromise, interviewPromise]);
      if (briefRes) {
        setBriefing(briefRes);
        onBriefingCreated?.(briefRes);
      }
      setInterviewState(intRes);
      if (intRes.paper_evidence?.length) {
        onEvidenceLoaded(intRes.paper_evidence);
      }
      speakQuestion(intRes.question);
    } catch (err) {
      setInterviewErr(err instanceof Error ? err.message : "Could not start interview");
    } finally {
      setBriefingBusy(false);
      setInterviewBusy(false);
    }
  };

  const sendInterviewTurn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!interviewState || !interviewAnswer.trim()) return;
    const answerText = interviewAnswer.trim();
    setInterviewBusy(true);
    setInterviewErr(null);
    try {
      if (briefing?.session_id) {
        void api
          .submitInterviewTurn({
            session_id: briefing.session_id,
            role: "founder",
            text: answerText,
          })
          .catch(() => null);
      }

      const res = await api.interview({
        session_id: interviewState.session_id,
        answer: answerText,
      });
      setInterviewState(res);
      setInterviewAnswer("");
      if (res.paper_evidence?.length) {
        onEvidenceLoaded(res.paper_evidence);
      }
      if (res.form.name) setName(res.form.name);
      if (res.form.expertise) setExpertise(res.form.expertise);
      if (res.form.customer_persona) setCustomerPersona(res.form.customer_persona);
      if (res.form.startup_url) setStartupUrl(res.form.startup_url);
      if (res.question) speakQuestion(res.question);
    } catch (err) {
      setInterviewErr(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setInterviewBusy(false);
    }
  };

  const toggleMic = () => {
    if (typeof window === "undefined") return;
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setInterviewErr("Browser speech recognition unavailable — type your answer below.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const chunks: string[] = [];
      for (let i = 0; i < ev.results.length; i++) {
        chunks.push(ev.results[i][0].transcript);
      }
      setInterviewAnswer(chunks.join(" "));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const handleFetchConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnector || !connectorUrl.trim()) return;
    setConnectorBusy(true);
    setConnectorMsg(null);
    try {
      const doc = await api.fetchConnector(activeConnector, connectorUrl.trim());
      setNotes((prev) => `${prev ? `${prev}\n\n` : ""}[${doc.title}] ${doc.text.slice(0, 800)}`);
      setConnectorMsg(`Imported "${doc.title}" into founder notes.`);
      setConnectorUrl("");
    } catch (err) {
      setConnectorMsg(err instanceof ApiError ? err.detail : "Connector requires setup.");
    } finally {
      setConnectorBusy(false);
    }
  };

  const handleFormSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await onSubmitForm({
      name: isHopo && name.trim() === "Hannah Weber" ? "Rebecca J. Abergel" : name.trim(),
      expertise: expertise.trim(),
      paper_links: parseLinks(),
      startup_url: startupUrl.trim() || null,
      customer_persona: customerPersona.trim(),
      interview_transcript: notes.trim() || null,
    });
  };

  const vp = interviewState?.value_proposition;
  const activeConnectorInfo = connectors.find((c) => c.id === activeConnector) ?? null;
  const resolvedVoiceIframeSrc = withSessionParam(hostedVoiceUrl, activeSessionId);

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-2">
      {/* SECTION 1: CLEAN LARGE-TYPE FOUNDER & PAPER INPUT */}
      <section className="grid grid-cols-1 gap-10 border-b border-white/15 pb-10 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-6">
          <div className="space-y-2">
            <div className="font-mono text-xs uppercase tracking-widest text-sky-400">
              01 · Research Intake
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Drop a paper. Find the R&amp;D buyer.
            </h1>
            <p className="text-base text-muted-foreground">
              DeepBridge reads your research, sharpens the commercial value proposition by voice, and traces cited warm paths.
            </p>
          </div>

          <form onSubmit={(e) => void handleFormSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Founder
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Hannah Weber"
                  className="h-11 border-white/20 bg-[#0f1117] text-base font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Startup Website
                </label>
                <Input
                  value={startupUrl}
                  onChange={(e) => setStartupUrl(e.target.value)}
                  placeholder="https://hopotx.com"
                  className="h-11 border-white/20 bg-[#0f1117] font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Paper Links (DOI / arXiv / OpenAlex)
              </label>
              <Input
                value={paperLinksRaw}
                onChange={(e) => setPaperLinksRaw(e.target.value)}
                placeholder="https://doi.org/10.1021/jm500389b"
                className="h-11 border-white/20 bg-[#0f1117] font-mono text-sm"
              />
            </div>

            {/* CONNECT NOTION / GOOGLE DRIVE + MORE CONTEXT TOGGLE */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {connectors.map((conn) => {
                const selected = activeConnector === conn.id;
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => {
                      setActiveConnector(selected ? null : conn.id);
                      setConnectorMsg(null);
                    }}
                    className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-medium transition-colors ${
                      selected
                        ? "border-sky-400 bg-[#0b2536] text-white"
                        : "border-white/15 bg-[#0f1117] text-foreground hover:border-white/35"
                    }`}
                  >
                    <span
                      className={`size-2 rounded-full ${
                        conn.connected ? "bg-emerald-400" : "bg-amber-400/80"
                      }`}
                    />
                    <span>Connect {conn.name}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setShowExtraInputs((v) => !v)}
                className="ml-auto inline-flex items-center gap-1.5 px-2 py-2 font-mono text-xs text-muted-foreground transition-colors hover:text-white"
              >
                <SlidersHorizontal className="size-3.5" />
                <span>{showExtraInputs ? "Hide options" : "More options"}</span>
                <ChevronDown
                  className={`size-3.5 transition-transform ${showExtraInputs ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {/* CONNECTOR DRAWER (PROGRESSIVE DISCLOSURE) */}
            <AnimatePresence initial={false}>
              {activeConnectorInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 border border-white/15 bg-[#0f1117] p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-white">
                        {activeConnectorInfo.name}{" "}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {activeConnectorInfo.connected ? "● Connected" : "○ Not connected"}
                        </span>
                      </span>
                    </div>
                    {!activeConnectorInfo.connected && (
                      <p className="font-mono text-xs text-amber-200/90">
                        {activeConnectorInfo.setup}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Input
                        value={connectorUrl}
                        onChange={(e) => setConnectorUrl(e.target.value)}
                        placeholder={
                          activeConnectorInfo.id === "notion"
                            ? "Paste Notion page URL…"
                            : "Paste public Google Doc URL…"
                        }
                        className="h-9 flex-1 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        flat
                        disabled={connectorBusy || !connectorUrl.trim()}
                        onClick={(e) => void handleFetchConnector(e)}
                        className="border border-white/25"
                      >
                        <Link2 className="size-3.5" />
                        {connectorBusy ? "Fetching…" : "Import"}
                      </Button>
                    </div>
                    {connectorMsg && (
                      <div className="font-mono text-xs text-sky-300">{connectorMsg}</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* EXTRA CONTEXT & QUICK FOUNDER SWITCH (HIDDEN BY DEFAULT) */}
            <AnimatePresence initial={false}>
              {showExtraInputs && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-white/10 pt-3">
                    <div className="space-y-1">
                      <label className="font-mono text-xs uppercase text-muted-foreground">
                        Technical Domain
                      </label>
                      <Input
                        value={expertise}
                        onChange={(e) => setExpertise(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-mono text-xs uppercase text-muted-foreground">
                        Target Buyer Persona Hypothesis
                      </label>
                      <Input
                        value={customerPersona}
                        onChange={(e) => setCustomerPersona(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="font-mono text-xs text-muted-foreground">Quick switch:</span>
                      {[
                        { label: "HOPO (Abergel)", query: "Rebecca J. Abergel" },
                        { label: "Lightmatter (Harris)", query: "Nicholas C. Harris" },
                        { label: "Dirk Englund", query: "Dirk Englund" },
                      ].map((preset) => (
                        <button
                          key={preset.query}
                          type="button"
                          onClick={() => {
                            void onSubmitQuery(preset.query);
                          }}
                          className="border border-white/15 bg-[#0f1117] px-2.5 py-1 font-mono text-xs text-muted-foreground hover:border-sky-400 hover:text-white"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {intakeError && (
              <div className="border-l-2 border-red-400 bg-red-950/30 px-3 py-2 font-mono text-xs text-red-200">
                {intakeError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                variant="default"
                flat
                disabled={briefingBusy || interviewBusy}
                onClick={() => void handleReadSourcesAndStart()}
                className="h-12 px-6 text-base font-semibold"
              >
                <Mic className="size-4" />
                {briefingBusy ? "Reading Paper…" : "Read Paper & Start Voice Interview"}
              </Button>

              <Button
                type="submit"
                flat
                disabled={loadingIntake}
                className="h-12 border border-white/25 bg-[#0f1117] px-5 text-sm font-medium hover:border-white/50"
              >
                {loadingIntake ? "Resolving…" : "Resolve Graph Directly"}
              </Button>
            </div>
          </form>
        </div>

        {/* RIGHT: LIVE VOICE INTERVIEW / BRIEFING PANEL */}
        <div className="flex flex-col justify-between border border-white/15 bg-[#0f1117] p-6 lg:col-span-6">
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                {/* Minimal flat animated voice orb */}
                <motion.div
                  animate={
                    listening || interviewBusy
                      ? { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }
                      : { scale: 1, opacity: 0.9 }
                  }
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  className={`size-4 rounded-full border ${
                    listening
                      ? "border-red-300 bg-red-400"
                      : interviewState || briefing
                        ? "border-sky-300 bg-sky-400"
                        : "border-white/30 bg-white/20"
                  }`}
                />
                <span className="text-lg font-semibold text-white">
                  {showHostedEmbed ? `Live Voice (${activeSessionId})` : "Stage Voice Interview"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {interviewState && (
                  <Badge flat className="border-white/15 bg-black/40 font-mono text-xs text-sky-300">
                    {interviewState.ms.toFixed(0)}ms · {interviewState.engine}
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => setVoiceReadback((v) => !v)}
                  title="Toggle spoken voice readback"
                  className="border border-white/15 p-2 text-muted-foreground transition-colors hover:border-white/40 hover:text-white"
                >
                  {voiceReadback ? <Volume2 className="size-4 text-sky-300" /> : <VolumeX className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHostedEmbed((v) => !v)}
                  title="Switch between embedded voice app and local stage interview"
                  className="border border-white/15 px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-white/40 hover:text-white"
                >
                  <Globe className="inline size-3.5 mr-1" />
                  {showHostedEmbed ? "Local Mode" : "Embed App"}
                </button>
              </div>
            </div>

            {showHostedEmbed ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={hostedVoiceUrl}
                    onChange={(e) => setHostedVoiceUrl(e.target.value)}
                    placeholder={`Paste hosted live-voice app URL (appends ?session=${activeSessionId})…`}
                    className="font-mono text-xs"
                  />
                </div>
                {resolvedVoiceIframeSrc ? (
                  <iframe
                    src={resolvedVoiceIframeSrc}
                    title="DeepBridge Live Voice Interview"
                    allow="microphone; autoplay"
                    className="h-[340px] w-full border border-white/15 bg-black"
                  />
                ) : (
                  <div className="flex h-[260px] items-center justify-center border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground">
                    Paste the hosted Lovable voice URL above (uses ?session={activeSessionId}), or switch to Local Mode for instant speech + text grilling.
                  </div>
                )}
              </div>
            ) : !interviewState && !briefing ? (
              <div className="flex min-h-[240px] flex-col justify-center space-y-4 py-6">
                <p className="text-xl font-medium leading-relaxed text-white/90">
                  &ldquo;I&apos;ll read your paper abstract, confirm what the prototype proves, and ask the 3 buyer questions the paper leaves open.&rdquo;
                </p>
                <div>
                  <Button
                    type="button"
                    variant="default"
                    flat
                    disabled={interviewBusy}
                    onClick={() => void handleReadSourcesAndStart()}
                    className="h-11 px-5 text-sm font-semibold"
                  >
                    <Play className="size-4" />
                    Start Stage Mode (~60s)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* BRIEFING ONE-LINER + EXPANDABLE CLAIMS */}
                {briefing && (
                  <div className="border-l-2 border-sky-400 pl-4 space-y-2.5">
                    <div className="text-base leading-relaxed text-white/95">
                      {briefing.understanding}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowBriefClaims((v) => !v)}
                        className="font-mono text-xs text-sky-300 hover:underline"
                      >
                        {showBriefClaims
                          ? "Hide extracted claims & gaps"
                          : `Show ${briefing.claims.length} claims & ${briefing.gaps.length} open gaps`}
                      </button>
                      {!interviewState && (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          flat
                          disabled={interviewBusy}
                          onClick={() => void handleReadSourcesAndStart()}
                          className="h-8 px-3 text-xs font-semibold"
                        >
                          <Play className="size-3.5" />
                          Ask {briefing.gaps.length} Open Gaps
                        </Button>
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {showBriefClaims && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-1.5 pt-1 text-xs text-muted-foreground"
                        >
                          {briefing.gaps.map((g, idx) => (
                            <div key={idx} className="text-amber-200/90">
                              • Gap: {g}
                            </div>
                          ))}
                          {briefing.claims.slice(0, 4).map((c, idx) => (
                            <div key={idx}>• {c.text}</div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* BIG STAGE-LEGIBLE INTERVIEWER QUESTION */}
                {interviewState?.question && !interviewState.done && (
                  <motion.div
                    key={interviewState.question}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3 py-2"
                  >
                    <div className="font-mono text-xs uppercase tracking-wider text-sky-400">
                      {listening ? "● Listening to founder…" : "Interviewer"}
                    </div>
                    <div className="text-xl font-semibold leading-snug text-white sm:text-2xl">
                      {interviewState.question}
                    </div>
                  </motion.div>
                )}

                {!interviewState?.done && interviewState && (
                  <form onSubmit={(e) => void sendInterviewTurn(e)} className="space-y-3">
                    <Textarea
                      value={interviewAnswer}
                      onChange={(e) => setInterviewAnswer(e.target.value)}
                      rows={2}
                      placeholder="Speak with microphone or type your answer…"
                      className="border-white/20 bg-[#090a0d] text-base"
                    />
                    <div className="flex items-center gap-2.5">
                      <Button
                        type="button"
                        flat
                        onClick={toggleMic}
                        className={`h-11 border px-4 text-sm font-medium ${
                          listening
                            ? "border-red-400 bg-red-950/60 text-red-100"
                            : "border-white/25 bg-[#151922]"
                        }`}
                      >
                        {listening ? <MicOff className="size-4" /> : <Mic className="size-4 text-sky-300" />}
                        {listening ? "Stop" : "Speak"}
                      </Button>
                      <Button
                        type="submit"
                        variant="default"
                        flat
                        disabled={interviewBusy || !interviewAnswer.trim()}
                        className="h-11 flex-1 text-sm font-semibold"
                      >
                        <Send className="size-4" />
                        {interviewBusy ? "Updating Graph…" : "Send Answer"}
                      </Button>
                    </div>
                  </form>
                )}

                {vp && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 border-t border-emerald-400/40 pt-4"
                  >
                    <div className="font-mono text-xs uppercase tracking-wider text-emerald-300">
                      Value Proposition Locked
                    </div>
                    <div className="text-lg font-semibold text-white">{vp.one_liner}</div>
                    <Button
                      type="button"
                      variant="default"
                      flat
                      onClick={onGoToLeads}
                      className="h-11 w-full text-sm font-semibold"
                    >
                      Open Live Knowledge Graph <ArrowRight className="size-4" />
                    </Button>
                  </motion.div>
                )}
              </div>
            )}

            {interviewErr && (
              <div className="font-mono text-xs text-amber-300">{interviewErr}</div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 2: RESOLVED FOUNDER SUMMARY BAR — ULTRA FLAT, EXPAND ON CLICK */}
      {founder && (
        <section className="space-y-5">
          <div className="group flex flex-wrap items-center justify-between gap-6 border-b border-white/15 pb-6">
            <div className="space-y-2 max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-white">
                  {founder.id === HOPO_FOUNDER_ID ? "Hannah Weber" : founder.name}
                </h2>
                <span className="border border-emerald-400/40 bg-[#07291e] px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-200">
                  {founder.id === HOPO_FOUNDER_ID
                    ? "HOPO Therapeutics · Berkeley Lab (R. Abergel)"
                    : founder.company || "Research Spinout"}
                </span>
                <div className="flex items-center gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
                  {founder.evidence_ids.slice(0, 2).map((eid) => (
                    <EvidenceChip
                      key={eid}
                      evidenceId={eid}
                      evidenceMap={evidenceMap}
                      onInspect={onInspectEvidence}
                      compact
                    />
                  ))}
                </div>
              </div>
              <p className="text-base leading-relaxed text-muted-foreground">{founder.summary}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {valueNodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowValueMap((v) => !v)}
                  className="inline-flex items-center gap-2 border border-white/20 bg-[#0f1117] px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-sky-400"
                >
                  <FileText className="size-4 text-sky-300" />
                  <span>Core Value Map ({valueNodes.length})</span>
                  <ChevronDown
                    className={`size-4 transition-transform ${showValueMap ? "rotate-180" : ""}`}
                  />
                </button>
              )}
              <Button
                variant="default"
                flat
                onClick={onGoToLeads}
                className="h-11 px-5 text-sm font-semibold"
              >
                Explore Knowledge Graph <ArrowRight className="size-4" />
              </Button>
              <Button
                flat
                onClick={onGoToBuyers}
                className="h-11 border border-white/20 bg-[#0f1117] px-4 text-sm hover:border-white/45"
              >
                Buyer Signals
              </Button>
            </div>
          </div>

          {/* EXPANDABLE CORE VALUE MAP (FEATURE -> BENEFIT -> VALUE -> PROBLEM) */}
          <AnimatePresence initial={false}>
            {showValueMap && valueNodes.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-6 border-b border-white/15 pb-8 sm:grid-cols-2 lg:grid-cols-4">
                  {(["feature", "benefit", "value", "problem"] as const).map((kind) => {
                    const items = valueNodes.filter((n) => n.kind === kind);
                    return (
                      <div key={kind} className="space-y-3">
                        <div className="border-b border-white/15 pb-2 font-mono text-xs font-semibold uppercase tracking-wider text-sky-300">
                          {kind}s ({items.length})
                        </div>
                        <div className="space-y-3">
                          {items.map((node) => (
                            <div
                              key={node.id}
                              className="group/vn space-y-1.5 border-l border-white/15 pl-3 transition-colors hover:border-sky-400"
                            >
                              <div className="text-sm leading-snug text-foreground">{node.text}</div>
                              {node.evidence_ids[0] && (
                                <div className="opacity-0 transition-opacity group-hover/vn:opacity-100">
                                  <EvidenceChip
                                    evidenceId={node.evidence_ids[0]}
                                    evidenceMap={evidenceMap}
                                    onInspect={onInspectEvidence}
                                    compact
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* MINIMAL 2-STAT ICP PREVIEW */}
          {icp && (
            <div className="grid grid-cols-1 gap-8 pt-1 md:grid-cols-2">
              {icp.buyer_roles[0] && (
                <div className="group space-y-1.5 border-l-2 border-sky-400/60 pl-4">
                  <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Primary Buyer Role
                  </div>
                  <div className="text-lg font-semibold text-white">{icp.buyer_roles[0].title}</div>
                  <p className="text-sm text-muted-foreground line-clamp-2 group-hover:line-clamp-none">
                    {icp.buyer_roles[0].why}
                  </p>
                </div>
              )}
              {icp.needs[0] && (
                <div className="group space-y-1.5 border-l-2 border-emerald-400/60 pl-4">
                  <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Core Technical Bottleneck
                  </div>
                  <div className="text-lg font-semibold text-white">{icp.needs[0].text}</div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
