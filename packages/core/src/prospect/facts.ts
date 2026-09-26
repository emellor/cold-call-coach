// The scenario's private facts as keyed items: the vocabulary shared by the
// judge (which fact did this question earn?) and the state note (which facts
// may she now discuss?).
import type { FactKey, HiddenFacts } from '@ccc/contracts';

export interface PrivateFact {
  key: FactKey;
  label: string;
  text: string;
}

const PAIN_KEYS = ['pain_1', 'pain_2', 'pain_3'] as const satisfies readonly FactKey[];

export function privateFacts(hidden: HiddenFacts): PrivateFact[] {
  return [
    ...hidden.pains.slice(0, PAIN_KEYS.length).map((text, i) => ({
      key: PAIN_KEYS[i]!,
      label: 'Pain',
      text,
    })),
    { key: 'current_solution', label: 'Current solution', text: hidden.currentSolution },
    { key: 'decision_process', label: 'Decision process', text: hidden.decisionProcess },
    { key: 'timing', label: 'Timing', text: hidden.timing },
  ];
}
