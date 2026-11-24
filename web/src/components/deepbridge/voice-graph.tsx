"use client";

import { motion, useReducedMotion } from "motion/react";
import type { GraphStreamState } from "@/lib/useGraphStream";

const CAT_HEX = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];
function catColor(colour: string | undefined, idx: number): string {
  const m = colour?.match(/--cat-(\d)/);
  if (m) return CAT_HEX[(Number(m[1]) - 1) % CAT_HEX.length];
  if (colour?.startsWith("#")) return colour;
  return CAT_HEX[idx % CAT_HEX.length];
}

const W = 520;
const H = 420;
const CX = W / 2;
const CY = H / 2;
const R_VALUE = 92; // step 3: value map ring
const R_CAT = 175; // step 4: buyer categories ring

function polar(r: number, angle: number) {
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

function short(text: string, n = 34) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Minimal live knowledge graph for the voice stage: Hannah in the centre, the value map (DEMO step 3) on the
 * inner ring, the buyer categories (step 4) on the outer ring. Nodes she names in the interview appear in white
 * with her own words.
 */
export function VoiceGraph({ stream }: { stream: GraphStreamState }) {
  const reduced = useReducedMotion();
  const values = stream.valueNodes;
  const cats = stream.categories;
  const named = [
    ...values.filter((v) => String(v.id).startsWith("interview:")).map((v) => ({ id: v.id, label: v.text })),
    ...stream.orgs.filter((o) => String(o.id).startsWith("interview:")).map((o) => ({ id: o.id, label: o.name })),
  ];
  const paperValues = values.filter((v) => !String(v.id).startsWith("interview:"));
  const pop = reduced
    ? {}
    : { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring" as const, stiffness: 260, damping: 18 } };

  const catPos = cats.map((c, i) => ({ c, i, ...polar(R_CAT, -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(cats.length, 4)) }));
  const valuePos = paperValues.map((v, i) => ({ v, ...polar(R_VALUE, (i * 2 * Math.PI) / Math.max(paperValues.length, 12)) }));
  const namedPos = named.map((n, i) => ({ n, ...polar(R_VALUE + 40, Math.PI * 0.15 + i * 0.55) }));

  const idle = stream.status === "off";

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-center gap-5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className={values.length ? "text-sky-300" : ""}>3 · Value map {values.length || ""}</span>
        <span className={cats.length ? "text-sky-300" : ""}>4 · Buyer categories {cats.length || ""}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Live knowledge graph: value map and buyer categories">
        {/* rings */}
        <circle cx={CX} cy={CY} r={R_VALUE} fill="none" stroke="rgba(148,163,184,0.12)" strokeDasharray="2 6" />
        <circle cx={CX} cy={CY} r={R_CAT} fill="none" stroke="rgba(148,163,184,0.10)" strokeDasharray="2 8" />

        {/* centre → value lines */}
        {valuePos.map(({ v, x, y }) => (
          <motion.line key={`l-${v.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(56,189,248,0.18)" strokeWidth={1}
            initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
        ))}
        {/* value ring → categories */}
        {catPos.map(({ c, i, x, y }) => (
          <motion.line key={`lc-${c.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke={catColor(c.colour, i)} strokeOpacity={0.35} strokeWidth={1.2}
            initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
        ))}

        {/* value nodes (step 3) */}
        {valuePos.map(({ v, x, y }) => (
          <motion.circle key={v.id} cx={x} cy={y} r={3.2} fill="#7dd3fc" {...pop} />
        ))}

        {/* categories (step 4) */}
        {catPos.map(({ c, i, x, y }) => {
          const col = catColor(c.colour, i);
          const w = typeof (c as { weight?: number }).weight === "number" ? (c as { weight?: number }).weight! : 0;
          // Labels centred above/below the dot so side categories never clip; short name (text before ":" / "(").
          const dy = y < CY - 10 ? -16 : 26;
          return (
            <motion.g key={c.id} {...pop}>
              <circle cx={x} cy={y} r={9 + Math.min(6, w * 6)} fill={col} fillOpacity={0.18} />
              <circle cx={x} cy={y} r={6} fill={col} />
              <text x={x} y={y + dy} textAnchor="middle" className="fill-slate-100 font-sans text-[12px]" stroke="#020510" strokeWidth={4} paintOrder="stroke">
                {short(c.name.split(/[:(]/)[0], 20)}
              </text>
            </motion.g>
          );
        })}

        {/* what Hannah said (her words) */}
        {namedPos.map(({ n, x, y }) => (
          <motion.g key={n.id} {...pop}>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={1.2} />
            <circle cx={x} cy={y} r={5} fill="#ffffff" />
            <text x={x + 9} y={y + 4} className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
              {short(n.label)}
            </text>
          </motion.g>
        ))}

        {/* centre */}
        <circle cx={CX} cy={CY} r={7} fill="#0b2536" stroke="#38bdf8" strokeWidth={2} />
        <text x={CX} y={CY + 24} textAnchor="middle" className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
          Hannah Weber
        </text>
      </svg>
      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {idle
          ? "The graph builds here while you talk"
          : "From her papers (cached research replay) · white = her own words, live"}
      </p>
    </div>
  );
}
