"use client";

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Mic,
  MicOff,
  RotateCcw,
  Search,
  Send,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, GOLDEN_FOUNDER_ID, HOPO_DISPLAY, HOPO_FOUNDER_ID } from "@/lib/api";
import type { Evidence, Founder, Icp, Id, IntakeForm, InterviewResponse } from "@/lib/types";
import { ParticleOrb } from "./particle-orb";
import { EvidenceChip } from "./evidence-chip";

interface ScreenIntakeProps {
  founder: Founder | null;
  icp: Icp | null;
  evidenceMap: Record<Id, Evidence>;
  loadingIntake: boolean;
  intakeError: string | null;
  onSubmitQuery: (query: string) => Promise<void>;
  onSubmitForm: (form: IntakeForm) => Promise<void>;
  onInspectEvidence: (evidenceId: Id) => void;
  onEvidenceLoaded: (list: Evidence[]) => void;
  onGoToBuyers: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

// Plain-language reasons for the browser's speech errors (they used to be swallowed, so the mic just "died").
const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone is blocked. Allow mic access for this site (address bar → site settings), then press Speak again.",
  "service-not-allowed": "This browser's speech service is turned off. Use Chrome, or type your answer below.",
  "audio-capture": "No microphone found. Check System Settings → Sound → Input, or type your answer below.",
  network: "The browser's speech service is unreachable (Chrome dictation needs internet). Type your answer below.",
  "language-not-supported": "Speech recognition doesn't support en-US here. Type your answer below.",
};

export function ScreenIntake({
  founder,
  icp,
  evidenceMap,
  loadingIntake,
  intakeError,
  onSubmitQuery,
  onSubmitForm,
  onInspectEvidence,
  onEvidenceLoaded,
  onGoToBuyers,
}: ScreenIntakeProps) {
  // HACK: prefill follows the booted demo case (HOPO for ?session=demo-hopo, else Lightmatter).
  const isHopo = founder?.id === HOPO_FOUNDER_ID;
  const [quickQuery, setQuickQuery] = React.useState(isHopo ? HOPO_DISPLAY.scientist : "Nicholas C. Harris");
  const [name, setName] = React.useState(isHopo ? HOPO_DISPLAY.name : "Nicholas C. Harris");
  const [expertise, setExpertise] = React.useState(
    isHopo
      ? "Oral hydroxypyridinone chelators (3,4,3-LI(1,2-HOPO)) for actinide decorporation, 89Zr PET imaging and gadolinium clearance"
      : "Coherent nanophotonic circuits, silicon photonics, and optical interconnects for AI compute clusters",
  );
  const [paperLinksRaw, setPaperLinksRaw] = React.useState(
    isHopo
      ? "https://doi.org/10.1021/jm500389b\nhttps://doi.org/10.1039/c7nj04559j"
      : "https://doi.org/10.1038/nphoton.2017.93",
  );
  const [startupUrl, setStartupUrl] = React.useState(isHopo ? "https://hopotx.com" : "https://lightmatter.co");
  const [customerPersona, setCustomerPersona] = React.useState(
    isHopo
      ? "Radiological countermeasure programs, radiopharmaceutical BD leads, and MRI contrast-agent R&D heads"
      : "Hyperscale AI infrastructure, optical interconnect architecture, and silicon photonics R&D leads",
  );
  const [interviewTranscript, setInterviewTranscript] = React.useState("");

  // Live Paper-Grilling Voice / Text Interview State (POST /interview)
  const [interviewState, setInterviewState] = React.useState<InterviewResponse | null>(null);
  const [interviewAnswer, setInterviewAnswer] = React.useState("");
  const [interviewBusy, setInterviewBusy] = React.useState(false);
  const [interviewErr, setInterviewErr] = React.useState<string | null>(null);
  const [listening, setListening] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const [voiceReadback, setVoiceReadback] = React.useState(true);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const wantMicRef = React.useRef(false);
  const finalTextRef = React.useRef("");

  const isGoldenReplay = founder?.id === GOLDEN_FOUNDER_ID || isHopo;

  const speakQuestion = React.useCallback(
    (text: string | null | undefined) => {
      if (!voiceReadback || !text || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.06;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [voiceReadback],
  );

  const startPaperInterview = async () => {
    setInterviewBusy(true);
    setInterviewErr(null);
    try {
      const links = paperLinksRaw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.interview({
        paper_links: links,
        founder_id: founder?.id ?? null,
      });
      setInterviewState(res);
      if (res.paper_evidence?.length) {
        onEvidenceLoaded(res.paper_evidence);
      }
      speakQuestion(res.question);
    } catch (err) {
      setInterviewErr(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setInterviewBusy(false);
    }
  };

  const sendInterviewTurn = async (e?: React.FormEvent) => {
    if (wantMicRef.current) stopMic();
    e?.preventDefault();
    if (!interviewState || !interviewAnswer.trim()) return;
    setInterviewBusy(true);
    setInterviewErr(null);
    try {
      const res = await api.interview({
        session_id: interviewState.session_id,
        answer: interviewAnswer.trim(),
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
      if (res.form.interview_transcript) setInterviewTranscript(res.form.interview_transcript);
      if (res.question) speakQuestion(res.question);
    } catch (err) {
      setInterviewErr(err instanceof Error ? err.message : "Failed to send answer");
    } finally {
      setInterviewBusy(false);
    }
  };

  // Mic: continuous dictation that survives pauses and browser-side session ends.
  // HACK: Web Speech API only (Chrome/Edge/Safari); typed answer stays the fallback.

  const stopMic = React.useCallback(() => {
    wantMicRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  React.useEffect(() => () => stopMic(), [stopMic]);

  const toggleMic = async () => {
    if (typeof window === "undefined") return;
    if (listening || wantMicRef.current) {
      stopMic();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setInterviewErr("Speech recognition isn't available in this browser. Use Chrome, or type your answer below.");
      return;
    }
    setInterviewErr(null);
    // Don't let the interviewer's read-back talk over (or into) the mic.
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);

    // Ask for the mic up front so a blocked/missing mic gets a clear message instead of a silent stop.
    // Capped at 2.5 s: if the permission check hangs, start recognition anyway (it asks for the mic itself).
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);
        stream?.getTracks().forEach((t) => t.stop());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setInterviewErr(
          name === "NotFoundError" ? MIC_ERRORS["audio-capture"] : MIC_ERRORS["not-allowed"],
        );
        return;
      }
    }

    finalTextRef.current = interviewAnswer ? `${interviewAnswer.trim()} ` : "";
    wantMicRef.current = true;

    const startSession = () => {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalTextRef.current += `${r[0].transcript.trim()} `;
          else interim += r[0].transcript;
        }
        setInterviewAnswer(`${finalTextRef.current}${interim}`.trimStart());
      };
      rec.onerror = (ev) => {
        // "no-speech" and "aborted" are routine; the end handler restarts or stops.
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        wantMicRef.current = false;
        setInterviewErr(MIC_ERRORS[ev.error] ?? `Microphone stopped (${ev.error}). Type your answer below.`);
      };
      rec.onend = () => {
        if (wantMicRef.current && recognitionRef.current === rec) {
          // Browser ended the session (silence/time limit): keep listening.
          try {
            startSession();
            return;
          } catch {
            // fall through to stop
          }
        }
        if (recognitionRef.current === rec) {
          recognitionRef.current = null;
          wantMicRef.current = false;
          setListening(false);
        }
      };
      recognitionRef.current = rec;
      rec.start();
    };

    try {
      startSession();
      setListening(true);
    } catch (err) {
      wantMicRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setInterviewErr(`Microphone couldn't start (${err instanceof Error ? err.message : "unknown error"}). Type your answer below.`);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const links = paperLinksRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmitForm({
      name: name.trim(),
      expertise: expertise.trim(),
      paper_links: links,
      startup_url: startupUrl.trim() || null,
      customer_persona: customerPersona.trim(),
      interview_transcript: interviewTranscript.trim() || null,
    });
  };

  const handleQuickLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickQuery.trim()) return;
    await onSubmitQuery(quickQuery.trim());
  };

  const topBuyerRole = icp?.buyer_roles?.[0];
  const topNeed = icp?.needs?.[0];
  const vp = interviewState?.value_proposition;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* LEFT: VOICE PAPER-GRILLING INTERVIEW + INTAKE */}
      <div className="xl:col-span-5 space-y-5">
        {/* 1. LIVE PAPER-GRILLING VOICE INTERVIEW (POST /interview · Moss fastlane-1) */}
        <Card flat border className="border-white/10 bg-white/[0.02] py-5 gap-4">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-sky-300">
                Paper-Grounded Voice Grilling
              </span>
              <div className="flex items-center gap-1.5">
                {interviewState && (
                  <Badge flat className="border-emerald-400/40 bg-emerald-950/60 font-mono text-[10px] text-emerald-200">
                    {interviewState.ms.toFixed(0)}ms · {interviewState.engine}
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => setVoiceReadback((v) => !v)}
                  title="Toggle spoken interviewer voice"
                  className="rounded border border-white/20 bg-[#151922] p-1 text-muted-foreground hover:text-foreground"
                >
                  {voiceReadback ? <Volume2 className="size-3.5 text-sky-300" /> : <VolumeX className="size-3.5" />}
                </button>
              </div>
            </div>
            <CardTitle className="text-lg">Live AI Value-Prop Interview</CardTitle>
            <CardDescription className="text-xs">
              Drop a paper DOI/link and let the interviewer drill down until your commercial buyer, measurable gain, and PO signer are sharp.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-5 space-y-3">
            <div className="flex flex-col items-center gap-1 py-1">
              <ParticleOrb
                size={150}
                state={listening ? "listening" : speaking ? "speaking" : interviewBusy ? "thinking" : "idle"}
                pulseKey={interviewState?.question ?? ""}
                label="Interview voice activity"
              />
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {listening ? "Listening" : speaking ? "Speaking" : interviewBusy ? "Reading the papers" : "Ready"}
              </span>
            </div>
            {!interviewState ? (
              <Button
                type="button"
                variant="default"
                flat
                disabled={interviewBusy}
                onClick={() => void startPaperInterview()}
                className="w-full"
              >
                <Mic className="size-4" />
                {interviewBusy ? "Reading Paper & Starting..." : "Start Live Paper Grilling"}
              </Button>
            ) : (
              <div className="space-y-3">
                {interviewState.question && !interviewState.done && (
                  <div className="rounded border-2 border-sky-400/50 bg-[#0b2536] p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-sky-300">
                      <span>Interviewer Question</span>
                      <span>{listening ? "● LISTENING..." : "SPEAK OR TYPE"}</span>
                    </div>
                    <div className="text-sm font-bold leading-snug text-white">
                      {interviewState.question}
                    </div>
                  </div>
                )}

                {!interviewState.done && (
                  <form onSubmit={(e) => void sendInterviewTurn(e)} className="space-y-2">
                    <Textarea
                      value={interviewAnswer}
                      onChange={(e) => setInterviewAnswer(e.target.value)}
                      rows={2}
                      placeholder="Speak with mic or type concrete buyer + metric answer..."
                      className="font-mono text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        flat
                        onClick={() => void toggleMic()}
                        className={`border font-mono text-xs ${
                          listening
                            ? "border-red-400 bg-red-950/60 text-red-100"
                            : "border-white/25 bg-[#151922]"
                        }`}
                      >
                        {listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5 text-sky-300" />}
                        {listening ? "Stop Mic" : "Speak"}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="default"
                        flat
                        disabled={interviewBusy || !interviewAnswer.trim()}
                        className="flex-1"
                      >
                        <Send className="size-3.5" />
                        {interviewBusy ? "Analyzing..." : "Submit Turn"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        flat
                        onClick={() => void startPaperInterview()}
                        className="border border-white/20 font-mono text-xs"
                      >
                        Reset
                      </Button>
                    </div>
                  </form>
                )}

                {vp && (
                  <div className="rounded border-2 border-emerald-400/50 bg-[#07291e] p-3.5 space-y-2">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      Synthesized Value Proposition (Grounded in Paper + Answers)
                    </div>
                    <div className="text-xs font-bold text-white">{vp.one_liner}</div>
                    <div className="font-mono text-[11px] text-emerald-100/90">
                      <strong>Buyer:</strong> {vp.for_whom} · <strong>Pain:</strong> {vp.pain}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      flat
                      onClick={() =>
                        void onSubmitForm({
                          name: name.trim(),
                          expertise: expertise.trim(),
                          paper_links: paperLinksRaw
                            .split(/[\n,]+/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                          startup_url: startupUrl.trim() || null,
                          customer_persona: customerPersona.trim(),
                          interview_transcript: interviewTranscript.trim() || null,
                        })
                      }
                      className="w-full"
                    >
                      Use This Value Prop → Run Intake
                    </Button>
                  </div>
                )}
              </div>
            )}

            {interviewErr && (
              <div className="rounded border border-red-500/50 bg-[#2d0a0e] p-2 font-mono text-[11px] text-red-200">
                {interviewErr}
              </div>
            )}
          </CardContent>
        </Card>

        <details className="group">
          <summary className="cursor-pointer list-none px-1 text-xs text-muted-foreground hover:text-foreground">
            Other ways in: look up a founder or DOI, or fill the form
          </summary>
          <div className="mt-4 space-y-5">
        {/* 2. QUICK OPENALEX AUTHOR / DOI LOOKUP */}
        <Card flat border className="border-white/10 bg-white/[0.02] py-5 gap-4">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-sky-300">
                Quick Research Lookup
              </span>
              <Badge flat className="font-mono text-[10px] border-white/20">
                POST /intake
              </Badge>
            </div>
            <CardTitle className="text-lg">Try Any Deep-Tech Founder or DOI</CardTitle>
          </CardHeader>
          <CardContent className="px-5 space-y-3">
            <form onSubmit={handleQuickLookup} className="flex gap-2">
              <Input
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="e.g. Nicholas C. Harris, Dirk Englund, 10.1038/nphoton.2017.93"
                className="font-mono text-xs"
              />
              <Button type="submit" flat disabled={loadingIntake}>
                <Search className="size-3.5" />
                {loadingIntake ? "Resolving..." : "Resolve"}
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Presets:</span>
              <button
                type="button"
                onClick={() => {
                  setQuickQuery("Nicholas C. Harris");
                  void onSubmitQuery("Nicholas C. Harris");
                }}
                className="rounded border border-emerald-400/45 bg-[#07291e] px-2 py-0.5 font-mono text-[11px] text-emerald-200"
              >
                ★ Nicholas C. Harris (Lightmatter)
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickQuery("10.1038/nphoton.2017.93");
                  void onSubmitQuery("10.1038/nphoton.2017.93");
                }}
                className="rounded border border-white/20 bg-[#151922] px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                DOI: 10.1038/nphoton.2017.93
              </button>
            </div>
          </CardContent>
        </Card>

        {/* 3. FULL FOUNDER SIGN-UP FORM */}
        <Card flat border className="border-white/10 bg-white/[0.02] py-5 gap-4">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Structured Founder Sign-Up
              </span>
              {!isGoldenReplay && founder && (
                <Button
                  size="xs"
                  flat
                  onClick={() => void onSubmitQuery("Nicholas C. Harris")}
                  className="border border-amber-400/45 bg-[#2b1d05] font-mono text-[10px] text-amber-100"
                >
                  <RotateCcw className="size-3" />
                  Restore Lightmatter Replay
                </Button>
              )}
            </div>
            <CardTitle className="text-lg">Founder & Lab-to-Market Form</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <form onSubmit={handleFormSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase text-muted-foreground">
                    Founder Name
                  </label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required className="text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase text-muted-foreground">
                    Startup URL
                  </label>
                  <Input
                    value={startupUrl}
                    onChange={(e) => setStartupUrl(e.target.value)}
                    placeholder="https://..."
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Technical Expertise & Breakthrough
                </label>
                <Input value={expertise} onChange={(e) => setExpertise(e.target.value)} required className="text-xs" />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Anchor Paper DOIs / OpenAlex Links
                </label>
                <Input value={paperLinksRaw} onChange={(e) => setPaperLinksRaw(e.target.value)} className="font-mono text-xs" />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Customer Persona Hypothesis
                </label>
                <Textarea value={customerPersona} onChange={(e) => setCustomerPersona(e.target.value)} rows={2} className="text-xs" />
              </div>

              {intakeError && (
                <div className="rounded border border-red-500/50 bg-[#2d0a0e] p-2.5 font-mono text-xs text-red-200">
                  {intakeError}
                </div>
              )}

              <Button type="submit" flat className="w-full border border-white/25" disabled={loadingIntake}>
                <FlaskConical className="size-4" />
                {loadingIntake ? "Synthesizing Founder Graph..." : "Run Founder Intake"}
              </Button>
            </form>
          </CardContent>
        </Card>
          </div>
        </details>
      </div>

      {/* RIGHT: RESOLVED FOUNDER PROFILE + STORY TRANSLATION */}
      <div className="xl:col-span-7 space-y-5">
        {founder ? (
          <>
            <Card flat border className="border-white/10 bg-white/[0.02] py-5 gap-4">
              <CardHeader className="px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div />
                  {founder.openalex_id && (
                    <a
                      href={founder.openalex_id}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      OpenAlex Profile <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>

                <div className="pt-1">
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    {isHopo ? HOPO_DISPLAY.name : founder.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {isHopo ? HOPO_DISPLAY.company : founder.company}
                    </span>
                  </CardTitle>
                  {isHopo && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      science: {HOPO_DISPLAY.science}
                    </div>
                  )}
                  <CardDescription className="mt-1.5 text-sm leading-relaxed text-foreground/90">
                    {isHopo
                      ? "HOPO Therapeutics develops investigational oral chelating agents for heavy-metal exposure. The papers study the 3,4,3-LI(1,2-HOPO) chelator in lab and animal work on actinide removal, 89Zr imaging and gadolinium clearance."
                      : founder.summary}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="px-6 space-y-4">
                {!isHopo && <div className="text-xs text-muted-foreground">{founder.topics.join(" · ")}</div>}

                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    {founder.evidence_ids.map((eid) => (
                      <EvidenceChip
                        key={eid}
                        evidenceId={eid}
                        evidenceMap={evidenceMap}
                        onInspect={onInspectEvidence}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* STORY TRANSLATION / VALUE MAP PREVIEW */}
            <Card flat border className="border-white/10 bg-white/[0.02] py-5 gap-4">
              <CardHeader className="px-6">
                <CardTitle className="text-base">Paper → buyer value</CardTitle>
              </CardHeader>

              <CardContent className="px-6 space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                      <BookOpen className="size-3.5" />
                      <span>In the paper</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/90">
                      Co-authored research in{" "}
                      <span className="font-semibold text-white">
                        {isHopo ? "heavy-metal chelation" : founder.topics.join(" & ") || "deep-tech systems"}
                      </span>{" "}
                      {isHopo
                        ? "— the oral chelator 3,4,3-LI(1,2-HOPO), tested in lab and animal work on actinide removal, 89Zr PET imaging and gadolinium clearance at Berkeley Lab."
                        : "— programmable Mach-Zehnder interferometer meshes and coherent nanophotonic circuits demonstrated at MIT."}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                      <span>For the buyer</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/95">
                      {vp ? (
                        vp.one_liner
                      ) : topBuyerRole ? (
                        <>
                          <span className="font-semibold text-emerald-200">{topBuyerRole.title}:</span>{" "}
                          {topBuyerRole.why}
                        </>
                      ) : (
                        "Eliminate electrical interconnect bottlenecks between AI accelerators using silicon-photonic optical links."
                      )}
                    </p>
                    {topNeed && (
                      <div className="pt-1 flex flex-wrap gap-1.5">
                        {topNeed.evidence_ids.slice(0, 2).map((eid) => (
                          <EvidenceChip
                            key={eid}
                            evidenceId={eid}
                            evidenceMap={evidenceMap}
                            onInspect={onInspectEvidence}
                            compact
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
                  <div />
                  <Button variant="default" flat onClick={onGoToBuyers}>
                    <span>Find buyers</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card flat border className="border-white/10 bg-white/[0.02] p-8 text-center font-mono text-xs text-muted-foreground">
            Loading founder research profile...
          </Card>
        )}
      </div>
    </div>
  );
}
