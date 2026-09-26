// The price table (config/prices.json), read once per call to price the
// call's usage and to warn when it passes the warning line.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PriceTable } from '@ccc/contracts';

export const pricesFile = fileURLToPath(new URL('../../../config/prices.json', import.meta.url));

/** The table, or why it couldn't be read. A call goes ahead either way, unpriced. */
export async function readPriceTable(
  path = pricesFile,
): Promise<{ ok: true; prices: PriceTable } | { ok: false; problem: string }> {
  try {
    const parsed = PriceTable.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (parsed.success) return { ok: true, prices: parsed.data };
    return {
      ok: false,
      problem: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
}
