import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

/** The tests that run against a real Postgres (CLAUDE.md, Tests). */
const DATABASE_TESTS = ['{apps,packages,scenarios,scripts}/**/*.{route,db}.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages,scenarios,scripts}/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/dist/**', ...DATABASE_TESTS],
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: DATABASE_TESTS,
          exclude: [...configDefaults.exclude, '**/dist/**'],
          // Brings the test database's schema up to date when one is reachable.
          globalSetup: ['./apps/api/src/test/global-setup.ts'],
          // One database for every file, so one file at a time: a prospect the
          // scenarios tests add and remove must not land in the demos tests' batch.
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['{apps,packages}/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, '**/dist/**'],
          setupFiles: ['./vitest.setup.jsdom.ts'],
        },
      },
    ],
  },
});
