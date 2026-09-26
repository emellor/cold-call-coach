import type { CallSummary } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '../components/AppHeader.tsx';
import { fetchCalls } from '../lib/api.ts';
import { OUTCOME_LABELS, OUTCOME_TONE, dateTime, duration, money } from '../review/format.ts';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; calls: CallSummary[] };

function Cost({ call }: { call: CallSummary }) {
  if (!call.overBudget) return <>{money(call.costUsd)}</>;
  return (
    <span className="text-amber-300" title="Over the price table's warning line">
      ⚠ {money(call.costUsd)}
      <span className="sr-only"> (over the warning line)</span>
    </span>
  );
}

function Score({ call }: { call: CallSummary }) {
  if (call.overallScore !== null) return <>{call.overallScore}</>;
  if (call.reviewStatus === 'pending' || call.reviewStatus === 'running') {
    return <span className="text-slate-400">reviewing…</span>;
  }
  return <span className="text-slate-600">–</span>;
}

/** Every call, newest first (`/calls`). */
export function CallsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    fetchCalls(abort.signal)
      .then(({ calls }) => setState({ kind: 'ready', calls }))
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => abort.abort();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <h2 className="mb-4 text-xl font-semibold">History</h2>
        {state.kind === 'loading' && <p className="text-slate-400">Loading…</p>}
        {state.kind === 'error' && (
          <p role="alert" className="text-rose-300">
            Couldn't load your calls: {state.message}
          </p>
        )}
        {state.kind === 'ready' && state.calls.length === 0 && (
          <p className="text-slate-400">
            No calls yet.{' '}
            <Link href="/" className="text-sky-300 underline">
              Make one
            </Link>
            .
          </p>
        )}
        {state.kind === 'ready' && state.calls.length > 0 && (
          // On a phone the table scrolls sideways within itself, not the whole page;
          // `relative` keeps the absolutely placed sr-only text inside the scroller too.
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500 uppercase">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Prospect</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 pr-3 text-right font-medium">Score</th>
                  <th className="py-2 pr-3 text-right font-medium">Duration</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {state.calls.map((call) => (
                  <tr key={call.id} className="border-t border-slate-800 hover:bg-slate-900/60">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Link href={`/calls/${call.id}`} className="text-sky-300 hover:underline">
                        {dateTime(call.startedAt)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {call.scenario.prospectName}
                      <span className="ml-2 text-slate-500">{call.scenario.difficulty}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {call.outcome ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${OUTCOME_TONE[call.outcome]}`}
                        >
                          {OUTCOME_LABELS[call.outcome]}
                        </span>
                      ) : (
                        <span className="text-slate-500">{call.status}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <Score call={call} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {duration(call.durationMs)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <Cost call={call} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
