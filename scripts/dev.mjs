#!/usr/bin/env node
// Run the same model bundle as the installer. Plain dev uses the balanced
// Standard tier; --lite / --standard / --pro override it explicitly.
// Reuse verified installed files, and resume/verify downloads before launch.
import { spawn } from 'node:child_process'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT, provisionRuntimeModels } from './lib/model-provisioning.mjs'

const TIER_FLAGS = { '--lite': 'lite', '--standard': 'standard', '--pro': 'pro' }
let tier = process.env.LOKLM_TIER || (totalmem() < 16 * 1024 ** 3 ? 'lite' : 'standard')
const passthrough = []
for (const arg of process.argv.slice(2)) {
  if (arg in TIER_FLAGS) tier = TIER_FLAGS[arg]
  else passthrough.push(arg)
}
if (!['lite', 'standard', 'pro'].includes(tier)) {
  throw new Error('LOKLM_TIER must be lite, standard or pro.')
}
console.log(`[dev] ${tier} model bundle`)
await provisionRuntimeModels(tier)
const env = { ...process.env, LOKLM_TIER: tier }
// Some Electron-based editors export this for their helpers; the dev app is a GUI.
delete env.ELECTRON_RUN_AS_NODE
const viteBin = join(REPO_ROOT, 'node_modules/electron-vite/bin/electron-vite.js')
const child = spawn(process.execPath, [viteBin, 'dev', ...passthrough], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env,
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
