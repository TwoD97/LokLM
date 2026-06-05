import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { InProcessModelsClient, asModelsWorkerClient } from './helpers/InProcessModelsClient'
import { EmbeddingBackfillService } from '@main/services/embeddings/EmbeddingBackfillService'
import { ProviderRegistry } from '@main/services/providers/Registry'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'
import type { LlmProvider, RerankerProvider } from '@main/services/providers/types'
import type { IndexProgress } from '@main/services/documents/types'

// Backfill only needs an embedder; LLM + reranker are stubbed.
function buildRegistry(embedder: EmbeddingService): ProviderRegistry {
  const llmStub: LlmProvider = {
    ask: async () => '',
    generateRaw: async () => '',
    generateTitle: async () => null,
    contextWindowTokens: () => 0,
    isReady: () => false,
    getStatus: () => ({ ready: false, message: null, identity: 'stub' }),
    getModelStatus: () => ({}) as never,
    setLanguage: async () => {},
  }
  const rerankerStub: RerankerProvider = {
    rerank: async () => [],
    isReady: () => false,
    ensureReady: async () => undefined,
  }
  return new ProviderRegistry({
    llm: { bundled: llmStub, ollama: null },
    embedder: { bundled: new BundledEmbedderProvider(embedder), ollama: null },
    reranker: { bundled: rerankerStub, ollama: null },
  })
}

const MODEL_PATH = join(process.cwd(), 'models', 'bge-m3-Q4_K_M.gguf')

// gated on the GGUF being present locally — CI without a bundled model skips
// the whole suite, dev runs it after `pnpm models:embedder`.
describe.runIf(existsSync(MODEL_PATH))('embedding backfill (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-embed-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('imports without embedder → backfill fills NULL embeddings', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const filePath = join(dir, 'sample.md')
    await writeFile(
      filePath,
      '# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n\nDrittes auf deutsch.',
      'utf-8',
    )

    // Phase 1: import with no embedder → all chunks land with NULL embedding.
    const sent: IndexProgress[] = []
    const docsNoEmbed = new DocumentService(auth)
    const doc = await docsNoEmbed.importFile({
      workspaceId: ws.id,
      sourcePath: filePath,
      sender: {
        send: (_c: string, p: IndexProgress) => sent.push(p),
      } as unknown as Electron.WebContents,
    })
    await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 10_000)

    const db = auth.requireDatabase()
    const missing = await db.documents().countChunksMissingEmbedding(ws.id)
    expect(missing).toBeGreaterThan(0)

    // Phase 2: warm the embedder + run backfill → all NULLs filled.
    const modelsClient = new InProcessModelsClient()
    const embedder = new EmbeddingService({ client: asModelsWorkerClient(modelsClient) })
    const ok = await embedder.ensureReady()
    expect(ok).toBe(true)
    const registry = buildRegistry(embedder)
    const backfill = new EmbeddingBackfillService(db, registry)
    await backfill.run(ws.id)

    const missingAfter = await db.documents().countChunksMissingEmbedding(ws.id)
    expect(missingAfter).toBe(0)

    // unload to release VRAM before the suite tears down
    await embedder.unload()
    void doc
  }, 180_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
