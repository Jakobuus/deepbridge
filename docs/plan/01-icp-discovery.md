# 1 · ICP & Discovery Quality (20%)
> "Sensible inferred ICP, real candidate leads with source citations, credible expansion segments."

**Judges must see:** the ICP inferred from the founder's own research + interview (not typed in); real companies and
people as leads, each with a clickable source; expansion segments = buyer categories by problem set.

| Task | Owner | Status | Where |
|---|---|---|---|
| Intake for any founder (name, DOI, paper links) | Jakob | ✅ | `POST /intake` |
| Reading sources (paper full text/abstract, website, notes, Notion, Google Doc) → briefing with claims + gaps | Jakob | 🔨 B1 | `POST /interview/brief` |
| Connectors ported (Notion, Google Drive), buttons in UI | Jakob / Mark | 🔨 N / ⬜ | `GET /connectors` |
| ICP from papers (roles, industries, needs, expansion) with evidence | Jakob | ✅ | `GET /icp` |
| Value map (feature → benefit → value → problem) = graph core | Jakob | ✅ | `GET /value-map` |
| Interview answers refine value + buyer roles live | Jakob | 🔨 B1 | `POST /interview/turn` |
| Buyer categories by problem set (= expansion segments, colour each) | Jakob | ✅ | `GET /categories` |
| Buyer companies ranked by why-now signals (papers 90 d, job posts, citations) | Jakob | ✅ | `GET /buyers` |
| Discovery during the interview (new categories → new buyers, streamed) | Erick | 🔨 | `/graph/stream` phase `discovery` |
| Adjacent companies on the same topics | Jakob | ✅ | `GET /competitors` |

**Demo moment:** while the founder answers, categories appear in colour and buyer companies drop in with source chips.
**Risks:** ICP too generic → every item must cite a paper/founder quote; utilities-type buyers don't publish → pick a
demo founder whose buyers publish (team decision ❓).
