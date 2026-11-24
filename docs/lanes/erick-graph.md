# Lane: Erick — graph + path finder (Python)

Files: `service/app/routers/graph.py`, `service/app/routers/paths.py`, `service/app/lanes/erick/`, `data/`,
`docs/architecture.md`. Contract: `contracts/types.ts` / `service/app/models.py`. Rules: `AGENTS.md`.
The base service and real Lightmatter fixtures land on `main` ~11:40 (routers already serve fixtures).

Goal: replace fixture graph/paths with ones computed from cached OpenAlex data for ANY founder.
1. `lanes/erick/pull.py`: `pull_founder(openalex_author_id) -> None` caches works + co-author profiles under
   `data/cache/<id>/` (OpenAlex keyless; use `page=` not `cursor=`; ≤10 req/s; also pull the PhD advisor's works).
2. `lanes/erick/build.py`: `build_graph(founder_id) -> (people, orgs, edges, evidence)` with edge types LAB_MATE
   (co-authored while both at the founder's university, later company affiliation), DUAL_AFFILIATION (university +
   company on the same authorship), ADVISOR_LAB, CO_AUTHORED, CITES (OpenAlex `cites:` filter), TOPIC_ALIGNED
   (Mark's Moss search feeds candidates), AFFILIATED_AT with `affiliation_asof`. Evidence quote = raw affiliation
   string or work title; source_url = OpenAlex work URL.
3. `lanes/erick/paths.py`: `find_paths(founder_id, buyer_org_ids) -> list[Path]`; score = edge warmth (LAB_MATE 0.9,
   DUAL 1.0, ADVISOR 0.7, CO_AUTHORED 0.6, CITES 0.4, ALIGNED 0.3) × recency decay × name-check; weakest edge marked.
4. Name noise: flag homonyms (affiliation string mismatch) as `confidence < 0.5`, `name_check: "unchecked"`.
5. `docs/architecture.md`: the system design doc the organizers ask for (query logic, graph ontology, reasoning loop,
   integrations). 1–2 pages.
Checkpoints: 12:00 routers still serve fixtures (nothing broken) · 13:30 computed graph for Lightmatter live ·
14:30 freeze. Research behind the edge types: tested on real data, see the private notes Jakob can share.
