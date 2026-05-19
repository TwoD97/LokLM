#!/usr/bin/env node
// Pre-package guard: assert the bundled GGUFs exist on the build server's
// local `models/` directory. We never auto-download in the build pipeline —
// the build server has the models pre-staged (see project memory).
//
// Fail loudly + early so a missed download doesn't ship a broken installer.

import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const REQUIRED = [
  { path: 'models/bge-m3-Q4_K_M.gguf', minMB: 400, fix: 'pnpm models:embedder' },
  { path: 'models/Qwen_Qwen3-8B-Q4_K_M.gguf', minMB: 4000, fix: 'pnpm models:medium' },
]

let failed = false
for (const m of REQUIRED) {
  const abs = join(ROOT, m.path)
  if (!existsSync(abs)) {
    console.error(`✗ Missing: ${m.path}`)
    console.error(`  Run: ${m.fix}`)
    failed = true
    continue
  }
  const mb = statSync(abs).size / 1024 / 1024
  if (mb < m.minMB) {
    console.error(`✗ ${m.path} is only ${mb.toFixed(0)} MB (expected ≥${m.minMB} MB)`)
    console.error(`  Partial download? Re-run: ${m.fix}`)
    failed = true
    continue
  }
  console.log(`✓ ${m.path} (${mb.toFixed(0)} MB)`)
}

if (failed) {
  console.error('')
  console.error('Bundled models missing or incomplete. Aborting package step.')
  process.exit(1)
}
console.log('All bundled models verified.')
