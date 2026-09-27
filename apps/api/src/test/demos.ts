// Demo-call fixtures: a written call, and a stub writer that records what it
// was asked for, can hold every call until released, and can fail on demand.
import type { DemoWriter, WrittenDemo } from '../demos/writer.ts';

export const writtenDemo: WrittenDemo = {
  lines: [
    { speaker: 'prospect', text: 'Claire Hughes.', technique: null, note: null },
    {
      speaker: 'rep',
      text: 'Hi Claire, it’s Sam from WattGuard. Have I caught you at a bad time?',
      technique: 'Permission opener',
      note: 'Lowers her guard before any pitch.',
    },
    { speaker: 'prospect', text: 'You have thirty seconds.', technique: null, note: null },
    {
      speaker: 'rep',
      text: 'How do you see energy site by site today?',
      technique: 'Open question',
      note: 'Gets her talking about her world, not our product.',
    },
  ],
  meeting: 'Thursday 10:00, a 20-minute video call',
  title: 'Earning thirty seconds',
  summary: 'A permission opener, then discovery.',
  lessons: ['Ask first.', 'Follow up on her words.'],
  model: 'claude-opus-5',
  costUsd: 0.08,
};

export function stubDemoWriter(options: { failOn?: (angle: string) => string | null } = {}) {
  const asked: Array<{ scenarioId: string; angle: string }> = [];
  let hold: Promise<void> | null = null;
  let release = () => {};
  const writer: DemoWriter = async ({ scenario, angle }) => {
    asked.push({ scenarioId: scenario.id, angle });
    if (hold) await hold;
    const failure = options.failOn?.(angle);
    if (failure) throw new Error(failure);
    return writtenDemo;
  };
  return {
    writer,
    asked,
    /** Every call from now on waits until `release()`. */
    holdAll() {
      hold = new Promise((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
    },
    release: () => release(),
  };
}
