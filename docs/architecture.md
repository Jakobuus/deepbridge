# DeepBridge architecture

The [system design](system-design.md) describes the pipeline, graph ontology, scoring, review gates and HOPO worked example. This page maps the main runtime entry points.

## Service and web app

The [FastAPI entry point](../service/app/main.py) loads JSON fixtures into the [in-memory store](../service/app/store.py) on startup. The [shared contract](../contracts/types.ts) is mirrored by the [Python models](../service/app/models.py). The [Next.js app](../web/) calls the API through its [typed client](../web/src/lib/api.ts) and displays dated evidence alongside buyers, paths and drafts.

## Data and replay

- The default smoke flow uses Lightmatter fixture replay. For other author IDs, the [graph loader](../service/app/lanes/erick/pull.py) computes from a saved OpenAlex dataset or fetches data when the dataset is absent. Graph endpoints label provenance and report partial results in response headers.
- The HOPO briefing has a [separate cached session](../fixtures/briefing_demo_hopo.json). [Graph events](../service/app/events.py) carry reading, interview, discovery and path updates. The API supports an event log and replay over server-sent events.
- Text generation uses the authenticated [Claude CLI wrapper](../service/app/llm.py) with tools and MCP disabled. The demo can replay cached research and draft templates. Seeded pipeline history is simulated.

## State and approvals

The store records identity checks, drafts, hash-bound approvals, credits and pipeline history. Editing an approved draft makes it stale. Identity checks and approval decisions are distinct. The pipeline records stage changes and whether the actor was human or an agent. Nothing is sent.

See the [setup and smoke check](../README.md#run-it) to start a fresh local service.
