# Recorded graph event logs (stage fallback + video)
`<session_id>.json` = JSON list of GraphEvent objects (see `contracts/types.ts`), in order.
Loaded on first request by `events.ensure_recorded`; `seq` is renumbered 1..N and `session_id` forced, `at` is kept.
`at` gaps drive replay pacing (`/graph/stream?speed=N`). session_id must match `^[A-Za-z0-9_-]{1,64}$`.
Only used when the session has no live events.
