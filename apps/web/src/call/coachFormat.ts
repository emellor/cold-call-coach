import { METRIC_TARGETS } from '@ccc/contracts';

/** The monologue timer's colour: amber from 30 s, red from 45 s (PLAN.md §8.1). */
export function monologueTone(seconds: number): 'ok' | 'warn' | 'over' {
  const { warnAt, max } = METRIC_TARGETS.longestMonologueSec;
  return seconds >= max ? 'over' : seconds >= warnAt ? 'warn' : 'ok';
}
