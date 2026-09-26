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
