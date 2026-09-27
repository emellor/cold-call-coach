# Cold Call Coach: v1 build plan

_Updated 26 Sep 2026. Package versions and APIs below were checked against npm and GitHub on that date._

## 1. What v1 is

Cold Call Coach is a personal web app for practising B2B cold calls. You pick a scenario, press **Dial** and hear it ring. A prospect answers: a talking 3D character (TalkingHead's public-domain sample avatar) with a natural voice. She objects and gets impatient. She hangs up if you ramble, and agrees to a meeting only when you earn it. A coach shows live cues during the call. Afterwards you get a scorecard with "say this instead" corrections.

**In v1**
- Voice conversation: ringing, pick-up, barge-in, hang-up.
- Three scenarios, with a hidden-state prospect that can hang up or agree to a meeting.
- The 3D avatar with lip-sync and moods, plus a phone mode.
- A live coach panel with tips, a stage tracker, and pause, hint and rewind.
- A post-call review, call history, and a latency and cost report.

**Not in v1** (section 14): your own characters, custom moods, a scenario generator, drills, progress charts, dial-in from a real phone, multi-user and billing.

## 2. Architecture

```
┌───────────────────────────────────────────────────────┐
│ BROWSER · apps/web (React + Vite + TS)                │
│ TalkingHead avatar + HeadAudio lip-sync               │
│ live-coach panel · transcript · controls              │
│ scenario picker · review · history                    │
└─────┬─────────────────────────────────┬───────────────┘
      │ your voice                      ▲ prospect voice,
      │                                 │ text streams, RPC
      ▼                                 │
┌─────┴─────────────────────────────────┴───────────────┐
│ LIVEKIT CLOUD · WebRTC audio + data (free tier)       │
└─────┬─────────────────────────────────┬───────────────┘
      │                                 ▲
      ▼                                 │
┌─────┴─────────────────────────────────┴───────────────┐
│ VOICE AGENT · apps/agent (LiveKit Agents, Node)       │
│ Silero VAD + turn detector                            │
│  └► Deepgram Nova-3 (fillers, keyterms)               │
│      ├► PROSPECT · Claude via custom llmNode          │
│      │    persona + hidden-state note                 │
│      │    └► Cartesia Sonic 3 ──► voice out           │
│      └► JUDGE · Claude JSON, in parallel              │
│           └► state engine (packages/core)             │
│              ──► mood, tips, stage, metrics           │
└─────┬─────────────────────────────────────────────────┘
      │ call log (POST /internal/calls/:id/log)
      ▼
┌─────┴─────────────────────────────────────────────────┐
│ APP API · apps/api (Fastify + Drizzle + Postgres)     │
│ scenarios · calls · LiveKit tokens + dispatch         │
│ metrics ─► review job (Claude) ─► scorecard           │
└───────────────────────────────────────────────────────┘
```

Each part has one job:
- **Browser:** captures your voice and renders.
- **Agent:** the only component that talks to AI services during a call.
- **API:** owns the database and runs the post-call review.

**Five principles** (enforced in code review):
1. **Speech-to-text, Claude, then text-to-speech; not a speech-to-speech model.** We keep every word you say, with timings and "um"s.
2. **Actor and referee are separate.** The prospect model only acts. A judge model scores each rep turn, and deterministic code turns the score into hidden state (patience, interest).
3. **The coach never delays the prospect.** The judge, the metrics and the tips run in parallel, and their state lands on the next turn.
4. **Code counts, Claude judges.** Code computes the metrics, and the review must quote your actual words. Code checks every quote.
5. **Everything is data and every call is logged.** Scenarios and rubrics are versioned JSON. Turns, events, state snapshots, latency and cost are all stored.

## 3. Stack (checked 26 Sep 2026)

| Area | Choice | Notes |
|---|---|---|
| Web | Vite 6, React 18, TypeScript (strict), Tailwind CSS 4, wouter | |
| Real-time client | `livekit-client` 2.22, `@livekit/components-react` 2.9 | Hooks used: `useVoiceAssistant`, `useTranscriptions`, `useTextStream`, `useRpc` |
| Avatar | `@met4citizen/talkinghead` 1.7.0 (MIT; depends on `three` ^0.180) | Sample avatar `mpfb.glb` (CC0) is **not** in the npm package; a script fetches it (§7) |
| Lip-sync | `@met4citizen/headaudio` 0.1.0 (MIT) | Audio-driven: turns the audio you hear into mouth shapes |
| API | Fastify 5, Drizzle ORM, `pg`, zod, `livekit-server-sdk` 2.19 | |
| Agent | `@livekit/agents` 1.9.1, plugins `deepgram`, `cartesia`, `silero`, `livekit` (turn detector), all 1.9.1, Apache-2.0 | Reference: `livekit-examples/agent-starter-node` |
| Claude | `@anthropic-ai/sdk`, called from a custom `llmNode` | Not the stock `@livekit/agents-plugin-anthropic`, which can't set effort or place the state note |
| Speech-to-text | Deepgram Nova-3 (`fillerWords: true`, `keyterm`) | Not Flux: Flux has no filler-word option |
| Text-to-speech | Cartesia Sonic 3 (`model: 'sonic-3'`), with `speed` and `emotion` options | Voice id per scenario |
| Media | LiveKit Cloud, Build plan (free: 1,000 agent-minutes a month, 5 concurrent agents) | Self-hosted LiveKit server is the free fallback |
| Database | Postgres 16 (Docker Compose locally) | |

## 4. Repo layout

```
cold-call-coach/
├─ apps/
│  ├─ web/            Vite + React SPA
│  ├─ api/            Fastify + Drizzle (serves the SPA in production)
│  └─ agent/          LiveKit Agents worker (agentName "prospect")
├─ packages/
│  ├─ contracts/      zod schemas + types for every wire payload
│  └─ core/           pure logic: metrics, state engine, prompt builders, quote validation
├─ scenarios/
│  ├─ product.json    what you sell
│  ├─ *.json          scenario files
│  └─ rubrics/cold-call-v1.json
├─ scripts/           fetch-avatar.mjs, simulate-call.ts
└─ docs/              PLAN.md (this file), PROMPTS.md
```

**Import boundaries** (ESLint):
- `packages/core`: no I/O, no Node built-ins, no React. It may import only `contracts`.
- `apps/web`: may import `contracts`, never `core`.

## 5. Call flow

1. **Web → API:** `POST /api/calls { scenarioId, mode }`. The API creates the `calls` row and mints a LiveKit token:
   - identity `rep`, room `call-<callId>`, 15-minute TTL;
   - `roomConfig` containing a `RoomAgentDispatch` for agent `prospect`, with metadata `{ callId, scenarioId, mode }`.

   It returns `{ callId, url, token }`.
2. **Web** connects and plays a synthesised ring tone while `call.state.phase === 'ringing'`. The UK tone is 400 + 450 Hz with a 0.4 s on / 0.2 s off / 0.4 s on / 2.0 s off cadence.
3. **Agent** job starts:
   - reads the dispatch metadata and loads the scenario;
   - publishes `ringing`, waits a random 2–5 s, then publishes `connected`;
   - calls `session.say(openingLine)`. No LLM is involved, so the pick-up is instant.
4. **Each rep turn:** VAD and the turn detector end the turn, and Deepgram gives the final transcript. Two things then happen at once:
   - **(a) Prospect:** the `llmNode` streams Claude's reply into Cartesia. The audio goes over WebRTC into TalkingHead's audio graph, where HeadAudio drives the lips.
   - **(b) Judge**, in parallel: a Claude call returns JSON, the state engine updates, and the agent publishes `prospect.state` (for mood) and the coach events. Metrics are published every 500 ms.
5. **End:** the prospect calls `end_call`, the rep hangs up, or the 15-minute limit hits. The agent posts the call log. The API computes metrics and runs the review. The web polls and shows the scorecard.

## 6. The prospect brain

### 6.1 Scenario and product files (validated by zod in `contracts`)

```jsonc
// scenarios/medium-finance-director.json
{
  "id": "medium-finance-director", "version": 1,
  "title": "Busy finance director", "difficulty": "medium", "locale": "en-GB",
  "prospect": {
    "name": "Claire Hughes", "role": "Finance Director",
    "company": "Harrow & Finch Logistics", "companyFacts": "3 warehouses in the Midlands, 240 staff",
    "personality": "direct, numbers-first, sceptical of vendors, hates wasted time",
    "speakingStyle": "clipped, dry humour, says 'right' and 'look'",
    "openingLine": "Claire Hughes.",
    "hidden": {
      "pains": ["energy bills up about 40% in two years and the board wants answers",
                "no per-site breakdown, only the supplier's monthly bill"],
      "currentSolution": "the supplier's portal plus a spreadsheet",
      "decisionProcess": "signs off anything under £20k; above that goes to the MD",
      "timing": "budget planning starts in January"
    },
    "objections": ["I'm about to go into a meeting", "Just send me an email",
                   "We already get reports from our supplier", "What's this going to cost?"]
  },
  "voice": { "provider": "cartesia", "voiceId": "<British female voice id>", "speed": "normal" },
  "avatar": { "url": "/avatars/mpfb.glb", "body": "F" },
  "state": { "interest": 20, "patience": 55, "patienceDecayPerTurn": 3, "hangUpAt": 0, "meetingAt": 65 },
  "winCondition": "Agrees to a 20-minute call at a specific day and time",
  "rubricId": "cold-call-v1"
}
```

```jsonc
// scenarios/product.json (example; replace with what you actually sell)
{
  "name": "WattGuard",
  "oneLiner": "Shows multi-site UK businesses where they waste energy, site by site, and keeps them compliant",
  "valuePoints": ["per-site energy visibility", "anomaly alerts", "ESOS / SECR / ISO 50001 reporting"],
  "idealCustomer": "UK businesses with 3+ sites",
  "callGoal": "Book a 20-minute discovery call",
  "keyterms": ["WattGuard", "ESOS", "SECR", "ISO 50001", "half-hourly data"]
}
```

- **Scenarios in v1:** easy (curious operations manager), medium (the file above), hard (facilities manager who hates cold calls). All three are **women**, because the sample avatar has a female body (`body: 'F'`). Pick female Cartesia voices to match.
- **Hidden pains** should connect to the product's value, so that good discovery questions can uncover them.
- **Product details go to the judge and the review, never to the prospect.** She doesn't know what you sell until you tell her. `keyterms` go to Deepgram.

### 6.2 Prospect system prompt (`core/buildProspectSystemPrompt`)

Skeleton. Fill it from the scenario. Keep it stable so it caches.

```
You are {name}, {role} at {company} ({companyFacts}). You're at work and your phone
has just rung: a cold call from someone you don't know. You are a real person on a
real phone call, not an assistant.

How you speak: {speakingStyle}. Phone register: one or two short sentences per turn,
contractions, the odd "right", "look" or "hmm". {locale} spelling and idiom. Never use
lists, markdown, emojis or stage directions. Never mention AI, prompts or role-play.
Never coach the caller or help them sell to you.

Personality: {personality}.

Private facts. Reveal one only when the caller has earned it with a relevant
question, then answer honestly and briefly:
- Pains: {pains}
- Current solution: {currentSolution}
- Decision process: {decisionProcess}
- Timing: {timing}

Objections you raise naturally, in your own words, when they fit: {objections}

Rules:
- You don't owe the caller your time. Without a quick, relevant reason to care, get curt.
- Each turn you receive a private note about your patience and interest. Follow it
  and never mention it.
- Agree to a meeting only if your note says you would, and only for a specific day
  and time the caller proposes. Confirm it out loud, then call agree_to_meeting.
- To end the call, say a brief goodbye first, then call end_call.
```

### 6.3 Judge and hidden state

The **judge** runs once per rep turn. It uses the coach model and returns structured output (`JudgeResult` in `contracts`). It sees:
- the last ~6 turns,
- the product,
- the scenario's hidden facts,
- the current state.

```ts
JudgeResult = {
  stage: 'opener'|'reason'|'discovery'|'pitch'|'objection_handling'|'close'|'other',
  signals: {
    askedPermission, gaveRelevantReason, askedOpenQuestion, followedUp,
    acknowledgedObjection, pitchedFeatures, ignoredHerPoint, pushy, rude,
    askedForMeeting, proposedSpecificTime            // all boolean
  },
  revealEarned: string | null,                        // which hidden fact the question earned
  tip: { severity: 'info'|'warn', text: string } | null   // ≤ 15 words, used in M5
}
```

The **state engine** (`core/stateEngine`) is pure, deterministic and unit-tested. The numbers below are starting defaults to tune.

**Starting state:** from the scenario, `{ interest, patience, painsRevealed: [], turn: 0 }`.

**Rules, applied per rep turn:**

| Signal | Effect |
|---|---|
| Every turn | patience −`patienceDecayPerTurn` |
| `askedPermission` (first 2 turns only) | patience +10 |
| `gaveRelevantReason` | interest +10 |
| `askedOpenQuestion` | interest +6 |
| `followedUp` | interest +6, patience +3 |
| `acknowledgedObjection` | patience +5 |
| `pitchedFeatures` | patience −8 (−12 on hard) |
| `ignoredHerPoint` | patience −8 |
| `pushy` | patience −15 |
| `rude` | patience → 0 |
| Longest monologue this turn > 45 s | patience −10 |
| `revealEarned` | adds that fact to `painsRevealed` |

- **Meeting allowed** only when `interest ≥ meetingAt`, `askedForMeeting` and `proposedSpecificTime` are all true.
- **Hang-up:** when `patience ≤ hangUpAt`, the next note says "You've had enough: say a brief goodbye and call end_call."

`moodFor(state)` sets the avatar's expression:
- `angry` if patience < 25;
- `happy` if interest ≥ 60;
- otherwise `neutral`.

`stateToInstruction(state)` is the per-turn note. It describes, in plain words:
- how much patience she has left (plenty / some / little / none);
- how interested she is;
- which private facts she may now discuss;
- whether she'd accept a specific meeting ask now;
- any forced instruction.

**One-turn lag by design:** the judge runs alongside the prospect's reply, so its update applies to the *next* reply.

### 6.4 Prospect tools (side-channel)

The two tools are `end_call({ reason })` and `agree_to_meeting({ when })`.
- The `llmNode` streams text to the TTS, then acts on any `tool_use` blocks after the stream ends. **No tool results are sent back.** The next turn's messages are rebuilt from `chatCtx` text, so no dangling `tool_use` ever exists.
- **`end_call`:** wait for playout, publish `call.state` with phase `ended` and outcome `hung_up_by_prospect`, then close the session.
- **`agree_to_meeting`:** record outcome `meeting_booked` with `when`. The conversation may continue.

### 6.5 Claude settings and gotchas

- **Load the `claude-api` skill before writing Claude API code**, and follow it (streaming, structured outputs, caching, refusal handling).
- **Model and effort per lane, from env:**

  | Lane | Model | Effort |
  |---|---|---|
  | Prospect | `claude-opus-5` | `low` |
  | Coach / judge | `claude-opus-5` | `low` |
  | Review | `claude-opus-5` | `high` |

  If the prospect's first word is slow, the lever is `PROSPECT_MODEL=claude-haiku-4-5` (faster, 5× cheaper). Decide with measured numbers.
- **Opus 5 rejects `temperature`, `top_p` and `top_k`** (400). Don't send them. Thinking is on by default (adaptive); control it with `output_config.effort`, and don't try to disable it.
- **The state note** goes in as a final mid-conversation `{ role: 'system' }` message. This is supported on Opus 5, keeps the cached prefix valid, and must come after a user message.
  - **Haiku 4.5 supports neither this nor `effort`.** For Haiku, append the note to the last user turn and omit `effort`. The code must handle both paths.
- **Caching:** put the persona in `system` as a text block with `cache_control: { type: 'ephemeral' }`. Check `usage.cache_read_input_tokens` from turn 2 onwards. A short persona may be below the model's minimum cacheable size, which is fine.
- **First message:** the Messages API needs the first message to be from the user. If history starts with the prospect's opening line, prepend a user turn "(Your phone rings and you answer.)".
- **Barge-in:** LiveKit cancels the `llmNode` when the rep interrupts. Abort the Anthropic stream on cancel. LiveKit already truncates the interrupted reply in `chatCtx`.
- **Refusals:** on `stop_reason: 'refusal'`, speak a neutral line ("Sorry, you're breaking up. Say that again?") and log it.

## 7. Avatar (v1: TalkingHead's sample)

**The asset**
- File: `avatars/mpfb.glb` from `github.com/met4citizen/TalkingHead`. Made with MPFB in Blender, **CC0**, female body (`body: 'F'`), about **37 MB**.
- It isn't in the npm package. `scripts/fetch-avatar.mjs` downloads it into `apps/web/public/avatars/` from a pinned commit SHA and verifies a SHA-256 checksum. The file is git-ignored and credited in `CREDITS.md`.
- **Don't use the other sample avatars:** `brunette.glb` is CC BY-NC, and `avatar.glb` and `vroid.glb` are non-commercial.
- Optional: compress with glTF-Transform (meshopt; TalkingHead supports it). Keep it only if the visemes still animate.

**TalkingHead setup**
```
new TalkingHead(el, { ttsEndpoint: null, lipsyncModules: ['en'], cameraView: 'upper' })
showAvatar({ url: '/avatars/mpfb.glb', body: 'F', avatarMood: 'neutral', lipsyncLang: 'en' })
```
Optionally copy the MPFB `modelDynamicBones` from TalkingHead's `siteconfig.js`.

**Audio and lip-sync wiring.** Follow HeadAudio's `openai.html` demo, adapted to LiveKit:
1. Take the agent's subscribed audio track and wrap it: `new MediaStream([track.mediaStreamTrack])`.
2. Attach that stream to a **muted** `<audio>` element. This works around a Chrome bug: Web Audio won't process a remote stream unless a media element touches it.
3. Route the audio through TalkingHead: `head.audioCtx.createMediaStreamSource(stream).connect(head.audioAnalyzerNode)`.
4. Set up HeadAudio:
   - `head.audioCtx.audioWorklet.addModule(workletUrl)`;
   - `const headaudio = new HeadAudio(head.audioCtx)`, then `await headaudio.loadModel(modelUrl)`;
   - `head.audioSpeechGainNode.connect(headaudio)`;
   - `headaudio.onvalue = (k, v) => Object.assign(head.mtAvatar[k], { newvalue: v, needsUpdate: true })`;
   - `head.opt.update = headaudio.update.bind(headaudio)`.
5. HeadAudio lags about 50–100 ms. Optionally insert a `DelayNode` (~0.1 s) between `audioSpeechGainNode` and `audioReverbNode` to line the voice up with the lips.
6. **Don't also render the agent track with `RoomAudioRenderer`**, or you'll hear it twice.
7. Resume `head.audioCtx` on the Dial click (browser autoplay policy).

**Vite notes**
- HeadAudio's `package.json` `main` points to a missing `.js` file. Import `@met4citizen/headaudio/dist/headaudio.min.mjs` explicitly. Get `dist/headworklet.min.mjs` and `dist/model-en-mixed.bin` as URLs with `?url` imports.
- TalkingHead lazy-loads its lip-sync modules relative to its own URL. If that breaks, add it to `optimizeDeps.exclude`.

**Behaviour**
- When HeadAudio's `onstarted` fires after at least 150 ms of silence: `head.lookAtCamera(500)` and `head.speakWithHands()`.
- While you speak: occasional small nods and eye contact.
- `setMood(moodFor(state))`, using the built-in moods `neutral`, `happy` and `angry` (custom "bored" and "sceptical" moods are v2).
- Pause rendering and HeadAudio on `visibilitychange`.

**Phone mode** hides the canvas but keeps the same audio path. Real cold calls have no face.

## 8. Feedback

### 8.1 Live metrics (`core/metrics`, pure, published ~2×/s)

| Metric | Definition | Starting target |
|---|---|---|
| Talk ratio | rep speech seconds ÷ (rep + prospect speech seconds) | 40–60% |
| Pace | rep words ÷ rep speech minutes | 130–170 wpm |
| Core fillers | um, uh, erm, er, ah (Deepgram `fillerWords: true` keeps them) | ≤ 2 a minute |
| Soft fillers | like, you know, basically, sort of, kind of, literally, I mean (reported separately; noisy) | Trend down |
| Questions | rep sentences ending "?". Open if they start with what, how, why, tell me or walk me through; closed otherwise | More open than closed |
| Monologue | continuous rep speech, merging gaps < 1.5 s without prospect speech; the timer shows amber at 30 s and red at 45 s | ≤ 45 s |
| Interruptions | rep barge-ins while the prospect speaks; prospect cut-ins (v2) | Low |
| Time to first question | seconds from connect to the rep's first question | Earlier is better |

- Word timings come from overriding `sttNode` to copy final `SpeechEvent`s aside. `SpeechData.words` is typed; use it if Deepgram fills it, and otherwise fall back to segment start and end times.
- Speaking intervals come from the user and agent state events.

### 8.2 Coach tips and stages (M5)

- **Tips** come from the judge's `tip`, in coached mode only. At most one every 20 s, severity `warn` or higher. They fade after 8 s.
- **Stage tracker:** Opener → Reason → Discovery → Objections → Next step, driven by `judge.stage`.

### 8.3 Controls (M5, RPC)

- **Pause / resume:** the agent ignores turns and interrupts speech; the web mutes the mic.
- **Get help** (was **Hint**): the exact words to say now, why they fit this point of the call, and what to say if she pushes back, from a structured-output call that should take no more than ~2 s.
- **Rewind:**
  1. Truncate the prospect's context to before the rep's last turn. Truncate only, never edit earlier turns.
  2. Restore that turn's state snapshot.
  3. Re-speak her previous line with `session.say(line, { addToChatCtx: false })`.
- **Hang up.**

### 8.4 Post-call review (M4)

The review model gets:
- the rubric;
- the scenario and product;
- the computed metrics, as facts it must not recount;
- the numbered transcript.

It returns `ReviewResult`:

```ts
{ outcome, overallScore /*0-100*/, summary,
  stages: [{ key: 'opener'|'reason'|'discovery'|'objections'|'next_step'|'delivery',
             score /*1-5*/, evidence: [{ turn, quote }], feedback }],
  topMoments: [{ turn, youSaid, tryInstead, why }],          // max 3
  objections: [{ turn, objection, yourResponse, score, better }],
  strengths: string[],                                        // max 3
  drill: { title, instructions } }
```

**Quote validation** (`core/validateQuotes`): every `quote` and `youSaid` must appear in the transcript, after normalising whitespace, case and punctuation. Drop or flag any that don't. Unit-test this.

### 8.5 Rubric v1 (`scenarios/rubrics/cold-call-v1.json`)

Each criterion is scored 1–5, with anchors for 1, 3 and 5:

| Criterion | What a good score looks like |
|---|---|
| Opener | States who you are fast and asks permission; no "sorry to bother you" |
| Reason for call | A problem she'd recognise for her role; not a company or feature blurb |
| Discovery | Open questions, follow-ups on her answers, uncovers the private facts |
| Objections | Acknowledge → ask → answer → check; no arguing |
| Next step | Asks for a specific day and time and confirms it |
| Delivery | Pace, fillers, monologues and talk ratio against the targets in §8.1 |

## 9. Contracts (`packages/contracts`: every payload has a zod schema, validated at both ends)

### Text-stream topics (agent → web)

The agent sends each payload with `room.localParticipant.sendText(JSON.stringify(payload), { topic })`. The web receives it with `room.registerTextStreamHandler` or `useTextStream`.

| Topic | Payload |
|---|---|
| `call.state` | `{ phase: 'ringing'\|'connected'\|'ended', outcome?: 'meeting_booked'\|'hung_up_by_prospect'\|'ended_by_rep'\|'timeout'\|'error', reason? }` |
| `prospect.state` | `{ turn, mood, interest, patience }` |
| `coach.metrics` | `{ elapsedSec, talkRatio, repWpm, coreFillers, softFillers, fillersPerMin, questionsOpen, questionsClosed, currentMonologueSec, longestMonologueSec }` |
| `coach.tip` | `{ id, turn, severity, text }` |
| `coach.stage` | `{ stage, status: 'active'\|'done' }` |
| `debug.latency` | `{ turn, endOfTurnMs, llmTtftMs, ttsTtfbMs, e2eMs }`, taken from `ChatMessage.metrics` (`endOfTurnDelay`, `llmNodeTtft`, `ttsNodeTtfb`, `e2eLatency`) |

Transcripts use LiveKit's built-in `lk.transcription` topic (read with `useTranscriptions`).

### RPC (web → agent)

The web calls `localParticipant.performRpc({ destinationIdentity: <agent identity>, method, payload })`. The agent handles it with `room.localParticipant.registerRpcMethod`.

| Method | Returns |
|---|---|
| `call.pause`, `call.resume` | `{ ok }` |
| `call.hint` | `{ say, why, ifPushback? }` |
| `call.rewind` | `{ ok, reason? }` |
| `call.hangup` | `{ ok }` |

### HTTP

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check, including the database |
| `GET /api/scenarios` | List scenarios |
| `POST /api/calls` | Body `{ scenarioId, mode: 'coached'\|'exam' }`; returns `{ callId, url, token }` |
| `GET /api/calls` | History |
| `GET /api/calls/:id` | The call, its turns and its review |
| `POST /api/calls/:id/review/rerun` | Re-run the review |
| `POST /internal/calls/:id/log` | Agent only, header `x-internal-secret`; idempotent upsert |
| `GET /internal/scenarios/:id` | Agent loads the scenario and product |

### Environment variables

```
DATABASE_URL=postgres://coach:coach@localhost:5432/coach
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
ANTHROPIC_API_KEY=
DEEPGRAM_API_KEY=
CARTESIA_API_KEY=
CARTESIA_VOICE_ID=              # M1 only; M3 moves voices into scenario files
API_BASE_URL=http://localhost:3000
INTERNAL_API_SECRET=
PROSPECT_MODEL=claude-opus-5
PROSPECT_EFFORT=low
COACH_MODEL=claude-opus-5
COACH_EFFORT=low
REVIEW_MODEL=claude-opus-5
REVIEW_EFFORT=high
APP_PASSWORD=                   # M6, only when deployed
```

## 10. Data model (Drizzle, hand-written migrations)

| Table | Columns | Notes |
|---|---|---|
| `users` | `id`, `email`, `created_at` | One seeded row. `user_id` goes on `calls` from day one, as cheap insurance for a product later |
| `scenarios` | `id`, `version`, `title`, `difficulty`, `spec` jsonb, `updated_at` | PK `(id, version)`; seeded from `scenarios/*.json` on boot |
| `calls` | `id` uuid, `user_id`, `scenario_id`, `scenario_version`, `mode`, `status`, `outcome`, `started_at`, `connected_at`, `ended_at`, `duration_ms`, `cost_usd`, `latency` jsonb, `recording_path` | |
| `turns` | `call_id`, `idx`, `speaker` (`'rep'` or `'prospect'`), `text`, `start_ms`, `end_ms`, `words` jsonb, `interrupted`, `state_after` jsonb | PK `(call_id, idx)` |
| `events` | `id`, `call_id`, `t_ms`, `kind`, `payload` jsonb | |
| `reviews` | `call_id`, `status`, `rubric_id`, `rubric_version`, `model`, `result` jsonb, `error`, `cost_usd`, `created_at`, `updated_at` | PK `call_id` |

## 11. Milestones (each one is a prompt in `PROMPTS.md`)

| M | Name | You get | Effort |
|---|---|---|---|
| M0 | Skeleton | Repo, tooling, CI, DB; all three apps boot | ½ day |
| M1 | Voice loop | Dial, ring, talk to a prospect; transcript and latency panel | 1–2 days |
| M2 | Avatar | TalkingHead sample avatar, lip-sync, idle behaviour, moods, phone mode | 1–2 days |
| M3 | Scenarios & realism | 3 scenarios, judge and hidden state, hang-up and meeting, simulation harness | 2–3 days |
| M4 | Review | Call log, metrics, scorecard with validated quotes, history | 2–3 days |
| M5 | Live coach | Live panel, tips, stage tracker, pause, hint and rewind, exam mode | 2 days |
| M6 | Hardening | Latency and cost report, resilience, auth, optional Render deploy | 1–2 days |

Total: about 2–3 weeks of focused work.

## 12. Testing

- **`core`:** unit tests for metrics, the state engine, the prompt builders, quote validation and the `chatCtx` → Anthropic message builder.
- **`contracts`:** every scenario, product and rubric file validates.
- **`api`:** route tests against a real Postgres (CI service), covering call creation, the idempotent internal log upsert and review persistence. Don't mock Drizzle.
- **`agent`:** unit tests for tool-call parsing and the Haiku/Opus message paths. `scripts/simulate-call.ts` is a text-only persona regression run by hand, because it spends tokens.
- **Manual (you, with a headset):** each milestone's "Done when" items marked _(I'll test)_. Cloud sessions can build and unit-test, but they can't hear you.

## 13. Targets

- **Latency:** from the rep finishing speaking to the prospect's first audio, p50 ≤ 1.5 s and p90 ≤ 2.5 s.
  - Judge result: ≤ 3 s.
  - Review ready: ≤ 30 s after hang-up.
- **Cost:** about $0.60–1.30 per 10-minute call with Opus 5 on every lane, or about $0.40–0.80 with the live lanes on Haiku 4.5. LiveKit is free on the Build plan.

## 14. Deferred to v2+

- Your own characters: MPFB in Blender for a 3D-render look, or VRoid for cartoon. Male prospects need a male avatar.
- Custom "bored" and "sceptical" moods via TalkingHead's `animMoods`.
- The prospect cutting in when you ramble: `userTurnLimit` and `onUserTurnExceeded` exist in the Node SDK.
- A scenario generator from `product.json`, objection drills, a "power hour" of back-to-back calls, and progress charts.
- Dial-in from a real phone (LiveKit SIP).
- Kokoro as a free TTS option.
- Multi-user, teams and billing.

## 15. Rules for coding agents (copy into `CLAUDE.md`)

**Scope and tooling**
- Read `docs/PLAN.md` before starting, and stay inside the current milestone's scope.
- pnpm only; Node 22; TypeScript strict; ESM.

**Code structure**
- `packages/core` is pure: all maths, state rules, prompt builders and validators live there, with unit tests.
- Every wire payload (topics, RPC, HTTP) has a zod schema in `packages/contracts`, validated on both ends.
- Provider keys live only in the API and agent environment. The web app never sees them.

**Claude**
- Load the `claude-api` skill before writing Claude API code.
- Model and effort come from env, per lane.
- Never send sampling parameters to Opus 5.

**Pipeline rules**
- Nothing may be awaited on the prospect's reply path except the prospect's own Claude stream. The coach never blocks the prospect.
- Code counts, Claude judges: metrics are computed in code, and review quotes are validated.

**Assets**
- Don't commit `mpfb.glb`, and don't use the non-CC0 sample avatars.

**Workflow**
- Work on a branch per milestone from `main`, e.g. `m1-voice-loop`.
- Run lint, typecheck, test and build before pushing, then open a PR.
- In the PR, list assumptions and anything unverified, especially anything that needs a microphone.
