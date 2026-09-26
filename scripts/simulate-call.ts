// Text-only persona regression for the prospect (PROMPTS.md M3): Claude plays a
// terrible rep and a good rep against the real prospect prompt, judge and state
// engine, and each run's outcome and state trace is printed. It spends real
// tokens, so it is run by hand, never in CI.
//
//   pnpm simulate                          # medium scenario, 5 runs per rep
//   pnpm simulate --scenario all --transcript
//   pnpm simulate --persona good --runs 3 --turns 12
//   pnpm simulate --persona good --runs 1 --review   # plus the post-call review
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ScenarioCatalog, type ScenarioSpec } from '@ccc/contracts';
import { createClaude } from '../apps/agent/src/claude/client.ts';
import { loadDotEnv } from '../apps/agent/src/config.ts';
import { readPriceTable } from '../apps/api/src/prices.ts';
import { type SimModels, type SimResult, type SimTurn, simulateCall } from './simulate/harness.ts';
import { PERSONAS, type PersonaId } from './simulate/personas.ts';
import { reviewSimulatedCall } from './simulate/review.ts';

const USAGE = `Usage: pnpm simulate [options]

  --scenario <id|all>          Scenario to call (default medium-finance-director)
  --persona <terrible|good|both>  Which rep plays (default both)
  --runs <n>                   Runs per rep and scenario (default 5)
  --turns <n>                  Rep turns before giving up (default 20)
  --concurrency <n>            Runs in flight at once (default 5)
  --transcript                 Print every line of every call
  --review                     Run the post-call review on each call and print the result
                               (REVIEW_MODEL / REVIEW_EFFORT; a high-effort call each)

Reads ANTHROPIC_API_KEY, PROSPECT_MODEL/EFFORT and COACH_MODEL/EFFORT from .env;
SIM_REP_MODEL picks the model that plays the rep (default claude-opus-5).
Pass criteria: the terrible rep books no meetings; the good rep books at least 3 in 5.`;

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const effortFrom = (name: string, fallback: Effort): Effort => {
  const value = process.env[name] || fallback;
  if (!(EFFORTS as readonly string[]).includes(value))
    fail(`${name} must be one of ${EFFORTS.join(', ')}`);
  return value as Effort;
};

const positive = (name: string, value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a whole number above 0`);
  return n;
};

/** The scenarios/ files, validated as the API validates them at boot. */
function loadCatalog(): ScenarioCatalog {
  const dir = fileURLToPath(new URL('../scenarios/', import.meta.url));
  const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  const json = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json'));
  return ScenarioCatalog.parse({
    product: read(join(dir, 'product.json')),
    rubrics: json(join(dir, 'rubrics')).map((f) => read(join(dir, 'rubrics', f))),
    scenarios: json(dir)
      .filter((f) => f !== 'product.json')
      .map((f) => read(join(dir, f))),
  });
}

function pickScenarios(catalog: ScenarioCatalog, which: string): ScenarioSpec[] {
  if (which === 'all') return catalog.scenarios;
  const found = catalog.scenarios.filter((s) => s.id === which);
  if (!found.length) {
    fail(`No scenario "${which}". Try: all, ${catalog.scenarios.map((s) => s.id).join(', ')}`);
  }
  return found;
}

/** Runs `tasks` with at most `limit` in flight, keeping their order. */
async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const pad = (text: string, width: number) => text.padEnd(width);

function traceLine(t: SimTurn): string {
  const j = t.judged;
  if (!j) return `  t${t.turn}  (not judged)`;
  const signals = Object.entries(j.judge.signals)
    .filter(([, on]) => on)
    .map(([name]) => `+${name}`)
    .join(' ');
  const reveal = j.judge.revealEarned ? `  reveal ${j.judge.revealEarned}` : '';
  const actions = t.actions.length
    ? `  → ${t.actions.map((a) => (a.type === 'end_call' ? `end_call(${a.reason})` : `agree_to_meeting(${a.when})`)).join(', ')}`
    : '';
  const failed = j.judged ? '' : '  [judge failed]';
  return `  t${pad(String(t.turn), 3)}${pad(j.judge.stage, 19)}interest ${pad(`${j.before.interest}→${j.after.interest}`, 8)} patience ${pad(`${j.before.patience}→${j.after.patience}`, 8)} ${signals}${reveal}${failed}${actions}`;
}

function report(result: SimResult, header: string, transcript: boolean): string {
  const lines = [
    `${header}: ${result.outcome}${result.detail ? ` (${result.detail})` : ''} after ${result.turns.length} turn(s)`,
  ];
  for (const turn of result.turns) {
    if (transcript) {
      lines.push(`    Rep: ${turn.rep}`, `    Prospect: ${turn.prospect}`);
    }
    lines.push(traceLine(turn));
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'medium-finance-director' },
      persona: { type: 'string', default: 'both' },
      runs: { type: 'string', default: '5' },
      turns: { type: 'string', default: '20' },
      concurrency: { type: 'string', default: '5' },
      transcript: { type: 'boolean', default: false },
      review: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  loadDotEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) fail('ANTHROPIC_API_KEY is not set (see .env.example). This script calls Claude.');

  const personas: PersonaId[] =
    values.persona === 'both'
      ? ['terrible', 'good']
      : values.persona === 'terrible' || values.persona === 'good'
        ? [values.persona]
        : fail('--persona must be terrible, good or both');
  const runs = positive('runs', values.runs);
  const maxTurns = positive('turns', values.turns);
  const concurrency = positive('concurrency', values.concurrency);
  const catalog = loadCatalog();
  const scenarios = pickScenarios(catalog, values.scenario);
  const { product } = catalog;
  const models: SimModels = {
    rep: process.env.SIM_REP_MODEL || 'claude-opus-5',
    prospect: process.env.PROSPECT_MODEL || 'claude-opus-5',
    prospectEffort: effortFrom('PROSPECT_EFFORT', 'low'),
    coach: process.env.COACH_MODEL || 'claude-opus-5',
    coachEffort: effortFrom('COACH_EFFORT', 'low'),
  };
  const messages = createClaude(apiKey).beta.messages;
  const reviewModel = process.env.REVIEW_MODEL || 'claude-opus-5';
  const reviewEffort = effortFrom('REVIEW_EFFORT', 'high');
  const prices = await readPriceTable();
  let reviewCostUsd = 0;

  console.log(
    `Prospect ${models.prospect} (${models.prospectEffort}), judge ${models.coach} (${models.coachEffort}), rep ${models.rep}.\n` +
      `${scenarios.length} scenario(s) × ${personas.length} rep(s) × ${runs} run(s), up to ${maxTurns} turns each.\n`,
  );

  const summary: string[] = [];
  let passed = true;
  const totals = { calls: 0, inputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 };

  for (const scenario of scenarios) {
    for (const personaId of personas) {
      const persona = PERSONAS[personaId];
      const results = await pool(
        Array.from({ length: runs }, (_, i) => async () => {
          const result = await simulateCall({
            scenario,
            product,
            persona,
            messages,
            models,
            maxTurns,
          });
          const lines = [
            report(
              result,
              `${scenario.id} × ${persona.label}, run ${i + 1}/${runs}`,
              values.transcript,
            ),
          ];
          if (values.review) {
            const rubric = catalog.rubrics.find((r) => r.id === scenario.rubricId);
            if (!rubric) fail(`No rubric "${scenario.rubricId}".`);
            try {
              const reviewed = await reviewSimulatedCall({
                messages,
                model: reviewModel,
                effort: reviewEffort,
                prices,
                scenario,
                product,
                rubric,
                result,
              });
              reviewCostUsd += reviewed.costUsd ?? 0;
              lines.push(
                `  review (${reviewed.model}, $${(reviewed.costUsd ?? 0).toFixed(4)}, ${reviewed.dropped.length} quote(s) dropped):`,
                JSON.stringify(reviewed.review, null, 2),
              );
            } catch (error) {
              lines.push(
                `  review failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          console.log(lines.join('\n'), '\n');
          return result;
        }),
        concurrency,
      );
      for (const r of results) {
        for (const key of Object.keys(totals) as Array<keyof typeof totals>)
          totals[key] += r.usage[key];
      }
      const booked = results.filter((r) => r.outcome === 'meeting_booked').length;
      const hungUp = results.filter((r) => r.outcome === 'hung_up_by_prospect').length;
      const ok = personaId === 'terrible' ? booked === 0 : booked >= Math.ceil(runs * 0.6);
      passed &&= ok;
      const needed = personaId === 'terrible' ? 'needs 0' : `needs ≥ ${Math.ceil(runs * 0.6)}`;
      summary.push(
        `${pad(scenario.id, 26)} ${pad(persona.label, 13)} booked ${booked}/${runs}, hung up ${hungUp}/${runs}  ${ok ? 'PASS' : 'FAIL'} (${needed})`,
      );
    }
  }

  console.log(['Summary', ...summary].join('\n'));
  console.log(
    `\nClaude usage: ${totals.calls} calls, ${totals.inputTokens} input tokens (${totals.cacheReadInputTokens} from cache), ${totals.outputTokens} output tokens.`,
  );
  if (values.review) console.log(`Reviews: $${reviewCostUsd.toFixed(4)} in total.`);
  console.log(passed ? '\nPASS' : '\nFAIL');
  process.exitCode = passed ? 0 : 1;
}

await main();
