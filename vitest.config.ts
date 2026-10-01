import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

// integration + tx run in a plain Node context. CI has no Electron binary, so a
// static `import { … } from 'electron'` (e.g. EmbeddingBackfillService) blows up
// at collection time with "ENOENT … electron/path.txt". These suites never need
// the real runtime, so resolve `electron` to a stub that mirrors how electron
// already behaves under vitest (all bindings undefined), minus the binary lookup.
const nodeMainAliases = {
  ...aliases,
  electron: resolve(__dirname, 'tests/helpers/electron-stub.ts'),
}

// All unit projects run through `pnpm test:unit`; database suites have separate
// commands because their native SQLite binding must match the test runtime.
// Electron end-to-end tests run through Playwright instead.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'node',
          include: ['src/main/**/*.test.ts', 'src/preload/**/*.test.ts', 'src/shared/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'web',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/renderer/src/setupTests.ts'],
          globals: false,
        },
      },
      {
        resolve: { alias: nodeMainAliases },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias: nodeMainAliases },
        test: {
          name: 'tx',
          include: ['tests/tx/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'wizard-frontend',
          include: ['installer-wizard/frontend/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'scripts',
          include: ['tests/unit/scripts/**/*.test.mjs'],
          environment: 'node',
        },
      },
    ],
  },
})
