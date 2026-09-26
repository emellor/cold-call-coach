import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages,scenarios,scripts}/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/dist/**'],
          // Brings the test database's schema up to date when one is reachable.
          globalSetup: ['./apps/api/src/test/global-setup.ts'],
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
