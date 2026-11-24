# DeepBridge stage demo

Run from the repo root. Requires Python 3, `uv`, `curl`, and `lsof`.

```bash
bash scripts/demo-reset.sh
bash scripts/demo-check.sh
# Checks spend credits and edit memory. Restore a clean stage session:
bash scripts/demo-reset.sh
bash scripts/warm-cache.sh
# In another terminal, if the web checkout is present:
cd web && npm run dev
```

Open http://localhost:3000. API: http://127.0.0.1:8000.
`demo-check.sh` exits nonzero for failed requests, demo endpoint latency ≥1.5s,
or failed smoke checks. It covers the contract GET/POST/PUT routes; explicit live
contact refresh and framework docs are outside the stage latency check.

Reset between rehearsals with `bash scripts/demo-reset.sh`, then warm again.
Reset copies tracked `fixtures/*.json` from `git show HEAD:fixtures/<file>` and
restarts the service: drafts, edits, approvals, pipeline changes, and credit
spending in memory disappear. Credits return to 5. Local fixture edits are
replaced; untracked files and the git index are left alone. It refuses to stop
another app or checkout on the port. The script prints its service log path.
For an isolated rehearsal, use `DEMO_PORT=8001` on reset and
`BASE_URL=http://127.0.0.1:8001` on check/warm.

## Five screens

1. **Intake / ICP:** enter “Lightmatter” or “Nicholas C. Harris”; show the cached
   founder and buyer hypotheses with their sources.
2. **Buyers:** inspect ranked organizations and dated “why now” evidence.
3. **Graph / paths:** inspect a co-author path and its weakest edge; open a source.
   Say “co-authored 2017”; describe affiliations as of their cited date.
4. **Contact / drafts:** choose a cached contact (Saumil Bandyopadhyay,
   Ryan Hamerly, or Dirk Robert Englund). Use a path with cached drafts; review and
   approve a draft. Keep contact details masked. Nothing is sent.
5. **Pipeline / metrics:** show the approval and stage counts; label seeded
   history as a simulated demo. Approval binds to the draft content; editing
   an approved draft makes it stale.

## Fallbacks

- **Wi-Fi down:** stay on the Lightmatter case and cached fixtures. Say “cached
  research replay”; avoid new-founder lookups and live refresh.
- **Moss down:** open one of the three cached contacts above. Say “cached contact”
  and show its source/date; do not infer current employment from a paper.
- **CLI slow:** use a path already in `fixtures/drafts.json` (for example
  Steinbrecher). Drafts replay from cache; no stage wait for generation.
- **UI unavailable:** walk the same data at http://127.0.0.1:8000/docs;
  use the check output to show API readiness. No messages to real people.
