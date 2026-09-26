import type { CallDetail } from '@ccc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, fetchCall } from '../lib/api.ts';

/** How often the page checks on a log or review that isn't in yet. */
export const POLL_MS = 2_000;
/** Stop checking after this long: the agent or the review has failed silently. */
export const GIVE_UP_MS = 5 * 60_000;

export type CallDetailState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; detail: CallDetail; gaveUp: boolean };

/** Still waiting on the agent's log or on the review? */
export function isSettling(detail: CallDetail): boolean {
  if (detail.call.status !== 'ended' || !detail.review) return true;
  return detail.review.status === 'pending' || detail.review.status === 'running';
}

/** The call, re-fetched every two seconds until its review has settled. */
export function useCallDetail(id: string) {
  const [state, setState] = useState<CallDetailState>({ kind: 'loading' });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const started = Date.now();
    const load = async () => {
      try {
        const detail = await fetchCall(id);
        if (stopped) return;
        const waiting = isSettling(detail);
        const gaveUp = waiting && Date.now() - started >= GIVE_UP_MS;
        setState({ kind: 'loaded', detail, gaveUp });
        if (waiting && !gaveUp) timer = window.setTimeout(() => void load(), POLL_MS);
      } catch (error) {
        if (stopped) return;
        if (error instanceof ApiRequestError && error.status === 404) setState({ kind: 'missing' });
        else
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      }
    };
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id, generation]);

  /** Fetch again and resume polling (after a rerun, say). */
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { state, reload };
}
