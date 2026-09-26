import { describe, expect, it } from 'vitest';
import { readConfig } from './config.ts';

describe('agent readConfig', () => {
  it('accepts a complete LiveKit configuration', () => {
    const result = readConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(result.ok).toBe(true);
  });

  it('names every missing variable instead of throwing', () => {
    const result = readConfig({});
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
    const result = readConfig({
      LIVEKIT_URL: 'https://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
    });
    expect(result.ok).toBe(false);
  });
});
