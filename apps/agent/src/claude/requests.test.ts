import { describe, expect, it } from 'vitest';
import { PROSPECT_MAX_TOKENS, prospectRequest } from './requests.ts';

const base = {
  effort: 'low' as const,
  persona: 'You are Claire Hughes.',
  messages: [{ role: 'user' as const, content: '(Your phone rings and you answer.)' }],
};

describe('prospectRequest', () => {
  it('sends Opus 5 effort, a cached persona and server-side refusal fallbacks', () => {
    const request = prospectRequest({ ...base, model: 'claude-opus-5' });
    expect(request).toEqual({
      model: 'claude-opus-5',
      max_tokens: PROSPECT_MAX_TOKENS,
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
