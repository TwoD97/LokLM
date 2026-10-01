import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'coverage/**',
      'docs/api/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/.playwright-report/**',
      '**/.astro/**',
      'installer-wizard/src-tauri/target/**',
      'sidecars/**/build/**',
      '_reference/**',
      '.tsbuildinfo-*/**',
      'public/**',
      'drizzle/**',
      '**/*.d.ts',
      // Local benchmark / diagnostic probes run via tsx (loose by nature —
      // `any`, console logging); dev tooling, not shipped code.
      'tests/bench/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-aware rules for our own .ts/.tsx
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Node globals for main/preload/shared/scripts/configs
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'scripts/**/*.{js,mjs,cjs,ts}',
      'tests/**/*.{js,mjs,cjs,ts}',
      '*.{ts,js,mjs,cjs}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    files: ['installer-wizard/frontend/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The installer dictionary also exports through CommonJS for unit tests.
    files: ['installer-wizard/frontend/i18n.js'],
    languageOptions: { globals: { module: 'readonly' } },
  },

  // Browser globals + React rules for renderer
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // react-jsx runtime
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Tests can be a bit looser
  {
    files: ['**/*.test.{ts,tsx}', '**/setupTests.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  prettier,
)
