import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { freemem, totalmem } from 'node:os'
import type { Api } from '../../src/preload'
import { launchApp } from './helpers/launch'
import { fingerprintCompiledBuild } from './helpers/buildFingerprint'
import { inspectBuildProvenance } from './helpers/buildProvenance'
import { registerAndUnlock, createWorkspace } from './helpers/seed'
import { isCalibrationSplit, loadCalibrationSplit } from '../evals/native-calibration/fixtures'
import {
  collectCalibrationStream,
  calibrationCollectionDecision,
} from '../evals/native-calibration/streamCapture'
import { describeEvidenceAssessment } from '../evals/native-calibration/report'

const execFileAsync = promisify(execFile)
const root = resolve('tests/evals/native-calibration')

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function gpuSample() {
  const { stdout } = await execFileAsync('nvidia-smi', [
    '--query-gpu=name,memory.total,memory.used,utilization.gpu',
    '--format=csv,noheader,nounits',
  ])
  const [name, total, used, utilization] = stdout
    .trim()
    .split(',')
    .map((part) => part.trim())
  return {
    at: new Date().toISOString(),
    gpuName: name,
    totalMiB: Number(total),
    usedMiB: Number(used),
    utilization: Number(utilization),
    freeSystemRamBytes: freemem(),
    totalSystemRamBytes: totalmem(),
  }
}

async function modelInfo(page: Page) {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { api: Api }).api
    return {
      llm: await api.llm.info(),
      embedder: await api.embedder.info(),
      reranker: await api.reranker.info(),
    }
  })
}

test('calibrate local RAG against frozen synthetic source documents', async () => {
  test.skip(process.env['LOKLM_NATIVE_RAG'] !== '1', 'Explicit real-GPU calibration opt-in')
  test.setTimeout(60 * 60 * 1000)
  const split = process.env['LOKLM_CALIBRATION_SPLIT'] ?? 'dev'
  if (!isCalibrationSplit(split)) throw new Error('Invalid split')
  const runId = process.env['LOKLM_CALIBRATION_RUN'] ?? `${split}-${Date.now()}`
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid run id')
  const manifestPath = join(root, `${split}.json`)
  const manifest = await loadCalibrationSplit(split)
  const filter = process.env['LOKLM_CALIBRATION_CASES']?.split(',')
  if (filter?.some((id) => !manifest.cases.some((entry) => entry.id === id)))
    throw new Error('Unknown calibration case selected')
  if (filter && new Set(filter).size !== filter.length)
    throw new Error('Duplicate calibration case selected')
  const cases = filter
    ? filter.map((id) => manifest.cases.find((entry) => entry.id === id)!)
    : manifest.cases
  if (!cases.length) throw new Error('No calibration cases selected')
  const questionTimeoutMs = Number(process.env['LOKLM_CALIBRATION_QUESTION_TIMEOUT_MS'] ?? 180_000)
  const continueErrors = process.env['LOKLM_CALIBRATION_CONTINUE_ERRORS'] === '1'
  if (
    !Number.isInteger(questionTimeoutMs) ||
    questionTimeoutMs < 30_000 ||
    questionTimeoutMs > 600_000
  )
    throw new Error('Calibration question timeout must be an integer from 30000 to 600000 ms')
  const repeats = Number(process.env['LOKLM_CALIBRATION_REPEATS'] ?? 1)
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
    throw new Error('Calibration repeats must be an integer from 1 to 10')
  const warmCases = process.env['LOKLM_CALIBRATION_WARM_CASES']?.split(',')
  if (warmCases?.some((id) => !cases.some((entry) => entry.id === id)))
    throw new Error('Warm calibration case must be in the selected cases')
  const output = join(root, 'reports', runId)
  await mkdir(join(root, 'reports'), { recursive: true })
  await mkdir(output, { recursive: false })
  process.env['LOKLM_RETRIEVAL_TRACE'] = '1'
  process.env['LOKLM_RETRIEVAL_TRACE_DIR'] = output
  const sourcePaths = [
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/shared/citationMarkers.ts',
    'src/main/services/llm/prompt.ts',
    'src/main/services/llm/citationAliases.ts',
    'src/main/services/llm/LlamaService.ts',
    'src/main/services/providers/ollama/OllamaLlmProvider.ts',
    'src/main/services/providers/ollama/OllamaClient.ts',
    'src/main/services/qa/QAService.ts',
    'src/main/services/qa/chatTurn.ts',
    'src/shared/documents.ts',
    'src/main/services/qa/contextBudget.ts',
    'src/main/services/qa/evidenceAssessment.ts',
    'src/main/services/retrieval/RetrievalService.ts',
    'src/main/services/retrieval/rrf.ts',
    'src/main/services/retrieval/heuristics.ts',
    'src/main/services/retrieval/QueryEmbeddingCache.ts',
    'src/main/services/embeddings/EmbeddingService.ts',
    'src/main/services/workers/modelMemory.ts',
    'src/main/services/workers/contextBudget.ts',
    'src/main/services/workers/chatWrapper.ts',
    'src/main/services/workers/GpuWorkCoordinator.ts',
    'src/main/services/workers/ModelsWorkerClient.ts',
    'src/main/services/workers/modelsWorker.ts',
    'out/main/index.js',
    'out/main/modelsWorker.js',
    'out/preload/index.cjs',
  ]
  const models = await Promise.all(
    ['models/Qwen3.5-4B-Q4_K_M.gguf', 'models/Qwen3-Embedding-0.6B-Q8_0.gguf'].map(
      async (path) => ({ path, sha256: await hashFile(path), bytes: (await stat(path)).size }),
    ),
  )
  const compiledBuildHashes = await fingerprintCompiledBuild()
  const raw: Record<string, unknown> = {
    kind: 'native-rag-calibration',
    runId,
    split,
    requestedContext: Number(process.env['LOKLM_LLM_CONTEXT_SIZE'] ?? 0),
    configuration: {
      queryEmbeddingCache: process.env['LOKLM_QUERY_EMBEDDING_CACHE'] !== '0',
      vramPaddingMiB: process.env['LOKLM_VRAM_PADDING_MIB'] ?? 'default',
      inferenceThreads: process.env['LOKLM_INFERENCE_THREADS'] ?? 'default',
      citationAliases: process.env['LOKLM_CITATION_ALIASES'] === '1',
      sourceMarkerFooters: process.env['LOKLM_SOURCE_MARKER_FOOTERS'] === '1',
      reuseGpuLayerPlan: process.env['LOKLM_REUSE_GPU_LAYER_PLAN'] !== '0',
      rerank: false,
      multiQuery: false,
      routing: false,
      wholeDocFallback: false,
      selectedCases: cases.map((entry) => entry.id),
      repeats,
      warmCases,
      questionTimeoutMs,
      continueErrors,
      // This isolated API-only harness has no user activity; prevent the
      // ordinary 15-minute idle lock from cancelling long calibration runs.
      autoLockMinutes: 0,
      evidenceAssessment: process.env['LOKLM_EVIDENCE_ASSESSMENT'] === '1',
    },
    startedAt: new Date().toISOString(),
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    // Hash only: no source diff/private content is written to the run report.
    // This identifies tracked edits; untracked input files are not covered.
    trackedDiffSha256: createHash('sha256')
      .update(
        execFileSync('git', ['diff', '--no-ext-diff', '--binary', 'HEAD'], {
          maxBuffer: 32 * 1024 ** 2,
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
      .digest('hex'),
    compiledBuildHashes,
    buildProvenance: await inspectBuildProvenance(),
    sourceHashesMeaning:
      'Working-tree inputs observed at run start; compiled-to-source correspondence requires a matching build-time provenance manifest.',
    sourceHashes: Object.fromEntries(
      await Promise.all(sourcePaths.map(async (path) => [path, await hashFile(path)])),
    ),
    fixtureSha256: await hashFile(manifestPath),
    models,
    hardware: await gpuSample(),
    documents: [],
    queries: [],
    continuedErrorCaseIds: [],
  }
  const flush = () => writeFile(join(output, 'raw.json'), JSON.stringify(raw, null, 2) + '\n')
  await flush()
  const gpuSamples: Awaited<ReturnType<typeof gpuSample>>[] = []
  let sampling = false
  const sampler = setInterval(() => {
    if (sampling) return
    sampling = true
    void gpuSample()
      .then((sample) => gpuSamples.push(sample))
      .catch(() => undefined)
      .finally(() => {
        sampling = false
      })
  }, 1500)
  const startupAt = Date.now()
  const launched = await launchApp().catch(async (error: unknown) => {
    clearInterval(sampler)
    raw.failure = error instanceof Error ? error.message : String(error)
    await flush()
    throw error
  })
  const { page, app } = launched
  let logs = ''
  const recordLog = (data: unknown) => {
    logs += String(data)
    const lines = String(data)
      .split(/\r?\n/)
      .filter((line) => /ready:|context plan|llm.ask|failed|error/i.test(line))
    for (const line of lines) console.log(line)
  }
  app.process().stdout?.on('data', recordLog)
  app.process().stderr?.on('data', recordLog)
  try {
    await registerAndUnlock(page, 'RAG calibration')
    const workspaceId = await createWorkspace(page, `Calibration ${split}`)
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.settings.update({
        basic: { answerLanguage: 'auto' },
        advanced: { reranker: { enabled: false } },
        security: { autoLockMinutes: 0 },
      })
    })
    const ready = () =>
      page.evaluate(async () => {
        const api = (globalThis as unknown as { api: Api }).api
        return (
          (await api.models.activity()).phase === 'idle' &&
          (await api.llm.status()).resident === true
        )
      })
    await expect.poll(ready, { timeout: 180_000 }).toBe(true)
    raw.startupMs = Date.now() - startupAt
    raw.readyInfo = await modelInfo(page)
    console.log(`CALIBRATION ready ${JSON.stringify(raw.readyInfo)}`)
    const indexingAt = Date.now()
    const docs: Array<Record<string, unknown>> = []
    for (const source of manifest.sources) {
      const sourcePath = resolve(root, source.file)
      const document = await page.evaluate(
        ({ id, path }) => (globalThis as unknown as { api: Api }).api.documents.import(id, path),
        { id: workspaceId, path: sourcePath },
      )
      docs.push({ sourceKey: source.key, ...document, sourceSha256: await hashFile(sourcePath) })
    }
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const documents = await (globalThis as unknown as { api: Api }).api.documents.list(id)
            const failed = documents.find((doc) => doc.status === 'failed')
            if (failed) throw new Error(`Indexing failed: ${failed.title}`)
            return documents.every((doc) => doc.status === 'ready')
          }, workspaceId),
        { timeout: 240_000 },
      )
      .toBe(true)
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await (globalThis as unknown as { api: Api }).api.models.activity()).phase,
          ),
        { timeout: 180_000 },
      )
      .toBe('idle')
    raw.indexingMs = Date.now() - indexingAt
    for (const doc of docs) {
      doc.chunks = await page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.documents.listChunksForDocument(id),
        Number(doc.id),
      )
    }
    raw.documents = docs
    raw.indexedInfo = await modelInfo(page)
    await flush()
    for (let repetition = 0; repetition < repeats; repetition++) {
      for (const entry of cases) {
        if (repetition > 0 && warmCases && !warmCases.includes(entry.id)) continue
        const beforeInfo = await modelInfo(page)
        const logStart = logs.length
        console.log(`CALIBRATION question ${entry.id} repeat=${repetition}`)
        const observation = await page.evaluate(collectCalibrationStream, {
          id: workspaceId,
          entry: { id: entry.id, question: entry.question, language: entry.language },
          repetition,
          timeoutMs: questionTimeoutMs,
        })
        const afterInfo = await modelInfo(page)
        const queryLogs = logs.slice(logStart).split(/\r?\n/)
        const collectionDecision = calibrationCollectionDecision(observation, continueErrors)
        const query = {
          ...observation,
          beforeInfo,
          afterInfo,
          logs: queryLogs,
          evidenceAssessment: describeEvidenceAssessment(queryLogs, observation.events),
          collectionDecision,
        }
        ;(raw.queries as unknown[]).push(query)
        if (collectionDecision === 'continue-error')
          (raw.continuedErrorCaseIds as string[]).push(`${entry.id}:${repetition}`)
        raw.gpuSamples = gpuSamples
        raw.peakGpuUsedMiB = Math.max(0, ...gpuSamples.map((sample) => sample.usedMiB))
        await flush()
        console.log(
          `CALIBRATION result ${entry.id}: ${JSON.stringify({ answer: observation.answer, ttftMs: observation.ttftMs, totalMs: observation.totalMs, timedOut: observation.timedOut })}`,
        )
        if (collectionDecision === 'stop') {
          throw new Error(`Calibration stopped on timeout/error for ${entry.id}; inspect raw.json`)
        }
      }
    }
    raw.observationCollectionCompletedAt = new Date().toISOString()
    if ((raw.continuedErrorCaseIds as string[]).length)
      throw new Error(
        `Calibration collected all selected observations but ${(raw.continuedErrorCaseIds as string[]).length} requests failed; inspect raw.json`,
      )
    raw.completedAt = new Date().toISOString()
    await flush()
  } catch (error) {
    raw.failure = error instanceof Error ? error.message : String(error)
    await flush()
    throw error
  } finally {
    clearInterval(sampler)
    await writeFile(join(output, 'app.log'), logs)
    await launched.cleanup()
    const after = await fingerprintCompiledBuild()
    raw.compiledBuildHashesAfter = after
    raw.buildProvenanceAfter = await inspectBuildProvenance()
    raw.compiledBuildUnchanged = JSON.stringify(after) === JSON.stringify(compiledBuildHashes)
    if (!raw.compiledBuildUnchanged) {
      raw.integrityError =
        'Compiled application files changed during calibration; results are not from a frozen build.'
    }
    await flush()
    expect(after, 'Compiled application must remain frozen throughout calibration').toEqual(
      compiledBuildHashes,
    )
  }
})
