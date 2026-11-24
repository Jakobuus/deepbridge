# DeepBridge: the shared plan (single source of truth; updated 24 Nov 12:40 PT)

Everyone (people and agents) works from this file + `CLAUDE.md` (working rules) + `AGENTS.md` (file ownership) +
`contracts/types.ts` (data shapes). If something here is outdated, say so on the board; the orchestrator updates it.

## 1. Product in one breath
Deep-tech founders (a company out of a PhD or a lab) don't need more leads; they need a warm path into the R&D team of
their first technical buyer. DeepBridge reads the founder's research, interviews them by voice until the value
proposition is sharp, then grows **one layered knowledge graph** from the founder outwards to the buyers and the
people who can introduce them, every link with a cited, dated source. A human approves every intro. Nothing is sent.

## 2. The flow (what the product does)
1. **Input:** founder name, paper links (DOI/arXiv/URL), startup website, notes; optional **Connect Notion / Google
   Drive** buttons (connectors ported; real workspace not needed for the pitch).
2. **Reading:** the AI reads paper (abstract, open-access full text), website, notes, docs → briefing: what it understood,
   claims with sources, **gaps** (who buys, what it replaces, what number improves, why now). The graph's **core layer
   grows live on screen** while it reads (features from the paper).
3. **Live voice interview** (real conversational voice AI that reacts and can be interrupted): reads back its
   understanding ("did I get it right?"), asks the gaps first, sharp but friendly technical buyer/investor.
   **Stage mode** ≈ 75 s (understanding + value, buyer, why now + read-back); **full mode** ≤ 8 questions.
   Each answer feeds the graph live: value → problems → buyer roles → **buyer categories** (colour per category).
4. **Discovery + warm paths, while the interview runs:** buyer companies per category (on-topic papers last 90 days,
   job posts, citations of the founder's work), then warm-path candidates light up: former lab mates, co-authors who
   sit at a university AND a company, the PhD advisor's lab, co-authors, shared boards, buyer scientists who cite the
   founder, topic-aligned researchers. Affiliations are "as of <date>", never "current" unless verified.
5. **Verify:** Moss web agent checks a bridge person's current role (example: a co-author listed at NTT Research in
   2024 papers is, since January 2026, also CTO of Opticore) and finds named technical people at a buyer.
6. **Intro draft** to the bridge person + 2-sentence forwardable note (template owned by Jakob) → **human approval**
   bound to the exact text (edit = re-approve) → **pipeline** (stages, agent vs human attribution, conversion analytics).
7. **Credits:** paid steps (drafts, live checks, prospecting) are metered (Flexprice; local counter as fallback).

## 3. The demo (16:00, 3 minutes, top 5)
- **≤ 1:30 video (Mark):** intro + the parts that are technical / fast-forward: the AI building knowledge about founder
  and product, the graph building, lead finding, the graph breaking out from the founder into the world. ElevenLabs
  voiceover. Recorded from the app (reset first).
- **1:30 live on stage:** the voice interview (stage mode) with the graph growing next to it and warm peers lighting up.
- Fallbacks: cached data for every screen; fast-forward replay of a recorded session; typed interview if audio fails.

## 4. Who builds what (lanes)
| Lane | Owner | Scope |
|---|---|---|
| Sales + ICP | **Jakob** (+ his agents) | intake/ICP, reading + briefing, interview logic + turns + transcript, value map, buyer categories, signals, contacts/Moss, intro template, approval, credits, pitch |
| Graph infrastructure | **Erick** (+ his agents) | event bus + `GET /graph/stream` (live + fast-forward), discovery + warm paths during the interview, path scoring, `/knowledge-graph`, `docs/architecture.md` |
| Visual | **Mark** (+ his agents) | **all UI** (`web/`): input + connector buttons, live layered graph (core → categories → leads), interview screen (embeds the hosted voice app), table ↔ graph, dashboard, design system, video |
| Orchestration | Jakob's main session (BlueLake) | contract, merges after demo check, this plan, briefs |

## 5. What exists on `main` now (API on :8000; `bash scripts/demo-reset.sh`)
Intake (any founder, live) · ICP from papers · buyers + why-now signals · adjacent companies · graph + paths for any
founder · value map (core layer) · buyer categories · `/knowledge-graph` (all layers) · contacts with Moss current-role
checks · Moss prospecting · intro drafts · hash-bound approval · pipeline + metrics + activity feed · credit gate
(Flexprice-ready) · paper-grilling interview (text) · contract for live events (`GraphEvent`, `/graph/stream`,
`/interview/brief`, `/interview/turn`). Building: briefing + live events (Jakob lane), connectors, transcript receiver +
public tunnel for the hosted voice app, graph stream (Erick), UI (Mark).

## 6. Judging criteria → subplans
**Detailed subplans per criterion (tasks, owners, status, demo moment): [`docs/plan/`](plan/README.md).**

ICP & discovery 20% (cited ICP, buyers with sources, expansion via categories) · Enrichment & outreach 20% (Moss-verified
contacts, signal-personalised intro, strict approval) · Dashboard 15% (stages, agent/human attribution, conversion) ·
Viability 15% (founders pay per path in credits; tech-transfer offices / accelerators buy seats per cohort) ·
Tech & demo 10% (clean API + live demo) · sponsors: Moss (Tasks API + inference), Flexprice (metering, credit gate).

## 7. Open team decisions (Jakob + Erick + Mark)
1. Demo founder: Lightmatter (rich data, but a large company with customers) vs a seed-stage spinout, e.g. Opticore /
   Zaijun Chen (its CTO is already in our graph). 2. The "break-out into the world" visual: world map (real institution
   locations) vs abstract deep space. 3. Who/what Jakob plays on stage. 4. Pitch line. 5. Pipeline stage names.

## 8. Clock (PT)
13:30 real data everywhere · **14:30 feature freeze** · 14:30–15:15 video + backup take · 15:15 submit · 15:30 deadline ·
16:00 pitch.

## 9. Honesty rules (non-negotiable)
Every claim on screen has a source link; co-author = "co-authored 2017", never "knows"; affiliations dated; replayed or
cached data labelled; no invented numbers; no "first"/"only"; nothing is sent to real people.
