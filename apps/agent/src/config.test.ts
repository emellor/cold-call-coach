import { describe, expect, it } from 'vitest';
import { describeMissingCallConfig, readCallConfig, readWorkerConfig } from './config.ts';

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

  it('drops the space or newline a pasted value brings with it', () => {
    const result = readWorkerConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud\n',
      LIVEKIT_API_KEY: ' key',
      LIVEKIT_API_SECRET: 'secret\n',
    });
    expect(result).toEqual({
      ok: true,
      config: {
        LIVEKIT_URL: 'wss://example.livekit.cloud',
        LIVEKIT_API_KEY: 'key',
        LIVEKIT_API_SECRET: 'secret',
      },
    });
  });

  it('refuses a room token from "Generate Token" as the secret, in words that say what to do', () => {
    const result = readWorkerConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'APIaB3cD4eF5gH6',
      LIVEKIT_API_SECRET: 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJBUEkifQ.c2ln',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        expect.stringMatching(/^LIVEKIT_API_SECRET is a room token .*create a key and copy both/),
      ]);
    }
  });
});

describe('readCallConfig', () => {
  const keys = {
    ANTHROPIC_API_KEY: 'a',
    DEEPGRAM_API_KEY: 'd',
    CARTESIA_API_KEY: 'c',
    INTERNAL_API_SECRET: 'dev-only-internal-secret',
  };

  it('defaults every Claude lane to Opus 5.5 at low effort, the local API and the plan’s turn detector', () => {
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
        PROSPECT_MODEL: 'claude-opus-5-5',
        PROSPECT_EFFORT: 'low',
        COACH_MODEL: 'claude-opus-5-5',
        COACH_EFFORT: 'low',
        REP_MODEL: 'claude-opus-5-5',
        REP_EFFORT: 'low',
        TURN_DETECTOR: 'multilingual',
      },
    });
  });

  it("takes Sam's lane and voice for reverse calls from the environment", () => {
    const result = readCallConfig({
      ...keys,
      REP_MODEL: 'claude-sonnet-5',
      REP_EFFORT: 'medium',
      REP_VOICE_ID: ' voice-sam ',
    });
    expect(result).toMatchObject({
      ok: true,
      config: { REP_MODEL: 'claude-sonnet-5', REP_EFFORT: 'medium', REP_VOICE_ID: 'voice-sam' },
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

  it('builds the API URL from Render’s private host:port only when API_BASE_URL is unset', () => {
    const hostport = { ...keys, API_BASE_URL: '', API_HOSTPORT: 'cold-call-coach:10000' };
    const derived = readCallConfig(hostport);
    expect(derived.ok && derived.config.API_BASE_URL).toBe('http://cold-call-coach:10000');
    const explicit = readCallConfig({ ...hostport, API_BASE_URL: 'https://coach.example.com' });
    expect(explicit.ok && explicit.config.API_BASE_URL).toBe('https://coach.example.com');
  });

  it('says the gap is in the agent’s own settings, not the API’s', () => {
    expect(describeMissingCallConfig(['INTERNAL_API_SECRET is not set'])).toBe(
      "The voice agent's own settings are incomplete: INTERNAL_API_SECRET is not set. " +
        'Set them where the agent runs, not only on the API, and restart it.',
    );
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

  it('takes a workspace for a key that has none, by its ID and not its name', () => {
    const set = readCallConfig({ ...keys, ANTHROPIC_WORKSPACE_ID: 'wrkspc_01AbC\n' });
    expect(set.ok && set.config.ANTHROPIC_WORKSPACE_ID).toBe('wrkspc_01AbC');
    const blank = readCallConfig({ ...keys, ANTHROPIC_WORKSPACE_ID: '' });
    expect(blank.ok && blank.config.ANTHROPIC_WORKSPACE_ID).toBeUndefined();
    expect(readCallConfig({ ...keys, ANTHROPIC_WORKSPACE_ID: 'Default' })).toEqual({
      ok: false,
      problems: ['ANTHROPIC_WORKSPACE_ID must be a workspace ID, which starts with wrkspc_'],
    });
  });

  it('rejects an unknown effort level and a non-http API URL', () => {
    expect(readCallConfig({ ...keys, PROSPECT_EFFORT: 'extreme' }).ok).toBe(false);
    expect(readCallConfig({ ...keys, COACH_EFFORT: 'extreme' }).ok).toBe(false);
    expect(readCallConfig({ ...keys, API_BASE_URL: 'localhost:3000' }).ok).toBe(false);
  });
});
