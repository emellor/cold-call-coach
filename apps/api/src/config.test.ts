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

  it("refuses .env.example's development secret in production", () => {
    const production = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/coach' };
    expect(() =>
      loadConfig({ ...production, INTERNAL_API_SECRET: DEV_INTERNAL_API_SECRET }),
    ).toThrowError(/INTERNAL_API_SECRET: is the development value/);
    expect(
      loadConfig({ ...production, INTERNAL_API_SECRET: 'a'.repeat(64) }).INTERNAL_API_SECRET,
    ).toHaveLength(64);
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
    expect(liveKitConfig(config)).toEqual({ missing: ['LIVEKIT_URL', 'LIVEKIT_API_SECRET'] });
  });
});
