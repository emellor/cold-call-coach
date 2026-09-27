import type { ScenarioSummary } from '@ccc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { fetchScenarios } from '../lib/api.ts';

export type ScenariosState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; scenarios: ScenarioSummary[] };

/** The list, or why it couldn't be had. */
const fetchState = (signal?: AbortSignal): Promise<ScenariosState> =>
  fetchScenarios(signal).then(
    ({ scenarios }) => ({ status: 'ready', scenarios }),
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: 'error', message: `Couldn't load the scenarios: ${detail}` };
    },
  );

/**
 * The scenario list, fetched when the page opens. `reload` fetches it again
 * (after "Add new", say), keeping the current list on screen until the new one
 * is in, and resolves once it is.
 */
export function useScenarios(): ScenariosState & { reload: () => Promise<void> } {
  const [state, setState] = useState<ScenariosState>({ status: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    void fetchState(abort.signal).then((next) => {
      if (!abort.signal.aborted) setState(next);
    });
    return () => abort.abort();
  }, []);
  const reload = useCallback(async () => setState(await fetchState()), []);
  return { ...state, reload };
}
