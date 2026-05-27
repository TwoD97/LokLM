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

async function entry(releaseDir, filename) {
  const file = join(releaseDir, filename)
  if (!existsSync(file)) return null
  const sha = (await readFile(`${file}.sha256`, 'utf8')).trim()
  const sz = (await stat(file)).size
  return { filename, sha256: sha, sizeBytes: sz }
}

export async function writePayloadManifest({ releaseDir, outFile, version, baseUrl }) {
  const platforms = {}
  for (const plat of ALL_PLATFORMS) {
    const payload = await entry(releaseDir, `payload-${plat}.tar.zst`)
    if (!payload) continue
    const block = { payload }
    if (CUDA_PLATFORMS.has(plat)) {
      const cuda = await entry(releaseDir, `cuda-${plat}.tar.zst`)
      if (cuda) block.cuda = cuda
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
  // baseUrl is the public-facing CDN host. Configurable via env so a CI
  // can point at a staging zone when generating a test wizard build.
  const baseUrl =
    process.env.LOKLM_PAYLOAD_BASE_URL || `https://cdn.loklm.ai/releases/v${pkg.version}`
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
