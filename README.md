# Cold Call Coach

A personal web app for practising B2B cold calls. Pick a scenario, press **Dial** and
hear it ring. A prospect answers: a talking 3D character with a natural voice who
objects, gets impatient, hangs up if you ramble and agrees to a meeting only when you
earn it. A coach shows live cues during the call, and afterwards you get a scorecard
with "say this instead" corrections.

The design is in [docs/PLAN.md](docs/PLAN.md); it is built milestone by milestone from
[docs/PROMPTS.md](docs/PROMPTS.md).

```
browser (apps/web) ⇄ LiveKit Cloud ⇄ voice agent (apps/agent) → Deepgram · Claude · Cartesia
                                              ↓ call log
                                     API (apps/api) + Postgres → post-call review
```

## Prerequisites

- **Node 22** (22.18 or newer: the API and agent run TypeScript directly) and
  **pnpm 10** (`corepack enable`).
- **Docker**, for the local Postgres 16.
- A **LiveKit Cloud** project on the free Build plan: its URL, API key and secret.
- API keys for **Anthropic**, **Deepgram** and **Cartesia**.
- A headset for calls. It avoids echo.

## Run it

```bash
pnpm install
cp .env.example .env        # then fill in the keys (and a voice: see Scenarios)
pnpm avatar:fetch           # once: the 3D avatar (~37 MB, CC0; see CREDITS.md)
pnpm --filter @ccc/agent download-files   # once: the turn detector's model
docker compose up -d        # Postgres on :5432
pnpm db:migrate
pnpm dev                    # API on :3000, web on http://localhost:5173, agent worker
```

Open http://localhost:5173, pick who to call, put your headset on and press **Dial**. It
rings for a few seconds, she picks up on camera, and you talk. Her lips follow her voice, she
looks at you and nods while you speak, and **Phone mode** hides her (real cold calls have
no face) without changing how her voice reaches you. If her lips trail her voice, tick
**Delay voice 0.1 s**. The transcript shows both sides, and the
latency panel shows each reply's end-of-turn, LLM, TTS and end-to-end times with a
running p50. The header shows whether the API and database are healthy
(`GET /api/health` returns the same).

Without the LiveKit variables the agent prints what is missing and exits, and the API
and web keep running. With LiveKit but without a provider key, a call ends straight
away and names the missing key.

## Scenarios

Three prospects, all in [`scenarios/`](scenarios): **Priya Shah** (easy: curious and
patient), **Claire Hughes** (medium: busy and sceptical) and **Denise Walsh** (hard: hates
cold calls, little patience). Each has private facts that good questions uncover,
objections, and hidden patience and interest. A judge (Claude) scores every turn you
take, code turns that into her patience and interest, and her next reply follows. Ramble
or push and she gets curt, frowns and hangs up; ask good questions and propose a specific
day and time, and she agrees to meet.

- **Voices.** Each scenario names its own Cartesia voice in `voice.voiceId`. They ship as
  `REPLACE_WITH_CARTESIA_VOICE_ID`, with a `hint` saying what to look for in Cartesia's
  library. Until you fill them in, `CARTESIA_VOICE_ID` in `.env` is used for all three.
- **What you sell** is `scenarios/product.json`. The judge and (from M4) the review read
  it; the prospect never does, so she only knows what you tell her.
- **Editing.** The API validates every file when it starts and refuses to boot on a bad
  one, naming the file and field. `pnpm test` checks them too. Bump a scenario's
  `version` when you change it meaningfully: calls record the version they were made
  with.

`pnpm simulate` plays a scripted terrible rep and a good rep against the real prospect,
judge and state engine, text only, and prints each run's outcome and state trace. It
spends Claude tokens, so run it by hand (`pnpm simulate --help` for the options). The bar:
the terrible rep books no meetings in 5 runs, and the good rep books at least 3.
`--review` also runs the post-call review on each simulated call and prints the result.

## During the call

Choose **Coached** or **Exam** next to **Dial**; the page remembers your choice.

A **coached** call shows the live coach under her video:

- where the call is: Opener → Reason for call → Discovery → Objections → Next step, as
  the coach judges each of your turns;
- your share of the talking against the 40–60% target, and your current monologue, which
  turns amber at 30 s and red at 45 s;
- your pace, fillers and open vs closed questions, updated as each of your turns ends;
- a tip when the coach sees something hurting the call: at most one every 20 s, never
  while she is talking over you, gone after 8 s.

You also get controls, each with a key:

| Control        | Key   | What it does                                                                                                                   |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pause / Resume | Space | Mutes your mic and stops her mid-sentence; she ignores anything she hears until you resume                                     |
| Hint           | H     | Three lines you could say next, from Claude on `COACH_MODEL` (it never sees her private facts)                                 |
| Rewind         | R     | Takes back your last turn and her reply. Her mood goes back to how it was, she says her previous line again, and you retake it |
| Hang up        | Esc   | Ends the call                                                                                                                  |

An **exam** call shows nothing live and offers only **Hang up**: the review is your only
feedback. After a coached call, the review mentions any pauses, hints and rewinds, and it
scores the call as it stands after them: a rewound turn is not in the transcript.

## After the call

Hang up (or get hung up on) and the page moves to the call's review. The agent sends
the call log to the API as the call ends, and the API reviews it with Claude
(`REVIEW_MODEL`, default `claude-opus-5` at `REVIEW_EFFORT=high`):

- an overall score out of 100 and one per rubric stage (`scenarios/rubrics/cold-call-v1.json`),
  each with quotes from the call;
- your delivery against the targets: talk ratio, pace, fillers, open vs closed questions,
  longest monologue, time to your first question (measured by code, never by Claude);
- the three moments that mattered most, as _you said → try instead → why_, and every
  objection she raised with a better answer;
- one drill, and the full transcript with each quote's turn marked. Click a turn number
  to jump to it.

Every quote is checked against the transcript before it's shown. The review drops any
it can't find, so each criticism uses your actual words. **History** lists every call
with its outcome, score and length. A review needs `ANTHROPIC_API_KEY` on the API. Without
one, the page says so, and **Try again** reruns the review once the key is set.

`TURN_DETECTOR=audio` in `.env` swaps the plan's text-based turn detector for LiveKit's
newer on-device audio model, which needs no download; the plugin now marks the text
model deprecated. Try both with your headset and keep whichever feels more natural.

To run it the way it is deployed, as one process serving the API and the built SPA:

```bash
pnpm build && pnpm start    # http://localhost:3000
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI runs the same against a Postgres 16 service on every pull request and push to `main`.

## Layout

| Path                 | What                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `apps/web`           | Vite + React SPA: dialler, avatar, live coach, review and history |
| `apps/api`           | Fastify + Drizzle + Postgres; serves the SPA in production        |
| `apps/agent`         | LiveKit Agents worker (`agentName: "prospect"`)                   |
| `packages/contracts` | zod schemas and types for every wire payload                      |
| `packages/core`      | Pure logic: metrics, state engine, prompt builders, validators    |
| `scenarios`          | Product, scenario and rubric JSON                                 |
| `docs`               | The build plan and milestone prompts                              |
