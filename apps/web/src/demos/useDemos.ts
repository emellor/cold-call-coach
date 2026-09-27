import type { DemoSummary } from '@ccc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { fetchDemos } from '../lib/api.ts';

/** How often the list is checked while the agent is writing demos. */
export const DEMOS_POLL_MS = 5_000;

export type DemosState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; demos: DemoSummary[] };

/** Still being written? */
export const writing = (demos: readonly DemoSummary[]) =>
  demos.some((d) => d.status === 'queued' || d.status === 'generating');

/** The demo calls, checked every few seconds while any are still being written. */
export function useDemos() {
  const [state, setState] = useState<DemosState>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const load = () =>
      fetchDemos().then(
        ({ demos }) => {
          if (stopped) return;
          setState({ status: 'ready', demos });
          if (writing(demos)) timer = window.setTimeout(load, DEMOS_POLL_MS);
        },
        (error: unknown) => {
          if (stopped) return;
          const detail = error instanceof Error ? error.message : String(error);
          setState({ status: 'error', message: `Couldn't load the demo calls: ${detail}` });
        },
      );
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [generation]);

  /** Fetch again, and keep checking while demos are being written. */
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { state, reload };
}
