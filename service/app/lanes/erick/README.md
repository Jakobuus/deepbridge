# Computed founder graphs

Lightmatter stays on its original fixtures. Other OpenAlex author IDs use the
computed graph. Both `person:openalex:A…`, author URLs, and bare `A…` IDs work.
Name/DOI input reuses Jakob's `fetch_founder`; the canonical ID from intake is
preferred. Graph pulling reads `OPENALEX_API_KEY` from the environment when set.
No credential is included in a cache filename or request error.

## Replay and checks

From `service/`:

```sh
uv run python -m app.lanes.erick.pull A5060617433 A5069094503
uv run python -m unittest discover -s app/lanes/erick -p 'test_*.py'
uv run uvicorn app.main:app --port 8011
# In another terminal:
BASE_URL=http://localhost:8011 bash smoke.sh
uv run python -m app.lanes.erick.verify_live http://localhost:8011
```

The real run is recorded in `data/cache/erick/verification.json`. Port 8000 was
already occupied during verification, so the smoke check used port 8011.

Cached founders:

- Yet-Ming Chiang / Form Energy: `person:openalex:A5060617433`.
- Paula Therese Hammond / LayerBio: `person:openalex:A5069094503`.
  MIT's [faculty page](https://ki.mit.edu/people/faculty/paula-hammond) identifies
  LayerBio and her MIT doctorate. Seed metadata preserves the source references.

Both include sourced advisor metadata. Advisor identity comes from MIT's thesis
catalog or oral-history transcript; it is never inferred from author order.

## Data and limits

The venue's keyless list-query budget returned HTTP 429, with no key available
in the worker environment. Single-author and single-work GETs succeeded. The
pull therefore combines real, newly fetched author profiles and seed papers with
existing intake papers read from Jakob's cache. Everything needed for replay is
copied under `data/cache/erick/`; no other lane's cache is changed.

`dataset.json` records the sample limits, fetch time, and warnings. `raw/` holds
unmodified successful API responses. No failed response is cached. Calls are
serialized with at least 210 ms between starts. Paging uses `page=`, with at most
75 founder papers, 30 coauthor profiles, and 25 citing papers, plus up to 10
explicit seed papers. A cache without publication evidence returns a clear 503
on budget failure rather than an empty success or a Lightmatter fallback.

The routes expose cache/partial status in `X-Graph-Data`, `X-Graph-Partial`, and
`X-Graph-Warnings`; computed edge labels also say cached OpenAlex. Company
membership only identifies a possible target organization, not verified demand.

Paper evidence cites the OpenAlex work and raw affiliation strings or title.
When a company affiliation is available only in the author profile, its evidence
cites that author profile, its year stays in the label, and its exact date stays
null. These edges have confidence at most 0.45 and remain unchecked. An
affiliation mismatch between a profile and sampled papers also lowers confidence
below 0.5. Coauthor relationships are always labelled as coauthorship; the
`LAB_MATE` contract category means shared university coauthorship followed by a
later company affiliation, not a verified personal relationship.

Paths have two or three directed edges. Ranking uses warmth, confidence,
recency decay, and the human name-check state, then marks the weakest edge.
Rejected edges are excluded. Name-check decisions survive recomputation for the
life of the service. Scores are heuristics, not measured relationship strength.

`ADVISOR_LAB` consumes a sourced `<author-id>/advisor.json`. `CITES` requires the
citing paper's references to contain a founder work. `TOPIC_ALIGNED` consumes
`topic_works` supplied by Mark's search and requires a shared OpenAlex topic.
No topic candidates were supplied in this run. Citation expansion and broader
advisor work queries were budget blocked; sampled advisor papers are cached.

To refresh a frozen partial sample after adding a key, remove that author's
`dataset.json` and rerun `pull`; successful raw responses remain reusable. The
name/DOI resolver retains Jakob's existing intake behavior; author-ID requests
avoid that separate resolver's network calls.

Computed evidence is served inline in `/graph` and through `/evidence/{id}`.
Computed data stays separate from fixture store collections. Downstream buyer,
draft, and pipeline changes are outside this task. Fixtures and contracts are
unchanged. Changes are intentionally left uncommitted for the lead session.
