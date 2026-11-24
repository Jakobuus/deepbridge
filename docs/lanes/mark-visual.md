# Lane: Mark — every screen, dashboard, Moss search, video

Files: `web/` (Next.js), `service/app/routers/search.py`, `service/app/lanes/mark/`. Contract: `contracts/types.ts`.
API base http://localhost:8000 (base service + fixtures land on `main` ~11:40; until then code against
`contracts/types.ts` with the fixture shapes). Rules: `AGENTS.md`.

Screens (one flow, left nav, stage-ready at 1440×900):
1. **Intake**: founder name/DOI box → founder card (topics, papers) → "Find buyers".
2. **ICP & buyers**: buyer roles/industries/needs with source chips; buyer orgs ranked with "why now" signals.
3. **Warm paths** (the hero): graph, founder → bridge → buyer, the chosen path lights up; edge labels like
   "co-authored 2017 (MIT)"; click an edge → evidence drawer (quote + link + date); name-check ok/reject buttons.
4. **Draft & approve**: intro request + forwardable note, evidence chips inline, edit → "needs re-approval",
   Approve/Reject; credit balance visible; 402 → "out of credits" state.
5. **Pipeline & analytics**: Kanban by stage (found → path_checked → draft → approved → intro_asked → intro_made →
   pilot) with actor badges (agent vs human); conversion per stage, by path kind, by actor.
Moss: `GET /search?q=` backed by Moss (project key in `.env` as MOSS_PROJECT_ID/KEY; Jakob gets it from the Moss
table) indexing researchers/topics for "people passionate about the field"; show `ms` and engine; fallback "cache".
Ask the Moss team what "best use" means and tell the board.
Video (2–3 min, recorded 14:30–15:15): intake → graph lights up → draft → approval → dashboard.
Checkpoints: 12:00 all 5 screens click through on fixtures · 13:30 real data + Moss · 14:30 freeze.
