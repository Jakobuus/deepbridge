# DeepBridge

DeepBridge helps a deep-tech founder—a researcher building a company around scientific or engineering advances—find potential technical buyers.
It turns public research into buyer hypotheses and cited introduction paths through co-authors and lab networks.
The founder checks the evidence, reviews a draft, and approves its exact text. Nothing is sent.

> **Screenshot placeholder:** buyer graph, dated evidence, and draft approval screen.

Built at HackwithBay 4.0, 24 Nov 2026. The stage case is **Lightmatter / Nicholas C. Harris**, replayed from cached research.

## Quick start

Requires Python 3.12, [uv](https://docs.astral.sh/uv/), and Node.js with npm for the web app.

From the repository root, start the service:

```sh
cd service
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

In another terminal, start the web app when the `web/` directory is available:

```sh
cd web
npm install
npm run dev
```

Open http://localhost:3000. The API explorer is at http://localhost:8000/docs and works without the web app. This checkout currently contains the service; the web app is a separate team deliverable.

The cached stage case needs no provider credentials. For optional live lookups, copy the template from the repository root:

```sh
cp .env.example .env
```

| Variables in [`.env.example`](.env.example) | Use today |
|---|---|
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | Enable live Moss contact checks; cached contacts remain available without them. |
| `OPENALEX_API_KEY` | Optional key for OpenAlex research lookups. |
| `FLEXPRICE_API_KEY`, `FLEXPRICE_BASE_URL` | Reserved for the planned Flexprice connection; the current credit gate is local. |

Keep credentials out of version control. New-founder ICP generation and uncached drafts also require an authenticated Claude CLI; the service invokes it with tools and MCP disabled. The cached stage flow makes no generation calls.

With a freshly started service, verify the demo from the repository root:

```sh
bash service/smoke.sh
```

The smoke check changes in-memory drafts, pipeline stages, and credits. Restart the service before presenting. See [DEMO.md](DEMO.md) for rehearsal, reset, warm-cache, and offline fallback steps.

## Five modules

| Module | What the judge can inspect | Endpoints |
|---|---|---|
| Intake / ICP | Founder research and evidence-backed buyer hypotheses | `POST /intake`, `GET /icp` |
| Buyers | Ranked organizations and public research or hiring signals | `GET /buyers` |
| Graph / paths | Research connections, dated evidence, and human name checks | `GET /graph`, `GET /paths`, `GET /evidence/{id}`, `POST /name-check`, `GET /search?q=` |
| Contacts / drafts | Cached or live contact checks, editable drafts, and approval tied to the exact text | `GET /contacts/{person_id}`, `POST /contacts/{person_id}/refresh`, `POST /drafts`, `PUT /drafts/{id}`, `POST /approve` |
| Pipeline / metrics | Stages, actor history, and remaining credits | `GET /pipeline`, `POST /pipeline/{card_id}/advance`, `GET /metrics`, `GET /credits` |

## Sponsor integrations

- **Moss Tasks — built, credentials required for live use.** A browser task checks a person's role and public profiles using `moss-fast`, structured output, verification, and runtime/cost limits. Cached results support stage replay. Moss is not asked for emails or phone numbers. **Moss fast inference for voice intake is planned**, with no live inference flow in this checkout.
- **Flexprice — connection planned.** The working local gate starts with five demo credits, charges for draft requests, and returns HTTP 402 when exhausted. `/credits` exposes the balance, events, and `source`. Flexprice wallet lookup and usage metering are planned; the demo currently reports `source: local`.
- **OpenAlex — built.** Public papers support founder intake, buyer research, and source links. Research responses are cached.

## What the demo claims

Cached research and replayed contacts are labelled. Seeded pipeline history is simulated. ICP needs and segments are hypotheses; buyer scores rank public signals, not purchase intent. Graph paths and scores come from demo fixtures; building paths for arbitrary founders is planned.

Every factual claim needs evidence with a `source_url`. A link says “co-authored 2017,” never that two people know each other. Publication affiliations are stated **as of their cited date** and do not establish current employment. Live contact checks carry separate sources and dates.

Nothing is sent to real people. Approval records a decision on the current draft hash; editing an approved draft makes it stale and requires approval again.

## Team and further reading

- **Jakob:** sales workflow, ideal customer profile, buyers, contacts, and drafts.
- **Erick:** research graph, paths, and evidence.
- **Mark:** web experience and visual demo.

Read the [architecture](docs/architecture.md) for implementation details and the [viability assessment](docs/viability.md) for customers, pricing, and risks.
