import type { HealthResponse } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { fetchHealth } from '../lib/api.ts';

type HealthState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'down' };

export function HomePage() {
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

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Cold Call Coach</h1>
        <p className="mt-2 text-slate-400">
          Practise B2B cold calls against an AI prospect, with live and post-call coaching.
        </p>
      </header>
      <section
        aria-label="System status"
        className="rounded-lg border border-slate-800 p-4 text-sm"
      >
        <StatusLine state={state} />
      </section>
    </main>
  );
}

function StatusLine({ state }: { state: HealthState }) {
  if (state.kind === 'loading') return <p className="text-slate-400">Checking the API…</p>;
  if (state.kind === 'down') return <p className="text-rose-400">API unreachable.</p>;
  const { db } = state.health;
  return db.ok ? (
    <p className="text-emerald-400">API ok · Database ok ({db.latencyMs} ms)</p>
  ) : (
    <p className="text-amber-400">API ok · Database unavailable: {db.error}</p>
  );
}
