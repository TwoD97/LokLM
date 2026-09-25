import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import { OllamaLlmProvider } from '@main/services/providers/ollama/OllamaLlmProvider'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { LlmAskPayload } from '@main/services/workers/protocol'
import type { ModelStatus, RetrievalHit } from '@shared/documents'

beforeEach(() => vi.stubEnv('LOKLM_CITATION_ALIASES', '1'))
afterEach(() => vi.unstubAllEnvs())
const source: RetrievalHit = {
  document_id: 2,
  chunk_id: 7,
  document_title: 'Revenue',
  text: 'Revenue is EUR 500.',
  ordinal: 0,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: null,
  score: 1,
}

function nativeFixture(pieces: string[], raw = pieces.join('')) {
  let status!: (patch: Partial<ModelStatus>) => void
  let token!: (text: string, count: number) => void
  const client = {
    setStatusListener: (_kind: string, cb: typeof status) => {
      status = cb
    },
    registerStream: (_id: string, cb: typeof token) => {
      token = cb
      return () => {}
    },
    llmAbort: vi.fn(async () => {}),
    llmAsk: vi.fn(async (_payload: LlmAskPayload) => {
      void _payload
      for (const piece of pieces) token(piece, 1)
      return { raw }
    }),
  }
  const service = new LlamaService({ client: client as unknown as ModelsWorkerClient })
  status({ state: 'ready' })
  return { service, client, token: (text: string) => token(text, 1) }
}

function ollamaFixture(pieces: string[]) {
  const client = {
    postNdjson: vi.fn(async function* (_path: string, _body: unknown, _signal?: AbortSignal) {
      void _path
      void _body
      _signal?.throwIfAborted()
      for (const piece of pieces) yield { message: { content: piece } }
      yield { done: true }
    }),
  }
  return { service: new OllamaLlmProvider(client as never, 'fixture-model'), client }
}

describe('citation aliases at native and external ask boundaries', () => {
  it.each(['native', 'ollama'] as const)(
    'keeps %s stream and final answer canonical',
    async (kind) => {
      const pieces = ['EUR 500 [', 'S', '1', ']', '. Literal `[S1]`. Unknown [S99].']
      const fixture = kind === 'native' ? nativeFixture(pieces) : ollamaFixture(pieces)
      const chunks: string[] = []
      const history = [{ role: 'assistant' as const, content: 'Earlier [doc:42, chunk:5].' }]
      const answer = await fixture.service.ask('How much revenue?', [source], {
        conversationHistory: history,
        onChunk: (text) => chunks.push(text),
      })
      expect(answer).toBe('EUR 500 [doc:2, chunk:7]. Literal `[S1]`. Unknown [S99].')
      expect(chunks.join('').trim()).toBe(answer)
      if (kind === 'native') {
        const payload = (fixture as ReturnType<typeof nativeFixture>).client.llmAsk.mock
          .calls[0]![0]
        expect(payload.prompt).toContain('[S1] (Revenue)\n' + source.text)
        expect(payload.prompt).toContain(history[0]!.content)
      } else {
        const body = (fixture as ReturnType<typeof ollamaFixture>).client.postNdjson.mock
          .calls[0]![1] as { messages: Array<{ content: string }> }
        expect(
          body.messages.some((message) =>
            message.content.includes('[S1] (Revenue)\n' + source.text),
          ),
        ).toBe(true)
        expect(body.messages.some((message) => message.content === history[0]!.content)).toBe(true)
      }
    },
  )

  it.each(['native', 'ollama'] as const)(
    'preserves literal source labels and question text for %s',
    async (kind) => {
      const fixture =
        kind === 'native' ? nativeFixture(['EUR 500 [S3].']) : ollamaFixture(['EUR 500 [S3].'])
      const literal = { ...source, text: 'The literal token is [S1]. Revenue is EUR 500.' }
      const answer = await fixture.service.ask('Explain [S2] and the revenue?', [literal], {})
      expect(answer).toBe('EUR 500 [doc:2, chunk:7].')
      const serialized = JSON.stringify(
        kind === 'native'
          ? (fixture as ReturnType<typeof nativeFixture>).client.llmAsk.mock.calls[0]![0]
          : (fixture as ReturnType<typeof ollamaFixture>).client.postNdjson.mock.calls[0]![1],
      )
      expect(serialized).toContain(literal.text)
      expect(serialized).toContain('Explain [S2] and the revenue?')
    },
  )

  it.each(['native', 'ollama'] as const)('is disabled by default for %s', async (kind) => {
    vi.stubEnv('LOKLM_CITATION_ALIASES', undefined)
    const fixture =
      kind === 'native' ? nativeFixture(['Answer [S1].']) : ollamaFixture(['Answer [S1].'])
    expect(await fixture.service.ask('Question', [source], {})).toBe('Answer [S1].')
    const serialized = JSON.stringify(
      kind === 'native'
        ? (fixture as ReturnType<typeof nativeFixture>).client.llmAsk.mock.calls[0]![0]
        : (fixture as ReturnType<typeof ollamaFixture>).client.postNdjson.mock.calls[0]![1],
    )
    expect(serialized).toContain('[doc:2, chunk:7] (Revenue)')
  })

  it('retries native history overflow with a fresh decoder and the same supplied-source map', async () => {
    const { service, client, token } = nativeFixture(['EUR 500 [S1].'])
    client.llmAsk.mockImplementationOnce(async () => {
      token('[S') // held by the existing think filter until the retry resets it
      throw new Error('context size exceeded')
    })
    const chunks: string[] = []
    const answer = await service.ask('Question', [source], {
      conversationHistory: [{ role: 'user', content: 'Earlier question' }],
      onChunk: (text) => chunks.push(text),
    })
    expect(client.llmAsk).toHaveBeenCalledTimes(2)
    expect(client.llmAsk.mock.calls[1]![0].prompt).not.toContain('Earlier question')
    expect(answer).toBe('EUR 500 [doc:2, chunk:7].')
    expect(chunks.join('')).toBe(answer)
  })

  it('maps native no-stream recovery using the same grammar', async () => {
    const { service } = nativeFixture([], 'EUR 500 [S1].')
    const chunks: string[] = []
    const answer = await service.ask('Question', [source], { onChunk: (text) => chunks.push(text) })
    expect(answer).toBe('EUR 500 [doc:2, chunk:7].')
    expect(chunks.join('')).toBe(answer)
  })

  it('keeps native repetition-loop recovery canonical in both streamed and final output', async () => {
    const { service, client, token } = nativeFixture([])
    client.llmAsk.mockImplementationOnce(async () => {
      for (let i = 0; i < 20; i++) {
        token('A repeated factual sentence with the same supporting source [S1]. ')
        if (client.llmAbort.mock.calls.length) throw new DOMException('Cancelled', 'AbortError')
      }
      throw new Error('Expected repetition detection')
    })
    const chunks: string[] = []
    const answer = await service.ask('Question', [source], { onChunk: (text) => chunks.push(text) })
    expect(client.llmAbort).toHaveBeenCalledOnce()
    expect(answer).toContain('[doc:2, chunk:7]')
    expect(answer).not.toContain('[S1]')
    expect(chunks.join('')).toBe(answer)
  })

  it('does not reclassify leading indented code when final native text is trimmed', async () => {
    const { service } = nativeFixture(['    [S1]\nAnswer [S1].'])
    const chunks: string[] = []
    const answer = await service.ask('Question', [source], { onChunk: (text) => chunks.push(text) })
    expect(answer).toBe('[S1]\nAnswer [doc:2, chunk:7].')
    expect(chunks.join('').trim()).toBe(answer)
  })

  it('forwards native cancellation and does not turn a partial alias into an invented citation', async () => {
    const { service, client } = nativeFixture([])
    const controller = new AbortController()
    client.llmAsk.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('Cancelled', 'AbortError')
    })
    await expect(
      service.ask('Question', [source], { abortSignal: controller.signal }),
    ).rejects.toThrow('Cancelled')
    expect(client.llmAbort).toHaveBeenCalledOnce()
  })

  it('flushes external error tails literally and does not leak decoder state to the next ask', async () => {
    const { service, client } = ollamaFixture(['Answer [S1].'])
    client.postNdjson.mockImplementationOnce(async function* () {
      yield { message: { content: '[S' } }
      throw new Error('connection interrupted')
    })
    const chunks: string[] = []
    await expect(
      service.ask('Question', [source], { onChunk: (text) => chunks.push(text) }),
    ).rejects.toThrow('connection interrupted')
    expect(chunks.join('')).toBe('[S')
    expect(await service.ask('Question', [source], {})).toBe('Answer [doc:2, chunk:7].')
  })
})
