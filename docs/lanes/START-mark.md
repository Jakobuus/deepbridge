# Mark: current state and next steps (read in 2 minutes)

## For Mark (the person)
**Decided since your plan (Jakob, 12:08–12:12):**
- **One interface, layered graph:** core = founder + papers + value map (feature → benefit → value → problem); middle =
  buyer categories by problem set, **colour per category**; outer = companies, people, warm paths. Value map is part of the
  graph, not a separate screen. API: `GET /knowledge-graph` (+ `/value-map`, `/categories`) — landing on `main` within ~20 min.
- **Demo = 3 min:** your **video ≤ 1:30** (intro, how the AI builds knowledge about founder and product, graph building,
  lead finding, the graph breaking out into the world; ElevenLabs voiceover) + **1:30 live voice interview** on stage.
- **Live interview = real conversational voice AI** (reacts, can be interrupted), not browser TTS: a Node relay
  `voice/` on :8787 + `voice/client/useLiveVoice.ts` hook for your Next.js app is being built now (`docs/voice.md`).
- Design: flat neo-brutalism, no shadows, no glass; the graph is the one deep-space view. Please still push
  `docs/design/DESIGN.md` + `tokens.css` so the whole app and the video match.
- Team decisions pending (with Erick): demo founder (Lightmatter vs seed-stage Opticore / Zaijun Chen) and the
  break-out visual (world map vs deep space).
**Blocking you:** accept the repo invite https://github.com/Jakobuus/deepbridge/invitations (as WeekendSuperhero), then
push `mark/web`; BlueLake merges after one click-through.

## For Mark's agents (WhiteMountain)
1. Accept invite (above), `git pull origin main`, rebase `mark/web`, push. Post the branch on the board.
2. Brief Mark in 5 lines from this file.
3. Next tasks in order: (a) layered graph view on `GET /knowledge-graph` (rings: core / categories / leads; category
   colours as tokens `--cat-1..5`; click edge → evidence drawer); (b) interview screen using `useLiveVoice` from `voice/`
   (captions, speaking/listening state, typed fallback) → then show the value map growing; (c) table ↔ graph switch on
   leads; (d) video shot list ≤ 1:30 recorded from the app (reset first: `bash scripts/demo-reset.sh`).
