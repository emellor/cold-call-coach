// Pure logic only: metrics, the state engine, prompt builders and validators.
// No I/O, no Node built-ins, no React; the only workspace import allowed is
// @ccc/contracts. eslint.config.js enforces this.
export * from './claude/models.ts';
export * from './claude/pricing.ts';
export * from './claude/structuredOutput.ts';
export * from './claude/workspace.ts';
export * from './cheatSheet/prompt.ts';
export * from './coach/hint.ts';
export * from './coach/liveMetrics.ts';
export * from './coach/stages.ts';
export * from './coach/talkClock.ts';
export * from './coach/tipGate.ts';
export * from './cost/cost.ts';
export * from './demos/script.ts';
export * from './demos/plan.ts';
export * from './judge/prompt.ts';
export * from './livekit/credentials.ts';
export * from './metrics/metrics.ts';
export * from './prospect/facts.ts';
export * from './prospect/messages.ts';
export * from './prospect/note.ts';
export * from './prospect/stateEngine.ts';
export * from './prospect/systemPrompt.ts';
export * from './prospect/writer.ts';
export * from './rep/messages.ts';
export * from './rep/notes.ts';
export * from './rep/playbook.ts';
export * from './rep/systemPrompt.ts';
export * from './report/latency.ts';
export * from './review/controls.ts';
export * from './review/prompt.ts';
export * from './review/reactions.ts';
export * from './review/validateQuotes.ts';
