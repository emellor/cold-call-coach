import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PriceTableError, readPriceTable } from './prices.ts';

describe('readPriceTable', () => {
  it('reads config/prices.json, which prices every default model', async () => {
    const prices = await readPriceTable();
    // The lanes' defaults (PLAN.md §6.5) and the voice pipeline's models.
    expect(prices.anthropic.perMillionTokens['claude-opus-5']).toBeDefined();
    expect(prices.anthropic.perMillionTokens['claude-haiku-4-5']).toBeDefined();
    expect(prices.deepgram.perMinute['nova-3']).toBeGreaterThan(0);
    expect(prices.cartesia.per1kCharacters['sonic-3']).toBeGreaterThan(0);
    expect(prices.warnAboveUsd).toBe(2);
  });

  it('refuses a malformed table, naming the bad field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prices-'));
    const file = join(dir, 'prices.json');
    await writeFile(file, JSON.stringify({ asOf: '2026-09-26', warnAboveUsd: -1 }));
    await expect(readPriceTable(file)).rejects.toThrow(PriceTableError);
    await expect(readPriceTable(file)).rejects.toThrow(/warnAboveUsd/);
    await expect(readPriceTable(join(dir, 'missing.json'))).rejects.toThrow(/Can't read/);
  });
});
