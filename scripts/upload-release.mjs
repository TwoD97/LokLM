// Uploads release/*.tar.zst + .sha256 sidecars to Bunny Storage under
// /releases/v<version>/ via HTTP PUT with AccessKey auth. Per-artifact
// HEAD round-trip after the PUT verifies Content-Length matches.
//
// Env :
//   BUNNY_STORAGE_ZONE   ( required ; the zone name in the Bunny dashboard )
//   BUNNY_STORAGE_KEY    ( required ; the Storage AccessKey )
//   BUNNY_BASE_URL       ( optional ; defaults to https://storage.bunnycdn.com )

import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ALL_PLATFORMS = ['win-x64', 'linux-x64', 'mac-arm64', 'mac-x64']
const CUDA_PLATFORMS = new Set(['win-x64', 'linux-x64'])

export async function planUploads({
  releaseDir,
  version,
  zone,
  platforms,
  baseUrl = 'https://storage.bunnycdn.com',
}) {
  const plans = []
  for (const plat of platforms) {
    const payloadFile = `payload-${plat}.tar.zst`
    plans.push({
      local: join(releaseDir, payloadFile),
      urlPath: `releases/v${version}/${payloadFile}`,
    })
    plans.push({
      local: join(releaseDir, `${payloadFile}.sha256`),
      urlPath: `releases/v${version}/${payloadFile}.sha256`,
    })
    if (CUDA_PLATFORMS.has(plat)) {
      const cudaFile = `cuda-${plat}.tar.zst`
      plans.push({
        local: join(releaseDir, cudaFile),
        urlPath: `releases/v${version}/${cudaFile}`,
      })
      plans.push({
        local: join(releaseDir, `${cudaFile}.sha256`),
        urlPath: `releases/v${version}/${cudaFile}.sha256`,
      })
    }
  }
  for (const p of plans) {
    if (!existsSync(p.local)) {
      throw new Error(`upload plan : missing local file ${p.local} ( run package:<plat> first )`)
    }
    const st = await stat(p.local)
    p.sizeBytes = st.size
    p.url = `${baseUrl}/${zone}/${p.urlPath}`
  }
  return plans
}

export async function runDryRun({ releaseDir, version, zone, platforms }) {
  const plans = await planUploads({ releaseDir, version, zone, platforms })
  for (const p of plans) {
    console.log(`DRY  PUT ${p.url} ( ${(p.sizeBytes / 1024 / 1024).toFixed(2)} MB )`)
  }
  return plans
}

export async function runUpload({
  releaseDir,
  version,
  zone,
  key,
  platforms,
  fetchImpl = fetch,
}) {
  const plans = await planUploads({ releaseDir, version, zone, platforms })
  for (const p of plans) {
    const body = await readFile(p.local)
    const put = await fetchImpl(p.url, {
      method: 'PUT',
      headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
      body,
    })
    if (!put.ok) throw new Error(`PUT ${p.url} failed : ${put.status} ${put.statusText}`)

    const head = await fetchImpl(p.url, { method: 'HEAD', headers: { AccessKey: key } })
    if (!head.ok) throw new Error(`HEAD ${p.url} failed : ${head.status}`)
    const remoteSize = parseInt(head.headers.get('content-length') ?? '0', 10)
    if (remoteSize !== p.sizeBytes) {
      throw new Error(`size mismatch at ${p.url} : remote ${remoteSize} vs local ${p.sizeBytes}`)
    }
    console.log(`OK   PUT ${p.url} ( ${(p.sizeBytes / 1024 / 1024).toFixed(2)} MB )`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const platformArg = args.find((a) => a.startsWith('--platforms='))
  const platforms = platformArg
    ? platformArg.slice('--platforms='.length).split(',')
    : ALL_PLATFORMS

  const ROOT = join(__dirname, '..')
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const releaseDir = join(ROOT, 'release')

  if (dry) {
    await runDryRun({ releaseDir, version: pkg.version, zone: 'dry-run-zone', platforms })
    return
  }

  const zone = process.env.BUNNY_STORAGE_ZONE
  const key = process.env.BUNNY_STORAGE_KEY
  if (!zone || !key) {
    console.error('BUNNY_STORAGE_ZONE and BUNNY_STORAGE_KEY env vars required ( or pass --dry-run )')
    process.exit(2)
  }
  await runUpload({ releaseDir, version: pkg.version, zone, key, platforms })
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}
