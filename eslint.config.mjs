// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'prototypes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Allow the standard `_`-prefixed convention for intentionally-unused
      // identifiers (mirrors TypeScript's `noUnusedLocals` / `noUnusedParameters`
      // handling). Used in mock factories, signature placeholders, etc.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Node script files (REPL CLIs, fixture-capture helpers) run in node, not
    // the browser — `console` / `process` are globals there. Files under
    // `**/scripts/**` and `**/bin/**` are invoked via `node …` directly.
    files: ['**/scripts/**/*.{js,mjs,cjs}', '**/bin/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
