import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, 'installer-wizard/model-manifest.json'), 'utf8'),
)

/** Runtime tiers always follow the installer; evaluation pools live separately. */
export function runtimeModels(tier) {
  const normalized = tier === 'medium' ? 'standard' : tier
  const tiers =
    normalized === 'all' || normalized === 'embedder' ? Object.keys(manifest.tiers) : [normalized]
  if (tiers.some((name) => !manifest.tiers[name])) throw new Error(`Unknown model tier: ${tier}`)
  const entries = tiers.flatMap((name) => manifest.tiers[name].models)
  const selected =
    normalized === 'embedder'
      ? entries.filter((entry) => entry.role === 'embedder' || entry.role === 'reranker')
      : [
          ...entries,
          ...manifest.common.filter((entry) => ['whisper', 'diarization'].includes(entry.role)),
        ]
  return [...new Map(selected.map((entry) => [entry.filename, entry])).values()]
}

export function installedModelDirs(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return [
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs/LokLM/models'),
      env.ProgramFiles && join(env.ProgramFiles, 'LokLM/models'),
    ].filter(Boolean)
  }
  if (platform === 'darwin') {
    return env.HOME ? [join(env.HOME, 'Library/Application Support/LokLM/models')] : []
  }
  return ['/opt/LokLM/models']
}

function modelPath(root, filename) {
  const target = resolve(root, filename)
  const rel = relative(resolve(root), target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Model filename escapes its directory.')
  return target
}

async function validFile(path, model) {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size !== model.sizeBytes) return false
    if (!model.sha256) return true
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === model.sha256.toLowerCase()
  } catch {
    return false
  }
}

/** Stream with backpressure, resume interrupted transfers, verify, then publish atomically. */
export async function provisionModel(
  model,
  {
    modelsDir = join(REPO_ROOT, 'models'),
    searchDirs = installedModelDirs(),
    fetchImpl = fetch,
    onProgress = () => {},
  } = {},
) {
  const target = modelPath(modelsDir, model.filename)
  await mkdir(dirname(target), { recursive: true })
  if (await validFile(target, model)) return 'present'
  const partial = `${target}.partial`
  if (await validFile(partial, model)) {
    await rename(partial, target)
    return 'resumed'
  }
  for (const root of searchDirs) {
    const source = modelPath(root, model.filename)
    if (source === target || !(await validFile(source, model))) continue
    await pipeline(createReadStream(source), createWriteStream(partial))
    if (!(await validFile(partial, model)))
      throw new Error(`Copied model failed verification: ${model.filename}`)
    await rename(partial, target)
    return 'copied from installed LokLM'
  }

  let offset = await stat(partial).then(
    (info) => info.size,
    () => 0,
  )
  if (offset >= model.sizeBytes) {
    await unlink(partial)
    offset = 0
  }
  const response = await fetchImpl(model.url, {
    redirect: 'follow',
    headers: offset ? { Range: `bytes=${offset}-` } : {},
  })
  if (!response.ok || !response.body)
    throw new Error(`Model download failed: HTTP ${response.status}`)
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
    if (!range || Number(range[1]) !== offset || Number(range[3]) !== model.sizeBytes) {
      await response.body.cancel()
      throw new Error('Unexpected model download range.')
    }
  } else {
    // Servers which ignore Range send the whole file: overwrite, never append.
    offset = 0
  }
  let received = offset
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      onProgress(received, model.sizeBytes)
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body),
    progress,
    createWriteStream(partial, { flags: offset ? 'a' : 'w' }),
  )
  if (!(await validFile(partial, model))) {
    await unlink(partial)
    throw new Error(`Model failed size/checksum verification: ${model.filename}`)
  }
  await rename(partial, target)
  return 'downloaded and verified'
}

export async function provisionRuntimeModels(tier, options = {}) {
  for (const model of runtimeModels(tier)) {
    console.log(`[models] ${model.role}: ${model.filename}`)
    let lastPrint = 0
    const result = await provisionModel(model, {
      ...options,
      onProgress: (received, total) => {
        if (Date.now() - lastPrint < 5000) return
        lastPrint = Date.now()
        console.log(
          `[models]   ${Math.floor((received / total) * 100)}% (${Math.round(received / 1048576)} MB)`,
        )
      },
    })
    console.log(`[models]   ${result}`)
  }
}
