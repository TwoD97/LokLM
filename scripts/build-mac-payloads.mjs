// Builds the LokLM.app payload for both mac archs ( arm64 + x64 ).
//
// Two sequential single-arch invocations rather than one multi-arch
// `electron-builder --mac dir --arm64 --x64`. Reason : the multi-arch
// form was empirically putting the first-built arch at release/mac/
// ( unsuffixed ) and the second at release/mac-<arch>/ ( suffixed ) ,
// with no documented ordering guarantee. Single-arch invocations
// consistently output to release/mac-<arch>/ ( verified on macos-latest
// 2026-05-27 ).

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function buildArch(arch) {
  const releaseDir = join(ROOT, 'release')
  const targetDir = join(releaseDir, `mac-${arch}`)
  const stragglerMacDir = join(releaseDir, 'mac')

  // Clean previous run's output so we know what we just produced.
  // Also wipe the unsuffixed release/mac/ in case some prior code path
  // landed there ; we don't want a stale tree to confuse downstream.
  if (existsSync(targetDir)) await rm(targetDir, { recursive: true, force: true })
  if (existsSync(stragglerMacDir)) await rm(stragglerMacDir, { recursive: true, force: true })

  console.log(`\n=== electron-builder --mac dir --${arch} ===`)
  execFileSync('pnpm', ['exec', 'electron-builder', '--mac', 'dir', `--${arch}`], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  })

  // electron-builder's single-arch CLI invocation writes to the suffixed
  // release/mac-<arch>/ path directly. ( Multi-arch + multiple --arch
  // flags is what triggered the inconsistent first-arch-unsuffixed
  // behaviour we worked around by splitting. )
  if (!existsSync(targetDir)) {
    // Defensive fallback : if electron-builder ever flips back to the
    // unsuffixed path , catch it and rename so we don't silently produce
    // a release with the wrong arch bundled.
    if (existsSync(stragglerMacDir)) {
      const { rename } = await import('node:fs/promises')
      await rename(stragglerMacDir, targetDir)
      console.log(`fallback : renamed release/mac -> release/mac-${arch}`)
    } else {
      throw new Error(`electron-builder did not produce ${targetDir} ( or release/mac/ )`)
    }
  }
  console.log(`ok : ${targetDir}`)
}

async function main() {
  await buildArch('arm64')
  await buildArch('x64')
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
