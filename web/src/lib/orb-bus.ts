"use client";

import * as React from "react";
import type { OrbState } from "@/components/deepbridge/particle-orb";

/**
 * One shared signal for the sidebar orb: the interview feeds its voice state, the graph stream feeds
 * pulses and build progress. Module-level store + useSyncExternalStore, so no provider is needed.
 */
export interface OrbSignal {
  state: OrbState;
  /** 0..1, how much of the knowledge graph has been built (lit particles). */
  progress: number;
  /** Increments once per event; the orb kicks on each change. */
  pulse: number;
  caption: string | null;
}

let current: OrbSignal = { state: "idle", progress: 0, pulse: 0, caption: null };
const listeners = new Set<() => void>();

function emit(next: Partial<OrbSignal>) {
  current = { ...current, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const orbBus = {
  setState(state: OrbState, caption: string | null) {
    if (current.state === state && current.caption === caption) return;
    emit({ state, caption });
  },
  /** Progress only moves forward until reset (a replay restart). */
  setProgress(p: number) {
    const v = Math.max(current.progress, Math.min(1, Math.max(0, p)));
    if (v !== current.progress) emit({ progress: v });
  },
  bumpProgress(delta: number, cap: number) {
    const v = Math.min(cap, current.progress + delta);
    if (v > current.progress) emit({ progress: v });
  },
  resetProgress() {
    if (current.progress !== 0) emit({ progress: 0 });
  },
  pulse() {
    emit({ pulse: current.pulse + 1 });
  },
};

export function useOrbSignal(): OrbSignal {
  return React.useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
