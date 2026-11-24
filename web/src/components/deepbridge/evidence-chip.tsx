"use client";

import { ExternalLink, FileCheck2 } from "lucide-react";
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

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
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
        <a
          href={ev.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open source: ${ev.source_url}`}
          className="inline-flex items-center justify-center rounded border border-white/15 bg-white/5 p-1 text-muted-foreground transition hover:border-white/40 hover:text-foreground"
        >
          <ExternalLink className="size-2.5" />
        </a>
      )}
    </span>
  );
}
