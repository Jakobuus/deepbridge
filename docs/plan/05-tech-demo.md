# 5 · Technical Execution & Demo (10%)
> "Clean architecture, working end-to-end prototype."

**Judges must see:** it runs end to end live, and the repo explains how (setup + system design).

| Task | Owner | Status | Where |
|---|---|---|---|
| One API, one contract, lanes in separate modules | orchestrator | ✅ | `contracts/`, `service/` |
| Live graph event stream + fast-forward replay | Erick | 🔨 | `/graph/stream` |
| Live voice interview (hosted voice app) ↔ our API (briefing, turns, transcript) via public tunnel | Jakob | 🔨 T + hosted app | `/interview/*` |
| System design doc (query logic, ontology, reasoning loops, integrations) | Erick | ✅ draft · update | `docs/architecture.md` |
| README with setup | orchestrator | ✅ | `README.md` |
| Demo safety: reset, check, warm cache, fallbacks | orchestrator | ✅ | `scripts/`, `DEMO.md` |
| Feature freeze 14:30; video + backup take by 15:15 | all | ⬜ | — |
