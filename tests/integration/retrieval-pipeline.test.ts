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
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import { ProviderRegistry } from '@main/services/providers/Registry'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'
import type { LlmProvider, RerankerProvider } from '@main/services/providers/types'
import type { IndexProgress } from '@main/services/documents/types'

// Helper to build a ProviderRegistry from a concrete EmbeddingService for
// these tests — LLM + reranker are stubbed out (the suite only exercises
// BM25+dense fusion, no rerank, no multi-query).
function buildRegistry(embedder: EmbeddingService): ProviderRegistry {
  const llmStub: LlmProvider = {
    ask: async () => '',
    generateRaw: async () => '',
    generateTitle: async () => null,
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

// gated on the GGUF being present locally — CI without the embedder model
// skips the suite, dev runs it after `pnpm models:embedder`.
describe.runIf(existsSync(MODEL_PATH))('hybrid retrieval (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-retrieval-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('finds the right doc via BM25+dense fusion on a seeded mini-corpus', async () => {
    const ws = await new WorkspaceService(auth).create('WS')

    const modelsClient = new InProcessModelsClient()
    const embedder = new EmbeddingService({ client: asModelsWorkerClient(modelsClient) })
    expect(await embedder.ensureReady()).toBe(true)
    const registry = buildRegistry(embedder)
    const docs = new DocumentService(auth, registry)

    const wochen = join(dir, 'Wochenbuch.md')
    const authPolicy = join(dir, 'auth-policy.md')
    const other = join(dir, 'recipe.md')
    await writeFile(
      wochen,
      '# Wochenbuch\n\nDiese Woche habe ich an LokLM gearbeitet: Datenbank-Schema in Postgres, ' +
        'Embeddings mit BGE-M3, hybride Suche mit RRF. Auch Codereviews mit Dominik gemacht.',
      'utf-8',
    )
    await writeFile(
      authPolicy,
      '# Authentication policy\n\nPasswords are hashed with argon2id. The vault uses AES-GCM ' +
        'envelope encryption with a passphrase-derived KEK.',
      'utf-8',
    )
    await writeFile(
      other,
      '# Pancake recipe\n\nFlour, milk, egg, butter. Mix, rest, fry. Nothing about software.',
      'utf-8',
    )

    for (const p of [wochen, authPolicy, other]) {
      const sent: IndexProgress[] = []
      await docs.importFile({
        workspaceId: ws.id,
        sourcePath: p,
        sender: {
          send: (_c: string, e: IndexProgress) => sent.push(e),
        } as unknown as Electron.WebContents,
      })
      await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 30_000)
    }

    const db = auth.requireDatabase()
    const retrieval = new RetrievalService(db, registry)

    // Auth question must rank the auth-policy doc highly
    const hitsAuth = await retrieval.search(ws.id, 'wie wurden passwörter geschützt', 5, {
      rerank: false,
    })
    expect(hitsAuth.length).toBeGreaterThan(0)
    expect(hitsAuth.map((h) => h.document_title)).toContain('auth-policy.md')

    // Diary-style question must rank Wochenbuch highly
    const hitsWochen = await retrieval.search(ws.id, 'was habe ich diese woche gemacht', 5, {
      rerank: false,
    })
    expect(hitsWochen.map((h) => h.document_title)).toContain('Wochenbuch.md')

    await embedder.unload()
  }, 240_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
