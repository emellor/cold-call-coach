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
pnpm simulate --persona good --runs 1 --review   # …plus a real post-call review
pnpm report:latency         # p50/p90 per stage, cache hits and cost over the logged calls
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

## The call log and the review (M4)

- **The agent records the call** in `CallRecorder` (`apps/agent/src/log/`): each committed
  turn with times in ms since she picked up (from LiveKit's speaking metrics), the rep's
  word timings, events (judgements, tool calls, meeting decisions, the outcome), latency and
  Claude usage per lane. Word timings come from `ProspectAgent.sttNode`, which taps the
  default node's final transcripts (`tapFinalWords`). Deepgram times words on the STT
  stream's own clock, which LiveKit doesn't expose, so each turn's words are pinned to the
  turn's VAD start; gaps within a turn stay exact.
- **The log is posted from a job shutdown callback**, so every ending posts it: her
  hang-up, the rep's, the time limit, an error. `failCall` posts a minimal log too when it
  can reach the API. `postCallLog` retries network errors and 5xx (1 s, 2 s, 4 s) and never
  throws.
- **`POST /internal/calls/:id/log` replaces the call's log in one transaction**: the call
  columns, then turns and events deleted and re-inserted. Posting twice leaves the same
  rows, and `callLog.route.test.ts` proves it against Postgres. A review is queued only if
  the call has none yet or the last one failed.
- **The review queue** (`apps/api/src/review/queue.ts`) is in-process and runs one review
  at a time. It resumes unfinished reviews at boot. Metrics come from
  `core/metrics/computeMetrics` (§8.1, pure), and the prompt from `core/review/prompt.ts`.
  The Claude call (`reviewer.ts`) streams raw events (`create` with `stream: true`: the SDK's
  stream helper parses the JSON itself and would hide a refusal or a `max_tokens` cut behind a
  parse error), on `REVIEW_MODEL`/`REVIEW_EFFORT`, with
  structured output as `ReviewDraft`. `finalizeReview` then runs `validateQuotes`: each
  quote must appear in the cited turn (or another turn, which then gets cited), ignoring
  case, punctuation and whitespace. Items whose quote can't be found are dropped and
  counted in `quotesDropped`. Scores are clamped, stages come in rubric order, and cost is
  priced with `core/claude/pricing.ts`.
- **Turn numbers in reviews count from 1** (`LoggedTurn.idx + 1`), matching the numbered
  transcript the reviewer sees and the page's `#turn-N` anchors.
- **Structured outputs** use `core/claude/structuredOutput.ts`, not the SDK's zod helper.
  It keeps `enum` and `const` as real constraints, and it moves the number and length
  bounds the API rejects into the description; zod enforces them on parse.
- **The web** moves to `/calls/:id` 1.5 s after a call she answered ends. That page polls
  every 2 s until the review settles, for up to 5 minutes. `/calls` is the history.

## The live coach and the controls (M5)

- **Exam calls get none of this.** The agent publishes no `coach.*` topic, and every
  control except hang-up refuses. The web hides the panel and the buttons as well.
- **`LiveCoach`** (`apps/agent/src/coach/`) publishes `coach.metrics` every 500 ms.
  - Talking time and the monologue come from `TalkClock` (`core/coach/talkClock.ts`), fed by
    LiveKit's `UserStateChanged`/`AgentStateChanged`. The VAD's `minSilenceDuration` is taken
    off each of the rep's stops.
  - Pace, fillers and questions are `computeMetrics` over the recorder's committed turns.
  - The stage tracker is a pure function of the judged stages (`core/coach/stages.ts`), and
    changes go out as a diff. A rewind can send `pending` to reset a stage.
  - Tips pass `TipGate` (`core/coach/tipGate.ts`): warn only, one per 20 s. A tip that
    arrives while both are speaking is held until the overlap ends, and dropped if that
    takes more than 5 s.
- **RPC**: `CallControls` (`apps/agent/src/controls/`) is registered on the agent's
  participant after `ctx.connect()`.
  - Only `REP_IDENTITY` may call it, and every answer is validated against `RpcMethods`.
  - A `ControlError`'s message reaches the rep as an `RpcError`. Any other failure becomes a
    generic one.
  - The web finds the agent through `participant.isAgent`. A stand-in agent in a test needs
    `kind: 'agent'` in its token.
- **Pause**: the agent calls `input.setAudioEnabled(false)`, `clearUserTurn()` and
  `interrupt()`.
  - While paused, `ProspectAgent.onUserTurnCompleted` throws `StopResponse`, so a turn that
    completes anyway never reaches the conversation.
  - The web mutes the mic before asking the agent to pause, and waits for the agent before
    unmuting on resume.
- **Rewind**, in order (each step is part of the contract):
  1. `interrupt()` and await it, so her cut-off reply is committed first.
  2. `clearUserTurn()`.
  3. `agent.updateChatCtx` with a copy cut just before the last user message. Earlier items
     are never edited.
  4. `brain.rewindTo(turn)`: queued or running judgements for that turn are cancelled, and
     her state goes back to the turn's `before`.
  5. `recorder.rewind()`: the rep's turn and her reply leave the log, which keeps the call
     as it stands.
  6. Her previous line again, with `session.say(line, { addToChatCtx: false })`.

  Rewind is refused once a meeting is booked. `rewind.session.test.ts` runs the whole thing
  on a real `AgentSession` in LiveKit's text-only mode.

- **Hint**: `claudeHints` runs a structured-output call for `HintDraft` on
  `COACH_MODEL`/`COACH_EFFORT`, with an 8 s cap.
  - Its prompt (`core/coach/hint.ts`) never sees her private facts, objections or state; a
    test asserts it.
  - Usage is logged as the call's `hint` lane.
- **The review** gets the controls from the `pause`, `resume`, `hint` and `rewind` events.
  Their payloads have schemas in `contracts/callLog.ts`. The API tallies them with
  `controlsUsed` into the prompt, and tells Claude not to mark the rep down for using them.
- **Web**: `useCall` owns the controls, and `useShortcuts` owns Space, H, R and Esc.
  - Shortcuts ignore typing and modifier keys.
  - Space still presses a focused button rather than pausing.
  - Tips and hints overlay the video, so the controls never move.

## Cost, latency, resilience and sign-in (M6)

- **Cost.**
  - The price table is `config/prices.json` (`PriceTable`). A dated model id prices as its
    alias. The API refuses to boot on a bad file, while the agent runs unpriced instead:
    costs are null and there is no warning.
  - The agent prices usage as it records it. `CallRecorder` takes Deepgram's audio and
    Cartesia's characters from LiveKit's `MetricsCollected` (`stt_metrics`, `tts_metrics`).
    Its `costSoFar()` feeds `CostWatch`, which sends one `call.notice` when the call passes
    `warnAboveUsd`.
  - The API adds the review's cost. `core/cost/costBreakdown` builds the lines for
    `GET /api/calls/:id`, and the list carries `costUsd` and `overBudget`.
  - Stored costs are never re-priced, so a price change applies to new calls only. The
    warning line is read at request time.
- **Latency.**
  - `core/report/latency.ts` computes percentiles and cache stats.
  - `pnpm report:latency` (`scripts/latency-report.ts`) reads the calls through
    `apps/api/src/calls/report.ts`, because the root scripts can't import `drizzle-orm`.
  - `claude/sentences.test.ts` proves the first sentence reaches the TTS tokenizer while
    Claude is still streaming.
- **The log always posts.**
  - `runCall` registers the shutdown callback before anything else can fail. Until the
    session exists the callback posts `minimalLog`; after that, the full log.
  - Set-up errors go through `fail(reason)`.
  - When the API is unreachable after `postCallLog`'s retries, `LogSpool` writes the log
    under `AGENT_SPOOL_DIR`. Each new call flushes the spool without waiting.
  - On the API, `sweepStaleCalls` (at boot, then every 5 min) marks calls that never
    ended, older than the limit plus 5 min, as failed. A late log still replaces the row.
- **Notices.** `call.notice` (`CallNoticePayload`) carries:
  - provider failures, which `failures.ts` words as the env var to check, or unreachable,
    timed out or rate-limited;
  - her failed replies;
  - judge failures, as warnings;
  - the cost warning.

  `CallNotices` drops a repeat of the same code and message. Every notice sent is also a
  `notice` event in the log. `GET /api/health` returns `features`, the reason calls or
  reviews are off, and the web header shows it.

- **Web.**
  - `useCall` shows **Reconnecting…** between `RoomEvent.Reconnecting` and `Reconnected`.
  - Her voice plays through LiveKit's `RoomAudioRenderer`, and `StartAudio` offers **Click to
    allow audio** when the browser holds sound back.
- **Sign-in** (`apps/api/src/auth.ts`), only when `APP_PASSWORD` is set.
  - An `onRequest` hook answers 401 on every `/api/*` route except health and
    `/api/auth/*`. The `/internal/*` routes keep `x-internal-secret`.
  - The cookie is `ccc_session` = `<expiry>.<HMAC>`, keyed by `INTERNAL_API_SECRET` and
    the password.
  - `LoginLimiter` allows 10 wrong passwords per address per 15 minutes.
  - In production the API requires `APP_PASSWORD` and a non-development
    `INTERNAL_API_SECRET`.
  - The web's `AuthGate` asks `GET /api/auth/session` first. Any other 401 fires
    `SIGNED_OUT_EVENT`. It fails open when the API can't be reached, and the API still
    refuses.
  - The web's `send` labels a request `application/json` only when it has a body.
    Fastify answers 400 to an empty body labelled JSON, and `app.inject` sends no
    content-type, so the route tests can't catch it. Deployed, sign-out never cleared
    the cookie and "Rerun review" always failed.
- **LiveKit keys.** A wrong key pair used to show only as a call dropping at the first ring.
  - `liveKitPairProblem` (core) refuses a room token from LiveKit's "Generate Token" as the
    secret, and a swapped pair. Both apps' configs use it, and they trim pasted values.
  - The API's `LiveKitCheck` asks LiveKit (`listRooms`) whether it accepts the pair, keeps
    the verdict for a minute, and `GET /api/health` reports a refusal as the calls reason.
  - `useCall` ignores the disconnect LiveKit reports for a refused join, so the dial error
    names the refusal (`LIVEKIT_REFUSED_TOKEN`) instead of a dropped connection.
- **Claude keys.** A key bound to a user or a service account can belong to the
  organization instead of a workspace. Claude then refuses every request with a 400,
  "not scoped to a workspace", unless it carries an `anthropic-workspace-id` header.
  - Both apps take an optional `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`) and send it as that
    header through `claudeHeaders` (core). The SDK sends the header only for its own
    credential profiles, never with an API key, so setting the variable alone does nothing.
  - The agent's `describeClaudeFailure` and the API's `describeClaudeError` name that
    refusal (`describeNoWorkspace`). Other failures are given in Claude's own words
    (`claudeErrorMessage`), because "Claude failed (400)" gave nothing to act on.
- **Render** (`render.yaml`).
  - Builds run `corepack pnpm`, which needs no global install (`npm install -g pnpm` is
    reported to fail on Render with EROFS). Start and pre-deploy commands are plain
    `node`, so nothing needs pnpm at run time.
  - The worker installs with `--prod`, runs `TURN_DETECTOR=audio`, and gets the API's
    private address as `API_HOSTPORT`, from which `readCallConfig` builds
    `http://host:port` when `API_BASE_URL` is unset.
  - The commands were run locally in production mode; the Blueprint has never been
    applied on Render.

## The avatar (removed)

- The 3D avatar (TalkingHead with HeadAudio lip-sync, M2) was removed at the owner's request:
  its quality wasn't worth having. Calls are voice only; the page shows her initials.
- Her mood is still computed (`moodFor`) and published in `prospect.state`, and `useCall`
  keeps it, for any future visual. Nothing on the page shows it.
- `scripts/fetch-avatar.mjs` is a stand-in that does nothing, kept only because the deployed
  web service's build command still runs it. Delete it once that step is gone from Render.

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
