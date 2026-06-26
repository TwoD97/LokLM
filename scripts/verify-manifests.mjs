// Release gate : verify that every artifact the wizard expects is actually
// reachable at its published URL with the right size ( and sha256 where the
// manifest pins one ). Catches the two failure modes that shipped broken
// installers in the past :
//
//   1. A model referenced by model-manifest.json was never uploaded to the
//      bucket ( e.g. the Qwen3-Embedding GGUF 404'd on every install because
//      models/ is populated by hand and one file was missed ).
//   2. The payload / cuda archive bytes in the bucket drifted from the
//      sha256 baked into the wizard ( the manifest is regenerated per build
//      via write-payload-manifest.mjs , so a stale or overwrite-in-place
//      upload makes the wizard's compile-time hash reject the download at
//      install with "sha256 mismatch" ).
//
// Usage :
//   node scripts/verify-manifests.mjs payload <plat> [<plat> ...]   # fresh build : archives vs baked manifest
//   node scripts/verify-manifests.mjs models [--deep]               # every model URL reachable + correct
//   node scripts/verify-manifests.mjs all [--deep]                  # both
//
// Exit code is non-zero when any FATAL check fails. Failures on hosts we
// don't control ( HuggingFace , GitHub releases ) are WARN-only so a
// transient upstream blip can't fail our release ; failures on our own S3
// host are FATAL ( we just uploaded those — they must be right ).

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const WIZ = join(ROOT, 'installer-wizard')

const ZERO_SHA = '0'.repeat(64)
// Our own object store. Failures here are fatal ; everywhere else is a warning.
const S3_HOST = process.env.LOKLM_S3_HOST || 's3.ltwodl.com'
// Above this, non-deep mode size-checks only ( a full streamed sha over a
// multi-GB GGUF on every release is wasteful ). --deep hashes everything.
const SHA_CAP_BYTES = 800 * 1024 * 1024

// ---- pure helpers ( unit-tested ) ---------------------------------------

export function isFatalHost(url, s3Host = S3_HOST) {
  try {
    return new URL(url).host === s3Host
  } catch {
    return false
  }
}

// Decide the verdict for a reachability/size probe. `totalSize` is the
// server-reported byte count ( null when the server didn't expose one ).
export function verdictForProbe({ status, totalSize, expectedSize }) {
  if (status === null) return { ok: false, reason: 'unreachable' }
  if (status === 404) return { ok: false, reason: 'HTTP 404 — object missing' }
  if (status >= 400) return { ok: false, reason: `HTTP ${status}` }
  if (typeof expectedSize === 'number' && expectedSize > 0 && typeof totalSize === 'number') {
    if (totalSize !== expectedSize) {
      return { ok: false, reason: `size ${totalSize} != manifest ${expectedSize}` }
    }
  }
  return { ok: true, reason: 'ok' }
}

// ---- network ------------------------------------------------------------

// Reachability + total size. HEAD first ; fall back to a 1-byte ranged GET
// when the server hides Content-Length on HEAD ( some CDN edges do ).
async function probe(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    const cl = head.headers.get('content-length')
    if (head.status < 400 && cl != null) {
      return { status: head.status, totalSize: Number(cl) }
    }
    if (head.status >= 400) {
      // Some stores answer HEAD with 405 but GET fine — retry with a ranged GET.
      const g = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' })
      return { status: g.status === 206 ? 200 : g.status, totalSize: totalFromContentRange(g) }
    }
    return { status: head.status, totalSize: cl == null ? null : Number(cl) }
  } catch {
    return { status: null, totalSize: null }
  }
}

function totalFromContentRange(res) {
  const cr = res.headers.get('content-range') // "bytes 0-0/12345"
  if (cr && cr.includes('/')) {
    const n = Number(cr.split('/').pop())
    return Number.isFinite(n) ? n : null
  }
  const cl = res.headers.get('content-length')
  return cl == null ? null : Number(cl)
}

async function sha256(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const hash = createHash('sha256')
  for await (const chunk of Readable.fromWeb(res.body)) hash.update(chunk)
  return hash.digest('hex')
}

// ---- checks -------------------------------------------------------------

const results = []
function record(name, url, ok, reason, fatal) {
  results.push({ name, url, ok, reason, fatal })
  const tag = ok ? 'OK  ' : fatal ? 'FAIL' : 'WARN'
  console.log(`  [${tag}] ${name} — ${reason}`)
  if (!ok) console.log(`         ${url}`)
}

async function checkEntry({ name, url, sha256: expSha, expectedSize, deep }) {
  const fatal = isFatalHost(url)
  const { status, totalSize } = await probe(url)
  const v = verdictForProbe({ status, totalSize, expectedSize })
  if (!v.ok) return record(name, url, false, v.reason, fatal)

  const pinned = expSha && expSha !== ZERO_SHA
  const wantSha = pinned && (deep || (totalSize ?? expectedSize ?? Infinity) <= SHA_CAP_BYTES)
  if (wantSha) {
    try {
      const actual = await sha256(url)
      if (actual.toLowerCase() !== expSha.toLowerCase()) {
        return record(name, url, false, `sha256 ${actual.slice(0, 12)}… != manifest ${expSha.slice(0, 12)}…`, fatal)
      }
      return record(name, url, true, 'ok ( sha verified )', fatal)
    } catch (e) {
      return record(name, url, false, `sha fetch failed : ${e.message}`, fatal)
    }
  }
  record(name, url, true, pinned ? 'ok ( size only — sha skipped, use --deep )' : 'ok ( size only )', fatal)
}

async function checkModels(deep) {
  const m = JSON.parse(await readFile(join(WIZ, 'model-manifest.json'), 'utf8'))
  const entries = [...(m.common ?? [])]
  for (const bundle of Object.values(m.tiers ?? {})) entries.push(...(bundle.models ?? []))
  const seen = new Set()
  console.log(`\nmodels ( model-manifest.json v${m.version} ) :`)
  for (const e of entries) {
    if (seen.has(e.url)) continue
    seen.add(e.url)
    await checkEntry({ name: e.id, url: e.url, sha256: e.sha256, expectedSize: e.sizeBytes, deep })
  }
}

async function checkPayload(platforms) {
  const m = JSON.parse(await readFile(join(WIZ, 'payload-manifest.json'), 'utf8'))
  console.log(`\npayload ( payload-manifest.json v${m.version} , baseUrl ${m.baseUrl} ) :`)
  for (const plat of platforms) {
    const block = m.platforms?.[plat]
    if (!block) {
      record(`${plat}/payload`, '(none)', false, `platform '${plat}' missing from manifest`, true)
      continue
    }
    for (const kind of ['payload', 'cuda']) {
      const a = block[kind]
      if (!a) continue
      if (a.sha256 === ZERO_SHA || a.sizeBytes === 0) {
        console.log(`  [SKIP] ${plat}/${kind} — zero placeholder ( archive not built on this runner )`)
        continue
      }
      await checkEntry({
        name: `${plat}/${kind} (${a.filename})`,
        url: `${m.baseUrl}/${a.filename}`,
        sha256: a.sha256,
        expectedSize: a.sizeBytes,
        deep: true, // archives are small enough to always sha-verify
      })
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const deep = argv.includes('--deep')
  const positional = argv.filter((a) => !a.startsWith('--'))
  const mode = positional[0] || 'all'

  if (mode === 'payload') {
    const plats = positional.slice(1)
    if (!plats.length) throw new Error('payload mode needs at least one platform, e.g. win-x64')
    await checkPayload(plats)
  } else if (mode === 'models') {
    await checkModels(deep)
  } else if (mode === 'all') {
    const m = JSON.parse(await readFile(join(WIZ, 'payload-manifest.json'), 'utf8'))
    const plats = Object.keys(m.platforms ?? {}).filter((p) => {
      const b = m.platforms[p]
      return b.payload?.sha256 !== ZERO_SHA && b.payload?.sizeBytes > 0
    })
    await checkPayload(plats)
    await checkModels(deep)
  } else {
    throw new Error(`unknown mode '${mode}' ( expected payload | models | all )`)
  }

  const fails = results.filter((r) => !r.ok && r.fatal)
  const warns = results.filter((r) => !r.ok && !r.fatal)
  console.log(
    `\nsummary : ${results.filter((r) => r.ok).length} ok , ${warns.length} warn ( upstream ) , ${fails.length} fatal`,
  )
  if (warns.length) {
    console.log('::warning::' + warns.map((w) => `${w.name} (${w.reason})`).join(' ; '))
  }
  if (fails.length) {
    console.error('::error::manifest verification failed for : ' + fails.map((f) => f.name).join(' , '))
    process.exit(1)
  }
}

const invoked = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
if (invoked || process.argv[1]?.endsWith('verify-manifests.mjs')) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}
