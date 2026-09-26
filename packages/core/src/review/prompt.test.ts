import type { CallMetrics, RubricSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { product, scenario } from '../test/fixtures.ts';
import { buildReviewSystemPrompt, buildReviewUserPrompt, clock } from './prompt.ts';

const rubric: RubricSpec = {
  id: 'cold-call-v1',
  version: 1,
  title: 'B2B cold call',
  criteria: (['opener', 'reason', 'discovery', 'objections', 'next_step', 'delivery'] as const).map(
    (key) => ({
      key,
      name: key.toUpperCase(),
      goodLooksLike: `good ${key}`,
      anchors: { '1': `${key} one`, '3': `${key} three`, '5': `${key} five` },
    }),
  ),
};

const metrics: CallMetrics = {
  durationSec: 192,
  repSpeechSec: 120,
  prospectSpeechSec: 40,
  talkRatio: 0.75,
  repWords: 380,
  repWpm: 190,
  coreFillers: 9,
  softFillers: 4,
  fillersPerMin: 4.5,
  questionsOpen: 1,
  questionsClosed: 3,
  longestMonologueSec: 52.4,
  interruptions: 2,
  timeToFirstQuestionSec: 38.5,
};

const input = {
  rubric,
  scenario,
  product,
  metrics,
  outcome: 'hung_up_by_prospect' as const,
  outcomeReason: 'Out of patience',
  turns: [
    { speaker: 'prospect' as const, text: 'Claire Hughes.', startMs: 0, interrupted: false },
    { speaker: 'rep' as const, text: 'Hi, Sam here.', startMs: 1_200, interrupted: false },
    { speaker: 'prospect' as const, text: 'Look, I', startMs: 65_000, interrupted: true },
  ],
};

describe('buildReviewSystemPrompt', () => {
  const prompt = buildReviewSystemPrompt(input);

  it('gives the reviewer the product, her private facts and every rubric anchor', () => {
    expect(prompt).toContain(`- WattGuard: ${product.oneLiner}`);
    expect(prompt).toContain('- Pain: energy bills up about 40% in two years');
    expect(prompt).toContain('- Timing: budget planning starts in January');
    expect(prompt).toContain('A win on this call: Agrees to a 20-minute call');
    for (const c of rubric.criteria) {
      expect(prompt).toContain(`- ${c.key} (${c.name}): good ${c.key}`);
      expect(prompt).toContain(`5: ${c.key} five`);
    }
  });

  it('demands exact quotes and treats the metrics as facts', () => {
    expect(prompt).toContain('must be copied word for word from the transcript turn it cites');
    expect(prompt).toContain("don't recount words, fillers or seconds");
  });
});

describe('buildReviewUserPrompt', () => {
  const prompt = buildReviewUserPrompt(input);

  it('states the outcome and the measured metrics against their targets', () => {
    expect(prompt).toContain('How the call ended: she hung up (Out of patience).');
    expect(prompt).toContain('- Duration: 3:12');
    expect(prompt).toContain('- Talk ratio (rep share of speaking time): 75% [target 40%–60%]');
    expect(prompt).toContain('- Pace: 190 words a minute [target 130–170]');
    expect(prompt).toContain('9, 4.5 a minute [target at most 2 a minute]');
    expect(prompt).toContain('- Longest monologue: 52.4 s [target at most 45 s]');
    expect(prompt).toContain('- First question asked: 38.5 s after she answered');
  });

  it('numbers the transcript from 1 with speaker and time', () => {
    expect(prompt).toContain('[1] Prospect (0:00): Claire Hughes.');
    expect(prompt).toContain('[2] Rep (0:01): Hi, Sam here.');
    expect(prompt).toContain('[3] Prospect (1:05): Look, I [cut off by the rep]');
  });
});

describe('clock', () => {
  it('formats minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_999)).toBe('1:05');
    expect(clock(600_000)).toBe('10:00');
  });
});
