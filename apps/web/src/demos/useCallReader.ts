import type { DemoGender, DemoTurn } from '@ccc/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CallReader, type ReaderState, browserSpeech } from './readAloud.ts';

/** The reading speeds on offer. */
export const READING_RATES = [1, 1.25, 1.5] as const;

/**
 * Reads a demo call aloud in the browser. `supported` is false where the
 * browser has no speech synthesis; leaving the page stops the reading.
 */
export function useCallReader(options: {
  turns: readonly DemoTurn[];
  locale: string;
  prospectGender: DemoGender;
}) {
  const { turns, locale, prospectGender } = options;
  const [speech] = useState(browserSpeech);
  const [state, setState] = useState<ReaderState>({ status: 'idle' });
  const [rate, setRateState] = useState<number>(1);
  const reader = useMemo(
    () =>
      speech
        ? new CallReader({ speech, lines: turns, locale, prospectGender, onChange: setState })
        : null,
    [speech, turns, locale, prospectGender],
  );

  useEffect(() => {
    // Chrome lists its voices only after the first time it is asked.
    speech?.voices();
    return () => reader?.dispose();
  }, [speech, reader]);

  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      reader?.setRate(next);
    },
    [reader],
  );

  return {
    supported: reader !== null,
    state,
    rate,
    setRate,
    play: (line?: number) => reader?.play(line),
    pause: () => reader?.pause(),
    resume: () => reader?.resume(),
    stop: () => reader?.stop(),
  };
}
