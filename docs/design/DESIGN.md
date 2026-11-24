# DeepBridge Design System & Stage Brief

**Locked Foundation:** Sistine **`Lucite` + `Onyx` + `flat`** (`<html class="dark" data-glass="lucite" data-glass-tint="onyx">`)
**Token Source of Truth:** [`docs/design/tokens.css`](./tokens.css) and [`docs/design/tokens.json`](./tokens.json)

---

## 1. Visual Principles

1. **Flat Neo-Brutalist Operating Surface:**
   - **Zero drop shadows (`box-shadow: none`)** and **zero frosted glass (`backdrop-filter: none`)** across every form, table, card, badge, and drawer.
   - Hierarchy comes from **1px / 2px crisp structural borders**, flat Onyx elevation steps (`#060709` → `#090a0d` → `#0f1117` → `#151922`), bold sans headings, and monospace provenance pills.
   - Rounded corners (`--radius: 0.75rem`; cards 1rem, buttons ~10px, inputs ~8px), WCAG AA contrast (`>= 7.2:1` muted text, `17.4:1` body text).
2. **The One Spatial Portal — Deep-Space Knowledge Graph:**
   - The **only** surface that breaks out of flat Onyx is the **Layered Knowledge Graph**, which drops into a deep-cosmos `#020510` void (`--db-cosmos-bg`) with crisp orbital rings, luminous category hues (`--cat-1..5`), and directional photon pulses along active warm paths.
3. **Receipts Over Claims:**
   - Every factual assertion renders an inline monospace `EvidenceChip` with source kind, year, and clickable external URL.
   - Publication edges carry explicit dates (`co-authored 2017 (MIT)`, `published affiliation as of 2024`) — **never** `"knows"`.

---

## 2. Stage & Video Grid (`1440×900` / `16:9`)

- **Left Rail (`256px` fixed, `#060709`, `1px` right border):** Brand lockup, 5-step workflow navigation (`01 Intake` → `05 Pipeline`), and persistent Stage Guardrails checklist.
- **Top Telemetry Header (`52px` height, flat `#090a0d`, `1px` bottom border):** Active Founder badge, `CACHED RESEARCH REPLAY` vs `LIVE OPENALEX` honesty pill, live `CreditPill`, and `Proof Drawer` trigger.
- **Main Stage (`1184px` fluid at `1440px`, `24px` padding, 12-column CSS grid, `16px–24px` gap):**
  - Sized so primary headlines (`20px–28px`), graph node labels (`11.5px–13px`), and status badges read clearly on a projector and in a 1080p 16:9 video capture without browser zoom hacks.
- **Right Inspector Sheet (`540px` slide-over, flat `#0a0c10`, `2px` left border):** Verbatim `Evidence` blockquotes, human `Name-Check` (`OK` / `Reject`), and Moss-verified `Contact` card.

---

## 3. Surfaces & User Journey (5 Screens + Live Voice Grilling)

1. **01 · Paper-Grilling Voice Interview & Founder Intake:**
   - Founder pastes paper DOI/links and enters a live conversational interview (`useLiveVoice` on `:8787` or `POST /interview` on `moss/fastlane-1`), showing live speaking/listening state, concise `<= 30`-word questions, live transcript, and synthesized `ValueProposition` (`one_liner`, `for_whom`, `pain`, `proof_points`) that populates `POST /intake`.
2. **02 · ICP & Buyer Signals + Instant Search:**
   - `GET /search?q=` bar displaying `ms` latency and `engine` (`moss` | `cache`), ranked buyer `Org` cards (`buyer_score` 0–100 + dated 90-day `Signal`s), and 4-quadrant cited `Icp`.
3. **03 · Layered Deep-Space Knowledge Graph ↔ Flat Leads Table:**
   - Explicit 1-click switcher (`Split Stage` / `Deep-Space Graph` / `Flat Leads Table`).
   - **3 Concentric/Layered Graph Zones (`GET /knowledge-graph`):**
     - **Core:** Founder + Papers + Value Map (`feature --ENABLES--> benefit --DELIVERS--> value --SOLVES--> problem`).
     - **Middle Ring:** Buyer Categories colored by problem set (`--cat-1` through `--cat-5`).
     - **Outer Ring:** Buyer Orgs, Bridge Researchers, and lit `Founder → Bridge → Buyer` warm paths.
4. **04 · Draft & Approve (HITL + Credit Gate):**
   - `POST /drafts` (`-1 credit`), explicit `HTTP 402` blocked banner at `0` credits, editable `intro_request` & `forwardable_note` tabs, SHA-256 `content_hash` lock (`stale` banner on post-approval edit), and `Approve` / `Reject` controls (`Nothing is sent externally`).
5. **05 · Pipeline Kanban & Governance Metrics:**
   - 7-stage horizontal Kanban (`found` → `pilot`), `[H]` human vs `[A]` agent pills, stage advance button, and `GET /metrics` conversion & path-kind tables (honestly labeled as seeded demo history).

---

## 4. Motion Rules

- **UI Chrome:** Instantaneous (`100ms–150ms` border/color transitions only; **no** spring bounce, **no** card hover scale, **no** drop-shadow lifts).
- **Deep-Space Graph:** Subtle `1.2s` linear `stroke-dashoffset` photon flow **only** on the currently selected warm path's hops; respects `prefers-reduced-motion: reduce`.

---

## 5. Canonical Component Specs

| Component | Visual & Behavioral Contract |
|---|---|
| **EvidenceChip** | Monospace `11px`, `1px solid rgba(56,189,248,0.4)`, flat `#0b2536` fill: `[PAPER · 2017 · harris-2017]` + external `↗` anchor. Opens Proof Drawer on click. |
| **EdgePill** | Monospace `10.5px`, dated relationship string (`co-authored 2017 (MIT)`, `published affiliation as of 2024`). **Banned word:** `"knows"`. |
| **VerificationBadge** | Moss-verified role: `--db-verified` (`MOSS VERIFIED · CTO @ Opticore · 2026-01-02`). Paper-only affiliation: `--db-unverified` (`PAPER AFFILIATION AS OF 2024`). |
| **CreditPill** | Normal: `--db-unverified` border (`CREDITS: 5 (flexprice)`). Zero / `HTTP 402`: `2px solid var(--db-blocked)` + `#2d0a0e` banner (`HTTP 402 — CREDIT GATE BLOCKED`). |
| **ApprovalState** | `draft` (neutral border), `approved` (`--db-verified` + SHA-256 prefix), `stale` (`2px solid var(--db-stale)` + `"EDITED AFTER APPROVAL — RE-APPROVE HASH"`), `rejected` (`--db-blocked`). Handles `409` hash conflict inline. |
| **PathCard** | Shows score (`94/100`), `kind` pill, ordered `EdgePill` chain, and highlights `weakest_edge_id` with `--db-unverified` border + `OK` / `Reject` Name-Check buttons. |
| **KanbanCard** | Flat `#0f1117`, `1px` border, org + bridge title, score, `[H]` (`--db-human`) or `[A]` (`--db-agent`) badge, collapsible history log, `Advance →` button. |
| **InterviewTurn** | Live mic indicator (`LISTENING` / `SPEAKING` / `IDLE`), `<= 30`-word question in bold `16px`, founder transcript in monospace, latency pill (`ms` + `engine`). |
| **Table↔Graph Switch** | Segmented flat button group (`aria-pressed="true"` gets `2px solid var(--db-accent)` + `#0b2536` fill) toggling `Split` / `Deep-Space Graph` / `Flat Table`. |

---

## 6. Do / Don't Examples

- **DO:** `published affiliation: Meta (as of 2024)` + `[AFFILIATION · stei-aff ↗]`
- **DON'T:** `Works at Meta` or `Nicholas knows Gregory at Meta`
- **DO:** `<Card flat border className="shadow-none rounded">` (`Onyx + Lucite + flat`)
- **DON'T:** Frosted glass cards, soft drop shadows, rounded-3xl pills, or unattributed AI claims.
