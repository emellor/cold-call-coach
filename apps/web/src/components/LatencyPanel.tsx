import type { DebugLatencyPayload } from '@ccc/contracts';
import { median } from '../lib/stats.ts';

/** PLAN.md §13: rep stops speaking → prospect's first audio. */
const E2E_TARGET_MS = { p50: 1500, p90: 2500 };

const STAGES = [
  ['endOfTurnMs', 'End of turn'],
  ['llmTtftMs', 'LLM first token'],
  ['ttsTtfbMs', 'TTS first byte'],
  ['e2eMs', 'End to end'],
] as const;

function e2eTone(ms: number | null | undefined): string {
  if (ms == null) return 'text-slate-400';
  if (ms <= E2E_TARGET_MS.p50) return 'text-emerald-400';
  if (ms <= E2E_TARGET_MS.p90) return 'text-amber-400';
  return 'text-rose-400';
}

const fmt = (ms: number | null | undefined) => (ms == null ? '–' : `${ms} ms`);

export function LatencyPanel({ entries }: { entries: DebugLatencyPayload[] }) {
  const last = entries.at(-1);
  const p50 = Object.fromEntries(
    STAGES.map(([key]) => [key, median(entries.map((e) => e[key]))]),
  ) as Record<(typeof STAGES)[number][0], number | null>;

  return (
    <section aria-labelledby="latency-heading" className="p-4 text-sm">
      <h2 id="latency-heading" className="mb-2 font-medium text-slate-300">
        Latency
        <span className="ml-2 font-normal text-slate-500">
          {last ? `turn ${last.turn} · ${entries.length} replies` : 'no replies yet'}
        </span>
      </h2>
      <table className="w-full tabular-nums">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th scope="col" className="font-normal">
              Stage
            </th>
            <th scope="col" className="text-right font-normal">
              Last turn
            </th>
            <th scope="col" className="text-right font-normal">
              p50
            </th>
          </tr>
        </thead>
        <tbody>
          {STAGES.map(([key, label]) => (
            <tr key={key} className={key === 'e2eMs' ? 'font-medium' : 'text-slate-300'}>
              <th scope="row" className="py-0.5 text-left font-normal">
                {label}
              </th>
              <td className={`text-right ${key === 'e2eMs' ? e2eTone(last?.[key]) : ''}`}>
                {fmt(last?.[key])}
              </td>
              <td className={`text-right ${key === 'e2eMs' ? e2eTone(p50[key]) : ''}`}>
                {fmt(p50[key])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Target: end to end p50 ≤ {E2E_TARGET_MS.p50} ms, p90 ≤ {E2E_TARGET_MS.p90} ms.
      </p>
    </section>
  );
}
