# DeepBridge

Warm intro paths from deep-tech founders to technical buyers, through the founder's research network
(co-authors, lab alumni, shared grants), with a cited source on every link and a human approval step before
any message goes out.

Built at HackwithBay 4.0, 24 Nov 2026. Setup instructions follow as the code lands.

## Run

```sh
cd service && uv run uvicorn app.main:app --reload --port 8000
```

In another terminal:

```sh
cd web && npm run dev
```

The web app runs on port 3000. Install service dependencies with `cd service && uv sync`.
With a freshly started service, run `bash service/smoke.sh` from the repository root.
The smoke check mutates in-memory demo data; restart the service to restore five credits.

The service replays cached Lightmatter research from `fixtures/`; it sends no messages and
makes no AI or paid API calls. ICP text, outreach drafts, and pipeline history are samples.
Affiliations describe dated publications, not verified current jobs. Numeric path scores
are sample ranking heuristics. The board path has `BOARD` edges; its `aligned` path
kind is a contract grouping fallback. All GET endpoints accept `?founder_id=`; unknown
founders return 404. API schemas are available at `http://localhost:8000/docs`.
