#!/usr/bin/env node
/**
 * Dev launcher with an optional tier flag + translator auto-wiring.
 *
 *   pnpm dev              → no tier override (hardware-heuristic defaults)
 *   pnpm dev --lite       → emulate the "lite" install tier
 *   pnpm dev --standard   → emulate the "standard" install tier
 *   pnpm dev --pro        → emulate the "pro" install tier
 *
 * Tier flag → LOKLM_TIER env, read in the main process via getEffectiveTier()
 * (src/main/services/tier/TierMarker.ts). In dev there is no install-time tier
 * marker, so this is the only way to exercise a specific tier — e.g. "lite"
 * defaults the reranker off and hides its status dot. Any other args are passed
 * through to electron-vite.
 *
 * Models: a tier flag also provisions that tier's GGUFs into <repo>/models from
 * installer-wizard/model-manifest.json ( the same bundle the installer ships ),
 * downloading any that are missing before electron-vite starts. So `pnpm dev
 * --lite` actually runs the lite LLM rather than whatever larger GGUF is on disk.
 * It ALSO provisions the manifest's shared `common` transcription assets — the
 * Whisper STT model ( ggml-base.bin ) plus the two speaker-diarization ONNX
 * models — which a plain dev checkout otherwise lacks, so transcription would
 * fail with "whisper model 'base' not found". ( The ~3 GB MADLAD translation
 * files in `common` are NOT downloaded here ; they're handled by the translator
 * discovery below, which borrows an already-built sidecar + model from an
 * install rather than downloading them. )
 *
 * Translator: the C++ sidecar (loklm-translator) and its ~3 GB MADLAD model are
 * provisioned by the installer, never the app, so a plain dev checkout has
 * neither — translation silently shows as unavailable. Rather than make every
 * dev build the sidecar (10-25 min + a CUDA/C++ toolchain), this borrows an
 * already-built binary + model from, in order: an in-repo packaged build
 * (release/<plat>-unpacked), then a locally installed LokLM. Found paths are
 * exported as LOKLM_TRANSLATOR_BIN / LOKLM_TRANSLATOR_MODELS_DIR (both honoured
 * by the main process). Anything the dev set themselves wins; a miss is silent.
 */
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'

const TIER_FLAGS = { '--lite': 'lite', '--standard': 'standard', '--pro': 'pro' }
const ROOT = process.cwd()
const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'

const TRANSLATOR_MODEL_SUBPATH = join(
  'translator',
  'madlad400-3b-mt-ct2-int8',
  'sentencepiece.model',
)

let tier = null
const passthrough = []
for (const arg of process.argv.slice(2)) {
  if (arg in TIER_FLAGS) tier = TIER_FLAGS[arg]
  else passthrough.push(arg)
}

const env = { ...process.env }
if (tier) {
  env.LOKLM_TIER = tier
  console.log(`[dev] LOKLM_TIER=${tier} — emulating the "${tier}" install tier`)
  // The wizard installs each tier's GGUFs; a dev checkout has none. Pull the
  // tier's models from the same manifest the installer uses so `--lite` runs
  // the actual lite LLM ( not whatever larger model happens to be on disk ).
  await ensureTierModels(tier)
  // The wizard also installs the tier-agnostic `common` assets — Whisper + the
  // diarization ONNX pair — which a dev checkout lacks, so transcription throws
  // "whisper model 'base' not found". Provision them the same way.
  await ensureCommonModels()
}

wireTranslator(env)

const viteBin = join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [viteBin, 'dev', ...passthrough], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

// --- tier model provisioning ----------------------------------------------

/**
 * Ensure the GGUFs for `tier` are present in <repo>/models, downloading any
 * that are missing. Source of truth is installer-wizard/model-manifest.json —
 * the exact same per-tier bundle the installer delivers, so dev matches a real
 * install. Files already on disk ( by exact filename ) are skipped. A failed
 * download warns but does not block the dev launch.
 */
async function ensureTierModels(tier) {
  const manifest = readManifest()
  if (!manifest) return
  const entry = manifest.tiers?.[tier]
  if (!entry?.models?.length) {
    console.warn(`[dev] manifest has no tier "${tier}" — skipping model download`)
    return
  }
  await provisionModels(entry.models, `tier "${tier}"`)
}

/**
 * Ensure the manifest's tier-agnostic `common` transcription assets — the
 * Whisper STT model ( ggml-base.bin ) and the two speaker-diarization ONNX
 * models — are present in <repo>/models, downloading any that are missing.
 * These are what the installer ships to EVERY tier; a plain dev checkout has
 * none, so TranscriptionService.run throws "whisper model 'base' not found".
 *
 * The big role:'translation' MADLAD files in `common` are EXCLUDED here: they're
 * ~3 GB and provisioned separately by wireTranslator() ( which borrows an
 * already-built sidecar + model from an install rather than downloading them ),
 * and their subpath filenames ( translator/…/model.bin ) would need nested
 * mkdirs that the flat provisioner doesn't create.
 */
async function ensureCommonModels() {
  const manifest = readManifest()
  if (!manifest) return
  const common = Array.isArray(manifest.common) ? manifest.common : []
  const wanted = common.filter((m) => m.role === 'whisper' || m.role === 'diarization')
  if (wanted.length === 0) {
    console.warn('[dev] manifest has no common whisper/diarization assets — skipping')
    return
  }
  await provisionModels(wanted, 'transcription (common)')
}

/**
 * Shared provisioner: ensure every `models` entry ( {filename, url, role,
 * sizeBytes} ) exists in <repo>/models, downloading the missing ones. `label`
 * names the set in the log. Files are matched by exact filename; a failed
 * download warns but never blocks the dev launch.
 */
async function provisionModels(models, label) {
  const modelsDir = join(ROOT, 'models')
  if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true })

  const missing = models.filter((m) => !existsSync(join(modelsDir, m.filename)))
  if (missing.length === 0) {
    console.log(`[dev] ${label} models already present (${models.length} files)`)
    return
  }
  console.log(`[dev] ${label}: ${missing.length}/${models.length} model(s) to download`)

  for (const m of missing) {
    const target = join(modelsDir, m.filename)
    const mb = m.sizeBytes ? m.sizeBytes / 1e6 : 0
    const size = mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : mb ? `${mb.toFixed(0)} MB` : '? size'
    console.log(`[dev]   ⬇ ${m.role} ${m.filename} (~${size}) from ${shortHost(m.url)}`)
    try {
      await downloadFile(m.url, target, m.sizeBytes ?? 0)
      console.log(`[dev]   ✓ ${m.filename}`)
    } catch (err) {
      console.warn(`[dev]   ✗ ${m.filename}: ${err.message} — app will show it as missing`)
    }
  }
}

/** Load + parse installer-wizard/model-manifest.json, or null ( with a warning )
 *  if it's absent or malformed. Shared by the tier + common provisioning paths. */
function readManifest() {
  const manifestPath = join(ROOT, 'installer-wizard', 'model-manifest.json')
  if (!existsSync(manifestPath)) {
    console.warn(`[dev] no model-manifest.json at ${manifestPath} — skipping model download`)
    return null
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.warn(`[dev] could not parse model-manifest.json: ${err.message}`)
    return null
  }
}

/**
 * Stream `url` to `target` via a .partial temp + atomic rename. Verifies size
 * against Content-Length ( exact ) or, when absent, the manifest sizeBytes
 * ( within 5% ). A partial download never leaves a file the app could pick up.
 */
async function downloadFile(url, target, expectedBytes) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('response had no body')

  const total = Number(res.headers.get('content-length') ?? 0)
  const tmp = target + '.partial'
  if (existsSync(tmp)) unlinkSync(tmp)
  const out = createWriteStream(tmp)

  let received = 0
  let lastPrint = 0
  try {
    for await (const chunk of res.body) {
      out.write(chunk)
      received += chunk.length
      // Date.now() is fine here ( plain dev script , no resume journal ).
      const now = Date.now()
      if (now - lastPrint > 500) {
        printProgress(received, total || expectedBytes)
        lastPrint = now
      }
    }
    printProgress(received, total || expectedBytes)
    process.stdout.write('\n')
  } catch (err) {
    out.destroy()
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }
  await new Promise((r) => out.end(r))

  const got = statSync(tmp).size
  if (total > 0 && got !== total) {
    unlinkSync(tmp)
    throw new Error(`size mismatch: got ${got}, expected ${total}`)
  }
  if (total === 0 && expectedBytes > 0 && got < expectedBytes * 0.95) {
    unlinkSync(tmp)
    throw new Error(`download too small: ${got} bytes`)
  }
  if (existsSync(target)) unlinkSync(target)
  renameSync(tmp, target)
}

function printProgress(received, total) {
  const mb = (received / 1048576).toFixed(0)
  if (total > 0) {
    const pct = ((received / total) * 100).toFixed(1)
    process.stdout.write(`\r[dev]     ${pct}%  ${mb} / ${(total / 1048576).toFixed(0)} MB    `)
  } else {
    process.stdout.write(`\r[dev]     ${mb} MB    `)
  }
}

function shortHost(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// --- translator discovery -------------------------------------------------

/** Install roots of a locally installed LokLM, by electron-builder convention. */
function installRoots() {
  if (WIN) {
    return [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'LokLM'),
      process.env['ProgramFiles'] && join(process.env['ProgramFiles'], 'LokLM'),
    ].filter(Boolean)
  }
  if (MAC) return ['/Applications/LokLM.app/Contents']
  return ['/opt/LokLM']
}

/** resources/translator dir for an install root (capital R on macOS bundles). */
function resourcesDir(root) {
  return join(root, MAC ? 'Resources' : 'resources')
}

function translatorBinNames() {
  // Prefer the GPU build when present; the binary self-falls-back to CPU.
  return WIN
    ? ['loklm-translator-cuda.exe', 'loklm-translator.exe']
    : ['loklm-translator-cuda', 'loklm-translator']
}

function firstExisting(paths) {
  for (const p of paths) if (p && existsSync(p)) return p
  return null
}

/** A models *root* (dir containing translator/…) that actually holds the model. */
function modelsRootWithTranslator(roots) {
  return firstExistingDir(roots.map((r) => (existsSync(join(r, TRANSLATOR_MODEL_SUBPATH)) ? r : null)))
}

function firstExistingDir(dirs) {
  for (const d of dirs) if (d) return d
  return null
}

function wireTranslator(env) {
  // 1) Binary. Skip if the dev already staged one (resolveTranslatorBinary finds
  //    sidecars/translator/dist*) or set the override explicitly.
  const devStaged =
    existsSync(join(ROOT, 'sidecars', 'translator', 'dist')) ||
    existsSync(join(ROOT, 'sidecars', 'translator', 'dist-cuda')) ||
    existsSync(join(ROOT, 'sidecars', 'translator', 'build', 'bin'))
  if (!env.LOKLM_TRANSLATOR_BIN && !devStaged) {
    const unpacked = WIN
      ? join(ROOT, 'release', 'win-unpacked')
      : MAC
        ? join(ROOT, 'release', 'mac', 'LokLM.app', 'Contents')
        : join(ROOT, 'release', 'linux-unpacked')
    const binDirs = [resourcesDir(unpacked), ...installRoots().map(resourcesDir)].map((d) =>
      join(d, 'translator'),
    )
    const bin = firstExisting(binDirs.flatMap((d) => translatorBinNames().map((n) => join(d, n))))
    if (bin) {
      env.LOKLM_TRANSLATOR_BIN = bin
      console.log(`[dev] translator sidecar → ${bin}`)
    }
  }

  // 2) Model. Skip if <repo>/models already has it or the override is set.
  if (!env.LOKLM_TRANSLATOR_MODELS_DIR) {
    const modelRoots = [join(ROOT, 'models'), ...installRoots().map((r) => join(r, 'models'))]
    if (existsSync(join(modelRoots[0], TRANSLATOR_MODEL_SUBPATH))) {
      // Already in <repo>/models — the app finds it without help.
    } else {
      const root = modelsRootWithTranslator(modelRoots)
      if (root) {
        env.LOKLM_TRANSLATOR_MODELS_DIR = root
        console.log(`[dev] translator model  → ${root}`)
      }
    }
  }
}
