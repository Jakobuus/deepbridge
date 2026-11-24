"use client";

import { motion, useReducedMotion } from "motion/react";
import { useOrbSignal } from "@/lib/orb-bus";
import { ParticleOrb } from "./particle-orb";

/** Giant floating orb in the sidebar: reacts to the voice interview and fills as the knowledge graph builds. */
export function SidebarOrb() {
  const { state, progress, pulse, caption } = useOrbSignal();
  const reduced = useReducedMotion();
  const pct = Math.round(progress * 100);

  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-3 lg:flex">
      <motion.div
        animate={reduced ? undefined : { y: [0, -10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <ParticleOrb
          size={184}
          state={state}
          pulseKey={pulse}
          pulseStrength={0.07}
          progress={0.12 + progress * 0.88}
          label="DeepBridge activity: voice interview and knowledge graph build"
        />
      </motion.div>
      <div className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground" aria-live="polite">
        {caption ?? (pct > 0 ? `Knowledge graph · ${pct}%` : "Ready")}
      </div>
    </div>
  );
}
