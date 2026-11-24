# 2 · Enrichment & Outreach (20%)
> "Verified contact resolution, signal-personalized messages, strict HITL approval gate."

**Judges must see:** a bridge person verified live (current role from a real profile, not the paper date), a message
that uses the buyer's real signal, and an approval gate that cannot be bypassed (edit → re-approve).

| Task | Owner | Status | Where |
|---|---|---|---|
| Warm paths: lab mates, dual-affiliation co-authors, advisor's lab, co-authors, boards, citers, aligned | Erick | ✅ (any founder) | `GET /paths` |
| Path scoring (warmth × recency × name check), weakest link shown | Erick | ⬜ | `lanes/erick/paths.py` |
| Name check (homonyms) by a human | Erick / Mark | ✅ API · ⬜ UI | `POST /name-check` |
| Current-role verification via Moss web agent (e.g. Hamerly: NTT Research on 2024 papers; since Jan 2026 also CTO of Opticore) | Jakob | ✅ | `GET/POST /contacts/{id}` |
| Named buyer-side technical people via Moss prospecting | Jakob | ✅ | `POST /prospect` |
| Intro request to the bridge + forwardable note, only cited facts | Jakob | ✅ engine · ⬜ template (Jakob) | `POST /drafts` |
| Hash-bound approval (edit = stale; 409 on mismatch), nothing sent | Jakob | ✅ | `POST /approve` |
| Email lookup (verified/guessed, masked on stage) | Jakob | ✅ code · needs key | `/contacts` |

**Demo moment:** click a lit warm path → "Moss verified: CTO, Opticore (Jan 2026)" → draft cites the shared paper and the
buyer's recent paper → approve → card moves.
**Risks:** Moss latency (~110 s) → cached results on stage, live run in the video.
