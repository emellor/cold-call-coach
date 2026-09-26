import type { HealthResponse } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { fetchHealth } from '../lib/api.ts';

type HealthState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'down' };

/** API and database health, from `GET /api/health`. */
export function SystemStatus() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ok', health }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'down' });
      });
    return () => controller.abort();
  }, []);

  const text =
    state.kind === 'loading'
      ? { tone: 'text-slate-400', label: 'Checking the API…' }
      : state.kind === 'down'
        ? { tone: 'text-rose-400', label: 'API unreachable' }
        : state.health.db.ok
          ? {
              tone: 'text-emerald-400',
              label: `API ok · Database ok (${state.health.db.latencyMs} ms)`,
            }
          : {
              tone: 'text-amber-400',
              label: `API ok · Database unavailable: ${state.health.db.error}`,
            };

  // What the API's settings leave switched off, so nobody dials into a dead end.
  const off =
    state.kind === 'ok'
      ? [state.health.features?.calls, state.health.features?.reviews].flatMap((f) =>
          f && !f.ok && f.reason ? [f.reason] : [],
        )
      : [];

  return (
    <div className="flex flex-col items-end gap-0.5">
      <p role="status" className={`text-xs ${text.tone}`}>
        {text.label}
      </p>
      {off.map((reason) => (
        <p key={reason} className="text-xs text-amber-400">
          {reason}
        </p>
      ))}
    </div>
  );
}
