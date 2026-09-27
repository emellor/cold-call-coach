import { INTERNAL_SECRET_HEADER, VOICE_ID_PLACEHOLDER, type ScenarioSpec } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { product, scenario } from './test/fixtures.ts';
import {
  ScenarioLoadError,
  cartesiaSpeed,
  chooseVoice,
  fetchScenario,
  keytermsFor,
  ttsLanguage,
} from './scenario.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchScenario', () => {
  const load = (fetchImpl: typeof fetch) =>
    fetchScenario({
      apiBaseUrl: 'http://api.test',
      secret: 's3cret-value',
      scenarioId: 'medium-finance-director',
      fetchImpl,
    });

  it('asks the internal route with the shared secret and validates the answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(json(200, { scenario, product })));
    await expect(load(fetchImpl)).resolves.toEqual({ scenario, product });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/internal/scenarios/medium-finance-director');
    expect((init?.headers as Record<string, string>)[INTERNAL_SECRET_HEADER]).toBe('s3cret-value');
  });

  it("passes on the API's own error message", async () => {
    const error = await load(() =>
      Promise.resolve(json(404, { error: 'Unknown scenario: medium-finance-director' })),
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScenarioLoadError);
    expect((error as Error).message).toBe(
      'the API answered 404 for medium-finance-director: Unknown scenario: medium-finance-director',
    );
  });

  it('names the secret when the API refuses it: the agent and the API disagree', async () => {
    const error = await load(() =>
      Promise.resolve(json(401, { error: 'Missing or wrong x-internal-secret header.' })),
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScenarioLoadError);
    expect((error as Error).message).toBe(
      "the API refused the agent's INTERNAL_API_SECRET: it must be the same value on the agent and the API",
    );
  });

  it('says when the API is unreachable', async () => {
    await expect(load(() => Promise.reject(new TypeError('fetch failed')))).rejects.toThrow(
      'could not reach the API at http://api.test (fetch failed)',
    );
  });

  it('rejects a body that is not a valid scenario', async () => {
    await expect(
      load(() => Promise.resolve(json(200, { scenario: { id: 'x' }, product }))),
    ).rejects.toThrow('invalid scenario');
  });
});

describe('chooseVoice', () => {
  const placeholder: ScenarioSpec = {
    ...scenario,
    voice: { ...scenario.voice, voiceId: VOICE_ID_PLACEHOLDER },
  };

  it("prefers the scenario's own voice", () => {
    expect(chooseVoice(scenario, 'fallback')).toEqual({ ok: true, voiceId: 'voice-123' });
  });

  it('falls back to CARTESIA_VOICE_ID while the file has the placeholder', () => {
    expect(chooseVoice(placeholder, 'fallback')).toEqual({ ok: true, voiceId: 'fallback' });
  });

  it('explains how to fix a scenario with no voice at all', () => {
    expect(chooseVoice(placeholder, undefined)).toEqual({
      ok: false,
      problem:
        'Claire Hughes has no voice yet: set CARTESIA_VOICE_ID for the agent, or voice.voiceId in scenarios/medium-finance-director.json if she is one of the shipped scenarios',
    });
  });
});

describe('keytermsFor', () => {
  it('combines the product vocabulary with her name and company, once each', () => {
    expect(keytermsFor(scenario, product)).toEqual([
      'WattGuard',
      'ESOS',
      'SECR',
      'ISO 50001',
      'half-hourly data',
      'Claire Hughes',
      'Claire',
      'Hughes',
      'Harrow & Finch Logistics',
    ]);
  });
});

describe('ttsLanguage', () => {
  it('takes the language part of the locale', () => {
    expect(ttsLanguage('en-GB')).toBe('en');
  });
});

describe('cartesiaSpeed', () => {
  it('maps presets to sonic-3 multipliers and leaves normal speed alone', () => {
    expect(cartesiaSpeed('normal')).toBeUndefined();
    expect(cartesiaSpeed('slow')).toBe(0.85);
    expect(cartesiaSpeed('fast')).toBe(1.15);
    expect(cartesiaSpeed(1.3)).toBe(1.3);
  });
});
