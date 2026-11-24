# Known issues: graph stream (`erick/graphstream`)

Independent review (Codex, round 3 of 3) returned FAIL with these open findings. Accepted for the demo by Erick, 24 Nov 2026.
None is high severity. Gates green: ruff, semgrep, gitleaks, `cd service && uv run python app/lanes/erick/test_graphstream.py`.

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| 1 | Med | `events.py` `publish` | `**payload` can override `seq`; indexed reads assume contiguous seq, so live SSE could repeat an event. No caller passes `seq` today. | Build the event as `{**payload, 'seq': ..., 'session_id': ...}`. |
| 2 | Med | `routers/graphstream.py` replay | A `load_log(..., replace=True)` during a replay of the same session can splice or truncate it. | Snapshot the log once per replay. |
| 3 | Med | `events.py` recorded-log validation | Nested `edge` / `node` / `evidence` contents are not validated against the contract. | Validate nested payloads before install. |
| 4 | Low | `events.py` `events()` | Gained an optional `limit` parameter. | Move batching to a private helper. |
| 5 | Low | `events.py` `ensure_recorded` | Copies the whole log to test emptiness. | Use a length check. |
| 6 | Low | replay | Ping can be up to 2 s late. | Wake at the earlier of next event / heartbeat. |
