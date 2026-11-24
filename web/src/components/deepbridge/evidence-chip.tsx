"use client";

import { ExternalLink, FileCheck2 } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import type { Evidence, Id } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EvidenceChipProps {
  evidenceId: Id;
  evidenceMap: Record<Id, Evidence>;
  onInspect: (evidenceId: Id) => void;
  compact?: boolean;
  className?: string;
}

export function EvidenceChip({
  evidenceId,
  evidenceMap,
  onInspect,
  compact = false,
  className,
}: EvidenceChipProps) {
  const ev = evidenceMap[evidenceId];
  const shortSlug = evidenceId.replace(/^evidence:/, "").slice(0, 18);
  const year = ev?.source_date ? ev.source_date.slice(0, 4) : null;
  const kindTag = ev?.kind ? ev.kind.replace("_", " ").toUpperCase() : "PROOF";

  // The source-link icon stays hidden and pops in (Motion spring) on hover or keyboard focus of the chip.
  const [shown, setShown] = React.useState(false);

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
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
        className="inline-flex items-center gap-1.5 rounded border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-200 transition hover:border-sky-300 hover:bg-sky-500/20"
      >
        <FileCheck2 className="size-3 text-sky-300" />
        <span>{compact ? shortSlug : `${kindTag}${year ? ` · ${year}` : ""} · ${shortSlug}`}</span>
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
          className="inline-flex items-center justify-center rounded border border-white/15 bg-white/5 p-1 text-muted-foreground hover:border-white/40 hover:text-foreground"
        >
          <ExternalLink className="size-2.5" />
        </motion.a>
      )}
    </span>
  );
}
