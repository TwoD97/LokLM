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
      '.tsbuildinfo-*/**',
      'public/**',
      'drizzle/**',
      '**/*.d.ts',
      // Excluded from AP-1.1 typecheck/lint; AP-2.1 brings these back.
      'src/main/services/**',
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
      '*.{ts,js}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
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
