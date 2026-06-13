import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
import { KORPUS, FRAGEN } from '../fixtures/retrieval/korpus'

// AP-T.2 (Pflichtenheft §8.2) — RetrievalService E2E: 50-Chunk-Korpus mit
// echtem Embedder importieren, 10 vorbereitete Fragen stellen, Top-K muss
// deterministisch sein und die erwarteten Chunks enthalten. Korpus + Fragen
// liegen in tests/fixtures/retrieval/korpus.ts.
//
// Wie retrieval-pipeline.test.ts gated auf das BGE-M3-GGUF (CI ohne Modell
// skippt, lokal: `pnpm models:embedder`). LLM + Reranker sind gestubbt — der
// Test misst BM25+Dense-Fusion, nicht Generierung.

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
const TOP_K = 5

// Alle nicht-deterministischen Stellschrauben explizit festgenagelt — sonst
// testet der Determinismus-Check Zufall statt Pipeline:
//  - rerank/multiQuery: Modelle aus dem Spiel (Stubs wären eh not-ready)
//  - recencyBoostFactor 1.0: kein Date.now()-abhängiger Score
//  - wholeDocFallback/neighbourRadius: keine zusätzlichen Hits jenseits Top-K
//  - documentDiversity false: pure Fusion-Reihenfolge, kein Round-Robin
const PINNED = {
  rerank: false,
  multiQuery: false,
  documentDiversity: false,
  wholeDocFallback: false,
  neighbourRadius: 0,
  recencyBoostFactor: 1.0,
}

type ChunkInfo = { id: number; heading_path: string[] | null }

describe.runIf(existsSync(MODEL_PATH))('AP-T.2 RetrievalService E2E (Korpus)', () => {
  let dir: string
  let auth: AuthService
  let wsId: number
  let embedder: EmbeddingService
  let retrieval: RetrievalService
  const chunksByDatei = new Map<string, ChunkInfo[]>()

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-korpus-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
    const ws = await new WorkspaceService(auth).create('WS')
    wsId = ws.id

    const modelsClient = new InProcessModelsClient()
    embedder = new EmbeddingService({ client: asModelsWorkerClient(modelsClient) })
    expect(await embedder.ensureReady()).toBe(true)
    const registry = buildRegistry(embedder)
    const docs = new DocumentService(auth, registry)

    for (const eintrag of KORPUS) {
      const path = join(dir, eintrag.datei)
      await writeFile(path, eintrag.inhalt, 'utf-8')
      const sent: IndexProgress[] = []
      const doc = await docs.importFile({
        workspaceId: wsId,
        sourcePath: path,
        sender: {
          send: (_c: string, e: IndexProgress) => sent.push(e),
        } as unknown as Electron.WebContents,
      })
      await waitFor(() => sent.some((e) => e.phase === 'done' || e.phase === 'failed'), 60_000)
      expect(sent.at(-1)?.phase).toBe('done')

      const rows = await auth.requireDatabase().documents().listChunksForDocument(doc.id)
      chunksByDatei.set(eintrag.datei, rows)
    }

    retrieval = new RetrievalService(auth.requireDatabase(), registry)
  }, 240_000)

  afterAll(async () => {
    await embedder?.unload()
    await auth?.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  // Löst {datei, sektion} aus dem Fixture in echte Chunk-IDs auf — über das
  // heading_path, das der markdown-aware Chunker pro Sektion mitschreibt.
  // Gematcht wird das LETZTE Element des heading_path (die spezifischste
  // Überschrift), nicht .includes(): sonst würde der `#`-Dokumenttitel — der in
  // jedem heading_path steckt — jede Sektion matchen und die Zuordnung still
  // auf Dokument-Ebene verwässern.
  function erwarteteChunkIds(
    frageId: string,
    erwartet: { datei: string; sektion: string }[],
  ): number[] {
    const ids: number[] = []
    for (const { datei, sektion } of erwartet) {
      const chunks = chunksByDatei.get(datei)
      if (!chunks)
        throw new Error(`Frage ${frageId}: Korpus-Dokument '${datei}' existiert nicht im Fixture`)
      const matching = chunks.filter((c) => (c.heading_path ?? []).at(-1) === sektion)
      if (matching.length === 0) {
        const vorhanden = [
          ...new Set(chunks.map((c) => (c.heading_path ?? []).at(-1)).filter(Boolean)),
        ].join(', ')
        throw new Error(
          `Frage ${frageId}: keine Chunks mit ##-Sektion '${sektion}' in '${datei}' — vorhandene Sektionen: ${vorhanden}`,
        )
      }
      ids.push(...matching.map((c) => c.id))
    }
    return ids
  }

  it('Korpus erfüllt den AP-T.2-Umfang: ≥50 Chunks, ≥10 Fragen', () => {
    const totalChunks = [...chunksByDatei.values()].reduce((n, c) => n + c.length, 0)
    expect(
      totalChunks,
      `Korpus hat erst ${totalChunks} Chunks — TODO(Dominik) in tests/fixtures/retrieval/korpus.ts: Dokumente ergänzen bis ≥50`,
    ).toBeGreaterThanOrEqual(50)
    expect(
      FRAGEN.length,
      `Erst ${FRAGEN.length} Prüf-Fragen — TODO(Dominik) in tests/fixtures/retrieval/korpus.ts: ergänzen bis ≥10`,
    ).toBeGreaterThanOrEqual(10)
  })

  it('jede Frage liefert die erwarteten Chunks im Top-K', async () => {
    for (const frage of FRAGEN) {
      const hits = await retrieval.search(wsId, frage.frage, TOP_K, PINNED)
      expect(hits.length, `Frage ${frage.id}: keine Treffer`).toBeGreaterThan(0)
      expect(hits.length).toBeLessThanOrEqual(TOP_K)

      const erwartet = erwarteteChunkIds(frage.id, frage.erwartet)
      const hitIds = hits.map((h) => h.chunk_id)
      expect(
        hitIds.some((id) => erwartet.includes(id)),
        `Frage ${frage.id} ('${frage.frage}'): erwartete Chunks ${erwartet.join(',')} nicht im Top-${TOP_K} [${hitIds.join(',')}]`,
      ).toBe(true)
    }
  }, 120_000)

  // Zeigt In-Prozess-Stabilität: zwei identische Anfragen gegen dieselbe
  // PGlite-Instanz liefern dasselbe Ranking. NICHT abgedeckt ist Stabilität
  // über Prozess-/DB-Neuaufbauten hinweg — searchChunks/searchChunksByVector
  // sortieren nur nach score ohne Tie-Breaker (anders als searchLibrary, das
  // 'score DESC, document_id, chunk_id' pinnt). Bei Score-Gleichstand kann die
  // physische Zeilenreihenfolge das Ergebnis drehen. → an Denys: zweiten
  // Sortierschlüssel in den Chat-Retrieval-Queries nachziehen.
  it('Top-K ist deterministisch: identische Anfrage → identische Reihenfolge', async () => {
    for (const frage of FRAGEN) {
      const erste = await retrieval.search(wsId, frage.frage, TOP_K, PINNED)
      const zweite = await retrieval.search(wsId, frage.frage, TOP_K, PINNED)
      expect(
        zweite.map((h) => h.chunk_id),
        `Frage ${frage.id}: zwei identische search()-Aufrufe lieferten verschiedene Rankings`,
      ).toEqual(erste.map((h) => h.chunk_id))
    }
  }, 120_000)
})

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}
