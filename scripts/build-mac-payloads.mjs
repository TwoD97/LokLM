// Builds one native-architecture LokLM.app payload. Release CI combines archives
// from separate Intel/Apple Silicon runners; host-built native addons cannot be
// reused for the other architecture when electron-builder npmRebuild is disabled.
//
// Explicit single-architecture output avoids electron-builder's ambiguous
// unsuffixed directory when multiple architectures are requested together.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMacApp } from './verify-mac-architecture.mjs'

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
  const arch = process.argv[2] || process.arch
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || arch !== process.arch) {
    throw new Error('Build each Mac payload on a native runner of the requested architecture')
  }
  // Also cover packaging after an install that explicitly skipped lifecycle scripts.
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-whisper-mac.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  await buildArch(arch)
  const app = join(ROOT, 'release', `mac-${arch}`, 'LokLM.app')
  await verifyMacApp(app, arch)
  // Preserve the existing unsigned/ad-hoc distribution posture, but perform
  // this at build time. Installers must not replace publisher signatures or
  // remove quarantine. Developer ID signing/notarization remains a separate gate.
  execFileSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      join(ROOT, 'resources', 'entitlements.mac.plist'),
      app,
    ],
    { stdio: 'inherit' },
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
