// The latency and cost report (PROMPTS.md M6) over the calls logged in Postgres.
//
//   pnpm report:latency                 # the 20 most recent calls
//   pnpm report:latency --calls 50
//   pnpm report:latency --since 2026-09-26
//
// Prints markdown, ready to paste into a PR. Reads DATABASE_URL from .env.
import { parseArgs } from 'node:util';
import { loggedCalls } from '../apps/api/src/calls/report.ts';
import { loadConfig, loadDotEnv } from '../apps/api/src/config.ts';
import { createDb } from '../apps/api/src/db/client.ts';
import { buildReport, formatReport } from './report/latency.ts';

const USAGE = `Usage: pnpm report:latency [--calls <n>] [--since <date>]

  --calls <n>      How many of the most recent ended calls to include (default 20)
  --since <date>   Only calls started on or after this date (ISO 8601)`;

const { values } = parseArgs({
  options: {
    calls: { type: 'string', default: '20' },
    since: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const limit = Number(values.calls);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--calls must be a whole number above 0');
  process.exit(2);
}
const since = values.since ? new Date(values.since) : null;
if (since && Number.isNaN(since.getTime())) {
  console.error('--since must be a date, such as 2026-09-26');
  process.exit(2);
}

loadDotEnv();
const { pool, db } = createDb(loadConfig(process.env).DATABASE_URL);
try {
  const reportCalls = await loggedCalls(db, { limit, since });
  const dates = reportCalls.map((c) => c.startedAt.getTime());
  const range = dates.length
    ? { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) }
    : null;
  console.log(formatReport(buildReport(reportCalls), range));
} finally {
  await pool.end();
}
