# Demo founder preparation

Run `scripts/prepare-founder.sh "<name or DOI>"` against the demo API. The report records the latest run for each input. Path ranks use the API scores, which are heuristics.

## Stage readiness

Verified November 24, 2026 on port 8001 because another DeepBridge checkout was serving port 8000. The script defaults to 8000. Set `DEMO_PORT` or `BASE_URL` to use another listener.

| Candidate | Verified intake | Paths | Drafts | Full run |
| --- | --- | ---: | ---: | --- |
| Nicholas C. Harris | `Nicholas C. Harris` | 10 | 6 | 0.026s, complete with Lightmatter fixture replay |
| Zaijun Chen | `10.1038/s41566-023-01233-w` | 11 | 0 | 44.140s, incomplete |
| Mikhail D. Lukin | `10.1103/PhysRevLett.87.037901` | 1 | 0 | 36.281s, incomplete |

The shared keyless OpenAlex list-query budget returned HTTP 429 for both name searches. The DOI lookups worked and provided one verified paper per founder. The publication graphs used that evidence and successful author lookups, with upstream limits recorded in the caches. After a restart, DOI intake, ICP, graph, and paths each returned successfully in 12 ms or less for both candidates. The smoke check passed and the final reset restored 18 committed fixture files and five credits.

### Identity evidence

- **Zaijun Chen, Opticore.** OpenAlex [A5077780617](https://openalex.org/A5077780617) is the lead author on the 2023 work “Deep learning with coherent VCSEL neural networks.” MIT identifies Chen as a postdoc at its Research Laboratory of Electronics when he conducted the work. Opticore lists him as “Founder & CEO” as of November 24, 2026. [OpenAlex work](https://openalex.org/W4384522497), [MIT](https://news.mit.edu/2023/system-could-yield-more-powerful-efficient-llms-0822), [Opticore team](https://www.opticore.ai/team).
- **Mikhail D. Lukin, CavilinQ.** OpenAlex [A5066245772](https://openalex.org/A5066245772) is the lead author on “Dipole Blockade and Quantum Information Processing in Mesoscopic Atomic Ensembles.” That paper lists Harvard as an affiliation as of its 2001 publication. CavilinQ lists him as “Co-Founder, Scientific Advisor” as of November 24, 2026. [OpenAlex work](https://openalex.org/W2042458092), [APS paper](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.87.037901), [CavilinQ team](https://www.cavilinq.com/team).

### Endpoint gaps

- `GET /buyers`, `GET /categories`, and `POST /drafts` are scoped to the cached Lightmatter founder. Both other founder IDs returned HTTP 404 from the shared founder guard. The drafts route also looks up paths in the fixture store, while the new paths come from the computed graph.
- `GET /value-map` supports other founders and caches their results in process memory. Lukin's run generated 14 nodes in 22.575s. A restart clears that result. Chen's run returned HTTP 502. The selected OpenAlex record has no abstract, leaving the paper title as the input for the route's exact-quote validation.
- `GET /knowledge-graph` returned Lukin's leads and value map with the “All buyers” fallback. Chen's request returned HTTP 502 from its value-map call.

<!-- founder-run 7949ce8668fb4436 -->
## Zaijun Chen

Input `Zaijun Chen`. Incomplete in 0.128s.

| Request | Status | Time | Counts and notes |
| --- | --- | ---: | --- |
| `POST /intake` | 503 | 0.128s | OpenAlex is rate limited; retry shortly |

### Top paths

No paths returned.

<!-- /founder-run 7949ce8668fb4436 -->

<!-- founder-run f6dcd81de0a40921 -->
## Mikhail D. Lukin

Input `Mikhail D. Lukin`. Incomplete in 0.109s.

| Request | Status | Time | Counts and notes |
| --- | --- | ---: | --- |
| `POST /intake` | 503 | 0.109s | OpenAlex is rate limited; retry shortly |

### Top paths

No paths returned.

<!-- /founder-run f6dcd81de0a40921 -->

<!-- founder-run 9c0af878d3027564 -->
## Nicholas C. Harris

Input `Nicholas C. Harris`. Complete in 0.026s.

| Request | Status | Time | Counts and notes |
| --- | --- | ---: | --- |
| `POST /intake` | 200 | 0.009s | Nicholas C. Harris (person:openalex:A5102978866), 2 topics, 2 evidence ids |
| `GET /icp` | 200 | 0.001s | 3 buyer roles, 3 industries, 3 needs, 3 expansion segments |
| `GET /buyers` | 200 | 0.002s | 10 orgs, 40 signals |
| `GET /graph` | 200 | 0.001s | 12 people, 12 orgs, 21 edges, 114 evidence · Lightmatter fixture replay |
| `GET /paths` | 200 | 0.002s | 10 paths · Lightmatter fixture replay |
| `GET /value-map` | 200 | 0.001s | 18 value nodes, 17 edges, 10 evidence · Lightmatter fixture replay |
| `GET /categories` | 200 | 0.002s | 4 categories · inferred from cached buyer evidence |
| `GET /knowledge-graph` | 200 | 0.004s | core has 18 value nodes, 17 edges, 4 categories, leads have 12 people, 12 orgs, 31 edges, 10 paths, 131 evidence · Lightmatter fixture replay |
| `POST /drafts (path:bandyopadhyay)` | 200 | 0.001s | 2 drafts |
| `POST /drafts (path:hamerly)` | 200 | 0.001s | 2 drafts |
| `POST /drafts (path:follet)` | 200 | 0.001s | 2 drafts |

### Top paths

| Rank | Bridge | Buyer organization | Evidence URL | Source quote |
| ---: | --- | --- | --- | --- |
| 1 | Saumil Bandyopadhyay | NTT Research | <https://openalex.org/W4404905249> | authorships.author.display_name: Nicholas C. Harris; Saumil Bandyopadhyay; raw_affiliation_strings: ["NTT Research Inc., Physics &amp; Informatics Laboratories, Sunnyvale, CA, USA", "Research Laboratory of Electronics, MIT, Cambridge, MA, USA"] |
| 2 | Ryan Hamerly | NTT Research | <https://openalex.org/W4404905249> | authorships.author.display_name: Nicholas C. Harris; Ryan Hamerly; raw_affiliation_strings: ["NTT Research Inc., Physics &amp; Informatics Laboratories, Sunnyvale, CA, USA", "Research Laboratory of Electronics, MIT, Cambridge, MA, USA"] |
| 3 | Dirk Robert Englund | NVIDIA | <https://openalex.org/W2752849906> | authorships.author.display_name: Nicholas C. Harris; Dirk Robert Englund |
| 4 | Gregory R. Steinbrecher | Meta | <https://openalex.org/W2746675113> | authorships.author.display_name: Nicholas C. Harris; Gregory R. Steinbrecher; raw_affiliation_strings: ["Research Laboratory of Electronics, Massachusetts Institute of Technology, Cambridge, MA 02139, USA"] |
| 5 | Jason Zander | Microsoft | <https://lightmatter.com/about/> | Board of Directors; Nicholas Harris; Jason Zander |

<!-- /founder-run 9c0af878d3027564 -->

<!-- founder-run 1395b81be97380c8 -->
## Zaijun Chen

Input `10.1038/s41566-023-01233-w`. Incomplete in 44.140s.

| Request | Status | Time | Counts and notes |
| --- | --- | ---: | --- |
| `POST /intake` | 200 | 0.254s | Zaijun Chen (person:openalex:A5077780617), 3 topics, 1 evidence ids |
| `GET /icp` | 200 | 10.873s | 3 buyer roles, 3 industries, 3 needs, 3 expansion segments |
| `GET /buyers` | 404 | 0.001s | Founder not in cached demo |
| `GET /graph` | 200 | 3.076s | 12 people, 13 orgs, 39 edges, 16 evidence · computed from cached OpenAlex responses · OpenAlex budget or rate limit exhausted; cached data is used when available. Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.; PhD advisor not independently resolved; no advisor relationship inferred. |
| `GET /paths` | 200 | 0.002s | 11 paths · computed from cached OpenAlex responses; scores are heuristics · OpenAlex budget or rate limit exhausted; cached data is used when available. Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.; PhD advisor not independently resolved; no advisor relationship inferred. |
| `GET /value-map` | 502 | 16.656s | Value-map generation failed or returned invalid evidence |
| `GET /categories` | 404 | 0.002s | Founder not in cached demo |
| `GET /knowledge-graph` | 502 | 13.274s | Value-map generation failed or returned invalid evidence |
| `POST /drafts (path:erick:0f6e79cd47c426e91259)` | 404 | 0.001s | Founder not in cached demo |
| `POST /drafts (path:erick:283f6a27773986ab1433)` | 404 | 0.001s | Founder not in cached demo |
| `POST /drafts (path:erick:2c4caf8608b766a7cfe0)` | 404 | 0.001s | Founder not in cached demo |

### Top paths

| Rank | Bridge | Buyer organization | Evidence URL | Source quote |
| ---: | --- | --- | --- | --- |
| 1 | Ryan Hamerly | NTT (United States) | <https://openalex.org/W4384522497> | Deep learning with coherent VCSEL neural networks |
| 2 | Ryan Hamerly | Hewlett-Packard (United States) | <https://openalex.org/W4384522497> | Deep learning with coherent VCSEL neural networks |
| 3 | Alexander Sludds | Lightmatter (United States) | <https://openalex.org/W4384522497> | Deep learning with coherent VCSEL neural networks |
| 4 | Ryan Hamerly | NTT (Japan) | <https://openalex.org/W4384522497> | Deep learning with coherent VCSEL neural networks |
| 5 | Liane Bernstein | QuEra Computing (United States) | <https://openalex.org/W4384522497> | Deep learning with coherent VCSEL neural networks |

<!-- /founder-run 1395b81be97380c8 -->

<!-- founder-run c8c48ea437803b00 -->
## Mikhail D. Lukin

Input `10.1103/PhysRevLett.87.037901`. Incomplete in 36.281s.

| Request | Status | Time | Counts and notes |
| --- | --- | ---: | --- |
| `POST /intake` | 200 | 0.325s | Mikhail D. Lukin (person:openalex:A5066245772), 3 topics, 1 evidence ids |
| `GET /icp` | 200 | 10.739s | 3 buyer roles, 3 industries, 3 needs, 3 expansion segments |
| `GET /buyers` | 404 | 0.001s | Founder not in cached demo |
| `GET /graph` | 200 | 2.632s | 7 people, 8 orgs, 18 edges, 8 evidence · computed from cached OpenAlex responses · OpenAlex budget or rate limit exhausted; cached data is used when available. Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.; PhD advisor not independently resolved; no advisor relationship inferred. |
| `GET /paths` | 200 | 0.002s | 1 paths · computed from cached OpenAlex responses; scores are heuristics · OpenAlex budget or rate limit exhausted; cached data is used when available. Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.; PhD advisor not independently resolved; no advisor relationship inferred. |
| `GET /value-map` | 200 | 22.575s | 14 value nodes, 14 edges, 6 evidence · generated from founder research |
| `GET /categories` | 404 | 0.001s | Founder not in cached demo |
| `GET /knowledge-graph` | 200 | 0.005s | core has 14 value nodes, 14 edges, 1 categories, leads have 7 people, 8 orgs, 18 edges, 1 paths, 15 evidence · computed from cached OpenAlex responses; scores are heuristics · OpenAlex budget or rate limit exhausted; cached data is used when available. Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.; PhD advisor not independently resolved; no advisor relationship inferred. · Buyer categories unavailable. Showing All buyers. |
| `POST /drafts (path:erick:1a4ae0b06c4464746a18)` | 404 | 0.001s | Founder not in cached demo |

### Top paths

| Rank | Bridge | Buyer organization | Evidence URL | Source quote |
| ---: | --- | --- | --- | --- |
| 1 | Dieter Jaksch | d-fine (Germany) | <https://openalex.org/W2042458092> | Dipole Blockade and Quantum Information Processing in Mesoscopic Atomic Ensembles |

<!-- /founder-run c8c48ea437803b00 -->
