import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({ resolve: { alias: { '@main': resolve('src/main'), '@shared': resolve('src/shared') } }, test: { include: ['native/scripts/conflict-fixtures.test.ts'], environment: 'node' } })
