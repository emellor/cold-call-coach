import type { CallStage } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { NO_STAGES, stageChanges, stageStatuses, trackerStageFor } from './stages.ts';

describe('trackerStageFor', () => {
  it.each<[CallStage, string | null]>([
    ['opener', 'opener'],
    ['reason', 'reason'],
    ['discovery', 'discovery'],
    ['objection_handling', 'objections'],
    ['close', 'next_step'],
    ['other', null],
  ])('%s → %s', (stage, expected) => {
    expect(trackerStageFor(stage, 'discovery')).toBe(expected);
  });

  it('counts an early pitch as the reason for calling, and a later one as nothing', () => {
    expect(trackerStageFor('pitch', 'opener')).toBe('reason');
    expect(trackerStageFor('pitch', 'reason')).toBe('reason');
    expect(trackerStageFor('pitch', 'discovery')).toBeNull();
  });
});

describe('stageStatuses', () => {
  it('opens on the opener', () => {
    expect(stageStatuses([])).toEqual({
      opener: 'active',
      reason: 'pending',
      discovery: 'pending',
      objections: 'pending',
      next_step: 'pending',
    });
  });

  it('marks each step it leaves done, and leaves a skipped step pending', () => {
    expect(
      stageStatuses(['opener', 'other', 'discovery', 'discovery', 'objection_handling']),
    ).toEqual({
      opener: 'done',
      reason: 'pending',
      discovery: 'done',
      objections: 'active',
      next_step: 'pending',
    });
  });

  it('can go back a step', () => {
    expect(stageStatuses(['opener', 'reason', 'discovery', 'reason'])).toMatchObject({
      reason: 'active',
      discovery: 'done',
    });
  });

  it('completes the next step once a meeting is booked', () => {
    expect(stageStatuses(['opener', 'reason', 'close'], true)).toMatchObject({
      reason: 'done',
      next_step: 'done',
    });
  });
});

describe('stageChanges', () => {
  it('publishes the whole tracker the first time', () => {
    expect(stageChanges(NO_STAGES, stageStatuses([]))).toEqual([
      { stage: 'opener', status: 'active' },
    ]);
  });

  it('sends what changed, the newly active step last', () => {
    const before = stageStatuses(['opener', 'reason']);
    const after = stageStatuses(['opener', 'reason', 'discovery']);
    expect(stageChanges(before, after)).toEqual([
      { stage: 'reason', status: 'done' },
      { stage: 'discovery', status: 'active' },
    ]);
    expect(stageChanges(after, after)).toEqual([]);
  });

  it('resets steps a rewind took back to pending', () => {
    const before = stageStatuses(['opener', 'reason', 'close']);
    const after = stageStatuses(['opener', 'reason']);
    expect(stageChanges(before, after)).toEqual([
      { stage: 'next_step', status: 'pending' },
      { stage: 'reason', status: 'active' },
    ]);
  });
});
