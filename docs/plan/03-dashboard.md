# 3 · Dashboard & Lead Management (15%)
> "Clear stage tracking, agent/rep attribution, and conversion analytics."

**Judges must see:** a pipeline board, every step labelled agent or human, and conversion numbers computed from data.

| Task | Owner | Status | Where |
|---|---|---|---|
| Pipeline stages + advance | Mark (UI) / API ✅ | ✅ API · 🔨 UI | `GET /pipeline` |
| Attribution: activity feed (agent vs human), live stream | Mark / API ✅ | ✅ API · 🔨 UI | `GET /activity`, `/activity/stream` |
| Conversion per stage, by path kind, by actor | Mark / API ✅ | ✅ API · 🔨 UI | `GET /metrics` |
| Live layered graph (core → categories → leads), table ↔ graph | Mark (+ Erick stream) | 🔨 | `/knowledge-graph`, `/graph/stream` |
| Stage names final | team | ❓ | contract `Stage` |

**Demo moment:** after approval the card jumps a stage, the activity feed shows "Draft agent → Jakob approved".
