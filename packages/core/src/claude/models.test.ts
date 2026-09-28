import { describe, expect, it } from 'vitest';
import { modelCapabilities } from './models.ts';

describe('modelCapabilities', () => {
  it('gives Opus 5 effort, mid-conversation system messages and server fallbacks', () => {
    expect(modelCapabilities('claude-opus-5')).toEqual({
      effort: true,
      midConversationSystem: true,
      serverFallbacks: true,
    });
  });

  it('gives Opus 5.5 the same, refusal fallbacks included', () => {
    expect(modelCapabilities('claude-opus-5-5')).toEqual(modelCapabilities('claude-opus-5'));
  });

  it('gives Haiku 4.5 none of them (PLAN.md §6.5)', () => {
    expect(modelCapabilities('claude-haiku-4-5')).toEqual({
      effort: false,
      midConversationSystem: false,
      serverFallbacks: false,
    });
  });

  it('does not give Sonnet 5 mid-conversation system messages', () => {
    expect(modelCapabilities('claude-sonnet-5').midConversationSystem).toBe(false);
  });

  it('treats unknown models conservatively so a request never 400s mid-call', () => {
    expect(modelCapabilities('claude-something-new')).toEqual({
      effort: false,
      midConversationSystem: false,
      serverFallbacks: false,
    });
  });
});
