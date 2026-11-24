"use client";

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { API_BASE, HOPO_FOUNDER_ID, api } from "@/lib/api";
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

// Seed graph before Speak: what we read in her papers, drawn dashed as AI assumptions until the interview confirms.
// HACK: short labels hand-written from GET /value-map, GET /categories and the POST /intake works list (HOPO case).
const SEED_PAPERS = [
  { id: "paper:hopo-chelators", label: "Oral actinide chelators (HOPO)", a: -150 },
  { id: "paper:anthrax-stealth", label: "Anthrax stealth siderophores", a: -35 },
  { id: "paper:bacillus-sid", label: "Bacillus siderophores", a: 95 },
  { id: "paper:lipocalin", label: "Evading lipocalin 2", a: 150 },
];
const SEED_VALUES: { id: string; label: string; a: number }[] = [
  { id: "value:hopo-f-decorp", label: "Oral decorporation pill", a: -125 },
  { id: "value:hopo-b-dtpa", label: "Beats DTPA", a: -55 },
  { id: "value:hopo-f-zr", label: "Stable 89Zr chelator", a: 30 },
  { id: "value:hopo-f-gd", label: "Removes gadolinium", a: 125 },
  { id: "value:hopo-f-affinity", label: "Binds lead and cadmium", a: 210 },
];
const SEED_CATS: { id: string; label: string; a: number }[] = [
  { id: "category:hopo:radiation", label: "Radiation", a: -90 },
  { id: "category:hopo:pet", label: "PET imaging", a: 0 },
  { id: "category:hopo:gd", label: "Gadolinium", a: 90 },
  { id: "category:hopo:lead", label: "Lead", a: 180 },
];
const CAT_SHORT: Record<string, string> = Object.fromEntries(SEED_CATS.map((c) => [c.id, c.label]));
const CAT_SEED_ANGLE: Record<string, number> = Object.fromEntries(SEED_CATS.map((c) => [c.id, c.a]));

/** Which seed ids the API really has (falls back to the full seed list if the API is down). */
function useSeedIds(): Set<string> | null {
  const [ids, setIds] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    let off = false;
    Promise.all([
      fetch(`${API_BASE}/value-map?founder_id=${encodeURIComponent(HOPO_FOUNDER_ID)}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ value_nodes?: { id: string }[] }>),
      api.getCategories(HOPO_FOUNDER_ID),
    ])
      .then(([vm, cats]) => {
        if (off) return;
        setIds(new Set([...(vm.value_nodes ?? []).map((v) => String(v.id)), ...cats.map((c) => String(c.id))]));
      })
      .catch(() => !off && setIds(null));
    return () => {
      off = true;
    };
  }, []);
  return ids;
}

function polar(deg: number, r: number, squash = 0.88) {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) * squash };
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
  const seedIds = useSeedIds();
  const has = (id: string) => !seedIds || seedIds.has(id);
  const seedValueIds = new Set(SEED_VALUES.map((v) => v.id));
  const paperValues = React.useMemo(
    () => stream.valueNodes.filter((v) => !String(v.id).startsWith("interview:") && !seedValueIds.has(String(v.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.valueNodes],
  );
  const streamValue = (id: string) => stream.valueNodes.find((v) => String(v.id) === id) as
    | ({ state?: string } & (typeof stream.valueNodes)[number])
    | undefined;
  // Seeded categories first (dashed until the stream confirms/weights them), then any extra category the stream adds.
  const cats = [
    ...SEED_CATS.filter((c) => has(c.id)).map(
      (c) => stream.categories.find((x) => String(x.id) === c.id) ?? ({ id: c.id, name: c.label, seed: true } as unknown as (typeof stream.categories)[number]),
    ),
    ...stream.categories.filter((x) => !CAT_SHORT[String(x.id)]),
  ];

  // Her words first and quickly, then the value map one node at a time, categories with a beat between them.
  const namedShown = useOneAtATime(named.length, 700);
  const valuesShown = useOneAtATime(paperValues.length, 260);
  const catsShown = cats.length; // seeded: all four are there from the start

  const values = paperValues.slice(0, valuesShown).map((v, i) => {
    const id = String(v.id);
    const a = i * 2.39996 + (rand(id, 1) - 0.5) * 0.9; // golden angle + jitter
    const r = 52 + rand(id, 2) * 88; // a loose band, not a ring
    return { id, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) * 0.86, bend: (rand(id, 3) - 0.5) * 36, d: rand(id, 4) };
  });
  const catNodes = cats.slice(0, catsShown).map((c, i) => {
    const id = String(c.id);
    const seedA = CAT_SEED_ANGLE[id];
    const a = ((seedA ?? CAT_ANGLES[i % CAT_ANGLES.length] + (rand(id, 5) - 0.5) * 18) * Math.PI) / 180;
    const r = seedA !== undefined ? 185 : 170 + rand(id, 6) * 26;
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
        <span>Papers {SEED_PAPERS.length}</span>
        <span className="text-sky-300">Value map {SEED_VALUES.length + values.length}</span>
        <span className="text-sky-300">Buyer categories {catNodes.length}</span>
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
          const st = (c as { state?: string }).state;
          const assumed = (c as { seed?: boolean }).seed === true || (st !== "confirmed" && w === 0);
          const faded = st === "faded";
          const side = Math.abs(y - CY) < 30 ? (x > CX ? 1 : -1) : 0; // left/right categories: label beside the node
          return (
            <g key={id} className="db-drift" style={drift(d)}>
              <path d={curve(x, y, bend)} fill="none" stroke={col} strokeOpacity={assumed ? 0.28 : 0.55} strokeWidth={1.3}
                strokeDasharray={assumed ? "3 4" : undefined} />
              <motion.g animate={{ opacity: faded ? 0.3 : 1 }}>
                <motion.circle cx={x} cy={y} fill={col} fillOpacity={assumed ? 0.05 : 0.18}
                  animate={{ r: 12 + Math.min(10, w * 10) }} transition={{ type: "spring", stiffness: 120, damping: 14 }} />
                <circle cx={x} cy={y} r={6} fill={assumed ? "none" : col} stroke={col} strokeWidth={1.4} strokeDasharray={assumed ? "2 2" : undefined} />
                <text x={side ? x + side * 16 : x} y={side ? y + 4 : y + (above ? -18 : 27)} textAnchor={side > 0 ? "start" : side < 0 ? "end" : "middle"}
                  className={`font-sans text-[12px] ${assumed ? "fill-slate-400" : "fill-slate-100 font-semibold"}`} stroke="#020510" strokeWidth={4} paintOrder="stroke">
                  {CAT_SHORT[id] ?? c.name.split(/[:(]/)[0].trim()}
                </text>
              </motion.g>
            </g>
          );
        })}

        {/* Abergel: where the science comes from */}
        <g opacity={0.6}>
          <path d={`M ${CX} ${CY + 7} L ${CX} ${CY + 34}`} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={CX} cy={CY + 37} r={3} fill="none" stroke="#94a3b8" strokeWidth={1.2} />
          <text x={CX} y={CY + 52} textAnchor="middle" className="fill-slate-400 font-sans text-[10px]" stroke="#020510" strokeWidth={3} paintOrder="stroke">
            science from Abergel
          </text>
        </g>

        {/* papers (seed): what we read */}
        {SEED_PAPERS.map((p) => {
          const { x, y } = polar(p.a, 82, 0.8);
          const left = x < CX - 10;
          return (
            <g key={p.id}>
              <path d={curve(x, y, 14)} fill="none" stroke="#94a3b8" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 4" />
              <rect x={x - 3.5} y={y - 3.5} width={7} height={7} fill="none" stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="2 2" />
              <text x={x + (left ? -8 : 8)} y={y + 4} textAnchor={left ? "end" : "start"} className="fill-slate-400 font-sans text-[10.5px] italic" stroke="#020510" strokeWidth={3} paintOrder="stroke">
                {p.label}
              </text>
            </g>
          );
        })}

        {/* value map seed: dashed until the interview confirms (strengthen → solid, bright) */}
        {SEED_VALUES.filter((v) => has(v.id)).map((v) => {
          const { x, y } = polar(v.a, 140, 0.86);
          const sv = streamValue(v.id);
          const confirmed = sv?.state === "confirmed";
          const faded = sv?.state === "faded";
          const left = x < CX - 10;
          return (
            <motion.g key={v.id} animate={{ opacity: faded ? 0.3 : 1 }}>
              <path d={curve(x, y, -18)} fill="none" stroke="#7dd3fc" strokeOpacity={confirmed ? 0.6 : 0.22} strokeWidth={confirmed ? 1.4 : 1}
                strokeDasharray={confirmed ? undefined : "3 4"} />
              <motion.circle cx={x} cy={y} animate={{ r: confirmed ? 5.5 : 4 }} fill={confirmed ? "#7dd3fc" : "none"} stroke="#7dd3fc" strokeWidth={1.3}
                strokeDasharray={confirmed ? undefined : "2 2"} />
              <text x={x + (left ? -9 : 9)} y={y + 4} textAnchor={left ? "end" : "start"}
                className={`font-sans text-[11px] ${confirmed ? "fill-sky-100 font-semibold" : "fill-slate-400"}`} stroke="#020510" strokeWidth={4} paintOrder="stroke">
                {v.label}
              </text>
            </motion.g>
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
        <text x={CX} y={CY - 14} textAnchor="middle" className="fill-white font-sans text-[12px] font-semibold" stroke="#020510" strokeWidth={4} paintOrder="stroke">
          Hannah Weber · HOPO
        </text>
      </svg>
      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {idle ? "What we read in her papers · dashed = AI assumption" : "What Hannah adds · solid = she confirmed · white = her own words"}
      </p>
    </div>
  );
}
