# DeepBridge stage demo

Founder: **Hannah Weber, HOPO Therapeutics** (Berkeley Lab spinout). Science by Rebecca J. Abergel
(`founder_id` person:openalex:A5043992375). Session `demo-hopo`. Molecule 3,4,3-LI(1,2-HOPO).
Fallback case: `demo-lightmatter` (Lightmatter / Nicholas C. Harris).

## 1. Stage format (3 min)

- **0:00-1:30 video:** pre-recorded screen capture with voiceover (intake, briefing, graph, buyers, path, Moss, draft, approval).
- **1:30-3:00 live voice:** the hosted voice interview with the graph growing next to it. Stage mode is about 75 s; keep answers short.
- One person speaks and plays Hannah, one drives the laptop, one watches the graph stream and switches to replay if it stalls.

## 2. Click-by-click flow (web http://localhost:3000, API http://127.0.0.1:8000)

| # | Screen | Shows | Endpoint |
|---|---|---|---|
| 1 | Intake | Hannah Weber, website, lab papers; briefing with source chips | `GET /interview/brief/demo-hopo` |
| 2 | Graph core | Core grows live as the papers are read | `GET /graph/stream?session_id=demo-hopo` |
| 3 | Value map | What the molecule replaces and improves | `GET /value-map` |
| 4 | Buyer categories | Four uses, one colour each: radiation countermeasure, 89Zr imaging, gadolinium removal after MRI contrast, lead/heavy-metal poisoning | `GET /categories` |
| 5 | Buyers | Ranked organizations with dated evidence; Bayer on top | `GET /buyers` |
| 6 | Warm path | Abergel, 2018 Th-227 chelator paper (doi 10.1021/acs.inorgchem.8b02430), Asmund Larsen, Bayer. Edge label "co-authored 2018" | `GET /paths`, `GET /evidence/{id}` |
| 7 | Contact (Moss) | Larsen: Radiopharmaceuticals manager at Bayer, as of 2024-03-21, with source | `GET /contacts/{person_id}` |
| 8 | Draft + approval | Draft with checks, human approves the exact text; nothing is sent | outreach routes |
| 9 | Pipeline / metrics | Card moves a stage; credits left | `GET /pipeline`, `GET /metrics`, `GET /credits` |

## 3. Talking points (honest)

- Say "co-authored 2018", never "knows". A paper is a link, not a relationship.
- Roles are dated: "Larsen, Radiopharmaceuticals manager at Bayer, as of March 2024, per Moss." Do not claim today's role.
- Hannah has no papers of her own; the lab's papers are the graph core and the paths run through their co-authors.
- Label replayed or cached data out loud: "cached research replay", "cached contact". Seeded pipeline history is simulated.
- No "first" or "nobody does this". No numbers beyond what is on screen with a source.
- Nothing goes to real people. Approval binds to the draft text; editing an approved draft makes it stale.
- Close: three to four buyer categories and a path into Bayer, every link sourced and dated. Ask: a pilot cohort.

## 4. Reset before each take

```bash
caffeinate -dims &                              # keep the Mac awake
bash scripts/demo-reset.sh                      # fixtures restored from HEAD, credits back to 5
cd web && npx next start -p 3000                # in a second terminal
```

- Commit fixture edits BEFORE resetting: reset restores tracked `fixtures/*.json` from HEAD.
- `bash scripts/demo-check.sh` and `service/smoke.sh` spend credits and edit memory: reset again afterwards.
- Check the API: `curl -s http://127.0.0.1:8000/health`.
- Replay check: `curl -N "http://127.0.0.1:8000/graph/stream?session_id=demo-hopo&speed=4"` (`speed` fast-forwards, `from_seq` resumes).
- Tunnel (for the hosted voice page): `bash scripts/webhook-tunnel.sh`, URL in `.webhook-url`;
  health: `curl -i -X OPTIONS "$(cat .webhook-url)/interview/transcript"` should answer, not time out.
- Isolated rehearsal: `DEMO_PORT=8001 bash scripts/demo-reset.sh`, `BASE_URL=http://127.0.0.1:8001` on check/warm.
- Optional: `bash scripts/warm-cache.sh` after reset.

## 5. Fallbacks

- **Voice down or audio fails:** use the typed interview and read answers aloud; or play the replay / recorded video ("this is the recorded run of the same flow").
- **Graph stalls:** start the replay `/graph/stream?session_id=demo-hopo&speed=4`.
- **Tunnel dead:** rerun `bash scripts/webhook-tunnel.sh`, read the new URL from `.webhook-url`, update the `api=` param in the voice link, reload.
- **Moss slow or down:** open a cached contact from `fixtures/contacts.json`; say "cached contact" and show its source and date.
- **CLI slow:** use a path already in `fixtures/drafts.json`; drafts replay from cache.
- **Wi-Fi down:** stay on cached fixtures; say "cached research replay"; no new-founder lookups.
- **Case breaks:** switch to `demo-lightmatter` (Lightmatter, Nicholas C. Harris; contacts Saumil Bandyopadhyay, Ryan Hamerly, Dirk Robert Englund).
- **UI unavailable:** walk the same data at http://127.0.0.1:8000/docs. No messages to real people.
