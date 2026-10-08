import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QAService } from '@main/services/qa/QAService'
import { runChatTurn } from '@main/services/qa/chatTurn'
import { CHECKED_ANSWER_SCHEMA, parseCheckedAnswer } from '@main/services/qa/checkedAnswer'
import { findCitationMatches } from '@shared/citationMarkers'
import { answerMaxTokens, estimateTokens } from '@main/services/llm/prompt'
import type { LlmProvider } from '@main/services/providers/types'
import type { AnswerOptions, RetrievalHit, StreamEvent } from '@shared/documents'

const hit: RetrievalHit = {
  document_id: 1,
  chunk_id: 10,
  document_title: 'Ledger',
  text: 'The recorded quantity is 42.',
  score: 1,
  ordinal: 0,
  heading_path: null,
  language: 'en',
  page_from: null,
  page_to: null,
}
const answerText = 'The recorded quantity is 42.'
const visible = `${answerText} [doc:1, chunk:10]`
const legacyPrivateCheck = 'Private legacy comparison that must not be published'
const privateCheck = 'Private source comparison that must not be published'
const envelope = (text = answerText) =>
  JSON.stringify({
    check: privateCheck,
    result: { resolution: 'answered', blocks: [{ text, sources: ['1:10'] }] },
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(
  options: { identity?: string; codebase?: boolean; pinned?: boolean; hits?: RetrievalHit[] } = {},
) {
  const llm = {
    getStatus: () => ({
      ready: true,
      message: null,
      identity: options.identity ?? 'bundled:fixture',
    }),
    contextWindowTokens: () => 8192,
    prepareContext: vi.fn(async () => 8192),
    setLanguage: vi.fn(async () => {}),
    setCodebaseMode: vi.fn(async () => {}),
    generateRaw: vi.fn<LlmProvider['generateRaw']>(async () => envelope()),
    ask: vi.fn<LlmProvider['ask']>(async () => 'Existing answer path'),
  }
  const docs = {
    listPinned: async () =>
      options.pinned ? [{ id: 2, title: 'Pinned source', workspaceId: 1 }] : [],
    listChunksForDocument: async () => [
      {
        id: 20,
        document_id: 2,
        ordinal: 0,
        text: 'The pinned record is 17.',
        page_from: null,
        page_to: null,
        heading_path: null,
        language: 'en',
      },
    ],
    listDocumentTitles: async () => [{ id: 1, title: 'Ledger' }],
    getDocument: async () => ({
      id: 1,
      workspaceId: 1,
      title: 'Ledger',
      status: 'ready',
      summary: 'Cached original overview.',
      tokenCount: 20,
    }),
  }
  const summarize = vi.fn(async () => ({ summary: 'Cached original overview.', cached: true }))
  const registry = { llm: vi.fn(() => llm) }
  const qa = new QAService(
    { documentsFor: async () => docs } as never,
    { search: async () => options.hits ?? [hit] } as never,
    registry as never,
    { summarize } as never,
    async () => options.codebase ?? false,
  )
  const events: StreamEvent[] = []
  const collect = async (
    opts: AnswerOptions = {},
    signal?: AbortSignal,
    query = 'What quantity is recorded?',
  ) => {
    for await (const event of qa.answer(
      1,
      query,
      { language: 'en', routing: false, ...opts },
      signal,
    ))
      events.push(event)
    return events
  }
  return { qa, llm, registry, summarize, events, collect }
}

beforeEach(() => vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', '0'))
afterEach(() => vi.unstubAllEnvs())

describe('standalone bundled checked answers', () => {
  it.each([
    ['What quantity is recorded?', 'full'],
    ['What quantity is recorded? Answer in one sentence.', 'summary'],
  ] as const)(
    'uses the regular JSON grammar for the checked plan: %s',
    async (query, comparisonMode) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const f = fixture()
        const events = await f.collect({}, undefined, query)
        expect(events.at(-1)?.type).toBe('done')
        const options = f.llm.generateRaw.mock.calls[0]![1]
        const call = log.mock.calls.find(
          ([message]) => typeof message === 'string' && message.startsWith('[qa] checked answer: '),
        )![0] as string
        const diagnostic = JSON.parse(call.slice('[qa] checked answer: '.length))
        expect(diagnostic.comparisonMode).toBe(comparisonMode)
        expect(Object.hasOwn(options, 'jsonStringPolicy')).toBe(false)
        expect(Object.hasOwn(diagnostic, 'jsonStringPolicy')).toBe(false)
      } finally {
        log.mockRestore()
      }
    },
  )

  it('publishes attributed exact comparison reports with canonical citations and no private check', async () => {
    const f = fixture({
      hits: [
        {
          ...hit,
          document_title: 'Blue note',
          text: 'Blue: the service interval is not 12 weeks. This excerpt establishes no priority.',
        },
        {
          ...hit,
          document_id: 2,
          chunk_id: 20,
          document_title: 'Green note',
          text: 'Green: the service interval is 12 weeks. This excerpt establishes no priority.',
        },
      ],
    })
    f.llm.generateRaw.mockResolvedValue(
      JSON.stringify({
        check: privateCheck,
        result: {
          resolution: 'comparison',
          summary: {
            scope: [{ text: 'service interval', source: '1:10' }],
            alternatives: [
              { label: 'Blue', value: 'not 12 weeks', source: '1:10' },
              { label: 'Green', value: '12 weeks', source: '2:20' },
            ],
            grounds: [
              {
                kind: 'priority',
                evidence: [
                  { text: 'This excerpt establishes no priority.', source: '1:10' },
                  { text: 'This excerpt establishes no priority.', source: '2:20' },
                ],
              },
            ],
          },
          outcome: 'unresolved',
        },
      }),
    )
    const events = await f.collect({}, undefined, 'Compare the intervals. Answer in one sentence.')
    const answer = events
      .filter((event) => event.type === 'token')
      .map((event) => event.text)
      .join('')
    expect(events.at(-1)?.type).toBe('done')
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(answer).toBe(
      'For “service interval” [doc:1, chunk:10], “Blue” reports “not 12 weeks” [doc:1, chunk:10] and “Green” reports “12 weeks” [doc:2, chunk:20]; because these excerpts do not establish priority, which statement governs remains unresolved [doc:1, chunk:10] [doc:2, chunk:20].',
    )
    expect(answer).not.toContain(privateCheck)
    expect(
      findCitationMatches(answer).map(({ documentId, chunkId }) => [documentId, chunkId]),
    ).toEqual([
      [1, 10],
      [1, 10],
      [2, 20],
      [1, 10],
      [2, 20],
    ])
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('logs only the fixed comparison rejection category without publishing source text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const f = fixture({
        hits: [{ ...hit, document_title: 'PRIVATE_TITLE', text: 'PRIVATE_SOURCE quantity is 42.' }],
      })
      f.llm.generateRaw.mockResolvedValue(
        JSON.stringify({
          check: privateCheck,
          result: {
            resolution: 'comparison',
            summary: { text: 'PRIVATE_BODY. Another sentence', sources: ['1:10'] },
            outcome: 'unresolved',
          },
        }),
      )
      const events = await f.collect(
        {},
        undefined,
        'Compare the quantities. Answer in one sentence.',
      )
      expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
      expect(events.some((event) => event.type === 'token' || event.type === 'done')).toBe(false)
      expect(f.llm.ask).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('[qa] checked rejection: comparison')
      expect(log).toHaveBeenCalledWith('[qa] checked comparison rejection detail: summary_shape')
      const exposed = JSON.stringify({ logs: log.mock.calls, events })
      for (const sentinel of [privateCheck, 'PRIVATE_TITLE', 'PRIVATE_SOURCE', 'PRIVATE_BODY'])
        expect(exposed).not.toContain(sentinel)
    } finally {
      log.mockRestore()
    }
  })

  it('logs only fixed rejection detail while withholding the rejected final payload', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const f = fixture()
      f.llm.generateRaw.mockResolvedValue(envelope('PRIVATE_BODY [doc:1, chunk:10]'))
      const events = await f.collect()
      expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
      expect(events.filter((event) => event.type === 'token')).toEqual([])
      expect(f.llm.ask).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('[qa] checked rejection: answer')
      expect(log).toHaveBeenCalledWith('[qa] checked rejection detail: citation_syntax')
      const exposed = JSON.stringify({ logs: log.mock.calls, events })
      expect(exposed).not.toContain('PRIVATE_BODY')
    } finally {
      log.mockRestore()
    }
  })

  it('publishes and persists only the final answer, with progress and exact context citations', async () => {
    const f = fixture()
    const controller = new AbortController()
    const events: StreamEvent[] = []
    const persist = vi.fn(async () => {})
    const turn = await runChatTurn({
      signal: controller.signal,
      language: 'en',
      persist,
      stream: () =>
        f.qa.answer(
          1,
          'What quantity is recorded?',
          { language: 'en', routing: false },
          controller.signal,
        ),
      emit: (event) => {
        events.push(event)
      },
    })
    expect(turn.content).toBe(visible)
    expect(turn.outcome).toBe('completed')
    expect(turn.citations).toEqual([{ doc_id: 1, chunk_id: 10, score: 1 }])
    expect(persist).toHaveBeenCalledExactlyOnceWith(turn)
    expect(JSON.stringify({ events, turn })).not.toContain('"resolution"')
    expect(JSON.stringify({ events, turn })).not.toContain(privateCheck)
    expect(events.filter((event) => event.type === 'token')).toEqual([
      { type: 'token', text: visible, count: 0 },
    ])
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1)
    expect(events).toContainEqual({ type: 'stage', stage: 'evidence', status: 'start' })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'stage', stage: 'evidence', status: 'done' }),
    )
    expect(f.llm.ask).not.toHaveBeenCalled()
    expect(f.llm.setLanguage).toHaveBeenCalledExactlyOnceWith('en')
    expect(f.llm.setCodebaseMode).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('uses the actual 8K prompt/output budget, including pinned sources and longer answers', async () => {
    const f = fixture({ pinned: true })
    const long = 'A detailed source-based explanation. '.repeat(100) + answerText
    f.llm.generateRaw.mockResolvedValue(envelope(long))
    const events = await f.collect()
    const [prompt, options] = f.llm.generateRaw.mock.calls[0]!
    expect(prompt).toContain('[doc:2, chunk:20]')
    expect(prompt).toContain('[doc:1, chunk:10]')
    expect(options).toMatchObject({
      plannedContextTokens: 8192,
      maxTokens: answerMaxTokens(8192) + 128,
      noThink: true,
      maxBoundedThoughtTokens: 128,
      temperature: 0,
      repeatPenalty: false,
      requireComplete: true,
    })
    const schema = options!.jsonSchema as {
      properties: {
        result: {
          oneOf: Array<{
            properties: {
              resolution: { const: string }
              sources?: {
                minItems: number
                maxItems: number
                items: { enum: string[] }
              }
            }
          }>
        }
      }
    }
    const sourceBranches = schema.properties.result.oneOf.filter(
      (branch) => branch.properties.sources,
    )
    expect(Object.keys(schema.properties)).toEqual(['check', 'result'])
    expect(schema).toHaveProperty('required', ['check', 'result'])
    expect(schema).toHaveProperty('properties.check.maxLength', 120)
    expect(sourceBranches).toHaveLength(2)
    for (const branch of sourceBranches)
      expect(branch.properties.sources).toEqual({
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { enum: ['2:20', '1:10'] },
      })
    expect(schema).toHaveProperty(
      'properties.result.oneOf.0.properties.blocks.items.properties.sources.items.enum',
      ['2:20', '1:10'],
    )
    expect(
      estimateTokens(prompt) +
        estimateTokens(options!.systemPrompt!) +
        options!.maxTokens! +
        Math.ceil(8192 / 10),
    ).toBeLessThanOrEqual(8192)
    expect(events.at(-1)).toMatchObject({ type: 'done', full_text: `${long} [doc:1, chunk:10]` })
  })

  it('persists source-backed comparisons without exposing the model envelope', async () => {
    const second = {
      ...hit,
      document_id: 2,
      chunk_id: 20,
      document_title: 'Second ledger',
      text: 'The recorded quantity is 37.',
    }
    const f = fixture({ hits: [hit, second] })
    f.llm.generateRaw.mockResolvedValue(
      JSON.stringify({
        check: privateCheck,
        result: {
          resolution: 'comparison',
          outcome: 'unresolved',
          sources: ['1:10', '2:20'],
        },
      }),
    )
    const persist = vi.fn(async () => {})
    const turn = await runChatTurn({
      signal: new AbortController().signal,
      language: 'en',
      persist,
      stream: () =>
        f.qa.answer(1, 'Which ledger quantity is definitive?', {
          language: 'en',
          routing: false,
        }),
      emit: () => {},
    })
    expect(turn.outcome).toBe('completed')
    expect(turn.content).toContain('42')
    expect(turn.content).toContain('37')
    expect(
      findCitationMatches(turn.content).map(({ documentId, chunkId }) => [documentId, chunkId]),
    ).toEqual([
      [1, 10],
      [2, 20],
    ])
    expect(turn.content).not.toContain('"resolution"')
    expect(persist).toHaveBeenCalledExactlyOnceWith(turn)
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('keeps the original prompt catalog and canonical IDs after caller mutation', async () => {
    const source = {
      ...hit,
      text: 'For ledger B, the first account reports 42. The second account reports 47. This excerpt establishes no priority.',
    }
    const f = fixture({ hits: [source] })
    f.llm.generateRaw.mockImplementation(async (prompt, options) => {
      const schema = options!.jsonSchema as {
        properties: {
          result: {
            oneOf: Array<{
              properties: {
                summary?: {
                  properties: { scope: { items: { properties: { source: { enum: string[] } } } } }
                }
              }
            }>
          }
        }
      }
      const sources = schema.properties.result.oneOf.find((branch) => branch.properties.summary)!
        .properties.summary!.properties.scope.items.properties.source.enum
      expect(sources).toEqual(['1:10'])
      expect(prompt).not.toMatch(/\[U\d+\]|U IDs|U-IDs/u)
      expect(prompt.split(source.text)).toHaveLength(2)
      source.text = 'An unrelated, later source replacement.'
      source.document_title = 'A later renamed source'
      return JSON.stringify({
        check: privateCheck,
        result: {
          resolution: 'comparison',
          summary: {
            scope: [{ text: 'ledger B', source: sources[0] }],
            alternatives: [
              { label: 'first account', value: '42', source: sources[0] },
              { label: 'second account', value: '47', source: sources[0] },
            ],
            grounds: [
              {
                kind: 'priority',
                evidence: [{ text: 'This excerpt establishes no priority.', source: sources[0] }],
              },
            ],
          },
          outcome: 'unresolved',
        },
      })
    })
    const events = await f.collect(
      {},
      undefined,
      'Which reported count governs? Answer in one short sentence.',
    )
    const final = events.at(-1)
    expect(final).toMatchObject({ type: 'done' })
    if (final?.type !== 'done') throw new Error('Expected completed cited summary')
    expect(final.full_text).toBe(
      'For “ledger B” [doc:1, chunk:10], “first account” reports “42” [doc:1, chunk:10] and “second account” reports “47” [doc:1, chunk:10]; because these excerpts do not establish priority, which statement governs remains unresolved [doc:1, chunk:10].',
    )
    expect(findCitationMatches(final.full_text).map((c) => [c.documentId, c.chunkId])).toEqual([
      [1, 10],
      [1, 10],
      [1, 10],
      [1, 10],
    ])
    expect(final.full_text).not.toContain('later source replacement')
    expect(final.full_text).not.toContain('A later renamed source')
    expect(final.full_text).not.toContain('"resolution"')
    expect(final.citations).toEqual([{ doc_id: 1, chunk_id: 10, score: 1 }])
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('rejects an unknown comparison source instead of publishing it or falling back to prose', async () => {
    const f = fixture()
    f.llm.generateRaw.mockResolvedValue(
      JSON.stringify({
        check: privateCheck,
        result: {
          resolution: 'comparison',
          outcome: 'insufficient',
          sources: ['999:999'],
        },
      }),
    )
    const events = await f.collect()
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(events.some((event) => event.type === 'token' || event.type === 'done')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('999:999')
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('retains the selected source identity even when another passage contains the same statement', async () => {
    const second = {
      ...hit,
      document_id: 2,
      chunk_id: 20,
      document_title: 'Another record',
      text: `A second record says: ${hit.text}`,
    }
    const f = fixture({ hits: [hit, second] })
    f.llm.generateRaw.mockResolvedValue(
      JSON.stringify({
        check: privateCheck,
        result: { resolution: 'comparison', outcome: 'insufficient', sources: ['2:20'] },
      }),
    )
    const events = await f.collect()
    const [prompt] = f.llm.generateRaw.mock.calls[0]!
    expect(prompt).toContain('[doc:1, chunk:10]')
    expect(prompt).toContain('[doc:2, chunk:20]')
    const final = events.at(-1)
    expect(final).toMatchObject({ type: 'done' })
    if (final?.type !== 'done') throw new Error('Expected completed comparison')
    expect(final.full_text).toContain('A second record says')
    expect(findCitationMatches(final.full_text).map((c) => [c.documentId, c.chunkId])).toEqual([
      [2, 20],
    ])
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it.each([
    '{"result":',
    '{"check":"x","result":{"resolution":"answered","blocks":[{"text":"first","text":"second","sources":["1:10"]}]}}',
    JSON.stringify({
      result: { resolution: 'answered', blocks: [{ text: answerText, sources: ['1:10'] }] },
    }),
    envelope('Invented source [doc:999, chunk:999].'),
  ])(
    'fails closed without exposing raw output or starting ordinary generation: %s',
    async (raw) => {
      const f = fixture()
      f.llm.generateRaw.mockResolvedValue(raw)
      const events = await f.collect()
      expect(events.filter((event) => event.type === 'error')).toEqual([
        {
          type: 'error',
          message:
            'The answer could not be completed. Please retry or narrow the source selection.',
        },
      ])
      expect(events.some((event) => event.type === 'token' || event.type === 'done')).toBe(false)
      expect(JSON.stringify(events)).not.toContain(legacyPrivateCheck)
      expect(f.llm.ask).not.toHaveBeenCalled()
    },
  )

  it('retains the explicit legacy v1 parser without admitting its envelope into active QA', async () => {
    const raw = JSON.stringify({ check: legacyPrivateCheck, answer: visible })
    expect(parseCheckedAnswer(raw, [hit], 1000)).toBe(visible)
    const f = fixture()
    f.llm.generateRaw.mockResolvedValue(raw)
    const events = await f.collect()
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.some((event) => event.type === 'token' || event.type === 'done')).toBe(false)
    expect(JSON.stringify(events)).not.toContain(legacyPrivateCheck)
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('does not expose provider error payloads or silently retry as ordinary prose', async () => {
    const f = fixture()
    f.llm.generateRaw.mockRejectedValue(new Error('Private source text and path in provider error'))
    const events = await f.collect({ language: 'de' })
    expect(events.at(-1)).toEqual({
      type: 'error',
      message:
        'Die Antwort konnte nicht vollständig erstellt werden. Bitte versuche es erneut oder grenze die Quellenauswahl ein.',
    })
    expect(JSON.stringify(events)).not.toContain('Private source')
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('shows progress while buffering the final payload, then discards it after cancellation', async () => {
    const f = fixture()
    const pending = deferred<string>()
    f.llm.generateRaw.mockReturnValue(pending.promise)
    const controller = new AbortController()
    const running = f.collect({}, controller.signal)
    await vi.waitFor(() => expect(f.llm.generateRaw).toHaveBeenCalledOnce())
    expect(f.events).toContainEqual({ type: 'stage', stage: 'evidence', status: 'start' })
    expect(f.events.some((event) => event.type === 'token')).toBe(false)
    controller.abort()
    pending.resolve(envelope('PRIVATE_LATE_ANSWER'))
    await running
    expect(f.events.some((event) => ['token', 'done', 'error'].includes(event.type))).toBe(false)
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE_LATE_ANSWER')
    expect(f.llm.ask).not.toHaveBeenCalled()
  })

  it('return aborts the buffered checked producer while next is pending', async () => {
    const f = fixture()
    const started = deferred<AbortSignal>()
    f.llm.generateRaw.mockImplementation(
      (_prompt, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.abortSignal!
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          started.resolve(signal)
        }),
    )
    const stream = f.qa.answer(1, 'What quantity is recorded?', { language: 'en', routing: false })
    const events: StreamEvent[] = []
    const running = (async () => {
      for await (const event of stream) events.push(event)
    })()
    const signal = await started.promise
    const close = stream.return!()
    expect(signal.aborted).toBe(true)
    await Promise.all([close, running])
    expect(events.some((event) => ['token', 'done', 'error'].includes(event.type))).toBe(false)
  })

  it.each(['stage', 'token'] as const)(
    'honors cancellation while handling the final %s',
    async (at) => {
      const f = fixture()
      const controller = new AbortController()
      const events: StreamEvent[] = []
      for await (const event of f.qa.answer(
        1,
        'What quantity is recorded?',
        { language: 'en', routing: false },
        controller.signal,
      )) {
        events.push(event)
        if (
          (at === 'stage' &&
            event.type === 'stage' &&
            event.stage === 'evidence' &&
            event.status === 'done') ||
          (at === 'token' && event.type === 'token')
        )
          controller.abort()
      }
      expect(events.some((event) => event.type === 'done' || event.type === 'error')).toBe(false)
      if (at === 'stage') expect(events.some((event) => event.type === 'token')).toBe(false)
    },
  )

  it.each(['remote', 'history', 'codebase'] as const)(
    'preserves the existing %s answer contract',
    async (mode) => {
      const f = fixture({
        identity: mode === 'remote' ? 'ollama:custom' : 'bundled:fixture',
        codebase: mode === 'codebase',
      })
      const history = [
        { role: 'user' as const, content: 'Earlier context that must remain available' },
      ]
      await f.collect(mode === 'history' ? { history } : {})
      expect(f.llm.generateRaw).not.toHaveBeenCalled()
      expect(f.llm.ask).toHaveBeenCalledOnce()
      if (mode === 'history')
        expect(f.llm.ask.mock.calls[0]![2].conversationHistory).toEqual(history)
      expect(f.llm.setCodebaseMode).toHaveBeenCalledWith(mode === 'codebase')
    },
  )

  it('preserves the cached summary preamble and original source citations', async () => {
    const f = fixture()
    await f.collect({ routing: true, activeDocumentIds: [1] }, undefined, 'Summarize Ledger')
    expect(f.summarize).toHaveBeenCalledOnce()
    expect(f.llm.generateRaw).not.toHaveBeenCalled()
    expect(f.llm.ask.mock.calls[0]![2].contextPreamble).toContain('Cached original overview.')
  })

  it('keeps explicit legacy assessment opt-in without a second checked generation', async () => {
    vi.stubEnv('LOKLM_EVIDENCE_ASSESSMENT', '1')
    const second = { ...hit, document_id: 2, chunk_id: 20, document_title: 'Second source' }
    const f = fixture({ hits: [hit, second] })
    f.llm.generateRaw.mockResolvedValue(
      JSON.stringify({ evidence: { '1:10': [1], '2:20': [1] }, relation: 'compatible' }),
    )
    await f.collect()
    expect(f.llm.generateRaw).toHaveBeenCalledOnce()
    expect(f.llm.generateRaw.mock.calls[0]![1]?.jsonSchema).not.toEqual(CHECKED_ANSWER_SCHEMA)
    expect(f.llm.ask).toHaveBeenCalledOnce()
  })
})
