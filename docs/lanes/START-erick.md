# Erick: start here (read in 2 minutes)

## For Erick (the person)
**What we build:** DeepBridge. Deep-tech founders (PhD/lab spinouts) don't need more leads; they need a warm path into a
technical buyer's R&D team. The founder uploads their papers → a live voice AI grills them until the value proposition is
sharp → one **layered knowledge graph**: core = founder, papers, value map (feature → benefit → value → problem);
middle = buyer categories by problem set (one colour each); outer = buyer companies, people and warm paths (former lab
mates, co-authors, advisor's lab), every link with a cited, dated source. Moss's web agent verifies current roles; a
human approves every intro draft. Nothing is sent.
**Demo (16:00, 3 min):** 1:30 video (Mark) for the technical parts (graph building, lead finding, the graph breaking out
into the world) + 1:30 live voice interview on stage.
**Your lane = the graph.** Agents already built a first version while you were on your way (all on `main`):
OpenAlex pull + graph + warm-path finder for any founder (`service/app/lanes/erick/`, `routers/graph.py`, `paths.py`),
tested on Yet-Ming Chiang. You own it now: review, improve scoring, and own `docs/architecture.md` (system design doc the
organisers require; a draft exists).
**Team decisions waiting for you + Jakob + Mark:** (1) demo founder: Lightmatter (big, has customers: weak "first buyer"
story) vs a seed-stage spinout, e.g. **Opticore / Zaijun Chen** (MIT postdoc, CTO Ryan Hamerly is already in our graph);
(2) how the graph "breaks out into the world" (world map with real institution locations vs abstract deep space).
**Clock:** 13:30 real data everywhere · 14:30 freeze · 15:15 submit.

## For Erick's agents
1. Accept the repo invite: https://github.com/Jakobuus/deepbridge/invitations (GitHub `raimaverick`).
2. Board: register as **RedHarbor** (Claude) / **GoldFalcon** (Codex) on project `/hackathon` (setup: ask Jakob for the
   one-prompt setup), read the newest BlueLake messages, reply "on board".
3. Read `AGENTS.md`, `contracts/types.ts` (esp. Edge, Path, KnowledgeGraph), `docs/lanes/erick-graph.md`,
   `service/app/lanes/erick/README.md`. Run: `bash scripts/demo-reset.sh && bash scripts/demo-check.sh`.
4. Brief Erick in 5 lines from this file, then propose his first 3 tasks, e.g.: path scoring with warmth × recency ×
   name-check and weakest-edge; FITS-edge join from buyer categories (`GET /categories`) to paths (`category_id`);
   geo coordinates for orgs (OpenAlex `institutions.geo`) if the team picks the world-map break-out.
5. Work on a `erick/<topic>` branch; post on the board when ready; the orchestrator (BlueLake) merges after the demo check.
