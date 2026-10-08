import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import type { RetrievalHit, StreamEvent } from '@shared/documents'
import { deferred } from './fixtures/retrievalHarness'

const comparison = vi.hoisted(() => ({
  plan: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))
vi.mock('@main/services/qa/evidenceAssessment', () => ({
  planEvidenceAssessment: comparison.plan,
  parseEvidenceAssessment: comparison.parse,
  renderUnresolvedEvidence: comparison.render,
}))

const hits: RetrievalHit[] = [1, 2].map((id) => ({
  document_id: id,
  chunk_id: id * 10,
  document_title: `Source ${id}`,
  text: `Source ${id} states a different proposed date.`,
  score: 1,
  ordinal: 0,
  heading_path: null,
  language: 'en',
  page_from: null,
  page_to: null,
}))

function fixture() {
  const llm = {
    contextWindowTokens: () => 8192,
    prepareContext: vi.fn(async () => 4096),
    generateRaw: vi.fn(async () => 'assessment'),
    setLanguage: vi.fn(async () => {}),
    ask: vi.fn(async () => 'Ordinary answer'),
  }
  const qa = new QAService(
    { documentsFor: async () => ({ listPinned: async () => [] }) } as never,
    { search: async () => hits } as never,
    { llm: () => llm } as never,
    {} as never,
  )
  const events: StreamEvent[] = []
  const collect = async (signal?: AbortSignal) => {
    for await (const event of qa.answer(
      1,
      'Which date is established?',
      { language: 'en', routing: false },
      signal,
    ))
      events.push(event)
    return events
  }
  return { qa, llm, events, collect }
}

beforeEach(() => {
  vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', '1')
  comparison.plan.mockReset().mockReturnValue({
    prompt: 'Compare exact supplied passages',
    systemPrompt: 'Source comparison',
    jsonSchema: { type: 'object' },
    maxTokens: 384,
  })
  comparison.parse.mockReset().mockReturnValue({ relation: 'unresolved' })
  comparison.render
    .mockReset()
    .mockReturnValue('Conflicting proposals [doc:1, chunk:10] [doc:2, chunk:20]')
})
afterEach(() => vi.unstubAllEnvs())

describe('QA source comparison boundary', () => {
  it('shows progress while assessing actual packed evidence and never regenerates an unresolved result', async () => {
    const f = fixture()
    const pending = deferred<string>()
    f.llm.generateRaw.mockReturnValue(pending.promise)
    const running = f.collect()
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    expect(f.events).toContainEqual({ type: 'stage', stage: 'evidence', status: 'start' })
    expect(f.events.some((event) => event.type === 'token')).toBe(false)
    expect(comparison.plan).toHaveBeenCalledWith('Which date is established?', hits, 4096)
    expect(f.llm.generateRaw).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ plannedContextTokens: 4096, requireComplete: true, noThink: true }),
    )
    pending.resolve('assessment')
    await running
    expect(comparison.parse).toHaveBeenCalledWith('assessment', hits)
    expect(f.llm.ask).not.toHaveBeenCalled()
    expect(f.events.at(-1)).toMatchObject({
      type: 'done',
      full_text: 'Conflicting proposals [doc:1, chunk:10] [doc:2, chunk:20]',
    })
  })

  it.each(['compatible', 'resolved', 'insufficient'])(
    'does not promote a %s classification into answer evidence',
    async (relation) => {
      comparison.parse.mockReturnValue({ relation })
      const f = fixture()
      await f.collect()
      expect(f.llm.ask).toHaveBeenCalledWith(
        'Which date is established?',
        hits,
        expect.not.objectContaining({ contextPreamble: expect.anything() }),
      )
      expect(f.events.at(-1)).toMatchObject({ type: 'done', full_text: 'Ordinary answer' })
    },
  )

  it('propagates cancellation and emits no late answer when a provider resolves after cancel', async () => {
    const f = fixture()
    const pending = deferred<string>()
    f.llm.generateRaw.mockReturnValue(pending.promise)
    const ctrl = new AbortController()
    const running = f.collect(ctrl.signal)
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    expect(f.llm.generateRaw).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
    ctrl.abort()
    pending.resolve('assessment')
    await running
    expect(f.llm.ask).not.toHaveBeenCalled()
    expect(f.events.some((event) => ['token', 'done', 'error'].includes(event.type))).toBe(false)
  })

  it.each(['stage', 'token'])(
    'honors cancellation while the consumer handles the final %s event',
    async (at) => {
      const f = fixture()
      const ctrl = new AbortController()
      const events: StreamEvent[] = []
      for await (const event of f.qa.answer(
        1,
        'Which date is established?',
        { language: 'en', routing: false },
        ctrl.signal,
      )) {
        events.push(event)
        if (
          (at === 'stage' &&
            event.type === 'stage' &&
            event.stage === 'evidence' &&
            event.status === 'done') ||
          (at === 'token' && event.type === 'token')
        )
          ctrl.abort()
      }
      expect(events.some((event) => event.type === 'done')).toBe(false)
      if (at === 'stage') expect(events.some((event) => event.type === 'token')).toBe(false)
      expect(f.llm.ask).not.toHaveBeenCalled()
    },
  )

  it.each(['invalid', 'rejected'])(
    'does not hide an %s assessment behind an unchecked answer',
    async (kind) => {
      const f = fixture()
      if (kind === 'invalid') comparison.parse.mockReturnValue(null)
      else f.llm.generateRaw.mockRejectedValue(new Error('Private provider/source text'))
      await f.collect()
      expect(f.llm.ask).not.toHaveBeenCalled()
      expect(f.events.at(-1)).toEqual({
        type: 'error',
        message:
          'The source comparison could not be completed. Please retry or narrow the source selection.',
      })
      expect(JSON.stringify(f.events)).not.toContain('Private provider/source text')
    },
  )

  it('does not claim an assessment ran when the bounded planner cannot cover the passages', async () => {
    comparison.plan.mockReturnValue(null)
    const f = fixture()
    await f.collect()
    expect(f.llm.generateRaw).not.toHaveBeenCalled()
    expect(f.events.some((event) => event.type === 'stage' && event.stage === 'evidence')).toBe(
      false,
    )
    expect(f.llm.ask).toHaveBeenCalledOnce()
  })

  it('keeps the experiment disabled unless explicitly enabled', async () => {
    vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', '0')
    const f = fixture()
    await f.collect()
    expect(f.llm.generateRaw).not.toHaveBeenCalled()
    expect(f.llm.ask).toHaveBeenCalledOnce()
  })
})
