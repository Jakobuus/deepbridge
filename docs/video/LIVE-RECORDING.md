# Live-interview recordings (Mark)

Two browser recordings of the real web app (`web/`, `:3000`) against the real API, 24 Nov 2026. They sit next to
`deepbridge-demo.mp4` (Jakob's demo video), which is unchanged.

| File | Length | What it is |
|---|---|---|
| `deepbridge-pitch-live-interview.mp4` | 2:29 | Pitch intro (voiceover over site footage) → the live interview with real audio → narrated walkthrough of the graph, draft, approval and pipeline |
| `deepbridge-live-interview.mp4` | 2:00 | The raw run only: interview with real audio, then the silent click-through |

## Timeline (`deepbridge-pitch-live-interview.mp4`)

- **0:00 Pitch intro.** Knowledge Graph screen, then the Intake orb. Voiceover: radiation and lead, the Berkeley Lab
  molecule, Hannah Weber and HOPO Therapeutics, the hard part is finding buyers.
- **0:27 Live interview.** Speak is clicked; the ElevenLabs agent ("Christine") asks the stage questions from
  `interview_style.py`; Hannah answers three times; the value map and buyer categories build beside the orb; the agent
  reads back, says "Thanks, Hannah." and hangs up (end_call); the app moves to the Knowledge Graph.
- **1:54 Narrated tail.** The graph with the Deblonde → Lawrence Livermore path lit, the cited draft with checks, human
  approval ("bound to this exact text · nothing sent"), and the pipeline.

## What is real, what is voiced

- **Real:** the web app, every click, the API data, the graph stream, the drafts and approval, and the interviewer:
  a live ElevenLabs agent conversation (`agent_4301m87wdsfcf4z87ac1fkw8xne1`), unscripted beyond its prompt. The
  interview audio is ElevenLabs' recording of that call, synced to the screen within about 0.3 s.
- **Voiced role-play:** Hannah's three answers are ElevenLabs text-to-speech ("Jessica"), written from public facts
  only (the pill, radiation and lead, Rebecca Abergel's lab, Lawrence Livermore and Bayer as people she would like to
  meet). They were played into the browser as her microphone, each after the interviewer finished asking.
- **Narration:** the intro and tail voiceover is ElevenLabs text-to-speech ("Chris"). Facts follow pitch v4:
  "now publishes from Lawrence Livermore" is an OpenAlex affiliation, not a verified current role.
- Pipeline stage history in the app is seeded demo data; nothing was sent to anyone.

## How it was made

Headless Chromium driven by Playwright; frames from the DevTools screencast, assembled with ffmpeg at 30 fps
(1920×1080, H.264/AAC). The loading screen at the start and most of the "Generating…" wait for the draft are trimmed.
