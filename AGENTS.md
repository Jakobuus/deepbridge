# DeepBridge: rules for every agent and teammate

Hackathon build (HackwithBay 4.0, 24 Nov 2026). Goal: a demo that works on stage. Speed over polish.

- **Contract:** `contracts/types.ts` (Python mirror `service/app/models.py`). Build against it; to change it, post on
  the board and let the orchestrator (Jakob's session) change it.
- **Lanes (stay in your files):**
  | Owner | Files |
  |---|---|
  | Jakob (sales, ICP) | `service/app/routers/icp.py`, `buyers.py`, `outreach.py`, `credits.py`, `contacts.py`, `service/app/lanes/jakob/` |
  | Erick (graph) | `service/app/routers/graph.py`, `paths.py`, `service/app/lanes/erick/`, `data/`, `docs/architecture.md` |
  | Mark (visual) | `web/`, `service/app/routers/search.py`, `service/app/lanes/mark/`, video |
  | Orchestrator | `contracts/`, `fixtures/`, `service/app/main.py`, `service/app/models.py`, `service/app/store.py`, `DEMO.md` |
- **Branches:** work on `<name>/<topic>` branches; merge to `main` only when `service` starts and the web flow clicks
  through end to end. Never `git checkout` in a shared folder: use a worktree. Commit small and often.
- **Honesty:** every claim on screen has an Evidence with `source_url`. A co-author link is "co-authored 2017", never
  "knows". Affiliations are "as of <date>". Mark cached or replayed data as such. No "first"/"only".
- **Nothing is sent** to real people. Drafts + approval only.
- **Secrets** live in `.env` (never committed); add each new key name to `.env.example`.
- **AI calls** run on subscription CLIs (`claude -p`, `codex exec`), no paid API keys; cache demo outputs in `fixtures/`.
- Run: `cd service && uv run uvicorn app.main:app --reload --port 8000` · `cd web && npm run dev` (port 3000).
