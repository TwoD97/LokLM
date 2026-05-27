// Builds installer-wizard/payload-manifest.json from the .tar.zst + .sha256
// files in release/. The wizard's Rust code include_str!s this JSON at
// compile time , so the hashes in the file are what gets baked into the
// wizard binary , and they must match exactly what gets uploaded to Bunny.
// Run AFTER package:<plat>:archive and BEFORE package:<plat>:wizard.

import { readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ALL_PLATFORMS = ['win-x64', 'linux-x64', 'mac-arm64', 'mac-x64']
const CUDA_PLATFORMS = new Set(['win-x64', 'linux-x64'])

const ZERO_SHA = '0000000000000000000000000000000000000000000000000000000000000000'

function placeholder(filename) {
  return { filename, sha256: ZERO_SHA, sizeBytes: 0 }
}

async function entry(releaseDir, filename) {
  const file = join(releaseDir, filename)
  if (!existsSync(file)) return placeholder(filename)
  const sha = (await readFile(`${file}.sha256`, 'utf8')).trim()
  const sz = (await stat(file)).size
  return { filename, sha256: sha, sizeBytes: sz }
}

// Always emit all 4 platforms ( zeros when the archive isn't on disk )
// so the wizard's compile-time `current_bundle()` lookup never panics on
// a per-target build that only produced one platform's archives. Real
// hashes appear when CI ( or a local full release build ) produces all
// platforms ; until then , a click-Install on a non-host-platform build
// would simply fail at sha verification with a clear "expected zeros"
// error rather than panicking.
export async function writePayloadManifest({ releaseDir, outFile, version, baseUrl }) {
  const platforms = {}
  for (const plat of ALL_PLATFORMS) {
    const block = { payload: await entry(releaseDir, `payload-${plat}.tar.zst`) }
    if (CUDA_PLATFORMS.has(plat)) {
      block.cuda = await entry(releaseDir, `cuda-${plat}.tar.zst`)
    }
    platforms[plat] = block
  }
  const manifest = { version, baseUrl, platforms }
  await writeFile(outFile, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

async function main() {
  const ROOT = join(__dirname, '..')
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  // baseUrl is the public-facing CDN host. Flat /v<V>/ path matches the
  // existing release-installer.yml workflow's pattern for the user-facing
  // .exe upload , so installer + payload + cuda all live in one release-
  // version folder on Bunny. CI sets LOKLM_PAYLOAD_BASE_URL to the real
  // public CDN host ( e.g. ${PUBLIC_INSTALLER_BASE_URL}/v${V} ) before
  // running this script.
  const baseUrl =
    process.env.LOKLM_PAYLOAD_BASE_URL || `https://cdn.loklm.ai/v${pkg.version}`
  await writePayloadManifest({
    releaseDir: join(ROOT, 'release'),
    outFile: join(ROOT, 'installer-wizard', 'payload-manifest.json'),
    version: pkg.version,
    baseUrl,
  })
  console.log(`payload-manifest.json written ( baseUrl ${baseUrl} )`)
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}
