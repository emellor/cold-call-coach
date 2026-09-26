import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
export const webDistDir = fileURLToPath(new URL('../../web/dist/', import.meta.url));
