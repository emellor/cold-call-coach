// @ts-check
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = [...new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))];

const PURE_CORE = 'packages/core is pure logic';

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', 'coverage/', 'apps/web/public/']),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './packages/*/tsconfig.json',
          './apps/api/tsconfig.json',
          './apps/agent/tsconfig.json',
          './apps/web/tsconfig.json',
          './apps/web/tsconfig.node.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'apps/api/**/*.ts',
      'apps/agent/**/*.ts',
      'scenarios/**/*.ts',
      'scripts/**/*.ts',
      '*.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  // apps/web: browser code. It may import @ccc/contracts for wire shapes, never
  // @ccc/core: analysis runs server-side and reaches the client over the wire.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ccc/core', '@ccc/core/*', '**/packages/core', '**/packages/core/**'],
              message:
                'apps/web must not import packages/core; it consumes results through the API or agent.',
            },
          ],
        },
      ],
    },
  },

  // packages/core: no I/O, no Node built-ins, no React, and no workspace
  // package except @ccc/contracts.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: `${PURE_CORE}: no Node built-ins.`,
          })),
          patterns: [
            { group: ['node:*'], message: `${PURE_CORE}: no Node built-ins.` },
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: `${PURE_CORE}: no React.`,
            },
            {
              group: ['@ccc/*', '!@ccc/contracts'],
              message: `${PURE_CORE}: the only workspace import allowed is @ccc/contracts.`,
            },
            {
              group: ['../../*', '**/apps/**'],
              message: `${PURE_CORE}: do not reach into other packages by path.`,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: `${PURE_CORE}: no dynamic import().` },
      ],
    },
  },
]);
