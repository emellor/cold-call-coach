import { describe, expect, it } from 'vitest';
import { readCallConfig, readWorkerConfig } from './config.ts';

describe('readWorkerConfig', () => {
  it('accepts a complete LiveKit configuration', () => {
    const result = readWorkerConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(result.ok).toBe(true);
  });

  it('names every missing variable, treating blank .env lines as unset', () => {
    const result = readWorkerConfig({ LIVEKIT_API_KEY: '' });
    expect(result).toEqual({
      ok: false,
      problems: [
        'LIVEKIT_URL is not set',
        'LIVEKIT_API_KEY is not set',
        'LIVEKIT_API_SECRET is not set',
      ],
    });
  });

  it('rejects an http URL', () => {
    const result = readWorkerConfig({
      LIVEKIT_URL: 'https://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(result.ok).toBe(false);
  });
});

describe('readCallConfig', () => {
  const keys = {
    ANTHROPIC_API_KEY: 'a',
    DEEPGRAM_API_KEY: 'd',
    CARTESIA_API_KEY: 'c',
    INTERNAL_API_SECRET: 'dev-only-internal-secret',
  };

  it('defaults both Claude lanes to Opus 5 at low effort, the local API and the plan’s turn detector', () => {
    const result = readCallConfig({
      ...keys,
      CARTESIA_VOICE_ID: '',
      PROSPECT_MODEL: '',
      PROSPECT_EFFORT: '',
    });
    expect(result).toEqual({
      ok: true,
      config: {
        ...keys,
        API_BASE_URL: 'http://localhost:3000',
        PROSPECT_MODEL: 'claude-opus-5',
        PROSPECT_EFFORT: 'low',
        COACH_MODEL: 'claude-opus-5',
        COACH_EFFORT: 'low',
        TURN_DETECTOR: 'multilingual',
      },
    });
  });

  it('takes each lane from the environment and trims a trailing slash off the API URL', () => {
    const result = readCallConfig({
      ...keys,
      API_BASE_URL: 'https://coach.example.com/',
      PROSPECT_MODEL: 'claude-haiku-4-5',
      COACH_MODEL: 'claude-opus-5',
      COACH_EFFORT: 'medium',
      CARTESIA_VOICE_ID: 'fallback-voice',
    });
    expect(result.ok && result.config).toMatchObject({
      API_BASE_URL: 'https://coach.example.com',
      PROSPECT_MODEL: 'claude-haiku-4-5',
      COACH_EFFORT: 'medium',
      CARTESIA_VOICE_ID: 'fallback-voice',
    });
  });

  it('reports each missing provider key by name', () => {
    const result = readCallConfig({ ANTHROPIC_API_KEY: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        'DEEPGRAM_API_KEY is not set',
        'CARTESIA_API_KEY is not set',
        'INTERNAL_API_SECRET is not set',
      ]);
    }
  });

  it('rejects an unknown effort level and a non-http API URL', () => {
    expect(readCallConfig({ ...keys, PROSPECT_EFFORT: 'extreme' }).ok).toBe(false);
    expect(readCallConfig({ ...keys, COACH_EFFORT: 'extreme' }).ok).toBe(false);
    expect(readCallConfig({ ...keys, API_BASE_URL: 'localhost:3000' }).ok).toBe(false);
  });
});
