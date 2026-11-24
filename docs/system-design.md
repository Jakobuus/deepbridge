# DeepBridge system design

## 1. Pipeline

- **Papers and website → grounded briefing → voice interview.** [Source readers](../service/app/lanes/jakob/sources.py) collect paper and website text. [Briefing logic](../service/app/lanes/jakob/briefing.py) turns sources into claims with verbatim quotes and gaps for the interviewer. The [briefing API](../service/app/routers/briefing.py) serves prompts and accepts turns. The [interview API](../service/app/routers/interview.py) ingests transcripts, and the [graph stream](../service/app/routers/graphstream.py) exposes session events for live display or replay.
- **Value map → buyer categories → buyers.** The [value-map API](../service/app/routers/valuemap.py) builds feature, benefit, value and problem nodes from research and interview input. The [category builder](../service/app/lanes/jakob/categories.py) groups candidate buyers by problem and proposed fit. It takes organizations and signals from the [buyer API](../service/app/routers/buyers.py). The [knowledge-graph API](../service/app/routers/knowledge.py) assembles the layers.
- **Warm paths → role check → draft → approval → pipeline.** The [graph builder](../service/app/lanes/erick/build.py) creates dated co-author and affiliation edges for the [path finder](../service/app/lanes/erick/paths.py). The [contacts API](../service/app/routers/contacts.py) checks the bridge’s role via Moss or replays cached evidence. The [outreach API](../service/app/routers/outreach.py) handles drafts and approval. The [pipeline API](../service/app/routers/pipeline.py) exposes stages and metrics to the [dashboard](../web/src/components/deepbridge/screen-pipeline.tsx).

## 2. Graph ontology

The [TypeScript contract](../contracts/types.ts) and [Python models](../service/app/models.py) define a `Founder`, `ValueNode` (feature, benefit, value, problem), `BuyerCategory`, `Person` and `Org` (company, university, lab, government, other). Papers are `Evidence` attached to claims and edges. Evidence carries a source URL, quote, source date and observation time.

Core edges are `ENABLES` (feature → benefit), `DELIVERS` (benefit → value) and `SOLVES` (value → problem). `FITS` joins a buyer category to an organization. Lead edge types are `LAB_MATE`, `DUAL_AFFILIATION`, `ADVISOR_LAB`, `CO_AUTHORED`, `CITES`, `TOPIC_ALIGNED`, `AFFILIATED_AT`, `BOARD` and `PERSONAL`. Each edge carries evidence IDs, confidence, date and an identity check. Affiliations are as of the cited source date.

## 3. Query logic

- **Buyer score.** Discovery uses topical OpenAlex works and co-author affiliations. The score is `min(40, 4 × on_topic_papers_90d) + min(35, 5 × sampled_citing_papers) + min(25, 5 × matching_job_posts)`. Citation counts are lower bounds. Scores rank public evidence for buyer hypotheses. [Signal code](../service/app/lanes/jakob/signals.py)
- **Path rank.** The computed search follows directed, non-cyclic paths of two or three edges to buyer organizations. Each edge weight is type warmth × confidence × identity × recency. Identity is 1 for confirmed, 0.65 for unchecked and 0 for rejected. Recency is `2^(-years/10)`, or 0.5 without a valid date. Path score is `100 × geometric_mean(weights) × sqrt(min(weights))`. The lowest-weight hop is recorded as the weakest edge. The search keeps the strongest path per bridge and buyer pair. The code sorts the buyer and path lists independently. A warmth × buyer score rank would combine those two scores. [Path code](../service/app/lanes/erick/paths.py)
- **Categories.** Group organizations by shared problems using value-map or ICP inputs and buyer evidence. The builder validates problem and value references, each organization’s own evidence and one category assignment per buyer. It can reuse saved plans or fall back to keyword or ICP grouping. [Category code](../service/app/lanes/jakob/categories.py)

## 4. Reasoning loops

- **Grounding.** The briefing drops claims whose quote is absent from the named source after text normalization, and stores the matching source excerpt. [Grounding code](../service/app/lanes/jakob/grounding.py)
- **Drafting.** With a bridge, draft an intro request and a forwardable note. Check evidence IDs, numeric claims, length, relationship language and unsupported features, among other rules. Failed copy checks trigger one retry with feedback. The result carries its check outcomes for human review. [Draft writer](../service/app/lanes/jakob/drafts.py) · [Copy checks](../service/app/lanes/jakob/draftchecks.py)
- **Approval.** A human approves or rejects against `SHA-256(subject + "\n" + body)`. A mismatched hash returns HTTP 409. An edit makes an approved draft stale. An approval can advance its pipeline card. Nothing is sent. [Store](../service/app/store.py)

## 5. Integrations

- **OpenAlex** supplies publication, citation and affiliation data. Cached results are labelled. [API client](../service/app/openalex.py)
- **Moss Tasks** checks current roles and profiles against dated public evidence. Stage contact results can be replayed from cache. Moss fast inference also supports the text interview. [Contact resolver](../service/app/lanes/jakob/contacts.py) · [Interview logic](../service/app/lanes/mark/interview.py)
- **Credits** use a local credit counter in the credential-free demo. The optional Flexprice adapter reads wallet balance and meters usage. Exhaustion returns HTTP 402. [Credit gate](../service/app/lanes/jakob/credits.py)
- **Lovable** is named as the voice front end in the repo. The backend exposes the briefing, turn and transcript interfaces. [Integration notes](plan/06-sponsors.md)

## 6. Demo case

Hannah Weber is a co-founder of HOPO Therapeutics, a Berkeley Lab spinout built on research by Rebecca J. Abergel. The cached briefing draws on papers and the company website. The worked example maps four researched uses of the investigational chelator 3,4,3-LI(1,2-HOPO) to buyer hypotheses. [Company team](https://www.hopotx.com/about) · [Berkeley Lab startup listing](https://ipo.lbl.gov/about-us/startups-by-technology/) · [Cached briefing](../fixtures/briefing_demo_hopo.json)

| Researched use | Buyer category |
| --- | --- |
| Actinide removal | Radiological medical countermeasures |
| Zirconium-89 PET imaging | Radiopharmaceutical developers |
| Gadolinium removal | MRI contrast and safety programs |
| Toxic heavy-metal binding | Heavy-metal poisoning therapeutics |

**Featured path from the cited sources.** Rebecca J. Abergel → 2018 Th-227 chelator paper → Åsmund Larsen → Bayer. Abergel and Larsen co-authored the paper in 2018. The paper supplies the co-author edge’s evidence. The bundled Abergel graph omits this path. The cached Moss check lists Larsen as Radiopharmaceuticals Manager at Bayer as of March 21, 2024. [Paper DOI 10.1021/acs.inorgchem.8b02430](https://doi.org/10.1021/acs.inorgchem.8b02430) · [Cached Moss evidence](../fixtures/contacts.json)
