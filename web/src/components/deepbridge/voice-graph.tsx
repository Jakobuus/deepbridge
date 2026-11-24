"use client";

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import type { GraphStreamState } from "@/lib/useGraphStream";

const CAT_HEX = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];
function catColor(colour: string | undefined, idx: number): string {
  const m = colour?.match(/--cat-(\d)/);
  if (m) return CAT_HEX[(Number(m[1]) - 1) % CAT_HEX.length];
  if (colour?.startsWith("#")) return colour;
  return CAT_HEX[idx % CAT_HEX.length];
}

const W = 520;
const H = 440;
const CX = W / 2 - 6;
const CY = H / 2 + 4;

/** Stable 0..1 pseudo-random numbers per id (same layout every take, but not geometric). */
function rand(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function short(text: string, n = 30) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Curved link from the centre: a soft quadratic bend instead of a straight spoke. */
function curve(x: number, y: number, bend: number) {
  const mx = (CX + x) / 2;
  const my = (CY + y) / 2;
  const dx = y - CY;
  const dy = -(x - CX);
  const len = Math.hypot(dx, dy) || 1;
  return `M ${CX} ${CY} Q ${mx + (dx / len) * bend} ${my + (dy / len) * bend} ${x} ${y}`;
}

// Uneven resting places for the four categories (degrees), so the outer layer never reads as a cross.
const CAT_ANGLES = [-78, 22, 128, 205, 300];

/** Reveal items one at a time, however fast the stream delivers them. */
function useOneAtATime(total: number, everyMs: number): number {
  const [shown, setShown] = React.useState(0);
  const target = React.useRef(total);
  React.useEffect(() => {
    target.current = total;
  }, [total]);
  React.useEffect(() => {
    // Clamp first so a stream reset (new take) starts the reveal over, then add one item per tick.
    const t = setInterval(() => setShown((s) => Math.min(s, target.current) + (s < target.current ? 1 : 0)), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return Math.min(shown, total);
}

/**
 * Live knowledge graph for the voice stage: Hannah at the centre, the value map (DEMO step 3) as a loose inner
 * cloud, the buyer categories (step 4) further out. What she names in the interview appears in white, in her words.
 */
export function VoiceGraph({ stream }: { stream: GraphStreamState }) {
  const reduced = useReducedMotion();
  const named = React.useMemo(
    () => [
      ...stream.valueNodes.filter((v) => String(v.id).startsWith("interview:")).map((v) => ({ id: String(v.id), label: v.text })),
      ...stream.orgs.filter((o) => String(o.id).startsWith("interview:")).map((o) => ({ id: String(o.id), label: o.name })),
    ],
    [stream.valueNodes, stream.orgs],
  );
  const paperValues = React.useMemo(
    () => stream.valueNodes.filter((v) => !String(v.id).startsWith("interview:")),
    [stream.valueNodes],
  );
  const cats = stream.categories;

  // Her words first and quickly, then the value map one node at a time, categories with a beat between them.
  const namedShown = useOneAtATime(named.length, 700);
  const valuesShown = useOneAtATime(paperValues.length, 260);
  const catsShown = useOneAtATime(cats.length, 1400);

  const values = paperValues.slice(0, valuesShown).map((v, i) => {
    const id = String(v.id);
    const a = i * 2.39996 + (rand(id, 1) - 0.5) * 0.9; // golden angle + jitter
    const r = 52 + rand(id, 2) * 88; // a loose band, not a ring
    return { id, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) * 0.86, bend: (rand(id, 3) - 0.5) * 36, d: rand(id, 4) };
  });
  const catNodes = cats.slice(0, catsShown).map((c, i) => {
    const id = String(c.id);
    const a = ((CAT_ANGLES[i % CAT_ANGLES.length] + (rand(id, 5) - 0.5) * 18) * Math.PI) / 180;
    const r = 170 + rand(id, 6) * 26;
    return { c, i, id, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) * 0.9, bend: (rand(id, 7) - 0.5) * 70, d: rand(id, 8) };
  });
  const words = named.slice(0, namedShown).map((n, i) => {
    const a = -0.35 + i * 1.15 + (rand(n.id, 9) - 0.5) * 0.4;
    const r = 112 + rand(n.id, 10) * 30;
    return { ...n, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a), bend: (rand(n.id, 11) - 0.5) * 50, d: rand(n.id, 12) };
  });

  const pop = reduced
    ? {}
    : {
        initial: { scale: 0, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        transition: { type: "spring" as const, stiffness: 180, damping: 14 },
      };
  const drift = (d: number) =>
    reduced ? undefined : ({ animationDelay: `${-d * 8}s`, animationDuration: `${6 + d * 5}s` } as React.CSSProperties);

  const idle = stream.status === "off";

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-center gap-5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className={values.length ? "text-sky-300" : ""}>3 · Value map {values.length || ""}</span>
        <span className={catNodes.length ? "text-sky-300" : ""}>4 · Buyer categories {catNodes.length || ""}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Live knowledge graph: value map and buyer categories">
        {/* soft glow where the graph lives */}
        <defs>
          <radialGradient id="vgGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={190} fill="url(#vgGlow)" />

        {/* value map (step 3): loose cloud, faint curved links */}
        {values.map((v) => (
          <g key={v.id} className="db-drift" style={drift(v.d)}>
            <motion.path d={curve(v.x, v.y, v.bend)} fill="none" stroke="rgba(125,211,252,0.16)" strokeWidth={1}
              initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7 }} />
            <motion.circle cx={v.x} cy={v.y} r={2.2 + v.d * 1.8} fill="#7dd3fc" fillOpacity={0.55 + v.d * 0.4} {...pop} />
          </g>
        ))}

        {/* buyer categories (step 4) */}
        {catNodes.map(({ c, i, id, x, y, bend, d }) => {
          const col = catColor(c.colour, i);
          const w = typeof (c as { weight?: number }).weight === "number" ? (c as { weight?: number }).weight! : 0;
          const above = y < CY - 10;
          return (
            <g key={id} className="db-drift" style={drift(d)}>
              <motion.path d={curve(x, y, bend)} fill="none" stroke={col} strokeOpacity={0.4} strokeWidth={1.3}
                initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1 }} />
              <motion.g {...pop}>
                <circle cx={x} cy={y} r={12 + Math.min(8, w * 8)} fill={col} fillOpacity={0.14} />
                <circle cx={x} cy={y} r={6} fill={col} />
                <text x={x} y={y + (above ? -16 : 25)} textAnchor="middle" className="fill-slate-100 font-sans text-[12px]" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                  {short(c.name.split(/[:(]/)[0], 20)}
                </text>
              </motion.g>
            </g>
          );
        })}

        {/* her own words (live, from the interview) */}
        {words.map((n) => (
          <g key={n.id} className="db-drift" style={drift(n.d)}>
            <motion.path d={curve(n.x, n.y, n.bend)} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1.3}
              initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
            <motion.g {...pop}>
              <circle cx={n.x} cy={n.y} r={5} fill="#ffffff" />
              <text x={n.x + 9} y={n.y + 4} className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                {short(n.label)}
              </text>
            </motion.g>
          </g>
        ))}

        {/* centre */}
        <circle cx={CX} cy={CY} r={7} fill="#0b2536" stroke="#38bdf8" strokeWidth={2} />
        <text x={CX} y={CY + 24} textAnchor="middle" className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
          Hannah Weber
        </text>
      </svg>
      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {idle ? "The graph builds here while you talk" : "From her papers (cached research replay) · white = her own words, live"}
      </p>
    </div>
  );
}
