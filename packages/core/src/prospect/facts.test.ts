import { describe, expect, it } from 'vitest';
import { scenario } from '../test/fixtures.ts';
import { privateFacts } from './facts.ts';

describe('privateFacts', () => {
  it('keys the pains in order, then the other facts', () => {
    expect(privateFacts(scenario.prospect.hidden).map((f) => [f.key, f.label])).toEqual([
      ['pain_1', 'Pain'],
      ['pain_2', 'Pain'],
      ['current_solution', 'Current solution'],
      ['decision_process', 'Decision process'],
      ['timing', 'Timing'],
    ]);
  });
});
