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
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The mac translator is CPU-only , but BOTH arch payloads build on a single
// arm64 runner from one extraResources source ( sidecars/translator/dist ).
// Stage the arch-matching prebuilt binary into dist/ right before each
// electron-builder run so the arm64 .app gets the arm64 binary and the x64 .app
// gets the x64 one — otherwise both arches would ship whichever binary happened
// to be in dist/ ( an arm64 binary inside an Intel .app simply won't run ).
// The release workflow fetches these into dist-mac-<arch>/. On a dev box they're
// usually absent , so dist/ is left as-is ( a locally-built binary still ships ).
async function stageSidecar(arch) {
  const src = join(ROOT, 'sidecars', 'translator', `dist-mac-${arch}`)
  const dist = join(ROOT, 'sidecars', 'translator', 'dist')
  let names = []
  try {
    names = await readdir(src)
  } catch {
    names = []
  }
  if (names.length === 0) {
    // This arch has no prebuilt. CRITICAL: dist/ is NOT necessarily empty here —
    // the arm64 pass runs first and leaves the arm64 binary in dist/. If we left
    // it as-is , electron-builder would bundle the arm64 binary into the Intel
    // .app ( and vice-versa ) → a sidecar that can't exec ( 'Bad CPU type' ).
    // Detect CI ( the release fetch always `mkdir -p`s BOTH dist-mac-* dirs ) by
    // the presence of the OTHER arch's dir : if it exists , wipe dist/ so no
    // foreign-arch binary can leak — that arch simply ships without translation.
    const otherArch = arch === 'arm64' ? 'x64' : 'arm64'
    const ciRun = existsSync(join(ROOT, 'sidecars', 'translator', `dist-mac-${otherArch}`))
    if (ciRun) {
      await rm(dist, { recursive: true, force: true })
      await mkdir(dist, { recursive: true })
      console.warn(
        `[mac-payloads] dist-mac-${arch}/ missing/empty but dist-mac-${otherArch}/ exists ` +
          `( CI ) — wiped dist/ so the ${otherArch} binary can't leak into the mac-${arch} ` +
          `.app; mac-${arch} ships WITHOUT translation.`,
      )
      return
    }
    // True dev box ( no per-arch dirs at all ): leave any locally-built dist/
    // as-is , just guarantee the dir exists so extraResources doesn't error.
    await mkdir(dist, { recursive: true })
    console.warn(
      `[mac-payloads] no dist-mac-* prebuilts ( dev box ) — leaving sidecars/translator/dist/ ` +
        `as-is for mac-${arch}.`,
    )
    return
  }
  // Reset dist/ to exactly this arch's binary so the other arch's binary can't
  // leak into the wrong .app.
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  for (const n of names) {
    await cp(join(src, n), join(dist, n), { recursive: true })
  }
  console.log(`staged ${names.length} translator file(s) from dist-mac-${arch}/ -> dist/`)
}

async function buildArch(arch) {
  const releaseDir = join(ROOT, 'release')
  const targetDir = join(releaseDir, `mac-${arch}`)
  const stragglerMacDir = join(releaseDir, 'mac')

  // Clean previous run's output so we know what we just produced.
  // Also wipe the unsuffixed release/mac/ in case some prior code path
  // landed there ; we don't want a stale tree to confuse downstream.
  if (existsSync(targetDir)) await rm(targetDir, { recursive: true, force: true })
  if (existsSync(stragglerMacDir)) await rm(stragglerMacDir, { recursive: true, force: true })

  // Put the arch-matching CPU translator into dist/ so extraResources bundles it.
  await stageSidecar(arch)

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
