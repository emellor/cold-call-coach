// Demo-call fixtures: a written call, and a stub writer that records what it
// was asked for, can hold every call until released, and can fail on demand.
import type { DemoProspect } from '@ccc/contracts';
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

/** Who the stub writes a demo from a brief to. */
export const briefProspect: DemoProspect = {
  name: 'Tom Reid',
  role: 'Head of Estates',
  company: 'Carewell Homes',
  difficulty: 'hard',
  gender: 'male',
  locale: 'en-GB',
};

export function stubDemoWriter(options: { failOn?: (angle: string) => string | null } = {}) {
  const asked: Array<{ scenarioId: string; angle: string }> = [];
  const briefs: string[] = [];
  let hold: Promise<void> | null = null;
  let release = () => {};
  const writer: DemoWriter = async (input) => {
    if ('brief' in input) briefs.push(input.brief);
    else asked.push({ scenarioId: input.scenario.id, angle: input.angle });
    if (hold) await hold;
    if ('brief' in input) return { ...writtenDemo, prospect: briefProspect };
    const failure = options.failOn?.(input.angle);
    if (failure) throw new Error(failure);
    return writtenDemo;
  };
  return {
    writer,
    asked,
    /** The briefs it was asked to write from, in order. */
    briefs,
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
