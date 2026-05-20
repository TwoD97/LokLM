import { resolve } from 'node:path'
import { defineWorkspace } from 'vitest/config'

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

// vier projects:
//   - node          : unit-tests neben source unter src/main , preload , shared
//   - web           : renderer unit-tests , jsdom
//   - integration   : tests/integration/** , node env , mehrere module zusammen
//   - tx            : tests/tx/** , node env , db- und vault-round-trips
// e2e läuft NICHT über vitest sondern über playwright (tests/e2e/*.spec.ts).

export default defineWorkspace([
  {
    resolve: { alias: aliases },
    test: {
      name: 'node',
      include: ['src/main/**/*.test.ts', 'src/preload/**/*.test.ts', 'src/shared/**/*.test.ts'],
      exclude: ['src/main/services/**'],
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
    resolve: { alias: aliases },
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
  {
    resolve: { alias: aliases },
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
    resolve: { alias: aliases },
    test: {
      name: 'installer',
      include: ['tests/installer/export.test.ts', 'tests/installer/artifact.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  },
])
