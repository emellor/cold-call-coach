// Builds the latency and cost report over logged calls (PLAN.md §13): p50 and
// p90 per stage of her replies, prompt-cache hits per Claude lane, and what the
// calls cost. Calls are grouped by the prospect's model and effort, so two
// settings can be compared side by side.
import type { CallLog, DebugLatencyPayload } from '@ccc/contracts';
import {
  type CacheStats,
  E2E_TARGET_MS,
  LATENCY_STAGES,
  type LatencyStage,
  type StageStats,
  cacheStats,
  latencyStats,
  percentile,
} from '@ccc/core';

export interface ReportCall {
  startedAt: Date;
  durationMs: number | null;
  latency: DebugLatencyPayload[];
  usage: CallLog['usage'];
  /** Priced during the call and by its review; null if nothing could be priced. */
  costUsd: number | null;
}

export interface ReportGroup {
  /** "claude-opus-5 @ low", or NO_CLAUDE_REPLIES. */
  prospect: string;
  calls: number;
  /** Her lines with at least one stage measured. */
  replies: number;
  /** Whether any call in the group made a Claude request at all. */
  claudeRequests: boolean;
  stages: Record<LatencyStage, StageStats>;
  cache: Record<'prospect' | 'judge' | 'hint', CacheStats>;
  cost: {
    calls: number;
    meanUsd: number | null;
    maxUsd: number | null;
    per10MinUsd: number | null;
  };
}

/** The group of calls whose log has no prospect lane: she never replied through Claude. */
export const NO_CLAUDE_REPLIES = 'no Claude replies';

const prospectOf = (call: ReportCall) => {
  const lane = call.usage.prospect;
  return lane ? `${lane.model} @ ${lane.effort ?? 'effort not recorded'}` : NO_CLAUDE_REPLIES;
};

const measured = (entry: DebugLatencyPayload) =>
  LATENCY_STAGES.some((stage) => entry[stage] !== null);

/** "1 call", "3 calls". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildReport(calls: readonly ReportCall[]): ReportGroup[] {
  const groups = new Map<string, ReportCall[]>();
  for (const call of calls)
    groups.set(prospectOf(call), [...(groups.get(prospectOf(call)) ?? []), call]);
  return [...groups].map(([prospect, members]) => {
    const priced = members.filter((c) => c.costUsd !== null);
    const costs = priced.map((c) => c.costUsd!);
    const minutes = priced.reduce((sum, c) => sum + (c.durationMs ?? 0) / 60_000, 0);
    const spent = costs.reduce((a, b) => a + b, 0);
    const entries = members.flatMap((c) => c.latency);
    return {
      prospect,
      calls: members.length,
      replies: entries.filter(measured).length,
      claudeRequests: members.some((c) => c.usage.prospect || c.usage.judge || c.usage.hint),
      stages: latencyStats(entries),
      cache: {
        prospect: cacheStats(members.map((c) => c.usage.prospect)),
        judge: cacheStats(members.map((c) => c.usage.judge)),
        hint: cacheStats(members.map((c) => c.usage.hint)),
      },
      cost: {
        calls: priced.length,
        meanUsd: costs.length ? round2(spent / costs.length) : null,
        maxUsd: costs.length ? round2(Math.max(...costs)) : null,
        per10MinUsd: minutes > 0 ? round2((spent / minutes) * 10) : null,
      },
    };
  });
}

const STAGE_NAMES: Record<LatencyStage, string> = {
  endOfTurnMs: 'End of turn',
  llmTtftMs: 'LLM first token',
  ttsTtfbMs: 'TTS first byte',
  e2eMs: 'End to end',
};

const ms = (n: number | null) => (n === null ? '–' : `${n.toLocaleString('en-GB')} ms`);
const usd = (n: number | null) => (n === null ? '–' : `$${n.toFixed(2)}`);

function verdict(e2e: StageStats): string {
  if (e2e.p50 === null || e2e.p90 === null) return 'No end-to-end measurements yet.';
  const over = [
    e2e.p50 > E2E_TARGET_MS.p50 ? `p50 is ${ms(e2e.p50 - E2E_TARGET_MS.p50)} over` : '',
    e2e.p90 > E2E_TARGET_MS.p90 ? `p90 is ${ms(e2e.p90 - E2E_TARGET_MS.p90)} over` : '',
  ].filter(Boolean);
  const target = `p50 ≤ ${ms(E2E_TARGET_MS.p50)}, p90 ≤ ${ms(E2E_TARGET_MS.p90)}`;
  if (!over.length) return `End to end meets the target (${target}).`;
  return (
    `End to end misses the target (${target}): ${over.join(', ')}. ` +
    'The levers are PROSPECT_EFFORT and PROSPECT_MODEL=claude-haiku-4-5 (PLAN.md §6.5); ' +
    'compare them with this report before changing a default.'
  );
}

function cacheLine(lane: string, stats: CacheStats): string | null {
  if (!stats.calls) return null;
  const health = stats.logsMissingAfterFirst
    ? `${count(stats.logsMissingAfterFirst, 'call')} missed it after their first request`
    : 'every call read it from its second request on';
  return `- ${lane}: ${stats.cachedCalls} of ${stats.calls} requests read the prompt cache (${health}).`;
}

export function formatReport(
  groups: readonly ReportGroup[],
  range: { from: Date; to: Date } | null,
): string {
  if (!groups.length) {
    return 'No ended calls with a log yet: make a call (or run `pnpm simulate`), then run this again.';
  }
  const calls = groups.reduce((n, g) => n + g.calls, 0);
  const when = range ? ` from ${range.from.toISOString()} to ${range.to.toISOString()}` : '';
  const lines = [`# Latency and cost: ${count(calls, 'call')}${when}`, ''];
  for (const g of groups) {
    const title =
      g.prospect === NO_CLAUDE_REPLIES
        ? 'Calls with no reply from Claude'
        : `Prospect on ${g.prospect}`;
    lines.push(
      `## ${title}: ${count(g.calls, 'call')}, ${count(g.replies, 'reply', 'replies')}`,
      '',
    );
    lines.push('| Stage | Replies | p50 | p90 |', '| --- | ---: | ---: | ---: |');
    for (const stage of LATENCY_STAGES) {
      const s = g.stages[stage];
      lines.push(`| ${STAGE_NAMES[stage]} | ${s.n} | ${ms(s.p50)} | ${ms(s.p90)} |`);
    }
    lines.push('', verdict(g.stages.e2eMs), '');
    const cache = [
      cacheLine('Prospect', g.cache.prospect),
      cacheLine('Judge', g.cache.judge),
      cacheLine('Hint', g.cache.hint),
    ].filter((l): l is string => l !== null);
    const noCache = g.claudeRequests
      ? '- No prompt-cache counts recorded (calls logged before M6).'
      : '- No Claude requests, so nothing to cache.';
    lines.push(...(cache.length ? cache : [noCache]), '');
    lines.push(
      g.cost.calls
        ? `Cost: ${usd(g.cost.meanUsd)} a call on average over ${count(g.cost.calls, 'priced call')}, ` +
            `${usd(g.cost.maxUsd)} at most, ${usd(g.cost.per10MinUsd)} per 10 minutes of calling.`
        : 'Cost: none of these calls was priced.',
      '',
    );
  }
  return lines.join('\n');
}

/** p50 of a list, re-exported for the script's summary line. */
export const median = (values: readonly number[]) => percentile(values, 50);
