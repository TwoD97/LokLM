import { describe, it, expect, vi } from 'vitest'
import {
  resolveRoute,
  resolveTargetDocument,
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
  summarizeImpl?: () => Promise<{ summary: string; cached: boolean }>
}): {
  qa: QAService
  llmAsk: ReturnType<typeof vi.fn>
  summarize: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
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
  const registry = { llm: () => llm } as unknown as ProviderRegistry
  const search = vi.fn().mockResolvedValue([mkHit(11, 1, 'TudosaDenys_Wochenbuch.pdf')])
  const retrieval = { search } as unknown as RetrievalService
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
  }
  const db = { documents: () => documentsRepo } as unknown as Database
  const summarize = vi.fn(
    opts.summarizeImpl ??
      (async () => ({ summary: 'Cached overview of the Wochenbuch.', cached: true })),
  )
  const summarization = { summarize } as unknown as SummarizationService
  return { qa: new QAService(db, retrieval, registry, summarization), llmAsk, summarize, search }
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
