# Cold Call Coach: implementation prompts

Seven prompts, one per milestone in `docs/PLAN.md` §11. Run them in order, one Claude Code session each.

## Before you start (once)

1. **Accounts and keys**
   - An Anthropic API key.
   - A Deepgram API key.
   - A Cartesia API key. In Cartesia's voice library, pick three **British female** voices (the sample avatar is a woman) and note their ids.
   - A LiveKit Cloud project on the free Build plan. Note its URL, API key and secret.
2. **Repo:** create an empty GitHub repo (e.g. `cold-call-coach`) and add this folder's two files as `docs/PLAN.md` and `docs/PROMPTS.md`.
3. **Keys for cloud sessions:** open the cloud environment menu in the session's title bar, choose **Edit**, and add them as environment variables using the names in PLAN.md §9. A new session picks them up. Never paste keys into a chat.
4. **Keys for local runs:** copy `.env.example` to `.env` once M0 exists.
5. **A headset.** It avoids echo, and it's what you'd wear on real calls anyway.

## How to run each prompt

1. Start a new session on the repo and paste the prompt.
2. The session works on its own branch and opens a PR.
3. Do the checks marked _(I'll test)_ yourself, locally with the headset. Cloud sessions can build and run tests, but they can't hear you.
4. Merge, then start the next prompt.

If a session stops early, say "continue M&lt;n&gt;" in the same session. If a check fails, paste the error or describe what you heard.

---

## Prompt 0: Skeleton (M0)

```text
You're setting up the repo for Cold Call Coach, a personal web app for practising B2B cold calls against an AI prospect with a talking 3D avatar and live and post-call coaching. Read docs/PLAN.md fully before starting. This session is milestone M0 only: the skeleton, no product features.

Build:
1. A pnpm workspace (pnpm 10, Node 22, TypeScript strict, ESM) with these packages:
   - apps/web: Vite 6 + React 18 + TypeScript + Tailwind CSS 4 (@tailwindcss/vite) + wouter. One placeholder page.
   - apps/api: Fastify 5 + Drizzle ORM + pg + zod.
     - GET /api/health checks the database.
     - Hand-written SQL migrations with a small runner (pnpm db:migrate).
     - In production it serves the built SPA.
   - apps/agent: a LiveKit Agents for Node worker (@livekit/agents 1.9.x).
     - Mirror the structure and scripts of livekit-examples/agent-starter-node (dev, build, start, download-files).
     - For now it registers with agentName "prospect" and logs when a job arrives.
     - If LiveKit env vars are missing, it prints a clear message and exits cleanly rather than crashing `pnpm dev`.
   - packages/contracts: zod schemas and TS types for wire payloads (empty index for now).
   - packages/core: pure logic, no I/O (empty index for now).
   - scenarios/: a README describing the files that will live there (PLAN.md §6.1).
2. docker-compose.yml with Postgres 16 (db, user and password all "coach", port 5432).
3. .env.example with every variable in PLAN.md §9, each with a comment. Git-ignore .env. Each app loads its env through a small zod-validated config module that fails fast with a clear message.
4. Tooling:
   - ESLint flat config (typescript-eslint), Prettier.
   - Vitest with two projects: node, for everything except .tsx; jsdom, for .tsx.
   - Scripts: pnpm dev (api + web + agent in parallel), pnpm build, pnpm test, pnpm lint, pnpm typecheck.
5. ESLint import boundaries:
   - packages/core must not import Node built-ins, React, or any workspace package except contracts.
   - apps/web must not import packages/core.
6. GitHub Actions CI on pull requests and pushes to main: install, lint, typecheck, migrate against a Postgres 16 service, test, build.
7. CLAUDE.md at the root containing:
   - the "Rules for coding agents" from PLAN.md §15;
   - the commands you created;
   - one line: "Before starting any milestone, read docs/PLAN.md and the matching prompt in docs/PROMPTS.md."
8. README.md: what this is, prerequisites (Node 22, pnpm, Docker, a LiveKit Cloud project, API keys), how to run.

Done when:
- `pnpm install && docker compose up -d && pnpm db:migrate && pnpm dev` starts everything. The web page loads, and /api/health returns ok including the database check.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally and in CI.

Deliver: branch m0-skeleton and one PR. In the PR, summarise the work and list any assumptions you made.
```

---

## Prompt 1: Voice loop (M1)

```text
Milestone M1 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md (§2, §5, §6.2, §6.5, §9) first. Load the claude-api skill before writing any Claude API code.

Goal: I press Dial, hear it ring, and hold a spoken conversation with one prospect. I see the live transcript and per-turn latency.

Build:

1. API: POST /api/calls { scenarioId, mode }.
   - Create a `calls` row with status "ringing" (add the table and its migration per PLAN.md §10). For M1, accept a fixed scenarioId.
   - Mint a LiveKit token with livekit-server-sdk: identity "rep", room "call-<callId>", publish/subscribe/data grants, a 15-minute TTL.
   - Set token.roomConfig to a RoomConfiguration holding a RoomAgentDispatch: agentName "prospect", metadata JSON { callId, scenarioId, mode }.
   - Return { callId, url, token }.

2. Agent (apps/agent): explicit dispatch as "prospect". Load Silero VAD in prewarm. In entry, parse the dispatch metadata, then start a voice.AgentSession with:
   - STT: deepgram.STT({ model: 'nova-3', language: 'en-GB', fillerWords: true, interimResults: true, punctuate: true, smartFormat: true, keyterm: [...] }), with a hard-coded keyterm list for now.
   - TTS: cartesia.TTS({ model: 'sonic-3', voice: env CARTESIA_VOICE_ID }).
   - vad: the Silero instance.
   - turnDetection: new livekit.turnDetector.MultilingualModel(). Wire in the download-files step for its model.
   - LLM: do NOT use @livekit/agents-plugin-anthropic. Subclass voice.Agent and override llmNode(chatCtx, toolCtx, modelSettings) to call @anthropic-ai/sdk directly with streaming. Return a ReadableStream<string> of text deltas.
     - model = env PROSPECT_MODEL (default claude-opus-5); output_config.effort = env PROSPECT_EFFORT (default low).
     - Never send temperature, top_p or top_k: Opus 5 rejects them.
     - system: the persona from PLAN.md §6.2, filled with the medium scenario's values from §6.1 (Claire Hughes). Send it as a text block with cache_control { type: 'ephemeral' }.
     - messages: rebuild from chatCtx every turn, user and assistant text only (LiveKit already truncates interrupted replies). If the first message is the prospect's, prepend a user turn "(Your phone rings and you answer.)".
     - max_tokens around 300.
     - When LiveKit cancels the node (I barged in), abort the Anthropic stream.
     - On stop_reason 'refusal', emit "Sorry, you're breaking up. Say that again?" and log it.
     - Log usage, including cache_read_input_tokens.
   - Put the chatCtx → Anthropic messages conversion in a pure function in packages/core, with unit tests (alternation, first-turn placeholder, truncated replies).

3. Ringing: the agent publishes call.state { phase: 'ringing' } via sendText on that topic, waits a random 2–5 s, publishes { phase: 'connected' }, then calls session.say(openingLine). No LLM for the pick-up.

4. Latency: for each assistant message added (conversation_item_added), read ChatMessage.metrics (endOfTurnDelay, llmNodeTtft, ttsNodeTtfb, e2eLatency) and publish it on debug.latency.

5. Contracts: zod schemas and topic-name constants for call.state and debug.latency, used by both the agent and the web.

6. Web: a Call page with Dial and Hang up, the connection state, the live transcript (useTranscriptions), and a latency panel showing the last turn and a running p50.
   - While call.state is 'ringing', play a Web Audio synthesised UK ring tone: 400 + 450 Hz, 0.4 s on, 0.2 s off, 0.4 s on, 2.0 s off.
   - Resume audio on the Dial click.
   - For now, play the agent's audio with RoomAudioRenderer. M2 replaces this.

Done when:
- (I'll test) I dial, hear the ring, and she answers. We talk for 3+ minutes, I can interrupt her mid-sentence, the transcript shows both sides, and the panel shows per-turn latency (target p50 e2e ≤ 1.5 s).
- Unit tests pass and CI is green.

Deliver: branch m1-voice-loop and a PR with:
- how to run it locally;
- any latencies you could measure;
- anything you couldn't verify without a microphone.
```

---

## Prompt 2: The avatar (M2)

```text
Milestone M2 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md §7 first.

Goal: the prospect appears as TalkingHead's sample 3D avatar, lip-synced to the voice I hear, with natural idle behaviour and a mood API. This replaces M1's plain audio playback.

Build:

1. scripts/fetch-avatar.mjs and a `pnpm avatar:fetch` script:
   - Download avatars/mpfb.glb from github.com/met4citizen/TalkingHead, pinned to a specific commit SHA, into apps/web/public/avatars/mpfb.glb.
   - Verify a SHA-256 checksum that you record in the script, and skip the download if the file is already present.
   - Run it from postinstall or document it in the README.
   - Git-ignore the file (it's about 37 MB).
   - Add CREDITS.md: "mpfb.glb from met4citizen/TalkingHead, made with MPFB, CC0".
   - Do NOT use the other sample avatars; their licences are non-commercial.
   - Optional: a --compress flag using glTF-Transform meshopt. Keep it only if the visemes still animate after compression.

2. Install @met4citizen/talkinghead 1.7.x (it brings three ^0.180) and @met4citizen/headaudio 0.1.x.
   - HeadAudio's package.json "main" points to a missing .js file. Import '@met4citizen/headaudio/dist/headaudio.min.mjs' explicitly, and get URLs for dist/headworklet.min.mjs and dist/model-en-mixed.bin with Vite `?url` imports.
   - If TalkingHead's lazy-loaded lip-sync modules fail under Vite, add the package to optimizeDeps.exclude.

3. An AvatarController class (plain TS, no React) wrapping TalkingHead, plus a <ProspectAvatar> React component that uses it:
   - new TalkingHead(el, { ttsEndpoint: null, lipsyncModules: ['en'], cameraView: 'upper' }).
   - showAvatar({ url: '/avatars/mpfb.glb', body: 'F', avatarMood: 'neutral', lipsyncLang: 'en' }) with a loading progress bar. Copy the MPFB modelDynamicBones from TalkingHead's siteconfig.js if it helps.
   - Lip-sync: follow HeadAudio's openai.html demo, adapted to LiveKit. When the agent's audio track is subscribed:
     a. stream = new MediaStream([track.mediaStreamTrack]).
     b. Attach the stream to a MUTED <audio> element. This is a Chrome workaround: Web Audio won't process a remote stream unless a media element touches it.
     c. head.audioCtx.createMediaStreamSource(stream).connect(head.audioAnalyzerNode).
     d. Register the worklet on head.audioCtx, create new HeadAudio(head.audioCtx), and await loadModel(modelUrl).
     e. head.audioSpeechGainNode.connect(headaudio).
     f. headaudio.onvalue = (k, v) => Object.assign(head.mtAvatar[k], { newvalue: v, needsUpdate: true }).
     g. head.opt.update = headaudio.update.bind(headaudio).
     h. Behind a setting, add an optional ~0.1 s DelayNode between audioSpeechGainNode and audioReverbNode to line the voice up with the lips.
   - Remove RoomAudioRenderer for the agent's track, so the audio isn't played twice.
   - Behaviour:
     - When headaudio.onstarted fires after ≥150 ms of silence: head.lookAtCamera(500) and head.speakWithHands().
     - While I'm speaking (agent state 'listening' and my mic active): occasional small nods and eye contact.
     - Stop and start rendering and HeadAudio on visibilitychange.
   - Expose setMood(mood) on the controller, and add a dev-only mood picker (neutral, happy, angry, sad) to test it.
   - Resume head.audioCtx on the Dial click.

4. Call screen layout: the avatar large on the left in a video-call frame; transcript and latency panel on the right; controls along the bottom.
   - A Phone mode toggle hides the avatar but keeps the same audio path, so there's only one code path.

5. When call.state becomes 'ended', play a short click and show "Call ended".

Done when:
- (I'll test) The avatar appears within a few seconds after the first load.
- (I'll test) Her lips move in time with the voice, with no double audio.
- (I'll test) She blinks, breathes and looks at me when idle.
- (I'll test) The mood picker visibly changes her expression.
- (I'll test) Phone mode works, and my laptop's CPU usage stays reasonable.
- CI is green.

Deliver: branch m2-avatar and a PR with a screenshot, plus any sync offset you noticed and how you tuned it.
```

---

## Prompt 3: Scenarios, judge and hidden state (M3)

```text
Milestone M3 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md §6 and §9 first. Load the claude-api skill before writing Claude API code.

Goal: realistic, data-driven prospects. They resist, raise objections, get annoyed and hang up, or agree to a meeting when it's earned.

Build:

1. Contracts: zod schemas ScenarioSpec, ProductSpec, ProspectState and JudgeResult (PLAN.md §6.1 and §6.3), plus the prospect.state and coach.stage topic payloads.

2. scenarios/:
   - product.json: keep the example; I'll edit it.
   - easy-ops-manager.json, medium-finance-director.json and hard-facilities-manager.json:
     - all women, to match the avatar;
     - each with its own Cartesia voiceId, left as a clearly marked placeholder;
     - each with an opening line, private facts that connect to the product's value, objections, and state thresholds. Hard should have low patience and fast decay; easy should be curious.
   - rubrics/cold-call-v1.json (PLAN.md §8.5).
   - A test that validates every file against its schema.
   - On boot, the API upserts scenarios into the `scenarios` table by (id, version).
   - GET /api/scenarios, and GET /internal/scenarios/:id for the agent.
   - The web shows a scenario picker before Dial; POST /api/calls takes the chosen scenarioId.

3. packages/core, all pure and unit-tested:
   - buildProspectSystemPrompt(scenario), following §6.2. No product details: she doesn't know what I sell.
   - stateEngine: initialState, applyJudgement(state, judge, turnMetrics), stateToInstruction, moodFor, using the rules in §6.3.
   - Tests must include:
     - a run of bad judgements drives patience down to the hang-up threshold;
     - a meeting needs interest ≥ meetingAt AND askedForMeeting AND proposedSpecificTime;
     - 'rude' ends the call.

4. Agent:
   - Load the scenario and product from the API. Take the voice, keyterms and locale from them.
   - Prospect llmNode:
     - Append stateToInstruction(state) as a final { role: 'system' } message (mid-conversation system message, supported on claude-opus-5).
     - If PROSPECT_MODEL is claude-haiku-4-5, which supports neither this nor effort, append the note to the last user turn instead and omit effort. Unit-test both paths.
   - Tools end_call({ reason }) and agree_to_meeting({ when }), as side-channel tools (§6.4). Stream the text, then act on the tool_use blocks after the stream, and send no tool results back.
     - end_call: wait for playout, publish call.state ended with outcome hung_up_by_prospect, then close the session.
     - agree_to_meeting: record the outcome and keep talking.
   - Judge: on each final rep turn, make a separate Claude call.
     - COACH_MODEL / COACH_EFFORT, structured output via messages.parse with the zod JudgeResult.
     - Inputs: the last ~6 turns, the product, the scenario's private facts, and the current state.
     - It runs in parallel and never blocks or delays the prospect's reply. Its result updates the state used on the NEXT turn.
     - When patience reaches the threshold, the next note tells her to say goodbye and call end_call.
   - Publish prospect.state after every update. The web maps mood to AvatarController.setMood (neutral, happy, angry).

5. scripts/simulate-call.ts, a text-only regression run by hand:
   - Claude plays a scripted "terrible rep" (rambling feature pitch, pushy, no questions) and a "good rep" (permission, relevant reason, open questions, specific meeting ask).
   - Each plays against the real prospect prompt, judge and state engine for up to 20 turns.
   - Print each run's outcome and state trace.
   - Pass criteria: the terrible rep books 0 meetings in 5 runs; the good rep books at least 3 in 5.

Done when:
- (I'll test) The three scenarios are selectable and feel different.
- (I'll test) The hard prospect hangs up on a rambling pitch.
- (I'll test) The easy prospect agrees to a meeting when I ask properly.
- (I'll test) Her expression follows her mood.
- simulate-call meets its pass criteria.
- Unit tests pass and CI is green.

Deliver: branch m3-scenarios and a PR with the simulate-call summary.
```

---

## Prompt 4: Call log, metrics and post-call review (M4)

```text
Milestone M4 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md §8, §9 and §10 first. Load the claude-api skill before writing Claude API code.

Goal: after every call, a scorecard with evidence-quoted corrections within about 30 s, plus a call history.

Build:

1. DB: the turns, events and reviews tables, plus the remaining calls columns, as in PLAN.md §10, with migrations.

2. Agent call log:
   - Record every final turn: speaker, text, start and end ms relative to connect, the interrupted flag, and state_after.
   - For word timings, override sttNode to copy final SpeechEvents aside and keep alternatives[0].words when Deepgram fills them. Fall back to segment times otherwise.
   - Also record events (outcome, tool calls, state changes), latency metrics, and Anthropic usage per lane.
   - On session close, for ANY reason, POST the log to /internal/calls/:id/log with the x-internal-secret header.
   - The API upserts idempotently: posting twice gives the same result.

3. packages/core/metrics.ts, pure and unit-tested, with the definitions in §8.1:
   - talk ratio, rep WPM, core and soft fillers, fillers per minute;
   - open and closed questions;
   - longest monologue, interruptions, time to first question.

4. Review job in the API (an in-process queue is fine), triggered when the log arrives:
   - Call Claude with REVIEW_MODEL (default claude-opus-5) and REVIEW_EFFORT (default high), with structured output via messages.parse and the zod ReviewResult (§8.4).
   - Input: the rubric, the scenario, the product, the computed metrics (stated as facts it must not recount), and the numbered transcript.
   - Then run core/validateQuotes: every evidence quote and youSaid must appear in the transcript after normalising whitespace, case and punctuation. Drop and log any that don't. Unit-test it.
   - Store the result, model, rubric version and cost.
   - Add POST /api/calls/:id/review/rerun.

5. Web:
   - After hang-up, go to /calls/:id and show "Reviewing…" until the review is ready.
   - Review page:
     - outcome, overall score, and a score per stage with quotes;
     - delivery stats against the §8.1 targets;
     - the top 3 moments as "you said → try instead → why";
     - an objection log and one drill;
     - the full transcript, with annotated turns (clicking a moment scrolls to it).
   - /calls lists history: date, scenario, outcome, score, duration.

6. Optional, if time allows:
   - Record the call client-side, using MediaRecorder on a Web Audio mix of mic and prospect audio, and upload it on hang-up.
   - The review page's audio player seeks to a turn's timestamp.

Done when:
- (I'll test) Hanging up shows the scorecard within about 30 s, and every criticism quotes my actual words.
- Metrics and quote-validator unit tests pass.
- A route test against real Postgres proves the internal log upsert is idempotent.
- CI is green.

Deliver: branch m4-review and a PR with a sample ReviewResult from a real call (or from simulate-call if you can't run one).
```

---

## Prompt 5: Live coach and controls (M5)

```text
Milestone M5 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md §8.1–8.3 and §9 first.

Goal: live coaching during the call that never slows the prospect, plus pause, hint and rewind.

Build:

1. Live metrics: the agent publishes coach.metrics about twice a second. Reuse core/metrics incrementally; the current monologue timer comes from the user speaking state.

2. Tips and stages:
   - Publish coach.stage from the judge's stage.
   - Publish coach.tip from the judge's tip, with these rules:
     - Coached mode only.
     - At most one every 20 s, and only severity warn or higher.
     - Never while the prospect is talking over me.

3. RPC methods, registered by the agent with room.localParticipant.registerRpcMethod and called from the web with performRpc:
   - call.pause / call.resume: the agent ignores turns and interrupts any speech. The web mutes the mic and dims the call.
   - call.hint: returns { suggestions: [3 short lines] } from a quick structured-output Claude call (target ≤ 2 s).
   - call.rewind:
     a. Truncate the prospect's conversation back to before my last turn. Truncate only, never edit earlier turns.
     b. Restore that turn's state snapshot.
     c. Re-speak her previous line with session.say(line, { addToChatCtx: false }).
   - call.hangup.
   - Log every pause, hint and rewind as an event, so the review can mention them.

4. Web live panel:
   - Talk-ratio bar, monologue timer (amber at 30 s, red at 45 s), WPM, filler counters, question counts.
   - Stage tracker: Opener → Reason → Discovery → Objections → Next step.
   - Tip cards that fade after 8 s.
   - Buttons with keyboard shortcuts: Pause/Resume (Space), Hint (H), Rewind (R), Hang up (Esc).
   - Mode choice before Dial: Coached, or Exam (no live panel and no tips; review only).

Done when:
- (I'll test) Tips arrive ≤ 3 s after my turn, and the prospect's p50 latency is no worse than in M3.
- (I'll test) Pause freezes the call; Hint gives 3 usable lines; Rewind lets me retake my last turn with her repeating her line.
- (I'll test) Exam mode shows nothing live.
- CI is green.

Deliver: branch m5-live-coach and a PR.
```

---

## Prompt 6: Hardening, cost and latency (M6)

```text
Milestone M6 of Cold Call Coach. Read CLAUDE.md and docs/PLAN.md §13 first.

Goal: make v1 dependable for daily practice.

Build:

1. Latency:
   - Confirm Claude's stream reaches TTS sentence by sentence.
   - Confirm cache hits (cache_read_input_tokens > 0 from turn 2).
   - Report p50 and p90 for each stage (end of turn, LLM TTFT, TTS TTFB, e2e) over the calls you can run or simulate.
   - If p50 e2e is over 1.5 s, measure PROSPECT_EFFORT and the PROSPECT_MODEL=claude-haiku-4-5 switch, and report the numbers. Don't change the defaults without asking me.

2. Cost:
   - Compute a per-call cost: Anthropic tokens per lane, including cache reads and writes, using a price table in config; Deepgram minutes; Cartesia characters.
   - Show it on the review page and in the history.
   - Warn when a call goes over $2.

3. Resilience:
   - The web handles reconnects.
   - The agent always posts its log: on errors, on timeouts, and at a 15-minute maximum call length.
   - Show clear UI errors when a provider key is missing or a provider fails mid-call.

4. Auth, only for non-local deploys:
   - A single password from APP_PASSWORD, exchanged for a signed http-only cookie.
   - All /api routes protected, and LiveKit tokens issued only to the signed-in user.

5. Optional: a render.yaml for Render with:
   - a web service (API + SPA);
   - a background worker (the agent);
   - Postgres.
   LiveKit Cloud stays as it is.

6. README additions: setup, keys, running, cost per call, and troubleshooting:
   - echo: use a headset;
   - avatar missing: run pnpm avatar:fetch;
   - no audio: click the page / check the autoplay policy;
   - slow replies: see the latency panel.

Done when:
- (I'll test) Three back-to-back calls work without restarting anything.
- Cost appears per call, and the latency report is in the PR.
- CI is green.

Deliver: branch m6-hardening and a PR.
```
