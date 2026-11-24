"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, PhoneOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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
export function VoiceStage() {
  const [graphOn, setGraphOn] = React.useState(false);
  const stream = useGraphStream(graphOn ? SESSION_ID : null, GRAPH_SPEED);
  return (
    <div className="grid grid-cols-1 items-center gap-8 xl:grid-cols-2">
      <ConversationProvider>
        <VoiceStageInner onStart={() => setGraphOn(true)} />
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

function VoiceStageInner({ onStart }: { onStart: () => void }) {
  const reduced = useReducedMotion();
  const levelRef = React.useRef(0);
  const [lastLine, setLastLine] = React.useState<{ who: "You" | "Interviewer"; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const conversation = useConversation({
    onMessage: ({ message: raw, role }) => {
      // Strip expressive-voice cues like "[happy]" (spoken style hints, not words).
      const message = raw.replace(/\[[^\]]{1,24}\]\s*/g, "").trim();
      if (!message) return;
      const who = role === "user" ? "You" : "Interviewer";
      setLastLine({ who, text: message });
      postTurn(role === "user" ? "founder" : "interviewer", message);
      orbBus.pulse();
      if (role === "user") orbBus.bumpProgress(0.06, 0.45);
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

      <div className="min-h-[3.5rem] max-w-xl text-center" aria-live="polite">
        {error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : lastLine ? (
          <p className="text-sm text-slate-300">
            <span className="mr-1.5 font-mono text-[10px] uppercase tracking-widest text-sky-300">{lastLine.who}</span>
            {lastLine.text}
          </p>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Real-voice interview · ElevenLabs
          </p>
        )}
      </div>
    </section>
  );
}
