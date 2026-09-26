import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scenariosDir } from './paths.ts';
import { ScenarioFilesError, readScenarioCatalog } from './scenarios.ts';

describe('readScenarioCatalog', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccc-scenarios-'));
    await cp(scenariosDir, dir, { recursive: true });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const edit = async (file: string, change: (json: Record<string, unknown>) => void) => {
    const path = join(dir, file);
    const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    change(json);
    await writeFile(path, JSON.stringify(json));
  };

  it('loads the repo scenarios, product and rubric', async () => {
    const catalog = await readScenarioCatalog(scenariosDir);
    expect(catalog.scenarios.map((s) => s.id).sort()).toEqual([
      'easy-ops-manager',
      'hard-facilities-manager',
      'medium-finance-director',
    ]);
    expect(catalog.product.name).toBe('WattGuard');
    expect(catalog.rubrics.map((r) => r.id)).toEqual(['cold-call-v1']);
  });

  it('names the file and field of a schema problem', async () => {
    await edit('hard-facilities-manager.json', (json) => {
      (json.state as Record<string, unknown>).patience = 'lots';
    });
    const error = await readScenarioCatalog(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScenarioFilesError);
    expect((error as Error).message).toContain('hard-facilities-manager.json: state.patience');
  });

  it('names a file that is not JSON', async () => {
    await writeFile(join(dir, 'product.json'), '{ nope');
    await expect(readScenarioCatalog(dir)).rejects.toThrow(/product\.json/);
  });

  it('rejects a rubric reference that does not resolve', async () => {
    await edit('easy-ops-manager.json', (json) => {
      json.rubricId = 'cold-call-v9';
    });
    await expect(readScenarioCatalog(dir)).rejects.toThrow(
      'easy-ops-manager.json: rubricId no rubric with id "cold-call-v9"',
    );
  });

  it('rejects a file not named after its id', async () => {
    await cp(join(dir, 'easy-ops-manager.json'), join(dir, 'easy-copy.json'));
    await rm(join(dir, 'easy-ops-manager.json'));
    await expect(readScenarioCatalog(dir)).rejects.toThrow(
      'easy-copy.json holds id "easy-ops-manager"',
    );
  });
});
