# DeepBridge: from paper to buyer

**From paper to buyer: bridging the commercialization gap for deep-tech founders.**

Built at HackwithBay 4.0, San Francisco, 24 Nov 2026.

**Demo video:** [docs/video/deepbridge-demo.mp4](docs/video/deepbridge-demo.mp4) · **Slide deck:** [docs/deepbridge-deck.pdf](docs/deepbridge-deck.pdf)

## Description (150 words)

Deep-tech founders publish strong science but rarely know who would buy it, or how to get a meeting.
DeepBridge reads a founder's papers and website, infers an ideal customer profile, and groups likely buyers into
categories, each organisation backed by cited public research. It then builds a knowledge graph of co-authors and lab
affiliations and finds warm paths: a dated, sourced chain from the founder's lab to a person at the buyer. Moss checks
that the person on the last hop still holds the role. A draft agent writes an intro request from cited facts, 12
automatic copy checks run on it, and a human approves the exact text. Nothing is sent. A dashboard tracks every stage, actor and
conversion. Flexprice meters usage and blocks paid steps when credits run out. Our demo
case: HOPO Therapeutics, a Berkeley Lab spinout, finds 59 buyer organisations and 50 warm paths, including into radiation and lead buyers.

## The problem

A researcher who starts a company can explain the molecule or the chip in detail. What they usually cannot say is which
team at which company has the budget for it, and who could introduce them. Generic lead lists give job titles at
companies. They do not give a reason for a specific scientist to take the call. The reason often already exists in the
public record: a shared paper, a shared lab, a citation. Finding it by hand takes days per account.

## How it works

1. **Intake and ICP.** The founder gives a name, a website and paper links. DeepBridge reads them, writes a briefing
   where every claim keeps a verbatim quote and its source, and infers an ideal customer profile. A short voice or text
   interview fills the gaps.
2. **Value map and buyer categories.** The papers become a value map (feature, benefit, value, problem): 50 nodes from
   30 papers in the demo. Problems group buyers into categories. For HOPO: radiation countermeasures, 89Zr PET imaging,
   MRI contrast (gadolinium removal), and lead poisoning as an expansion segment.
3. **Discovery.** Buyer organisations are ranked from public signals (recent on-topic papers, citations of the
   founder's work, job posts). The demo lists 59 buyer organisations, each with OpenAlex evidence.
4. **Warm paths and contact check.** A graph of co-author and affiliation edges finds 2 to 3 hop paths into each buyer,
   weighted by edge type, recency and a human name check. The featured path: a 2018 thorium chelator paper
   (doi 10.1021/acs.inorgchem.8b02430) links the HOPO science to Åsmund Larsen at Bayer. Moss then checks the live web:
   Larsen is listed as Radiopharmaceuticals manager at Bayer as of March 2024, and a second co-author on that paper,
   Roger Smeets, is listed at Bayer.
5. **Draft, approval, pipeline.** A draft agent writes an intro request and a forwardable note from cited facts. The
   draft passes 12 automatic checks (evidence IDs, numbers, length, relationship wording and more), then a human
   approves the exact text, bound by a SHA-256 hash. Editing an approved draft makes it stale. Approval moves the card
   on the pipeline dashboard, which shows stage, who did each step (agent or human) and conversion rates.

## How we meet each judging criterion

API base `http://127.0.0.1:8000` (explorer at `/docs`), web app `http://localhost:3000`.

| Criterion | What to look at |
|---|---|
| ICP & Discovery Quality (20%) | Inferred ICP and briefing with source chips: `POST /intake`, `GET /icp`, `GET /interview/brief/demo-hopo`. Four buyer categories incl. the lead-poisoning expansion segment: `GET /categories`. 59 cited buyer organisations: `GET /buyers`. Value map: `GET /value-map`. Code: `service/app/lanes/jakob/{briefing,grounding,icp,categories,signals}.py` |
| Enrichment & Outreach (20%) | Moss-verified role with source and date: `GET /contacts/{person_id}`, `POST /contacts/{person_id}/refresh`, cached results in `fixtures/contacts.json`. Signal-personalised draft with check results: `POST /drafts`, `PUT /drafts/{id}`. Hash-bound HITL gate: `POST /approve` (409 on a changed text). Code: `service/app/lanes/jakob/{contacts,drafts,draftchecks}.py`, `service/app/store.py` |
| Dashboard & Lead Management (15%) | Pipeline screen with stages, actor history (agent or human) and stage-to-stage conversion: `GET /pipeline`, `GET /metrics`, `POST /pipeline/{card_id}/advance`. Code: `service/app/routers/pipeline.py`, `web/src/components/deepbridge/screen-pipeline.tsx` |
| Startup Viability (15%) | Customer, pricing through credits, risks and next tests: [docs/viability.md](docs/viability.md) |
| Technical Execution & Demo (10%) | One run from intake to pipeline. Live graph replay of 268 recorded events: `GET /graph/stream?session_id=demo-hopo`. Ontology, query logic and reasoning loops: [docs/system-design.md](docs/system-design.md), [docs/architecture.md](docs/architecture.md). Smoke check: `service/smoke.sh` |
| Band: multi-agent + HITL decision | Band room with Planner, Builder, Reviewer and Security agents reviewing the Larsen/Bayer draft; a human approves with `@Security approve`, which calls our `/approve`. `scripts/band-demo.sh`, `service/band_agents.py`, [DEMO.md](DEMO.md) section 6 |
| Flexprice: metering + credit gate | Usage events `leads_enriched`, `outreach_sent`, `graph_queries` sent to a live Flexprice wallet; at zero credits the next draft returns HTTP 402 until a top-up. `GET /credits` shows balance, events and source. `service/app/lanes/jakob/credits.py`, `scripts/flexprice_{setup,topup}.py` |

## Sponsor integrations: what is real, what is simulated

| Integration | Real | Simulated or cached |
|---|---|---|
| **Band** | A real Band room with four agent accounts (Planner, Builder, Reviewer, Security). The draft, its sources and its 12 copy-check results come from our API. The human reply in the room calls our real approval endpoint and moves the pipeline card. | The agents' messages are scripted (no LLM in the room). |
| **Flexprice** | Live usage metering for `leads_enriched`, `outreach_sent` and `graph_queries`, a live prepaid wallet, and a credit gate that returns 402 at zero. Top-up through a script. | Without Flexprice keys, a local counter (5 demo credits) applies the same gate. Usage events are asynchronous; this is not an atomic production spending limit. |
| **Moss** | Moss Tasks checks a person's current role and public profiles with structured output and verification. Moss is not asked for emails or phone numbers. | On stage, contact results replay from cache (`fixtures/contacts.json`), labelled as cached, with source URL and date. |
| **OpenAlex** | Papers, authors, citations and affiliations. | Responses are cached so the demo runs offline. |

## Tech stack

- **Backend:** Python 3.12 (uv), FastAPI service in `service/`, server-sent events for the live graph.
- **Frontend:** Next.js web app in `web/`.
- **Data:** OpenAlex for research, Moss Tasks for role checks, cached fixtures for replay.
- **Generation:** Claude via the authenticated CLI, with tools and MCP disabled; drafts are checked by deterministic
  copy rules before a human sees them.
- **Integrations:** Band (REST, agent room), Flexprice (usage events, wallet).

## Team

- **Jakob Volbracht:** sales workflow, ICP, buyers, contacts, drafts, credits, pitch.
- **Erick Julyan** ([raimaverick](https://github.com/raimaverick)): research graph, warm paths, evidence, live graph events.
- **Mark Blake** ([WeekendSuperhero](https://github.com/WeekendSuperhero)): web experience and visual demo.

## Setup

See [README: Run it](README.md#run-it). The cached demo needs no provider credentials. Reset steps are in
[DEMO.md](DEMO.md).

## Honesty notes

- Cached research, cached contacts and the replayed graph stream are labelled as such. Seeded pipeline history is
  simulated.
- Nothing is sent to real people. Approval records a decision on the exact draft text and moves a card in our app.
- A co-author link says "co-authored 2018", never that two people know each other. Paper affiliations hold as of the
  paper's date; current roles come from a separate, dated Moss check.
- Buyer and path scores rank public signals. They do not measure purchase intent or relationship strength.
- Buyer categories are hypotheses for the founder to test. The lead-poisoning category is an expansion segment; we do
  not claim a lead buyer or any clinical advantage.
- The demo uses public information about HOPO Therapeutics and the published Berkeley Lab research behind it.
