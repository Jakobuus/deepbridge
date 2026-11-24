"use client";

import {
  animate,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import * as React from "react";

/**
 * A sphere of glowing particles drawn on a canvas. Motion springs drive how it
 * breathes per state; `pulseKey` changes give it a short kick (e.g. one per
 * graph event). Transparent background, so it sits in cards and inside SVG.
 */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const TARGETS: Record<OrbState, { energy: number; spin: number; scale: number }> = {
  idle: { energy: 0.06, spin: 0.14, scale: 1 },
  listening: { energy: 0.2, spin: 0.22, scale: 0.93 },
  thinking: { energy: 0.12, spin: 0.85, scale: 0.97 },
  speaking: { energy: 0.36, spin: 0.32, scale: 1.05 },
};

// Hannah's categories first (--cat-1..4), then sky + white highlights.
const DEFAULT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#e0f2fe", "#ffffff"];

interface Particle {
  x: number;
  y: number;
  z: number;
  phase: number;
  color: string;
}

function fibonacciSphere(count: number, colors: string[]): Particle[] {
  const pts: Particle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      phase: (i * 0.618) % 1,
      color: colors[i % colors.length],
    });
  }
  return pts;
}

interface ParticleOrbProps {
  size?: number;
  state?: OrbState;
  /** Change this value to kick the orb (one short pulse per change). */
  pulseKey?: number | string;
  /** Kick strength, 0..1. */
  pulseStrength?: number;
  colors?: string[];
  count?: number;
  label?: string;
  className?: string;
}

export function ParticleOrb({
  size = 140,
  state = "idle",
  pulseKey,
  pulseStrength = 0.5,
  colors = DEFAULT_COLORS,
  count,
  label = "AI voice activity",
  className,
}: ParticleOrbProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const particles = React.useMemo(
    () => fibonacciSphere(count ?? Math.round(Math.min(900, Math.max(180, size * 4))), colors),
    [count, size, colors],
  );

  const energy = useSpring(TARGETS[state].energy, { stiffness: 90, damping: 18 });
  const spin = useSpring(TARGETS[state].spin, { stiffness: 60, damping: 20 });
  const scale = useSpring(TARGETS[state].scale, { stiffness: 140, damping: 16 });
  const kick = useMotionValue(0);
  const angle = React.useRef(0);
  const drewStatic = React.useRef(false);

  React.useEffect(() => {
    energy.set(TARGETS[state].energy);
    spin.set(TARGETS[state].spin);
    scale.set(TARGETS[state].scale);
  }, [state, energy, spin, scale]);

  const firstPulse = React.useRef(true);
  React.useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    if (reduced) return;
    const controls = animate(kick, [kick.get(), pulseStrength, 0], { duration: 0.55, ease: "easeOut" });
    return () => controls.stop();
  }, [pulseKey, pulseStrength, kick, reduced]);

  // Size the backing store for the device pixel ratio.
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    drewStatic.current = false;
  }, [size]);

  useAnimationFrame((time, delta) => {
    const c = canvasRef.current;
    if (!c) return;
    if (reduced && drewStatic.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const t = reduced ? 0 : time / 1000;
    if (!reduced) angle.current += spin.get() * (Math.min(delta, 64) / 1000);

    const W = c.width;
    const H = c.height;
    const cx = W / 2;
    const cy = H / 2;
    const e = energy.get() + kick.get();
    const R = W * 0.34 * scale.get() * (1 + kick.get() * 0.12);
    const dot = Math.max(0.6, W / 240);

    ctx.clearRect(0, 0, W, H);

    // Inner glow, brighter with energy.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.45);
    glow.addColorStop(0, `rgba(56, 189, 248, ${0.16 + e * 0.35})`);
    glow.addColorStop(0.55, `rgba(56, 189, 248, ${0.05 + e * 0.12})`);
    glow.addColorStop(1, "rgba(2, 5, 16, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const cosA = Math.cos(angle.current);
    const sinA = Math.sin(angle.current);
    const tilt = 0.38;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const persp = 2.8;

    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      // Radial breathing: two waves so the surface ripples instead of pulsing as one.
      const wobble =
        1 +
        e * (0.55 * Math.sin(t * 3.1 + p.phase * 12.6) + 0.45 * Math.sin(t * 1.7 + p.y * 5.0));
      const x0 = p.x * wobble;
      const y0 = p.y * wobble;
      const z0 = p.z * wobble;
      // Spin around Y, then tilt around X.
      const x1 = x0 * cosA + z0 * sinA;
      const z1 = -x0 * sinA + z0 * cosA;
      const y2 = y0 * cosT - z1 * sinT;
      const z2 = y0 * sinT + z1 * cosT;
      const k = persp / (persp - z2);
      const depth = (z2 + 1) / 2; // 0 back, 1 front
      ctx.globalAlpha = 0.18 + depth * 0.72;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx + x1 * R * k, cy + y2 * R * k, dot * (0.55 + depth * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (reduced) drewStatic.current = true;
  });

  return (
    <motion.div
      role="img"
      aria-label={label}
      className={className}
      style={{ width: size, height: size }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 160, damping: 18 }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} />
    </motion.div>
  );
}
