"use client";

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FlaskConical,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GOLDEN_FOUNDER_ID } from "@/lib/api";
import type { Evidence, Founder, Icp, Id, IntakeForm } from "@/lib/types";
import { EvidenceChip } from "./evidence-chip";

interface ScreenIntakeProps {
  founder: Founder | null;
  icp: Icp | null;
  evidenceMap: Record<Id, Evidence>;
  loadingIntake: boolean;
  intakeError: string | null;
  onSubmitQuery: (query: string) => Promise<void>;
  onSubmitForm: (form: IntakeForm) => Promise<void>;
  onInspectEvidence: (evidenceId: Id) => void;
  onGoToBuyers: () => void;
}

export function ScreenIntake({
  founder,
  icp,
  evidenceMap,
  loadingIntake,
  intakeError,
  onSubmitQuery,
  onSubmitForm,
  onInspectEvidence,
  onGoToBuyers,
}: ScreenIntakeProps) {
  const [quickQuery, setQuickQuery] = React.useState("Nicholas C. Harris");
  const [name, setName] = React.useState("Nicholas C. Harris");
  const [expertise, setExpertise] = React.useState(
    "Coherent nanophotonic circuits, silicon photonics, and optical interconnects for AI compute clusters",
  );
  const [paperLinksRaw, setPaperLinksRaw] = React.useState(
    "https://doi.org/10.1038/nphoton.2017.93",
  );
  const [startupUrl, setStartupUrl] = React.useState("https://lightmatter.co");
  const [customerPersona, setCustomerPersona] = React.useState(
    "Hyperscale AI infrastructure, optical interconnect architecture, and silicon photonics R&D leads",
  );
  const [interviewTranscript, setInterviewTranscript] = React.useState("");

  const isGoldenReplay = founder?.id === GOLDEN_FOUNDER_ID;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const links = paperLinksRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmitForm({
      name: name.trim(),
      expertise: expertise.trim(),
      paper_links: links,
      startup_url: startupUrl.trim() || null,
      customer_persona: customerPersona.trim(),
      interview_transcript: interviewTranscript.trim() || null,
    });
  };

  const handleQuickLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickQuery.trim()) return;
    await onSubmitQuery(quickQuery.trim());
  };

  const topBuyerRole = icp?.buyer_roles?.[0];
  const topNeed = icp?.needs?.[0];

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* LEFT: SIGN-UP / INTAKE + TRY ANY FOUNDER */}
      <div className="xl:col-span-5 space-y-5">
        <Card flat border className="border-white/15 bg-white/[0.02] py-5 gap-4">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-sky-300">
                Quick Research Lookup
              </span>
              <Badge flat className="font-mono text-[10px] border-white/20">
                POST /intake
              </Badge>
            </div>
            <CardTitle className="text-lg">Try Any Deep-Tech Founder or DOI</CardTitle>
            <CardDescription className="text-xs">
              Enter an OpenAlex author name, OpenAlex ID, or paper DOI — or load the cached Lightmatter golden replay.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 space-y-3">
            <form onSubmit={handleQuickLookup} className="flex gap-2">
              <Input
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder="e.g. Nicholas C. Harris, Dirk Englund, 10.1038/nphoton.2017.93"
                className="font-mono text-xs"
              />
              <Button type="submit" variant="default" flat disabled={loadingIntake}>
                <Search className="size-3.5" />
                {loadingIntake ? "Resolving..." : "Resolve"}
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Presets:</span>
              <button
                type="button"
                onClick={() => {
                  setQuickQuery("Nicholas C. Harris");
                  void onSubmitQuery("Nicholas C. Harris");
                }}
                className="rounded border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-200 hover:bg-emerald-500/20"
              >
                ★ Nicholas C. Harris (Lightmatter Replay)
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickQuery("10.1038/nphoton.2017.93");
                  void onSubmitQuery("10.1038/nphoton.2017.93");
                }}
                className="rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-white/35 hover:text-foreground"
              >
                DOI: 10.1038/nphoton.2017.93
              </button>
            </div>
          </CardContent>
        </Card>

        <Card flat border className="border-white/15 bg-white/[0.02] py-5 gap-4">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Structured Founder Sign-Up
              </span>
              {!isGoldenReplay && founder && (
                <Button
                  size="xs"
                  flat
                  onClick={() => void onSubmitQuery("Nicholas C. Harris")}
                  className="border border-amber-400/40 bg-amber-500/15 font-mono text-[10px] text-amber-100"
                >
                  <RotateCcw className="size-3" />
                  Restore Lightmatter Replay
                </Button>
              )}
            </div>
            <CardTitle className="text-lg">Founder & Lab-to-Market Intake</CardTitle>
            <CardDescription className="text-xs">
              Captures technical expertise, anchor papers, startup URL, and target buyer hypothesis.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <form onSubmit={handleFormSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase text-muted-foreground">
                    Founder Name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[11px] uppercase text-muted-foreground">
                    Startup URL
                  </label>
                  <Input
                    value={startupUrl}
                    onChange={(e) => setStartupUrl(e.target.value)}
                    placeholder="https://..."
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Technical Expertise & Breakthrough
                </label>
                <Input
                  value={expertise}
                  onChange={(e) => setExpertise(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Anchor Paper DOIs / OpenAlex Links (comma or newline separated)
                </label>
                <Input
                  value={paperLinksRaw}
                  onChange={(e) => setPaperLinksRaw(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Initial Customer Persona Hypothesis
                </label>
                <Textarea
                  value={customerPersona}
                  onChange={(e) => setCustomerPersona(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[11px] uppercase text-muted-foreground">
                  Optional Founder Discovery Notes / Voice Transcript
                </label>
                <Textarea
                  value={interviewTranscript}
                  onChange={(e) => setInterviewTranscript(e.target.value)}
                  rows={2}
                  placeholder="Optional notes from technical founder interview..."
                  className="text-xs"
                />
              </div>

              {intakeError && (
                <div className="rounded border border-red-500/40 bg-red-500/10 p-2.5 font-mono text-xs text-red-200">
                  {intakeError}
                </div>
              )}

              <Button type="submit" flat className="w-full border border-white/25" disabled={loadingIntake}>
                <FlaskConical className="size-4" />
                {loadingIntake ? "Synthesizing Founder Graph..." : "Run Founder Intake"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT: RESOLVED FOUNDER PROFILE + STORY TRANSLATION */}
      <div className="xl:col-span-7 space-y-5">
        {founder ? (
          <>
            <Card flat border className="border-white/20 bg-white/[0.03] py-5 gap-4">
              <CardHeader className="px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      flat
                      className={
                        isGoldenReplay
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 font-mono text-[10px]"
                          : "border-sky-400/40 bg-sky-500/15 text-sky-200 font-mono text-[10px]"
                      }
                    >
                      {isGoldenReplay ? "CACHED RESEARCH REPLAY" : "LIVE OPENALEX INTAKE"}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">{founder.id}</span>
                  </div>
                  {founder.openalex_id && (
                    <a
                      href={founder.openalex_id}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 px-2.5 py-1 font-mono text-xs hover:border-white/40"
                    >
                      OpenAlex Author Profile <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>

                <div className="pt-1">
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    {founder.name}{" "}
                    <span className="font-normal text-muted-foreground">· {founder.company}</span>
                  </CardTitle>
                  <CardDescription className="mt-1.5 text-sm leading-relaxed text-foreground/90">
                    {founder.summary}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="px-6 space-y-4">
                <div className="space-y-1.5">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Indexed Research Domains ({founder.topics.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {founder.topics.map((topic) => (
                      <Badge
                        key={topic}
                        flat
                        className="border-white/20 bg-white/[0.06] px-3 py-1 font-mono text-xs text-foreground"
                      >
                        <Cpu className="mr-1 size-3 text-sky-300" />
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Verified Anchor Evidence ({founder.evidence_ids.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {founder.evidence_ids.map((eid) => (
                      <EvidenceChip
                        key={eid}
                        evidenceId={eid}
                        evidenceMap={evidenceMap}
                        onInspect={onInspectEvidence}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* STORY TRANSLATION ENGINE CARD */}
            <Card flat border className="border-sky-400/30 bg-sky-950/[0.14] py-5 gap-4">
              <CardHeader className="px-6">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-sky-300">
                  <Sparkles className="size-3.5" />
                  <span>Lab-to-Buyer Story Translation (Zero Hallucinated Claims)</span>
                </div>
                <CardTitle className="text-lg">
                  From Academic Publication Language → Commercial Buyer Urgency
                </CardTitle>
                <CardDescription className="text-xs">
                  Technical founders write in physics & circuit primitives; enterprise buyers buy cluster bandwidth, interconnect power efficiency, and roadmap velocity.
                </CardDescription>
              </CardHeader>

              <CardContent className="px-6 space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded border border-white/15 bg-black/40 p-4 space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <BookOpen className="size-3.5 text-amber-300" />
                      <span>What The Papers Say (Lab Frame)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/90">
                      Co-authored research in{" "}
                      <span className="font-semibold text-white">
                        {founder.topics.join(" & ") || "deep-tech systems"}
                      </span>{" "}
                      — demonstrating programmable Mach-Zehnder interferometer meshes and coherent nanophotonic matrix multiplication at MIT.
                    </p>
                  </div>

                  <div className="rounded border border-emerald-400/30 bg-emerald-950/20 p-4 space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                      <span>What Enterprise Buyers Hear (Commercial Frame)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/95">
                      {topBuyerRole ? (
                        <>
                          <span className="font-semibold text-emerald-200">{topBuyerRole.title}:</span>{" "}
                          {topBuyerRole.why}
                        </>
                      ) : (
                        "Eliminate electrical interconnect bottlenecks between AI accelerators using silicon-photonic optical links that scale cluster throughput per watt."
                      )}
                    </p>
                    {topNeed && (
                      <div className="pt-1 flex flex-wrap gap-1.5">
                        {topNeed.evidence_ids.slice(0, 2).map((eid) => (
                          <EvidenceChip
                            key={eid}
                            evidenceId={eid}
                            evidenceMap={evidenceMap}
                            onInspect={onInspectEvidence}
                            compact
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
                  <div className="font-mono text-xs text-muted-foreground">
                    Next: Rank commercial buyer organizations & 90-day publication signals.
                  </div>
                  <Button variant="default" flat onClick={onGoToBuyers}>
                    <span>02 · Find Buyers & Why-Now Signals</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card flat border className="border-white/15 p-8 text-center font-mono text-xs text-muted-foreground">
            Loading founder research profile...
          </Card>
        )}
      </div>
    </div>
  );
}
