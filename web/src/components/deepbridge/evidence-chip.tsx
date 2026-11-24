"use client";

import { ArrowUpRight, FileText } from "lucide-react";
import type { Evidence, Id } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EvidenceChipProps {
  evidenceId: Id;
  evidenceMap: Record<Id, Evidence>;
  onInspect: (evidenceId: Id) => void;
  compact?: boolean;
  className?: string;
}

const KIND_HUMAN: Record<Evidence["kind"], string> = {
  paper: "Paper",
  affiliation: "Affiliation",
  job_post: "Job Post",
  filing: "Filing",
  grant: "Grant",
  web: "Web",
  board_page: "Board",
};

export function EvidenceChip({
  evidenceId,
  evidenceMap,
  onInspect,
  compact = false,
  className,
}: EvidenceChipProps) {
  const ev = evidenceMap[evidenceId];
  const year = ev?.source_date ? ev.source_date.slice(0, 4) : null;
  const kindLabel = ev?.kind ? KIND_HUMAN[ev.kind] ?? "Source" : "Source";
  const label = compact
    ? `${kindLabel}${year ? ` '${year.slice(2)}` : ""}`
    : `${kindLabel}${year ? ` · ${year}` : ""}`;

  return (
    <span className={cn("group/chip inline-flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInspect(evidenceId);
        }}
        title={ev ? `${ev.quote} — ${ev.source_url}` : "Inspect cited source"}
        className="inline-flex items-center gap-1.5 border border-white/15 bg-[#0f1117] px-2.5 py-1 font-mono text-xs font-medium text-sky-300 transition-colors hover:border-sky-400 hover:bg-[#0b2536] hover:text-white"
      >
        <FileText className="size-3.5 text-sky-400" />
        <span>{label}</span>
      </button>
      {ev?.source_url && (
        <a
          href={ev.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open original source: ${ev.source_url}`}
          className="inline-flex items-center justify-center border border-transparent px-1.5 py-1 text-muted-foreground opacity-0 transition-all group-hover/chip:opacity-100 hover:border-white/25 hover:text-white focus:opacity-100"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      )}
    </span>
  );
}
