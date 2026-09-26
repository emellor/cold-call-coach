import type { ScenarioSummary } from '@ccc/contracts';
import { useEffect, useState } from 'react';
import { fetchScenarios } from '../lib/api.ts';

export type ScenariosState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; scenarios: ScenarioSummary[] };

/** The scenario list, fetched once when the page opens. */
export function useScenarios(): ScenariosState {
  const [state, setState] = useState<ScenariosState>({ status: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    fetchScenarios(abort.signal)
      .then(({ scenarios }) => setState({ status: 'ready', scenarios }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        const detail = error instanceof Error ? error.message : String(error);
        setState({ status: 'error', message: `Couldn't load the scenarios: ${detail}` });
      });
    return () => abort.abort();
  }, []);
  return state;
}
