import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEV_DATABASE_URL,
  DEV_INTERNAL_API_SECRET,
  liveKitConfig,
  loadConfig,
} from './config.ts';

describe('loadConfig', () => {
  it('applies defaults and falls back to the docker-compose database outside production', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: DEV_DATABASE_URL,
    });
  });

  it('coerces PORT from the environment string', () => {
    expect(loadConfig({ PORT: '4100' }).PORT).toBe(4100);
  });

  it('requires DATABASE_URL in production and names it in the error', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrowError(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrowError(/DATABASE_URL/);
  });

  it('rejects a non-postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrowError(/postgres:\/\//);
  });

  it('takes INTERNAL_API_SECRET when set, treating a blank line as unset', () => {
    expect(loadConfig({ INTERNAL_API_SECRET: DEV_INTERNAL_API_SECRET }).INTERNAL_API_SECRET).toBe(
      DEV_INTERNAL_API_SECRET,
    );
    expect(loadConfig({ INTERNAL_API_SECRET: '' }).INTERNAL_API_SECRET).toBeUndefined();
    expect(() => loadConfig({ INTERNAL_API_SECRET: 'short' })).toThrowError(/16 characters/);
  });

  it('reviews on Opus 5.5 at high effort unless told otherwise', () => {
    const config = loadConfig({ REVIEW_MODEL: '', REVIEW_EFFORT: '', ANTHROPIC_API_KEY: '' });
    expect(config).toMatchObject({ REVIEW_MODEL: 'claude-opus-5-5', REVIEW_EFFORT: 'high' });
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadConfig({ REVIEW_EFFORT: 'max' }).REVIEW_EFFORT).toBe('max');
    expect(() => loadConfig({ REVIEW_EFFORT: 'extreme' })).toThrowError(/REVIEW_EFFORT/);
  });

  it('takes a workspace for a key that has none, by its ID and not its name', () => {
    expect(loadConfig({ ANTHROPIC_WORKSPACE_ID: ' wrkspc_01AbC\n' }).ANTHROPIC_WORKSPACE_ID).toBe(
      'wrkspc_01AbC',
    );
    expect(loadConfig({ ANTHROPIC_WORKSPACE_ID: '' }).ANTHROPIC_WORKSPACE_ID).toBeUndefined();
    expect(() => loadConfig({ ANTHROPIC_WORKSPACE_ID: 'Default' })).toThrowError(
      /ANTHROPIC_WORKSPACE_ID: must be a workspace ID, which starts with wrkspc_/,
    );
  });

  it("refuses .env.example's development secret in production", () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://db/coach',
      APP_PASSWORD: 'correct horse battery',
    };
    expect(() =>
      loadConfig({ ...production, INTERNAL_API_SECRET: DEV_INTERNAL_API_SECRET }),
    ).toThrowError(/INTERNAL_API_SECRET: is the development value/);
    expect(
      loadConfig({ ...production, INTERNAL_API_SECRET: 'a'.repeat(64) }).INTERNAL_API_SECRET,
    ).toHaveLength(64);
  });

  it('requires a password in production, and a secret to sign its sessions with', () => {
    const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/coach' };
    expect(() => loadConfig({ ...production, INTERNAL_API_SECRET: 'a'.repeat(64) })).toThrowError(
      /APP_PASSWORD: is required in production/,
    );
    expect(() => loadConfig({ ...production, APP_PASSWORD: 'correct horse battery' })).toThrowError(
      /INTERNAL_API_SECRET: is required with APP_PASSWORD/,
    );
    expect(() => loadConfig({ APP_PASSWORD: 'short' })).toThrowError(
      /APP_PASSWORD: must be at least 8 characters/,
    );
    // Locally there is no sign-in unless a password is set.
    expect(loadConfig({}).APP_PASSWORD).toBeUndefined();
  });
});

describe('liveKitConfig', () => {
  it('returns the settings when all three are present', () => {
    const config = loadConfig({
      LIVEKIT_URL: 'wss://x.livekit.cloud',
      LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 's',
    });
    expect(liveKitConfig(config)).toEqual({
      url: 'wss://x.livekit.cloud',
      apiKey: 'k',
      apiSecret: 's',
    });
  });

  it('names the missing ones, treating blank .env lines as unset', () => {
    const config = loadConfig({ LIVEKIT_URL: '', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: '' });
    expect(liveKitConfig(config)).toEqual({
      problem: 'set LIVEKIT_URL, LIVEKIT_API_SECRET on the API.',
    });
  });

  it('drops the space or newline a pasted value brings with it', () => {
    const config = loadConfig({
      LIVEKIT_URL: ' wss://x.livekit.cloud\n',
      LIVEKIT_API_KEY: 'k ',
      LIVEKIT_API_SECRET: '\ts\n',
      ANTHROPIC_API_KEY: '   ',
    });
    expect(liveKitConfig(config)).toEqual({
      url: 'wss://x.livekit.cloud',
      apiKey: 'k',
      apiSecret: 's',
    });
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('refuses a room token from "Generate Token" as the secret, saying where the secret is', () => {
    const config = loadConfig({
      LIVEKIT_URL: 'wss://x.livekit.cloud',
      LIVEKIT_API_KEY: 'APIaB3cD4eF5gH6',
      LIVEKIT_API_SECRET: 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJBUEkifQ.c2ln',
    });
    const result = liveKitConfig(config);
    expect('problem' in result && result.problem).toMatch(
      /is a room token.*shows a secret only once/,
    );
  });
});
