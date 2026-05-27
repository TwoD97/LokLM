// Builds the LokLM.app payload for both mac archs ( arm64 + x64 ) and
// normalises the output paths so build-payload-archive.mjs finds them at
// predictable release/mac-<arch>/LokLM.app.
//
// Why this wrapper exists :
//   electron-builder's multi-arch behaviour when invoked as
//   `electron-builder --mac dir --arm64 --x64` is to put the FIRST arch
//   it builds at release/mac/ ( unsuffixed ) and subsequent archs at
//   release/mac-<arch>/ ( suffixed ). The "first arch" isn't documented
//   to be deterministic and empirically can be x64-first ; that breaks
//   build-payload-archive's hard-coded release/mac-x64/LokLM.app path.
//
//   Running one arch per invocation + renaming release/mac to
//   release/mac-<arch> after each gives us both bundles at predictable
//   paths regardless of electron-builder's internal arch ordering.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function buildArch(arch) {
  const releaseDir = join(ROOT, 'release')
  const macDir = join(releaseDir, 'mac')
  const targetDir = join(releaseDir, `mac-${arch}`)

  // Clean both possible output dirs so a previous run's leftover doesn't
  // get mis-renamed. Specifically , if release/mac exists from a prior
  // arch's build , electron-builder would NOT delete it — it'd just write
  // alongside and we'd rename the wrong one.
  if (existsSync(macDir)) await rm(macDir, { recursive: true, force: true })
  if (existsSync(targetDir)) await rm(targetDir, { recursive: true, force: true })

  console.log(`\n=== electron-builder --mac dir --${arch} ===`)
  execFileSync('pnpm', ['exec', 'electron-builder', '--mac', 'dir', `--${arch}`], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  })

  // After a single-arch build , electron-builder always uses the unsuffixed
  // release/mac/ output dir. Rename to release/mac-<arch>/ so downstream
  // scripts find it at the expected per-arch path.
  if (!existsSync(macDir)) {
    throw new Error(`electron-builder did not produce ${macDir}`)
  }
  await rename(macDir, targetDir)
  console.log(`renamed release/mac -> release/mac-${arch}`)
}

async function main() {
  await buildArch('arm64')
  await buildArch('x64')
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
