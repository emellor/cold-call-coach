import { readFileSync } from 'node:fs';
import {
  type DemoNotesDraft,
  ProductSpec,
  ScenarioSpec,
  VOICE_ID_PLACEHOLDER,
} from '@ccc/contracts';
import { DEMO_NOTES_MAX_TOKENS } from '@ccc/core';
import { describe, expect, it, vi } from 'vitest';
import type { BetaMessage } from '../claude/client.ts';
import { silentLogger } from '../test/fixtures.ts';
import { fakeClaude } from '../test/fakeClaude.ts';
import type { SimMessages } from '../simulate/harness.ts';
import type { Speech } from './speech.ts';
import { writeDemo } from './write.ts';

const load = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../scenarios/${file}`, import.meta.url), 'utf8'));
const scenario = ScenarioSpec.parse(load('medium-finance-director.json'));
const product = ProductSpec.parse(load('product.json'));
const models = {
  rep: 'claude-opus-5',
  prospect: 'claude-opus-5',
  prospectEffort: 'low' as const,
  coach: 'claude-opus-5',
  coachEffort: 'low' as const,
  notes: 'claude-opus-5',
  notesEffort: 'medium' as const,
};

const GOOD_CALL = [
  "Hi Claire, it's Sam at WattGuard. Have you got thirty seconds?",
  'Finance directors tell me energy bills are the line the board keeps asking about.',
  'How do you see energy use across the three warehouses today?',
  'How does that land at month end?',
  'How is the board reacting to the increase?',
  'Could we take twenty minutes, say Tuesday at 10am?',
];

/** The simulation's fake Claude, plus the notes call answered with `notes` (or refused). */
function claudeWith(lines: string[], notes: () => DemoNotesDraft, refuse = false) {
  const fake = fakeClaude(lines);
  const notesAsked: string[] = [];
  const messages: SimMessages = {
    ...fake.messages,
    parse: (params, options) => {
      if (params.max_tokens !== DEMO_NOTES_MAX_TOKENS) return fake.messages.parse(params, options);
      const user = params.messages[0]?.content;
      notesAsked.push(typeof user === 'string' ? user : '');
      return Promise.resolve({
        model: params.model,
        stop_reason: refuse ? 'refusal' : 'end_turn',
        usage: { input_tokens: 2_000, output_tokens: 700, cache_read_input_tokens: 0 },
        content: [],
        parsed_output: refuse ? null : notes(),
      } as unknown as BetaMessage & { parsed_output: unknown });
    },
  };
  return { messages, notesAsked };
}

function speechFake() {
  const spoken: Array<{ text: string; id: string; speed?: number }> = [];
  const speech: Speech = {
    speak: (text, voice) => {
      spoken.push({ text, id: voice.id, ...(voice.speed ? { speed: voice.speed } : {}) });
      return Promise.resolve({ audio: Buffer.from(`mp3:${text}`), ms: 1_000 + spoken.length });
    },
    repVoice: () => Promise.resolve('rep-voice'),
  };
  return { speech, spoken };
}

const notesFor = (repLines: number): DemoNotesDraft => ({
  title: 'Permission, then discovery',
  summary: 'The rep earns time, finds the board pressure and books the meeting.',
  lessons: ['Ask for thirty seconds.', 'Follow up on her words.', 'Close on a specific time.'],
  lines: Array.from({ length: repLines }, (_, i) => ({
    line: i + 1,
    technique: `Technique ${i + 1}`,
    note: `Why line ${i + 1} works.`,
  })),
});

const job = {
  id: '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
  scenarioId: scenario.id,
  angle: 'Lead with cost visibility.',
};

describe('writeDemo', () => {
  it('plays the expert against her, notes every rep line, and voices both sides', async () => {
    const { messages, notesAsked } = claudeWith(GOOD_CALL, () => notesFor(6));
    const { speech, spoken } = speechFake();
    const loadScenario = vi.fn(() =>
      Promise.resolve({
        scenario: {
          ...scenario,
          voice: { ...scenario.voice, voiceId: 'her-voice', speed: 'fast' as const },
        },
        product,
      }),
    );
    const result = await writeDemo(job, {
      loadScenario,
      messages,
      models,
      speech,
      prices: null,
      logger: silentLogger,
    });

    expect(loadScenario).toHaveBeenCalledWith(scenario.id);
    expect(result).toMatchObject({
      scenarioVersion: scenario.version,
      title: 'Permission, then discovery',
      outcome: 'meeting_booked',
      outcomeDetail: 'Tuesday at 10am',
      lessons: ['Ask for thirty seconds.', 'Follow up on her words.', 'Close on a specific time.'],
      costUsd: null,
    });
    // Her opening line, then six rep lines each with her reply.
    expect(result.turns).toHaveLength(13);
    expect(result.turns[0]).toMatchObject({
      speaker: 'prospect',
      text: 'Claire Hughes.',
      technique: null,
    });
    expect(result.turns[1]).toMatchObject({
      idx: 1,
      speaker: 'rep',
      text: GOOD_CALL[0],
      technique: 'Technique 1',
      note: 'Why line 1 works.',
      interest: 20,
    });
    expect(result.turns.filter((t) => t.speaker === 'rep').map((t) => t.technique)).toEqual(
      Array.from({ length: 6 }, (_, i) => `Technique ${i + 1}`),
    );
    expect(Buffer.from(result.turns[1]!.audio!, 'base64').toString()).toBe(`mp3:${GOOD_CALL[0]}`);

    // The rep in the rep's voice; her in hers, at her speed.
    expect(spoken.find((s) => s.text === GOOD_CALL[0])).toEqual({
      text: GOOD_CALL[0],
      id: 'rep-voice',
    });
    expect(spoken.find((s) => s.text === 'Claire Hughes.')).toEqual({
      text: 'Claire Hughes.',
      id: 'her-voice',
      speed: 1.15,
    });
    // The notes saw the approach and how she took each line.
    expect(notesAsked[0]).toContain(
      'The approach the rep was asked to take: Lead with cost visibility.',
    );
    expect(notesAsked[0]).toContain('Rep line 1: Hi Claire');
  });

  it('prices what it can, and says nothing it cannot', async () => {
    const { messages } = claudeWith(GOOD_CALL, () => notesFor(6));
    const { speech } = speechFake();
    const { readPriceTable } = await import('../prices.ts');
    const priced = await readPriceTable();
    if (!priced.ok) throw new Error('no price table');
    const result = await writeDemo(job, {
      loadScenario: () => Promise.resolve({ scenario, product }),
      messages,
      models,
      speech,
      fallbackVoiceId: 'default-voice',
      prices: priced.prices,
      logger: silentLogger,
    });
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('fails without a voice for her, and when the notes are refused', async () => {
    const { speech } = speechFake();
    const silent = { ...scenario, voice: { ...scenario.voice, voiceId: VOICE_ID_PLACEHOLDER } };
    await expect(
      writeDemo(job, {
        loadScenario: () => Promise.resolve({ scenario: silent, product }),
        messages: claudeWith(GOOD_CALL, () => notesFor(6)).messages,
        models,
        speech,
        prices: null,
        logger: silentLogger,
      }),
    ).rejects.toThrow('has no voice yet');

    const refusing = claudeWith(GOOD_CALL, () => notesFor(6), true);
    await expect(
      writeDemo(job, {
        loadScenario: () => Promise.resolve({ scenario, product }),
        messages: refusing.messages,
        models,
        speech,
        fallbackVoiceId: 'default-voice',
        prices: null,
        logger: silentLogger,
      }),
    ).rejects.toThrow('Claude declined to annotate the demo.');
  });
});
