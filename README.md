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
cp .env.example .env        # then fill in the keys and CARTESIA_VOICE_ID
pnpm --filter @ccc/agent download-files   # once: the turn detector's model
docker compose up -d        # Postgres on :5432
pnpm db:migrate
pnpm dev                    # API on :3000, web on http://localhost:5173, agent worker
```

Open http://localhost:5173, put your headset on and press **Dial**. It rings for a few
seconds, Claire Hughes picks up, and you talk. The transcript shows both sides, and the
latency panel shows each reply's end-of-turn, LLM, TTS and end-to-end times with a
running p50. The header shows whether the API and database are healthy
(`GET /api/health` returns the same).

Without the LiveKit variables the agent prints what is missing and exits, and the API
and web keep running. With LiveKit but without a provider key, a call ends straight
away and names the missing key.

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
