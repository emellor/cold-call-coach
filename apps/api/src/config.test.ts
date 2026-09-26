import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_DATABASE_URL, loadConfig } from './config.ts';

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
});
