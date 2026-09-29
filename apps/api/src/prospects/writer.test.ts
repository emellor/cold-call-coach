import { APIError } from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { VOICE_ID_PLACEHOLDER } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { readPriceTable } from '../prices.ts';
import { testCatalog } from '../test/catalog.ts';
import { brokerDraft } from '../test/prospects.ts';
import type { VoiceLibrary } from './voices.ts';
import {
  type CreatingMessages,
  PROSPECT_WRITER_EFFORT,
  ProspectWriterError,
  claudeProspectWriter,
} from './writer.ts';

const prices = await readPriceTable();

const VOICES = [
  { id: 'voice-harriet', name: 'Harriet', description: 'en-GB. Brisk: a businesslike voice' },
  { id: 'voice-maeve', name: 'Maeve', description: 'en-IE. Warm: a friendly voice' },
];

function answer(patch: Partial<BetaMessage> & { json?: unknown } = {}) {
  const { json = brokerDraft, ...rest } = patch;
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 3_000, output_tokens: 900, cache_read_input_tokens: 0 },
    content: [{ type: 'text', text: JSON.stringify(json) }],
    ...rest,
  } as BetaMessage;
}

function writerWith(options: { reply?: () => Promise<BetaMessage>; voices?: VoiceLibrary | null }) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const messages: CreatingMessages = {
    create: (params) => {
      sent.push(params);
      return options.reply ? options.reply() : Promise.resolve(answer());
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const write = claudeProspectWriter({
    messages,
    model: 'claude-opus-5',
    catalog: testCatalog,
    voices:
      options.voices === undefined ? { voices: () => Promise.resolve(VOICES) } : options.voices,
    prices,
    logger,
    suffix: () => '4f2a9c',
  });
  return { write, sent, logger };
}

describe('claudeProspectWriter', () => {
  it('asks Claude for her as structured output, with the voices to choose from', async () => {
    const { write, sent } = writerWith({
      reply: () => Promise.resolve(answer({ json: { ...brokerDraft, voiceId: 'voice-harriet' } })),
    });
    const { scenario, voice } = await write('A mid-sized energy broker, very tough to sell to.');
    const [params] = sent;
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      output_config: { effort: PROSPECT_WRITER_EFFORT, format: { type: 'json_schema' } },
    });
    expect(params?.messages).toHaveLength(1);
    expect(params?.messages[0]?.content).toContain('very tough to sell to');
    expect(params?.system).toContain('- voice-harriet: Harriet.');
    const schema = JSON.stringify(params?.output_config?.format?.schema);
    expect(schema).toContain('"enum":["voice-harriet","voice-maeve"]');

    expect(voice).toBe('chosen');
    const hard = testCatalog.scenarios.find((s) => s.difficulty === 'hard')!;
    expect(scenario).toMatchObject({
      id: 'rachel-byrne-4f2a9c',
      version: 1,
      difficulty: 'hard',
      state: hard.state,
      rubricId: hard.rubricId,
      voice: { voiceId: 'voice-harriet', speed: 'fast' },
    });
  });

  it("practising a demo's call, shows Claude the call and keeps how hard she was to win", async () => {
    const { write, sent } = writerWith({ voices: null });
    const { scenario } = await write('Head of Estates at a care group, 14 homes.', {
      prospect: {
        name: 'Tamsin Reid',
        role: 'Head of Estates',
        company: 'Carewell',
        difficulty: 'medium',
        gender: 'female',
      },
      lines: ['Tamsin Reid speaking.', 'We have fourteen homes and one gas contract.'],
    });
    expect(sent[0]?.messages[0]?.content).toContain('We have fourteen homes and one gas contract.');
    // Claude's draft says hard; the demo's medium wins, with medium's thresholds.
    const medium = testCatalog.scenarios.find((s) => s.difficulty === 'medium')!;
    expect(scenario).toMatchObject({ difficulty: 'medium', state: medium.state });
  });

  it('gives her the default voice when there is no library, or it cannot be read', async () => {
    const none = writerWith({ voices: null });
    const plain = await none.write('A friendly office manager.');
    expect(plain).toMatchObject({
      voice: 'default',
      scenario: { voice: { voiceId: VOICE_ID_PLACEHOLDER } },
    });
    expect(JSON.stringify(none.sent[0]?.output_config?.format?.schema)).not.toContain('voiceId');

    const broken = writerWith({ voices: { voices: () => Promise.reject(new Error('401')) } });
    expect((await broken.write('A friendly office manager.')).voice).toBe('default');
    expect(broken.logger.warn).toHaveBeenCalled();
  });

  it('fails with words the rep can act on', async () => {
    const said = (reply: () => Promise<BetaMessage>) =>
      writerWith({ reply })
        .write('Someone tough.')
        .catch((e: unknown) => e);

    const refused = await said(() => Promise.resolve(answer({ stop_reason: 'refusal' })));
    expect(refused).toBeInstanceOf(ProspectWriterError);
    expect(refused).toHaveProperty(
      'message',
      'Claude declined to write this prospect. Try describing her differently.',
    );
    expect(await said(() => Promise.resolve(answer({ stop_reason: 'max_tokens' })))).toHaveProperty(
      'message',
      'Claude ran out of room writing her. Try again.',
    );
    expect(
      await said(() =>
        Promise.resolve(answer({ content: [{ type: 'text', text: '{"title":' }] } as never)),
      ),
    ).toHaveProperty('message', "Claude's answer came back malformed. Try again.");
    const empty = {
      ...brokerDraft,
      voiceId: 'voice-harriet',
      prospect: { ...brokerDraft.prospect, objections: [] },
    };
    expect(await said(() => Promise.resolve(answer({ json: empty })))).toHaveProperty(
      'message',
      expect.stringContaining('The prospect Claude wrote is incomplete'),
    );
    const rejected = APIError.generate(
      401,
      { error: { type: 'x', message: 'bad key' } },
      'bad key',
      new Headers(),
    );
    expect(await said(() => Promise.reject(rejected))).toHaveProperty(
      'message',
      expect.stringContaining('ANTHROPIC_API_KEY'),
    );
  });
});
