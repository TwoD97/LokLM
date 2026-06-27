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
import { existsSync } from 'node:fs'
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
}

wireTranslator(env)

const viteBin = join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [viteBin, 'dev', ...passthrough], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

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
