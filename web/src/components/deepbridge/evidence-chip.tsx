"use client";

import { ExternalLink, FileCheck2 } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { API_BASE } from "@/lib/api";
import type { Evidence, Id } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EvidenceChipProps {
  evidenceId: Id;
  evidenceMap: Record<Id, Evidence>;
  onInspect: (evidenceId: Id) => void;
  compact?: boolean;
  className?: string;
}

// Evidence missing from the page's map (e.g. buyer signals: /buyers returns ids only) is fetched once from
// GET /evidence/{id} and cached for the session, so the chip shows the paper/link title instead of the id slug.
const evidenceCache = new Map<Id, Promise<Evidence | null>>();

function fetchEvidence(id: Id): Promise<Evidence | null> {
  let p = evidenceCache.get(id);
  if (!p) {
    p = fetch(`${API_BASE}/evidence/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Evidence>) : null))
      .catch(() => null);
    evidenceCache.set(id, p);
  }
  return p;
}

function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function EvidenceChip({
  evidenceId,
  evidenceMap,
  onInspect,
  compact = false,
  className,
}: EvidenceChipProps) {
  const mapped = evidenceMap[evidenceId];
  const [fetched, setFetched] = React.useState<Evidence | null>(null);

  React.useEffect(() => {
    if (mapped) return;
    let alive = true;
    fetchEvidence(evidenceId).then((ev) => {
      if (alive) setFetched(ev);
    });
    return () => {
      alive = false;
    };
  }, [evidenceId, mapped]);

  const ev = mapped ?? fetched ?? undefined;
  const shortSlug = evidenceId.replace(/^evidence:/, "").slice(0, 18);
  const year = ev?.source_date ? ev.source_date.slice(0, 4) : null;
  // Paper/link title first (cleaner); the id slug shows only while loading or when the source has no quote.
  // "field: https://…" quotes (API query evidence) read better as the source name than as a raw URL.
  const fieldUrl = ev?.quote?.match(/^[a-z_ ]+:\s*https?:\/\/(?:api\.)?([^/\s]+)/i);
  const sourceName = fieldUrl
    ? `${fieldUrl[1].replace(/\.(org|com|net)$/, "").replace(/^\w/, (c) => c.toUpperCase())} query`
    : null;
  const title = sourceName ?? (ev?.quote ? shorten(ev.quote, compact ? 34 : 56) : shortSlug);
  const label = year && !compact ? `${title} · ${year}` : title;

  // The source-link icon stays hidden and pops in (Motion spring) on hover or keyboard focus of the chip.
  const [shown, setShown] = React.useState(false);

  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1", className)}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInspect(evidenceId);
        }}
        title={ev ? `${ev.quote} (${ev.source_url})` : `Inspect ${evidenceId}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 text-left text-[11px] font-medium text-sky-200 transition hover:border-sky-300 hover:bg-sky-500/20"
      >
        <FileCheck2 className="size-3 shrink-0 text-sky-300" />
        <span className={cn("truncate", !ev?.quote && "font-mono")}>{label}</span>
      </button>
      {ev?.source_url && (
        <motion.a
          href={ev.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open source: ${ev.source_url}`}
          aria-label={`Open source: ${ev.source_url}`}
          initial={false}
          animate={shown ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.5, x: -6 }}
          transition={{ type: "spring", stiffness: 520, damping: 26 }}
          style={{ pointerEvents: shown ? "auto" : "none" }}
          className="inline-flex shrink-0 items-center justify-center rounded border border-white/15 bg-white/5 p-1 text-muted-foreground hover:border-white/40 hover:text-foreground"
        >
          <ExternalLink className="size-2.5" />
        </motion.a>
      )}
    </span>
  );
}
