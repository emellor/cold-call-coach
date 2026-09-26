import { describe, expect, it } from 'vitest';
import { readPriceTable } from './prices.ts';

describe('readPriceTable (agent)', () => {
  it('reads config/prices.json, which prices the voice pipeline’s models', async () => {
    const result = await readPriceTable();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prices.deepgram.perMinute['nova-3']).toBeGreaterThan(0);
    expect(result.prices.cartesia.per1kCharacters['sonic-3']).toBeGreaterThan(0);
  });

  it('reports a missing table instead of failing the call', async () => {
    const result = await readPriceTable('/nonexistent/prices.json');
    expect(result).toMatchObject({ ok: false });
  });
});
