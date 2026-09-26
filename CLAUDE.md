# CLAUDE.md

Before starting any milestone, read docs/PLAN.md and the matching prompt in docs/PROMPTS.md.

## Rules for coding agents (PLAN.md §15)

**Scope and tooling**

- Read `docs/PLAN.md` before starting, and stay inside the current milestone's scope.
- pnpm only; Node 22; TypeScript strict; ESM.

**Code structure**

- `packages/core` is pure: all maths, state rules, prompt builders and validators live
  there, with unit tests.
- Every wire payload (topics, RPC, HTTP) has a zod schema in `packages/contracts`,
  validated on both ends.
- Provider keys live only in the API and agent environment. The web app never sees them.

**Claude**

- Load the `claude-api` skill before writing Claude API code.
- Model and effort come from env, per lane.
- Never send sampling parameters to Opus 5.

**Pipeline rules**

- Nothing may be awaited on the prospect's reply path except the prospect's own Claude
  stream. The coach never blocks the prospect.
- Code counts, Claude judges: metrics are computed in code, and review quotes are
  validated.

**Assets**

- Don't commit `mpfb.glb`, and don't use the non-CC0 sample avatars.

**Workflow**

- Work on a branch per milestone from `main`, e.g. `m1-voice-loop`.
- Run lint, typecheck, test and build before pushing, then open a PR.
- In the PR, list assumptions and anything unverified, especially anything that needs a
  microphone.

## Commands

```bash
pnpm install
docker compose up -d        # Postgres 16 on :5432 (db, user and password all "coach")
pnpm db:migrate             # apply apps/api/migrations/*.sql
pnpm dev                    # API :3000 + web :5173 + agent, in parallel
pnpm build && pnpm start    # production: one Fastify process serves the API and the built SPA

pnpm lint                   # eslint (incl. import boundaries) + prettier --check
pnpm format                 # prettier --write
pnpm typecheck              # tsc for every workspace
pnpm test                   # vitest, single pass (node + jsdom projects)
pnpm test:watch
pnpm test apps/api          # filter by path
pnpm test -t "health"       # filter by name

pnpm --filter @ccc/agent download-files   # fetch the agent's model files (turn detector, VAD)
pnpm simulate --help        # text-only persona regression; spends Claude tokens, run by hand
```

## How the code runs

- **No compile step for Node code.** Node 22 strips TypeScript types natively, so the
  API and the agent run `src/*.ts` directly and workspace packages export `./src/index.ts`.
  Consequences, all enforced by `tsconfig.base.json`: relative imports carry an explicit
  `.ts` extension; no enums, namespaces or constructor parameter properties
  (`erasableSyntaxOnly`); type-only imports use `import type`. `tsc` only type-checks.
- **Config**: each app has a small zod-validated `config.ts` that reads the repo-root
  `.env` (real environment variables win) and fails fast with the names of whatever is
  missing. The agent instead exits 0 with a notice when LiveKit is not configured, so
  `pnpm dev` keeps the API and web running.
- **Migrations** are hand-written SQL in `apps/api/migrations/NNNN_*.sql`, applied in
  filename order by `apps/api/src/db/migrate.ts`, which records a SHA-256 per file.
  Editing an applied migration is a hard error: add a new numbered file. The Drizzle
  schema in `apps/api/src/db/schema.ts` is hand-written to match.

## The voice agent (apps/agent)

- **One job is one call.** `runCall.ts` builds the session; `CallController` (`call.ts`) owns
  the lifecycle: ring 2–5 s with the rep's audio detached, pick up with `session.say` (no LLM),
  enforce the 15-minute cap, end exactly once.
- **The prospect calls Claude from `ProspectAgent.llmNode`.** LiveKit only runs `llmNode` when
  an `LLM` instance is configured, so `DirectClaudeLLM` is a placeholder that must stay; its
  `chat()` is never called. Don't swap in `@livekit/agents-plugin-anthropic`: it can't set
  effort or place the state note.
- **Each call loads its scenario** from the API (`API_BASE_URL` + `INTERNAL_API_SECRET`):
  voice (or `CARTESIA_VOICE_ID` while the file has the placeholder), STT locale, keyterms
  and opening line. A missing piece ends the call with a reason the rep can read.
- **Barge-in**: LiveKit cancels the `llmNode` stream; `claudeTextStream` aborts the HTTP request
  on cancel. Preemptive generation is on (LiveKit's default), so a reply can be generated and
  then discarded: act on anything a reply "does" only once its message is committed.
- **Turn detector**: `TURN_DETECTOR=multilingual` (the plan's text model) imports
  `@livekit/agents-plugin-livekit` only when selected, because importing it registers an
  inference runner that crashes the worker if the model hasn't been downloaded
  (`pnpm --filter @ccc/agent download-files`). `audio` is LiveKit's on-device replacement.
- **A local LiveKit server** (`livekit-server --dev`, key `devkey`, secret `secret`,
  `ws://localhost:7880`) runs the full dispatch path without LiveKit Cloud.

## Scenarios and the prospect's brain

- **Data** lives in `scenarios/`: `product.json`, one file per scenario (named after its
  `id`), `rubrics/*.json`. Schemas are in `packages/contracts/src/scenario.ts`;
  `ScenarioCatalog` also checks cross-file references. `scenarios/scenarios.test.ts`
  validates every file and runs scripted judgements through the real state engine, so a
  threshold edit that makes a scenario unwinnable (or unlosable) fails a test.
- **API**: at boot `readScenarioCatalog` validates the files (a bad one stops the boot)
  and `syncScenarios` upserts them by `(id, version)`, retrying until Postgres answers.
  Routes read the table back: `GET /api/scenarios` (summaries only; private facts never
  leave the server) and `GET /internal/scenarios/:id` (agent only, `x-internal-secret`).
  The product and rubrics stay in memory; there are no tables for them.
- **Core** (pure): `buildProspectSystemPrompt` (no product details: she doesn't know what
  the caller sells), `stateEngine` (`applyJudgement`, `moodFor`, `stateToInstruction`,
  `meetingAllowed`), `withStateNote` (Opus: a final `system` message; Haiku: appended to the
  last user turn) and the judge's prompt. Private facts are keyed `pain_1`…`timing`
  (`FactKey`), a fixed enum so the judge's structured-output schema never changes.
- **Agent**: `ProspectBrain` (LiveKit-free, shared with the simulator) holds her state,
  queues one judgement per committed rep turn (`ConversationItemAdded`, role `user`) and
  applies them in order. Her reply reads `brain.note()` and never waits for the judge: the
  one-turn lag is by design. Her tools are side-channel: `llmNode` tags each reply with an
  id in the first `ChatChunk`'s `extra` (`REPLY_ID_KEY`), LiveKit copies it onto the
  committed message, and `actOnReply` runs only for a reply committed un-interrupted. A
  preemptive generation that was discarded never commits, so its tools never run.
- **Meetings** stand only if `meetingAllowed` agrees, checked against the state her reply
  was written under and the rep's last three judged turns; otherwise her next note says
  nothing is agreed. A booked meeting makes `meeting_booked` the call's outcome however it
  ends. When patience hits `hangUpAt` the next note forces a goodbye, and the call ends
  after that reply even if she forgets `end_call`.
- **The judge** is a `client.beta.messages.parse` call on `COACH_MODEL`/`COACH_EFFORT`. Its
  format comes from `structuredFormat` (`claude/structuredOutput.ts`), not the SDK's
  `betaZodOutputFormat`, which folds `enum` into the description and so would leave the
  stage and fact keys unconstrained. A failed or timed-out judgement applies no signals.
- **`scripts/simulate-call.ts`** drives the same brain, request builders and tools with
  Claude as the rep (`scripts/simulate/`); its harness is unit-tested with a fake Claude.

## The avatar (apps/web/src/avatar)

- `AvatarController` wraps TalkingHead (3D) and HeadAudio (lip-sync from audio). The
  prospect's LiveKit track is routed through TalkingHead's audio graph only: a muted
  `<audio>` element touches the stream (Chrome won't process a remote stream otherwise),
  and `RoomAudioRenderer` is not used, or she would play twice. It is the fallback only
  when there is no controller (no WebGL).
- `lipsyncModules: []`: HeadAudio drives the mouth, and TalkingHead's text lip-sync modules
  are loaded by a runtime-computed import Vite's build can't follow.
- Never call `head.stop()` to pause: it also suspends the audio context and silences her.
  Phone mode and hidden tabs set `head.isRunning = false` and stop HeadAudio instead.
- The 3D code is a lazy chunk loaded by `AvatarStore`; the call UI works without it.
  In development the controller is on `window.__cccAvatar` for console experiments.
- The model is fetched by `pnpm avatar:fetch` (pinned commit + SHA-256) and git-ignored.

## Tests

Two Vitest projects in `vitest.config.ts`: `node` for every `*.test.ts`, `jsdom` for
every `*.test.tsx`.

Database-backed tests (`*.route.test.ts`, `*.db.test.ts`) run against a real Postgres,
never a mocked Drizzle. When no database answers they skip with a loud warning; with
`REQUIRE_DB=1` (set in CI) that is a failure instead. The node project's global setup
migrates the test database first, so `docker compose up -d && pnpm test` just works.

## Import boundaries (eslint.config.js)

- `packages/core`: no Node built-ins, no React, no dynamic `import()`, and no workspace
  package except `@ccc/contracts`.
- `apps/web`: may import `@ccc/contracts`, never `@ccc/core`.
