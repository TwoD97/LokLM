#!/usr/bin/env node
// Use the runtime matching the installed SQLite binding. `pnpm install`
// prepares Electron's ABI for development; CI may rebuild the binding for Node.
// Tests should not force a rebuild that breaks the next app launch.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const cwd = fileURLToPath(new URL('..', import.meta.url))
const requested = process.env.LOKLM_TEST_RUNTIME ?? 'auto'
if (!['auto', 'node', 'electron'].includes(requested)) {
  throw new Error('LOKLM_TEST_RUNTIME must be auto, node or electron')
}

const probe =
  'const DB=require("better-sqlite3-multiple-ciphers"); const db=new DB(":memory:"); db.close()'
const nodeEnv = { ...process.env }
delete nodeEnv.ELECTRON_RUN_AS_NODE
const nodeWorks =
  requested !== 'electron' &&
  spawnSync(process.execPath, ['-e', probe], {
    cwd,
    env: nodeEnv,
    stdio: 'pipe',
    timeout: 15_000,
  }).status === 0
if (requested === 'node' && !nodeWorks) {
  throw new Error(
    'SQLite is not built for Node. Use the default automatic runtime, or rebuild it with pnpm rebuild better-sqlite3-multiple-ciphers.',
  )
}
const executable = nodeWorks ? process.execPath : require('electron')
const env = nodeWorks ? nodeEnv : { ...nodeEnv, ELECTRON_RUN_AS_NODE: '1' }
if (
  !nodeWorks &&
  spawnSync(executable, ['-e', probe], { cwd, env, stdio: 'pipe', timeout: 15_000 }).status !== 0
) {
  throw new Error(
    'SQLite could not load in Node or Electron. Run pnpm install to restore the development dependencies.',
  )
}
console.log(`[tests] ${nodeWorks ? 'Node' : 'Electron as Node'} runtime (native modules unchanged)`)
const vitestPackage = require.resolve('vitest/package.json')
const vitestBin = resolve(dirname(vitestPackage), require(vitestPackage).bin.vitest)
const child = spawn(executable, [vitestBin, ...process.argv.slice(2)], {
  cwd,
  env,
  stdio: 'inherit',
  windowsHide: true,
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
