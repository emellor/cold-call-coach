// The price table (config/prices.json): every cost the app shows is priced from it.
import { readFile } from 'node:fs/promises';
import { PriceTable } from '@ccc/contracts';
import { pricesFile } from './paths.ts';

export class PriceTableError extends Error {
  override name = 'PriceTableError';
}

/** Reads and validates the price table; a missing or malformed file stops the boot. */
export async function readPriceTable(path = pricesFile): Promise<PriceTable> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new PriceTableError(
      `Can't read the price table ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = PriceTable.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new PriceTableError(`The price table ${path} is invalid:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
