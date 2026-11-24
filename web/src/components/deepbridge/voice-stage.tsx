"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, PhoneOff } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { API_BASE } from "@/lib/api";
import { orbBus } from "@/lib/orb-bus";
import { useGraphStream } from "@/lib/useGraphStream";
import { ParticleOrb } from "./particle-orb";
import { VoiceGraph } from "./voice-graph";

// HACK: public ElevenLabs agent "DeepBridge Interviewer (HOPO demo)" in Mark's workspace (no auth, agent id only).
const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4301m87wdsfcf4z87ac1fkw8xne1";
const SESSION_ID = "demo-hopo";

// The recorded demo-hopo build spans ~300 s; speed 4 plays it over the ~75 s stage interview, then the stream
// keeps listening (live-tail) so nodes from her spoken answers (POST /interview/turn → /graph/sharpen) appear live.
const GRAPH_SPEED = 4;

/** Large orb floating in space with one Speak button (ElevenLabs Agents), and the knowledge graph building beside it. */
export function VoiceStage({ onEnded }: { onEnded?: () => void }) {
  const [graphOn, setGraphOn] = React.useState(false);
  const stream = useGraphStream(graphOn ? SESSION_ID : null, GRAPH_SPEED);
  return (
    <div className="grid grid-cols-1 items-center gap-8 xl:grid-cols-2">
      <ConversationProvider>
        <VoiceStageInner onStart={() => setGraphOn(true)} onEnded={onEnded} />
      </ConversationProvider>
      <VoiceGraph stream={stream} />
    </div>
  );
}

function postTurn(role: "founder" | "interviewer", text: string) {
  // Each spoken line feeds the live graph (POST /interview/turn publishes "interview" events). Fire and forget.
  void fetch(`${API_BASE}/interview/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: SESSION_ID, role, text }),
  }).catch(() => undefined);
}

type Line = { id: number; who: "You" | "Interviewer"; text: string };

function VoiceStageInner({ onStart, onEnded }: { onStart: () => void; onEnded?: () => void }) {
  const reduced = useReducedMotion();
  const levelRef = React.useRef(0);
  // The last few lines, newest last: each one fades in on its own, older ones dim.
  const [lines, setLines] = React.useState<Line[]>([]);
  const lineId = React.useRef(0);
  const lastLine = lines[lines.length - 1] ?? null;
  const [error, setError] = React.useState<string | null>(null);
  const [ended, setEnded] = React.useState(false);
  const wasLive = React.useRef(false);
  const endTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (endTimer.current) clearTimeout(endTimer.current);
  }, []);

  const conversation = useConversation({
    onMessage: ({ message: raw, role }) => {
      // Strip expressive-voice cues like "[happy]" (spoken style hints, not words).
      const message = raw.replace(/\[[^\]]{1,24}\]\s*/g, "").trim();
      if (!message) return;
      const who = role === "user" ? "You" : "Interviewer";
      lineId.current += 1;
      const next = { id: lineId.current, who, text: message } as Line;
      setLines((prev) => [...prev, next].slice(-3));
      postTurn(role === "user" ? "founder" : "interviewer", message);
      orbBus.pulse();
      if (role === "user") orbBus.bumpProgress(0.06, 0.45);
    },
    onConnect: () => {
      wasLive.current = true;
      setEnded(false);
    },
    // Interview over (the agent hangs up after "Thanks, Hannah", or End is pressed): go to the next step.
    onDisconnect: () => {
      if (!wasLive.current) return;
      wasLive.current = false;
      setEnded(true);
      if (onEnded) endTimer.current = setTimeout(onEnded, 2200);
    },
    onError: (msg) => setError(typeof msg === "string" ? msg : "Voice connection error"),
  });

  const { status, isSpeaking } = conversation;
  const live = status === "connected";
  const connecting = status === "connecting";

  // Feed real audio levels into the orb every frame while connected.
  React.useEffect(() => {
    if (!live) {
      levelRef.current = 0;
      return;
    }
    let raf = 0;
    const tick = () => {
      levelRef.current = Math.max(conversation.getOutputVolume(), conversation.getInputVolume());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, conversation]);

  const orbState = connecting ? "thinking" : live ? (isSpeaking ? "speaking" : "listening") : "idle";

  // Mirror to the sidebar orb.
  React.useEffect(() => {
    orbBus.setState(orbState, live ? (isSpeaking ? "Interviewer speaking" : "Listening") : connecting ? "Connecting voice" : null);
  }, [orbState, live, isSpeaking, connecting]);
  React.useEffect(() => () => orbBus.setState("idle", null), []);

  const start = async () => {
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone is blocked. Allow mic access for this site, then press Speak again.");
      return;
    }
    conversation.startSession({ agentId: AGENT_ID, connectionType: "webrtc" });
    onStart();
  };

  return (
    <section className="relative flex flex-col items-center gap-5 py-6">
      <motion.div
        animate={reduced ? undefined : { y: [0, -14, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        <ParticleOrb
          size={300}
          state={orbState}
          levelRef={levelRef}
          pulseKey={lastLine?.text ?? ""}
          pulseStrength={0.2}
          count={900}
          label="Live voice interview"
        />
      </motion.div>

      <motion.button
        type="button"
        onClick={() => (live || connecting ? conversation.endSession() : void start())}
        whileHover={reduced ? undefined : { scale: 1.06 }}
        whileTap={reduced ? undefined : { scale: 0.95 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
        className={`inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-base font-semibold transition-colors ${
          live
            ? "bg-rose-500/90 text-white hover:bg-rose-500"
            : "bg-white text-[#05070d] hover:bg-sky-100"
        }`}
      >
        {live ? <PhoneOff className="size-5" /> : <Mic className="size-5" />}
        {live ? "End interview" : connecting ? "Connecting…" : "Speak"}
      </motion.button>

      <div className="flex min-h-[6.5rem] w-full max-w-xl flex-col items-center justify-end gap-1.5 text-center" aria-live="polite">
        {error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : lines.length ? (
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.p
                key={l.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: i === lines.length - 1 ? 1 : 0.4, y: 0, filter: "blur(0px)" }}
                exit={reduced ? undefined : { opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 200, damping: 26 }}
                className={i === lines.length - 1 ? "text-sm text-slate-200" : "text-xs text-slate-400"}
              >
                <span className={`mr-1.5 font-mono text-[10px] uppercase tracking-widest ${l.who === "You" ? "text-white" : "text-sky-300"}`}>
                  {l.who === "You" ? "Hannah" : l.who}
                </span>
                {l.text}
              </motion.p>
            ))}
          </AnimatePresence>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Realtime interview
          </p>
        )}
        {ended && !error && (
          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="pt-1 font-mono text-[10px] uppercase tracking-widest text-sky-300"
          >
            Interview done · opening the knowledge graph…
          </motion.p>
        )}
      </div>
    </section>
  );
}
