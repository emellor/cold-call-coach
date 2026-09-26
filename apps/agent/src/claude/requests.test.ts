import { describe, expect, it } from 'vitest';
import { PROSPECT_TOOLS } from '../prospect/tools.ts';
import { HINT_MAX_TOKENS } from '@ccc/core';
import {
  JUDGE_MAX_TOKENS,
  PROSPECT_MAX_TOKENS,
  hintRequest,
  judgeRequest,
  prospectRequest,
} from './requests.ts';

const base = {
  effort: 'low' as const,
  persona: 'You are Claire Hughes.',
  messages: [{ role: 'user' as const, content: '(Your phone rings and you answer.)' }],
};

describe('prospectRequest', () => {
  it('sends Opus 5 effort, her tools, a cached persona and server-side refusal fallbacks', () => {
    const request = prospectRequest({ ...base, model: 'claude-opus-5' });
    expect(request).toEqual({
      model: 'claude-opus-5',
      max_tokens: PROSPECT_MAX_TOKENS,
      tools: PROSPECT_TOOLS,
      system: [
        { type: 'text', text: 'You are Claire Hughes.', cache_control: { type: 'ephemeral' } },
      ],
      messages: base.messages,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('omits effort and fallbacks for Haiku 4.5, which accepts neither', () => {
    const request = prospectRequest({ ...base, model: 'claude-haiku-4-5' });
    expect(request).not.toHaveProperty('output_config');
    expect(request).not.toHaveProperty('fallbacks');
    expect(request).not.toHaveProperty('betas');
    expect(request.tools).toBe(PROSPECT_TOOLS);
  });

  it('never sends sampling parameters', () => {
    for (const model of ['claude-opus-5', 'claude-haiku-4-5']) {
      const request = prospectRequest({ ...base, model });
      expect(request).not.toHaveProperty('temperature');
      expect(request).not.toHaveProperty('top_p');
      expect(request).not.toHaveProperty('top_k');
    }
  });
});

describe('judgeRequest', () => {
  const input = { effort: 'low' as const, system: 'You judge.', user: 'LATEST Rep: hi' };

  it('asks Opus 5 for JudgeResult as structured output, at the coach effort', () => {
    const request = judgeRequest({ ...input, model: 'claude-opus-5' });
    expect(request).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: JUDGE_MAX_TOKENS,
      system: [{ type: 'text', text: 'You judge.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'LATEST Rep: hi' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const schema = JSON.stringify(request.output_config.format.schema);
    for (const field of [
      'stage',
      'askedPermission',
      'proposedSpecificTime',
      'revealEarned',
      'tip',
    ]) {
      expect(schema).toContain(field);
    }
  });

  it('keeps the enums as real constraints and closes every object', () => {
    const { schema } = judgeRequest({ ...input, model: 'claude-opus-5' }).output_config.format;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.stage?.enum).toEqual([
      'opener',
      'reason',
      'discovery',
      'pitch',
      'objection_handling',
      'close',
      'other',
    ]);
    expect(JSON.stringify(properties.revealEarned)).toContain(
      '"enum":["pain_1","pain_2","pain_3","current_solution","decision_process","timing"]',
    );
    expect(schema).not.toHaveProperty('$schema');
    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (record.type === 'object') objects.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(schema);
    expect(objects.length).toBeGreaterThanOrEqual(3); // the result, its signals, the tip
    for (const object of objects) expect(object.additionalProperties).toBe(false);
  });

  it('parses what the schema describes', () => {
    const { format } = judgeRequest({ ...input, model: 'claude-opus-5' }).output_config;
    const parsed = format.parse(
      JSON.stringify({
        stage: 'discovery',
        signals: {
          askedPermission: false,
          gaveRelevantReason: false,
          askedOpenQuestion: true,
          followedUp: true,
          acknowledgedObjection: false,
          pitchedFeatures: false,
          ignoredHerPoint: false,
          pushy: false,
          rude: false,
          askedForMeeting: false,
          proposedSpecificTime: false,
        },
        revealEarned: 'current_solution',
        tip: null,
      }),
    );
    expect(parsed.revealEarned).toBe('current_solution');
    expect(() => format.parse('{"stage":"gossip"}')).toThrow();
  });

  it('drops effort and fallbacks for Haiku 4.5 but keeps the format', () => {
    const request = judgeRequest({ ...input, model: 'claude-haiku-4-5' });
    expect(request.output_config).not.toHaveProperty('effort');
    expect(request.output_config.format.type).toBe('json_schema');
    expect(request).not.toHaveProperty('fallbacks');
    expect(request).not.toHaveProperty('temperature');
  });
});

describe('hintRequest', () => {
  const input = { effort: 'low' as const, system: 'You coach.', user: 'Rep: hi' };

  it('asks the coach model for three lines as structured output, with a cached system', () => {
    const request = hintRequest({ ...input, model: 'claude-opus-5' });
    expect(request).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: HINT_MAX_TOKENS,
      system: [{ type: 'text', text: 'You coach.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Rep: hi' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      fallbacks: 'default',
    });
    for (const key of ['temperature', 'top_p', 'top_k']) expect(request).not.toHaveProperty(key);
    const { format } = request.output_config;
    expect(JSON.stringify(format.schema)).toContain('Exactly three different lines');
    expect(format.parse('{"suggestions":["a","b","c"]}')).toEqual({ suggestions: ['a', 'b', 'c'] });
  });

  it('drops effort and fallbacks for Haiku 4.5', () => {
    const request = hintRequest({ ...input, model: 'claude-haiku-4-5' });
    expect(request.output_config).not.toHaveProperty('effort');
    expect(request).not.toHaveProperty('fallbacks');
  });
});
