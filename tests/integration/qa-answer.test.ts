import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { DocumentService } from '@main/services/documents/DocumentService'
import { EmbeddingService } from '@main/services/embeddings/EmbeddingService'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import { LlamaService } from '@main/services/llm/LlamaService'
import { QAService } from '@main/services/qa/QAService'
import { ProviderRegistry } from '@main/services/providers/Registry'
import { BundledLlmProvider } from '@main/services/providers/bundled/BundledLlmProvider'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'
import type { RerankerProvider } from '@main/services/providers/types'
import type { IndexProgress } from '@main/services/documents/types'
import type { StreamEvent } from '@main/services/qa/types'

// Build a registry around concrete LlamaService + EmbeddingService for the
// integration tests. Reranker is stubbed (these scenarios don't use it).
function buildRegistry(llama: LlamaService, embedder: EmbeddingService): ProviderRegistry {
  const rerankerStub: RerankerProvider = {
    rerank: async () => [],
    isReady: () => false,
    ensureReady: async () => undefined,
  }
  return new ProviderRegistry({
    llm: { bundled: new BundledLlmProvider(llama), ollama: null },
    embedder: { bundled: new BundledEmbedderProvider(embedder), ollama: null },
    reranker: { bundled: rerankerStub, ollama: null },
  })
}

const EMBEDDER_PATH = join(process.cwd(), 'models', 'bge-m3-Q4_K_M.gguf')
const LLM_PATH = join(process.cwd(), 'models', 'Qwen_Qwen3-8B-Q4_K_M.gguf')

// Both models must be present locally for this suite to run. CI without
// the GGUFs skips; dev runs it after `pnpm models:embedder && pnpm models:medium`.
describe.runIf(existsSync(EMBEDDER_PATH) && existsSync(LLM_PATH))(
  'QAService.answer (integration)',
  () => {
    let dir: string
    let auth: AuthService

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'loklm-qa-'))
      auth = new AuthService(dir)
      await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
    })
    afterEach(async () => {
      await auth.lock().catch(() => undefined)
      await rm(dir, { recursive: true, force: true })
    })

    it('streams a grounded answer with citations on a seeded corpus', async () => {
      const ws = await new WorkspaceService(auth).create('WS')
      const filePath = join(dir, 'argon-doc.md')
      await writeFile(
        filePath,
        '# Auth design\n\nPasswords in LokLM are hashed with argon2id at 64 MiB memory cost, ' +
          '3 iterations, parallelism 4, producing a 32-byte raw hash. The vault uses AES-256-GCM ' +
          'envelope encryption with a passphrase-derived KEK.',
        'utf-8',
      )

      const embedder = new EmbeddingService()
      expect(await embedder.ensureReady()).toBe(true)
      const llama = new LlamaService()
      const registry = buildRegistry(llama, embedder)

      const docs = new DocumentService(auth, registry)
      const sent: IndexProgress[] = []
      await docs.importFile({
        workspaceId: ws.id,
        sourcePath: filePath,
        sender: {
          send: (_c: string, e: IndexProgress) => sent.push(e),
        } as unknown as Electron.WebContents,
      })
      await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)

      const db = auth.requireDatabase()
      await llama.autoLoad()
      expect(llama.isReady()).toBe(true)
      const retrieval = new RetrievalService(db, registry)
      const qa = new QAService(db, retrieval, registry)

      const events: StreamEvent[] = []
      for await (const ev of qa.answer(ws.id, 'How are passwords hashed?', { topK: 4 })) {
        events.push(ev)
      }

      const tokens = events.filter((e) => e.type === 'token')
      expect(tokens.length).toBeGreaterThan(0)
      const done = events.find((e) => e.type === 'done')
      expect(done).toBeDefined()
      expect((done as { type: 'done'; full_text: string }).full_text.toLowerCase()).toContain(
        'argon2',
      )
      const citations = events.filter((e) => e.type === 'citation')
      expect(citations.length).toBeGreaterThan(0)

      await llama.unload()
      await embedder.unload()
    }, 360_000)

    it('emits refusal when threshold forces no answer', async () => {
      const ws = await new WorkspaceService(auth).create('WS')
      const filePath = join(dir, 'cooking.md')
      await writeFile(filePath, '# Pancake\nFlour, milk, egg, butter. Mix, rest, fry.', 'utf-8')

      const embedder = new EmbeddingService()
      expect(await embedder.ensureReady()).toBe(true)
      const llama = new LlamaService()
      const registry = buildRegistry(llama, embedder)
      const docs = new DocumentService(auth, registry)
      const sent: IndexProgress[] = []
      await docs.importFile({
        workspaceId: ws.id,
        sourcePath: filePath,
        sender: {
          send: (_c: string, e: IndexProgress) => sent.push(e),
        } as unknown as Electron.WebContents,
      })
      await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)

      const db = auth.requireDatabase()
      await llama.autoLoad()
      expect(llama.isReady()).toBe(true)
      const retrieval = new RetrievalService(db, registry)
      const qa = new QAService(db, retrieval, registry)

      const events: StreamEvent[] = []
      for await (const ev of qa.answer(ws.id, 'wie schütze ich passwörter', {
        // force refusal regardless of actual top score
        refusalThreshold: 0.9,
      })) {
        events.push(ev)
      }
      const refusal = events.find((e) => e.type === 'refusal')
      expect(refusal).toBeDefined()
      expect((refusal as { type: 'refusal'; message: string }).message).toMatch(/find|nicht/i)

      await llama.unload()
      await embedder.unload()
    }, 240_000)
  },
)

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
