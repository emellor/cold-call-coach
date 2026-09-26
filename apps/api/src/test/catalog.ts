import { scenariosDir } from '../paths.ts';
import { readScenarioCatalog } from '../scenarios.ts';

/** The repo's real scenarios/ files, as the API loads them at boot. */
export const testCatalog = await readScenarioCatalog(scenariosDir);
