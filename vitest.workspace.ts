import { resolve } from 'node:path'
import { defineWorkspace } from 'vitest/config'

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

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
])
