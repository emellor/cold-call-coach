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

## Keys

Keys go in the repo-root `.env`, which git ignores, or in your host's secret settings.
Never paste them into a chat, an issue or a commit. `.env.example` lists every variable.

| Variable                                               | Used by                                                         | Where to get it                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | API (room tokens) and agent                                     | LiveKit Cloud: your project → Settings → API keys → **Create key**. The secret is shown only then; **Generate Token** makes a room token, which is not the secret |
| `ANTHROPIC_API_KEY`                                    | Agent (her replies, the judge, Get help) and API (the review)   | Claude Console → API keys. Create it in a workspace                                                                                                               |
| `ANTHROPIC_WORKSPACE_ID`                               | Wherever `ANTHROPIC_API_KEY` is, only for a key in no workspace | The workspace's ID (`wrkspc_…`) from the Claude Console. A key created in a workspace doesn't need it                                                             |
| `DEEPGRAM_API_KEY`                                     | Agent: hearing you                                              | Deepgram console → API keys                                                                                                                                       |
| `CARTESIA_API_KEY`                                     | Agent: her voice                                                | Cartesia → API keys                                                                                                                                               |
| `CARTESIA_VOICE_ID`                                    | Agent, for a scenario whose voice is still a placeholder        | Cartesia's voice library: a voice's ID                                                                                                                            |
| `INTERNAL_API_SECRET`                                  | API and agent, the same value on both                           | Any random string, e.g. `openssl rand -hex 32`                                                                                                                    |
| `APP_PASSWORD`                                         | API, deployed only                                              | You choose it (8 characters or more)                                                                                                                              |

Locally, `INTERNAL_API_SECRET` can stay as `.env.example` has it and `APP_PASSWORD`
empty, which means no sign-in. In production the API refuses to start with either one
left like that.

## Run it

```bash
pnpm install
cp .env.example .env        # then fill in the keys (and a voice: see Scenarios)
pnpm --filter @ccc/agent download-files   # once: the turn detector's model
docker compose up -d        # Postgres on :5432
pnpm db:migrate
pnpm dev                    # API on :3000, web on http://localhost:5173, agent worker
```

Open http://localhost:5173, pick who to call, put your headset on and press **Dial**. It
rings for a few seconds, she picks up, and you talk: a voice call, as real cold calls
are. The transcript shows both sides, and the latency panel shows each reply's end-of-turn, LLM, TTS and end-to-end times with a
running p50. The header shows whether the API and database are healthy
(`GET /api/health` returns the same).

Without the LiveKit variables the agent prints what is missing and exits, and the API
and web keep running. With LiveKit but without a provider key, a call ends straight
away and names the missing key.

To run it the way it is deployed, as one process serving the API and the built SPA:

```bash
pnpm build && pnpm start    # http://localhost:3000
```

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
- **What you sell** is `scenarios/product.json`. The judge and the review read it; the
  prospect never does, so she only knows what you tell her.
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

| Control        | Key   | What it does                                                                                                                                                                      |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause / Resume | Space | Mutes your mic and stops her mid-sentence; she ignores anything she hears until you resume                                                                                        |
| Get help       | H     | What to say right now: the exact words, why they fit this point of the call, and what to say if she pushes back. From Claude on `COACH_MODEL`, which never sees her private facts |
| Rewind         | R     | Takes back your last turn and her reply. Her mood goes back to how it was, she says her previous line again, and you retake it                                                    |
| Hang up        | Esc   | Ends the call                                                                                                                                                                     |

An **exam** call shows nothing live and offers only **Hang up**: the review is your only
feedback. After a coached call, the review mentions any pauses, uses of Get help and rewinds, and it
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

## Cost per call

Every call is priced from what it used. The review page's **Cost** section shows it line
by line, and **History** has a Cost column.

- **Claude**, per lane: her replies, the judge, Get help (the `hint` lane) and the review. Input tokens,
  cache writes, cache reads and output are each priced at their own rate.
- **Deepgram**: the minutes of your audio it transcribed.
- **Cartesia**: the characters she spoke.

The prices are in `config/prices.json`, dated, with where each figure came from. Check
them against your own plans, because Deepgram and Cartesia price differently per plan,
and edit the file. The API and the agent read it when they start. A model the file
doesn't list shows as "not priced", and the total gets a `+`.

A call over **$2** (`warnAboveUsd` in the same file) is flagged three ways:

- during the call, the agent tells you as soon as it passes the line;
- the review page says so;
- History marks it ⚠.

Claude is most of the cost. Her replies and the judge run on every turn you take, so
`PROSPECT_MODEL`, `COACH_MODEL` and their efforts matter most. The prompt cache makes
every turn after the first cheaper. `claude-sonnet-5` costs 40% as much per token as Opus 5.
`claude-haiku-4-5` costs a fifth as much, but it caches nothing shorter than 4,096 tokens and
her prompts are shorter, so per call it saves little more than Sonnet 5. The voice costs
little by comparison: in the current table,
Deepgram is $0.0077 a minute and Cartesia $0.05 per 1,000 characters.

## Latency

Her reply should start within 1.5 s of you finishing at p50, and within 2.5 s at p90.
The **latency panel** under the transcript shows each reply's stages and a running p50:

| Stage           | What it measures                                                      |
| --------------- | --------------------------------------------------------------------- |
| End of turn     | How long after you stopped the turn detector decided you had finished |
| LLM first token | Claude's time to the first token of her reply                         |
| TTS first byte  | Cartesia's time to her first audio                                    |
| End to end      | From you stopping to her voice starting                               |

Her reply streams: each sentence goes to Cartesia while Claude is still writing the next
one, and a test holds the agent to that. Her persona and the conversation up to her last
reply are cached, so after the first request only your latest words and her state note are
billed at the full input price; the report below shows whether the cache was read.

`pnpm report:latency` prints p50 and p90 for each stage over the logged calls, grouped
by her model and effort, with cache hits and cost. It covers the 20 most recent calls
by default; `--calls 50` and `--since 2026-09-26` change that.

If replies are slow, the panel shows which stage is slow:

- **End of turn**: try the other `TURN_DETECTOR`. `audio` is LiveKit's newer on-device
  model and needs no download; `multilingual` is the plan's text model, which the plugin
  now marks deprecated.
- **LLM first token**: `PROSPECT_MODEL=claude-haiku-4-5` is the plan's latency lever.
  `PROSPECT_EFFORT` is already at its lowest, `low`, and Haiku ignores it.
- **TTS first byte**: this is Cartesia's time, and the app has nothing to tune.

## When something fails

- **A provider fails mid-call.** A notice under her video names it. A rejected key names
  the variable to fix (`check DEEPGRAM_API_KEY`). Otherwise the notice says the provider
  couldn't be reached, timed out or is rate-limiting you. If the call can't go on, it
  ends and says why.
- **Something isn't configured.** The header says what is off and what to set: "Calls
  are off: set LIVEKIT_URL, … on the API", or "Reviews are off: set ANTHROPIC_API_KEY on
  the API".
- **Your connection drops.** LiveKit reconnects on its own and the call shows
  **Reconnecting…** meanwhile. If the connection can't be restored, the call ends and
  says so.
- **The log always arrives.** However the call ends, the agent posts its log when the
  call's job shuts down: her hang-up or yours, the 15-minute limit, a provider failure,
  or the agent failing to set the call up. If the API is down at that moment, the log
  waits on the agent's disk (`AGENT_SPOOL_DIR`) and goes with the next call.
- **The agent dies mid-call.** A call that never reports back is marked failed once it is
  20 minutes old (the API checks every 5 minutes), so History doesn't show it ringing
  forever. If its log turns up later, the log wins.

## Deploy to Render

`render.yaml` is a Render Blueprint for three resources: the API and SPA as one web
service, the agent as a background worker, and Postgres. LiveKit Cloud stays as it is.

1. In Render, choose **New → Blueprint** and pick this repository.
2. Fill in the secrets it asks for. The web service and the worker each ask for the
   LiveKit trio and `ANTHROPIC_API_KEY`, because both use them. The web service also
   asks for `APP_PASSWORD`; the worker asks for `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`
   and `CARTESIA_VOICE_ID`. `INTERNAL_API_SECRET` is generated and shared with the
   worker, and the database is wired in.
3. Apply. Each deploy:
   - installs with the pnpm version `package.json` pins;
   - builds the SPA;
   - runs the migrations (`preDeployCommand`);
   - starts the service, with `/api/health` as its health check.
4. Open the web service's URL and sign in with `APP_PASSWORD`.

Things to know:

- **Plans.** The web service runs on Starter, the worker on Standard and Postgres on
  Basic-256mb. Workers have no free plan, and the pre-deploy migration needs a paid
  instance. The worker needs Standard's 2 GB: in production LiveKit keeps up to four
  job processes warm, which measured about 1.3 GB at rest.
- **Region.** All three run in Frankfurt, Render's nearest region to UK callers. They
  must share a region, because the worker reaches the API, and the API reaches Postgres,
  over Render's private network. The worker gets the API's private address as
  `API_HOSTPORT`.
- **Turn detector.** The worker uses `TURN_DETECTOR=audio`. That model is compiled into
  its package, whereas the text model is downloaded into `~/.cache`, outside the project.
- **Sign-in.** `APP_PASSWORD` is traded for a signed, http-only cookie. It lasts 30
  days and is `Secure` and `SameSite=Lax`.
  - Every `/api` route except health and sign-in needs the cookie, so only a signed-in
    browser gets LiveKit tokens.
  - Ten wrong passwords from one address lock it out until 15 minutes after the first.
  - Changing `APP_PASSWORD` or `INTERNAL_API_SECRET` signs everyone out.
  - To try the sign-in locally, set `APP_PASSWORD` in `.env`.

The Blueprint hasn't been applied on Render yet. Its build, pre-deploy and start
commands were run locally in production mode, against a local LiveKit server.

## Troubleshooting

| Symptom                                                                                  | What to do                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| She talks over herself, or answers her own words                                         | Echo: her voice is reaching your microphone from your speakers. Use a headset.                                                                                                                                                                                               |
| You can't hear her                                                                       | Press **Click to allow audio** if it appears: browsers only play sound once you have interacted with the page. Check the tab isn't muted and the site may play sound.                                                                                                        |
| Her replies are slow                                                                     | Open the latency panel to see which stage is slow, then see [Latency](#latency).                                                                                                                                                                                             |
| The call ends as soon as it starts ringing, or the header says LiveKit rejected the keys | `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be a key and its secret from the LiveKit project in `LIVEKIT_URL`, on the API and the agent alike. LiveKit shows a secret once, when the key is created, so create a new key and copy both values.                           |
| The call ends: "The voice agent's own settings are incomplete: … is not set"             | The agent reads its own environment. On Render it is its own service (`cold-call-coach-agent`), so set the named variables there too (`INTERNAL_API_SECRET` must match the web service's), then save and deploy. The agent's log lists anything missing each time it starts. |
| "Calls are off" or "Reviews are off" in the header                                       | Set the variables it names on the API and restart the API.                                                                                                                                                                                                                   |
| A red notice: "… rejected the agent's key: check …"                                      | Fix that variable where the agent runs and restart the agent.                                                                                                                                                                                                                |
| "Claude refused the … key because it isn't in a workspace"                               | The key belongs to your organization, not a workspace. Use an `ANTHROPIC_API_KEY` created in a workspace, or set `ANTHROPIC_WORKSPACE_ID` to the workspace's ID (`wrkspc_…`) next to every `ANTHROPIC_API_KEY`: on Render, on both services. Then save and deploy each.      |
| She only says "Sorry, you're breaking up. Say that again?"                               | That's her line when her reply fails. The notice beside the call says why, usually a Claude key.                                                                                                                                                                             |
| The call ends straight away                                                              | The ending names what is missing: a key, or a voice for the scenario.                                                                                                                                                                                                        |
| You're asked to sign in again                                                            | The session is 30 days old, or `APP_PASSWORD` or `INTERNAL_API_SECRET` changed.                                                                                                                                                                                              |
| "Too many wrong passwords"                                                               | Wait up to 15 minutes.                                                                                                                                                                                                                                                       |

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI runs the same against a Postgres 16 service on every pull request and push to `main`.

## Layout

| Path                 | What                                                           |
| -------------------- | -------------------------------------------------------------- |
| `apps/web`           | Vite + React SPA: dialler, live coach, review and history      |
| `apps/api`           | Fastify + Drizzle + Postgres; serves the SPA in production     |
| `apps/agent`         | LiveKit Agents worker (`agentName: "prospect"`)                |
| `packages/contracts` | zod schemas and types for every wire payload                   |
| `packages/core`      | Pure logic: metrics, state engine, prompt builders, validators |
| `scenarios`          | Product, scenario and rubric JSON                              |
| `docs`               | The build plan and milestone prompts                           |
