import { describe, it, expect, vi } from 'vitest'
import {
  resolveRoute,
  resolveTargetDocument,
  detectCorpusIntent,
  extractThemeTokens,
  TITLE_MATCH_MIN_COVERAGE,
  type RouteDocument,
} from '@main/services/qa/router'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalService } from '@main/services/retrieval/RetrievalService'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import type { Database } from '@main/db/database'
import type { SummarizationService } from '@main/services/summarize/SummarizationService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import type { AskOptions } from '@main/services/llm/LlamaService'

const docs: RouteDocument[] = [
  { id: 1, title: 'TudosaDenys_Wochenbuch.pdf' },
  { id: 2, title: 'Strom und Spannung — Grundlagen' },
  { id: 3, title: 'Übungen Lineare Algebra' },
  { id: 4, title: 'Projektbericht LokLM 2026' },
]

describe('resolveTargetDocument', () => {
  describe('resolved (unambiguous title match)', () => {
    const cases: Array<[string, number]> = [
      ['fasse mein wochenbuch zusammen', 1],
      ['summarize the Wochenbuch please', 1],
      ['zusammenfassung von strom und spannung', 2],
      // umlaut tokens straight from the title — tokenizer keeps äöüß
      ['gib mir einen überblick über die übungen zur linearen algebra', 3],
      ['tl;dr projektbericht loklm', 4],
    ]
    for (const [q, id] of cases) {
      it(`"${q}" → doc ${id}`, () => {
        expect(resolveTargetDocument(q, docs)).toEqual({ kind: 'resolved', documentId: id })
      })
    }
  })

  describe('none (no usable match)', () => {
    const cases = [
      'fasse das mal zusammen', // no title tokens at all
      'summarize everything important', // generic words only
      'überblick über die prüfung', // "prüfung" appears in no title
      // strict by design: a single token covering 1/3 of a 3-token title
      // stays below the coverage gate even when it's unique in the corpus —
      // false-negative falls back to retrieval , false-positive summarizes
      // the wrong doc
      'überblick: übungen bitte kurz',
    ]
    for (const q of cases) {
      it(`"${q}" → none`, () => {
        expect(resolveTargetDocument(q, docs)).toEqual({ kind: 'none' })
      })
    }

    it('single shared generic token below coverage gate → none', () => {
      // "grundlagen" covers only 1/3 of the Strom-title's non-stopword tokens
      const res = resolveTargetDocument('zusammenfassung der grundlagen', docs)
      expect(res.kind).toBe('none')
      expect(TITLE_MATCH_MIN_COVERAGE).toBeGreaterThan(1 / 3)
    })
  })

  describe('ambiguous (two docs inside the margin)', () => {
    const twins: RouteDocument[] = [
      { id: 10, title: 'Laborbericht Optik' },
      { id: 11, title: 'Laborbericht Mechanik' },
    ]
    it('"fasse den laborbericht zusammen" → ambiguous with both candidates', () => {
      const res = resolveTargetDocument('fasse den laborbericht zusammen', twins)
      expect(res.kind).toBe('ambiguous')
      if (res.kind === 'ambiguous') {
        expect(res.candidateIds.sort()).toEqual([10, 11])
      }
    })

    it('an extra distinguishing token breaks the tie', () => {
      expect(resolveTargetDocument('fasse den laborbericht optik zusammen', twins)).toEqual({
        kind: 'resolved',
        documentId: 10,
      })
    })
  })

  it('empty query tokens → none', () => {
    expect(resolveTargetDocument('the and of', docs)).toEqual({ kind: 'none' })
  })

  describe('intent keywords are excluded from matching', () => {
    // Titles literally named after the trigger word are common in a
    // study-notes corpus. Without stripping the intent vocabulary from the
    // query side , every summary query would contain a free matched token
    // for them — confident wrong-doc answers.
    const trapDocs: RouteDocument[] = [
      { id: 20, title: 'Zusammenfassung_Statistik.pdf' },
      { id: 21, title: 'Überblick.pdf' },
      { id: 22, title: 'Project Overview.docx' },
      { id: 23, title: 'Prüfung SS26.pdf' },
    ]

    it('"gib mir eine zusammenfassung der prüfungsthemen" does NOT resolve to Zusammenfassung_*.pdf', () => {
      expect(
        resolveTargetDocument('gib mir eine zusammenfassung der prüfungsthemen', trapDocs),
      ).toEqual({ kind: 'none' })
    })

    it('intent-only title can never win against the doc the user actually named', () => {
      expect(
        resolveTargetDocument('gib mir einen überblick über die prüfung ss26', trapDocs),
      ).toEqual({ kind: 'resolved', documentId: 23 })
    })

    it('"give me an overview of the budget" does not capture Project Overview.docx', () => {
      expect(resolveTargetDocument('give me an overview of the budget', trapDocs)).toEqual({
        kind: 'none',
      })
    })

    it('naming the intent-titled file by its distinctive token still resolves it', () => {
      expect(resolveTargetDocument('fasse die statistik zusammen', trapDocs)).toEqual({
        kind: 'resolved',
        documentId: 20,
      })
    })
  })

  it('extension stripping is file-type agnostic — .rst routes like .pdf', () => {
    const rstDocs: RouteDocument[] = [{ id: 30, title: 'TudosaDenys_Wochenbuch.rst' }]
    expect(resolveTargetDocument('fasse mein wochenbuch zusammen', rstDocs)).toEqual({
      kind: 'resolved',
      documentId: 30,
    })
  })
})

describe('detectCorpusIntent', () => {
  describe('count', () => {
    const cases = [
      'wie viele dokumente habe ich zu strom und spannung?',
      'wieviele dokumente gibt es zum thema optik?',
      'anzahl der dokumente über neuronale netze',
      'how many documents do I have about transformers?',
      'how many of my documents cover RAG?',
      'what is the number of documents in this workspace?',
    ]
    for (const q of cases) {
      it(`"${q}" → count`, () => {
        expect(detectCorpusIntent(q)).toBe('count')
      })
    }
  })

  describe('list', () => {
    const cases = [
      'which documents cover the wave equation?',
      'list my documents about chemistry',
      'what documents do I have about electronics?',
      'welche dokumente behandeln die schlüsselableitung?',
      'welche meiner dateien gehen über die prüfung?',
      'zeig mir alle dokumente zu LokLM',
      // "in welchem dokument steht X" — a locate question; listing the docs
      // that mention X is the right answer shape (RAGFlow doc_aggs use case)
      'in welchem dokument steht die formel zur kondensatorladung?',
    ]
    for (const q of cases) {
      it(`"${q}" → list`, () => {
        expect(detectCorpusIntent(q)).toBe('list')
      })
    }
  })

  describe('null (scope noun not the counted/listed object)', () => {
    const cases = [
      'how many pages does the document have?', // counts pages , not docs
      'how many volts are needed for the circuit?',
      'wie viele seiten hat das dokument?',
      'wie viele themen behandelt das skript?',
      'the documents say the KDF is argon2id — why?', // no intent phrase
      'compare the documents on optics', // breadth , not corpus
      'fasse alle dokumente zusammen', // summary intent , not corpus
      'what is a document store?',
      // scope noun is the OBJECT of a content question , not the counted thing:
      'how many documents does chapter 3 mention?', // "does … mention"
      "list the documents' shortcomings", // possessive
      'number of sources cited in chapter 4', // "cited" participle
      'which sources does the author trust?', // "does"
    ]
    for (const q of cases) {
      it(`"${q}" → null`, () => {
        expect(detectCorpusIntent(q)).toBe(null)
      })
    }
  })
})

describe('extractThemeTokens', () => {
  const cases: Array<[string, string[]]> = [
    ['wie viele dokumente habe ich zu strom und spannung?', ['strom', 'spannung']],
    ['which documents cover the wave equation?', ['wave', 'equation']],
    ['welche dokumente behandeln neuronale netze?', ['neuronale', 'netze']],
    ['how many documents do I have?', []],
    ['liste alle dokumente', []],
  ]
  for (const [q, expected] of cases) {
    it(`"${q}" → [${expected.join(', ')}]`, () => {
      expect(extractThemeTokens(q)).toEqual(expected)
    })
  }
})

describe('resolveRoute', () => {
  const ctx = (
    overrides: Partial<{ activeDocumentIds: number[] | null; docs: RouteDocument[] }> = {},
  ): { activeDocumentIds: number[] | null; getDocuments: ReturnType<typeof vi.fn> } => ({
    activeDocumentIds: overrides.activeDocumentIds ?? null,
    getDocuments: vi.fn().mockResolvedValue(overrides.docs ?? docs),
  })

  it('non-summary query → retrieval WITHOUT touching the documents table', async () => {
    const c = ctx()
    const route = await resolveRoute('wie funktioniert die schlüsselableitung?', c)
    expect(route).toEqual({ kind: 'retrieval' })
    expect(c.getDocuments).not.toHaveBeenCalled()
  })

  it('broad query → retrieval without DB fetch (breadth ≠ route)', async () => {
    const c = ctx()
    expect(await resolveRoute('vergleiche BM25 und dense retrieval', c)).toEqual({
      kind: 'retrieval',
    })
    expect(c.getDocuments).not.toHaveBeenCalled()
  })

  it('summary intent + unique title match → doc_summary', async () => {
    expect(await resolveRoute('fasse mein wochenbuch zusammen', ctx())).toEqual({
      kind: 'doc_summary',
      documentId: 1,
    })
  })

  it('summary intent + exactly one pinned doc → doc_summary without title matching', async () => {
    const c = ctx({ activeDocumentIds: [3] })
    expect(await resolveRoute('fasse das zusammen', c)).toEqual({
      kind: 'doc_summary',
      documentId: 3,
    })
    expect(c.getDocuments).not.toHaveBeenCalled()
  })

  it('summary intent + several pinned docs restricts candidates to the pin', async () => {
    // "wochenbuch" matches doc 1, but doc 1 is not pinned → no match in the
    // pinned set → retrieval fallback
    const c = ctx({ activeDocumentIds: [2, 3] })
    expect(await resolveRoute('fasse mein wochenbuch zusammen', c)).toEqual({ kind: 'retrieval' })
  })

  it('summary intent + no/ambiguous match → retrieval fallback, never an error', async () => {
    expect(await resolveRoute('fasse das mal zusammen', ctx())).toEqual({ kind: 'retrieval' })
  })

  it('documents fetch failure → retrieval fallback', async () => {
    const c = {
      activeDocumentIds: null,
      getDocuments: vi.fn().mockRejectedValue(new Error('db locked')),
    }
    expect(await resolveRoute('summarize the wochenbuch', c)).toEqual({ kind: 'retrieval' })
  })

  it('corpus intent wins over everything and never pays the docs fetch', async () => {
    const c = ctx()
    expect(await resolveRoute('wie viele dokumente habe ich zu strom?', c)).toEqual({
      kind: 'corpus',
      intent: 'count',
      themeTokens: ['strom'],
    })
    expect(c.getDocuments).not.toHaveBeenCalled()
  })

  describe('compound messages bypass the single-intent routes (ADR-0003)', () => {
    it('a corpus question alongside another question → retrieval, not corpus', async () => {
      // The corpus regex matches the 2nd half ; without the compound guard the
      // WHOLE message would route to corpus and drop "what is argon2id".
      const c = ctx()
      expect(
        await resolveRoute('what is argon2id? how many documents do I have about the vault?', c),
      ).toEqual({ kind: 'retrieval' })
    })

    it('a summarize question alongside another question → retrieval, not doc_summary', async () => {
      expect(
        await resolveRoute(
          'fasse mein wochenbuch zusammen? und was ist die schlüsselableitung?',
          ctx(),
        ),
      ).toEqual({ kind: 'retrieval' })
    })

    it('a single corpus question is unaffected', async () => {
      expect(await resolveRoute('wie viele dokumente habe ich zu strom?', ctx())).toEqual({
        kind: 'corpus',
        intent: 'count',
        themeTokens: ['strom'],
      })
    })
  })

  describe('workspace-pin fallback (pinnedFallbackDocumentId)', () => {
    it('"fasse das zusammen" + one pinned doc → that doc as last resort', async () => {
      const c = { ...ctx(), pinnedFallbackDocumentId: 4 }
      expect(await resolveRoute('fasse das zusammen', c)).toEqual({
        kind: 'doc_summary',
        documentId: 4,
      })
    })

    it('an explicit title match always beats the pin — pinning is emphasis, not focus', async () => {
      const c = { ...ctx(), pinnedFallbackDocumentId: 4 }
      expect(await resolveRoute('fasse mein wochenbuch zusammen', c)).toEqual({
        kind: 'doc_summary',
        documentId: 1,
      })
    })

    it('an ambiguous title tie does NOT fall through to the pin', async () => {
      const twins: RouteDocument[] = [
        { id: 10, title: 'Laborbericht Optik' },
        { id: 11, title: 'Laborbericht Mechanik' },
      ]
      const c = { ...ctx({ docs: twins }), pinnedFallbackDocumentId: 4 }
      expect(await resolveRoute('fasse den laborbericht zusammen', c)).toEqual({
        kind: 'retrieval',
      })
    })

    it('does NOT summarize a pinned doc scoped OUT of the conversation focus', async () => {
      // active focus = docs 2 & 3 ; the workspace pin (doc 4) is not in it.
      // Every other path treats activeDocumentIds as a hard filter , so the
      // pin fallback must too — otherwise "fasse das zusammen" summarizes a
      // doc the user explicitly scoped out.
      const c = { ...ctx({ activeDocumentIds: [2, 3] }), pinnedFallbackDocumentId: 4 }
      expect(await resolveRoute('fasse das zusammen', c)).toEqual({ kind: 'retrieval' })
    })

    it('fires when the pin IS within the conversation focus', async () => {
      const c = { ...ctx({ activeDocumentIds: [2, 4] }), pinnedFallbackDocumentId: 4 }
      expect(await resolveRoute('fasse das zusammen', c)).toEqual({
        kind: 'doc_summary',
        documentId: 4,
      })
    })
  })
})

// ---------------------------------------------------------------------------
// QAService-level: the doc_summary route end-to-end over fakes
// ---------------------------------------------------------------------------

const mkHit = (id: number, docId: number, title: string): RetrievalHit =>
  ({
    chunk_id: id,
    document_id: docId,
    document_title: title,
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: null,
    text: `chunk ${id} text`,
    score: 0.5,
    language: null,
  }) as RetrievalHit

function buildFakes(opts: {
  summary?: string | null
  tokenCount?: number
  cpu?: boolean
  status?: string
  docWorkspaceId?: number
  corpusDocs?: Array<{ id: number; title: string; chunkHits: number; firstChunkId: number | null }>
  embedderReady?: boolean
  summarizeImpl?: () => Promise<{ summary: string; cached: boolean }>
}): {
  qa: QAService
  llmAsk: ReturnType<typeof vi.fn>
  summarize: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
  searchDocumentsByTheme: ReturnType<typeof vi.fn>
  embed: ReturnType<typeof vi.fn>
} {
  const llmAsk = vi.fn(async (...args: [string, RetrievalHit[], AskOptions]) => {
    void args
    return 'answer'
  })
  const llm = {
    setLanguage: vi.fn().mockResolvedValue(undefined),
    contextWindowTokens: () => 8192,
    isCpuInference: () => opts.cpu ?? false,
    ask: llmAsk,
  }
  // Embedder fake — default NOT ready, so the corpus theme-embedding arm stays
  // off and themeEmbedding is null (the literal path). Set embedderReady to
  // exercise the summary-embedding signal.
  const embed = vi.fn().mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])])
  const embedder = { isReady: () => opts.embedderReady ?? false, embed }
  const registry = { llm: () => llm, embedder: () => embedder } as unknown as ProviderRegistry
  const search = vi.fn().mockResolvedValue([mkHit(11, 1, 'TudosaDenys_Wochenbuch.pdf')])
  const retrieval = { search } as unknown as RetrievalService
  const searchDocumentsByTheme = vi.fn().mockResolvedValue(opts.corpusDocs ?? [])
  const documentsRepo = {
    // answer() fetches workspace-pinned docs up-front; none in these scenarios.
    listPinned: vi.fn().mockResolvedValue([]),
    listDocumentTitles: vi.fn().mockResolvedValue([{ id: 1, title: 'TudosaDenys_Wochenbuch.pdf' }]),
    getDocument: vi.fn().mockResolvedValue({
      id: 1,
      workspaceId: opts.docWorkspaceId ?? 1,
      title: 'TudosaDenys_Wochenbuch.pdf',
      status: opts.status ?? 'ready',
      summary: opts.summary ?? null,
      tokenCount: opts.tokenCount ?? 2000,
    }),
    searchDocumentsByTheme,
  }
  const db = { documents: () => documentsRepo } as unknown as Database
  const summarize = vi.fn(
    opts.summarizeImpl ??
      (async () => ({ summary: 'Cached overview of the Wochenbuch.', cached: true })),
  )
  const summarization = { summarize } as unknown as SummarizationService
  return {
    qa: new QAService(db, retrieval, registry, summarization),
    llmAsk,
    summarize,
    search,
    searchDocumentsByTheme,
    embed,
  }
}

async function collect(qa: QAService, query: string, answerOpts = {}): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const ev of qa.answer(1, query, answerOpts)) events.push(ev)
  return events
}

describe('QAService doc_summary route', () => {
  it('uses the cached summary as preamble, pins search to the doc, cites only chunks', async () => {
    const { qa, llmAsk, summarize, search } = buildFakes({ summary: 'Cached overview.' })
    const events = await collect(qa, 'fasse mein wochenbuch zusammen')

    expect(summarize).toHaveBeenCalledWith(1, expect.anything())
    // top-up retrieval pinned to the resolved doc
    expect(search.mock.calls[0]![3]).toMatchObject({ activeDocumentIds: [1] })
    // preamble reached the provider; citations stay chunk-bound (Option A)
    const askOpts = llmAsk.mock.calls[0]![2] as AskOptions
    expect(askOpts.contextPreamble).toContain('Cached overview of the Wochenbuch.')
    const citations = events.filter((e) => e.type === 'citation')
    expect(citations).toEqual([{ type: 'citation', doc_id: 1, chunk_id: 11, score: 0.5 }])
    // stage telemetry: route fired and summarize reported the cache hit
    const stages = events.filter((e) => e.type === 'stage')
    expect(stages.some((s) => s.type === 'stage' && s.stage === 'route')).toBe(true)
    expect(
      stages.some((s) => s.type === 'stage' && s.stage === 'summarize' && s.detail === 'cached'),
    ).toBe(true)
  })

  it('routing: false pins the old behaviour — no summarize, no route stage', async () => {
    const { qa, summarize } = buildFakes({ summary: 'Cached overview.' })
    const events = await collect(qa, 'fasse mein wochenbuch zusammen', { routing: false })
    expect(summarize).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'stage' && e.stage === 'route')).toBe(false)
  })

  it('CPU + cache miss + long doc falls back to retrieval (no summarize call)', async () => {
    const { qa, summarize } = buildFakes({ summary: null, tokenCount: 500_000, cpu: true })
    const events = await collect(qa, 'fasse mein wochenbuch zusammen')
    expect(summarize).not.toHaveBeenCalled()
    // pipeline still answered via the chunk path
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('CPU + cache HIT serves the summary regardless of doc length', async () => {
    const { qa, summarize } = buildFakes({
      summary: 'Cached overview.',
      tokenCount: 500_000,
      cpu: true,
    })
    await collect(qa, 'fasse mein wochenbuch zusammen')
    expect(summarize).toHaveBeenCalled()
  })

  it('non-ready doc (mid-reindex / failed import) never reaches the summarizer', async () => {
    // The single-pin shortcut returns an unvalidated id; without the status
    // gate a partial chunk set would be summarized and CACHED until the next
    // reindex — served as the authoritative whole-doc overview by chat AND
    // the Library action.
    const { qa, summarize } = buildFakes({ summary: null, status: 'indexing' })
    const events = await collect(qa, 'fasse das zusammen', { activeDocumentIds: [1] })
    expect(summarize).not.toHaveBeenCalled()
    expect(
      events.some(
        (e) =>
          e.type === 'stage' && e.stage === 'route' && e.detail === '→ retrieval (doc not ready)',
      ),
    ).toBe(true)
  })

  it('foreign-workspace pinned id never leaks its summary into this chat', async () => {
    const { qa, summarize } = buildFakes({ summary: 'Cached overview.', docWorkspaceId: 99 })
    await collect(qa, 'fasse das zusammen', { activeDocumentIds: [1] })
    expect(summarize).not.toHaveBeenCalled()
  })

  it('CPU-guard fallback reports its outcome in the route stage detail', async () => {
    const { qa } = buildFakes({ summary: null, tokenCount: 500_000, cpu: true })
    const events = await collect(qa, 'fasse mein wochenbuch zusammen')
    expect(
      events.some(
        (e) => e.type === 'stage' && e.stage === 'route' && e.detail === '→ retrieval (cpu guard)',
      ),
    ).toBe(true)
  })

  it('summarizer failure falls back to retrieval instead of erroring', async () => {
    const { qa, llmAsk } = buildFakes({
      summary: null,
      summarizeImpl: async () => {
        throw new Error('model_not_ready')
      },
    })
    const events = await collect(qa, 'fasse mein wochenbuch zusammen')
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    const askOpts = llmAsk.mock.calls[0]![2] as AskOptions
    expect(askOpts.contextPreamble).toBeUndefined()
  })

  it('zero top-up hits with a summary present does NOT refuse (doc-pinned fallback)', async () => {
    const { qa, search } = buildFakes({ summary: 'Cached overview.' })
    search.mockResolvedValue([])
    const events = await collect(qa, 'fasse mein wochenbuch zusammen')
    expect(events.some((e) => e.type === 'refusal')).toBe(false)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })
})

describe('QAService corpus route', () => {
  const corpusDocs = [
    { id: 1, title: 'Strom und Spannung — Grundlagen', chunkHits: 5, firstChunkId: 11 },
    { id: 2, title: 'Netzteil Notizen', chunkHits: 2, firstChunkId: 21 },
  ]

  it('answers a count query from the documents table — no LLM, no chunk retrieval', async () => {
    const { qa, llmAsk, search, searchDocumentsByTheme } = buildFakes({ corpusDocs })
    const events = await collect(qa, 'wie viele dokumente habe ich zu strom?')

    // embedder not ready (default) → no theme embedding, literal path only
    expect(searchDocumentsByTheme).toHaveBeenCalledWith(1, ['strom'], {
      activeDocumentIds: null,
      themeEmbedding: null,
    })
    expect(llmAsk).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()

    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
    if (done?.type === 'done') {
      expect(done.full_text).toContain('**2**')
      expect(done.full_text).toContain('[doc:1, chunk:11]')
      expect(done.full_text).toContain('[doc:2, chunk:21]')
      expect(done.citations).toEqual([
        { doc_id: 1, chunk_id: 11, score: 1 },
        { doc_id: 2, chunk_id: 21, score: 0.4 },
      ])
    }
    // stage telemetry: route → corpus , lookup reported the doc count
    expect(
      events.some((e) => e.type === 'stage' && e.stage === 'route' && e.detail === '→ corpus'),
    ).toBe(true)
    expect(
      events.some((e) => e.type === 'stage' && e.stage === 'corpus' && e.detail === '2 docs'),
    ).toBe(true)
  })

  it('zero theme matches → existing refusal contract, no generation', async () => {
    const { qa, llmAsk } = buildFakes({ corpusDocs: [] })
    const events = await collect(qa, 'which documents cover quantum chromodynamics?')
    expect(llmAsk).not.toHaveBeenCalled()
    const refusal = events.find((e) => e.type === 'refusal')
    expect(refusal).toBeDefined()
    if (refusal?.type === 'refusal') expect(refusal.reason).toBe('no_hits')
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('respects the source-focus pin', async () => {
    const { qa, searchDocumentsByTheme } = buildFakes({ corpusDocs })
    await collect(qa, 'wie viele dokumente habe ich zu strom?', { activeDocumentIds: [1, 2] })
    expect(searchDocumentsByTheme).toHaveBeenCalledWith(1, ['strom'], {
      activeDocumentIds: [1, 2],
      themeEmbedding: null,
    })
  })

  it('embeds the theme and passes it through when the embedder is ready', async () => {
    const { qa, searchDocumentsByTheme, embed } = buildFakes({ corpusDocs, embedderReady: true })
    await collect(qa, 'wie viele dokumente habe ich zu strom?')
    expect(embed).toHaveBeenCalledWith(['strom'])
    expect(searchDocumentsByTheme).toHaveBeenCalledWith(1, ['strom'], {
      activeDocumentIds: null,
      themeEmbedding: [expect.closeTo(0.1, 5), expect.closeTo(0.2, 5), expect.closeTo(0.3, 5)],
    })
  })

  it('themeless count does not embed (nothing to match semantically)', async () => {
    const { qa, embed, searchDocumentsByTheme } = buildFakes({ corpusDocs, embedderReady: true })
    await collect(qa, 'wie viele dokumente habe ich?')
    expect(embed).not.toHaveBeenCalled()
    expect(searchDocumentsByTheme).toHaveBeenCalledWith(1, [], {
      activeDocumentIds: null,
      themeEmbedding: null,
    })
  })

  it('routing: false keeps corpus queries on the chunk pipeline', async () => {
    const { qa, search, searchDocumentsByTheme } = buildFakes({ corpusDocs })
    await collect(qa, 'wie viele dokumente habe ich zu strom?', { routing: false })
    expect(searchDocumentsByTheme).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalled()
  })

  it('every emitted citation marker appears in the rendered text — no phantoms past the cap', async () => {
    // >CORPUS_LIST_MAX docs with a chunk-less doc inside the top 20. The
    // citation list must be slice-then-filter (mirroring the rendered list) ,
    // not filter-then-slice , or a doc from past the cut gets a citation event
    // whose marker is hidden behind "… und N weitere".
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      title: `doc ${i + 1}`,
      chunkHits: 25 - i,
      firstChunkId: i === 5 ? null : (i + 1) * 100,
    }))
    const { qa } = buildFakes({ corpusDocs: many })
    const events = await collect(qa, 'wie viele dokumente habe ich zu strom?')
    const done = events.find((e) => e.type === 'done')
    const citationEvents = events.filter((e) => e.type === 'citation')
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      // citations on the done event match the streamed citation events
      expect(done.citations).toEqual(
        citationEvents.map((e) =>
          e.type === 'citation' ? { doc_id: e.doc_id, chunk_id: e.chunk_id, score: e.score } : null,
        ),
      )
      // and EVERY citation's marker is present in the rendered answer text
      for (const c of done.citations) {
        expect(done.full_text).toContain(`[doc:${c.doc_id}, chunk:${c.chunk_id}]`)
      }
      // the chunk-less doc at rank 6 contributes no citation
      expect(done.citations.some((c) => c.doc_id === 6)).toBe(false)
    }
  })
})
