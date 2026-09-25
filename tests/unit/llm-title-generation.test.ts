import { afterEach, expect, it, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { ModelStatus } from '@shared/documents'

afterEach(() => vi.useRealTimers())

function fixture(resident = true) {
  let status!: (patch: Partial<ModelStatus>) => void
  const generate = vi.fn().mockResolvedValue({ raw: 'Library opening times' })
  const abort = vi.fn().mockResolvedValue(undefined)
  const service = new LlamaService({
    client: {
      setStatusListener: (_kind: string, cb: typeof status) => {
        status = cb
      },
      llmGenerateRaw: generate,
      llmAbort: abort,
    } as never,
  })
  status({ state: 'ready', resident })
  return { service, generate, abort }
}

it('bounds automatic titles, disables reasoning, and isolates their instructions', async () => {
  const { service, generate } = fixture()
  expect(await service.generateTitle('When does it open?', 'At nine.')).toBe(
    'Library opening times',
  )
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      maxTokens: 48,
      noThink: true,
      background: true,
      systemPrompt: 'Write only a short conversation title in the requested language.',
    }),
  )
})

it('does not restore a parked chat model for a title', async () => {
  const { service, generate } = fixture(false)
  expect(await service.generateTitle('Question', 'Answer')).toBeNull()
  expect(generate).not.toHaveBeenCalled()
})

it('aborts a slow title and releases its timeout instead of occupying the worker indefinitely', async () => {
  vi.useFakeTimers()
  const { service, generate, abort } = fixture()
  let reject!: (error: Error) => void
  generate.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  abort.mockImplementation(async () => {
    reject(new Error('aborted'))
  })
  const title = service.generateTitle('Question', 'Answer')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await title).toBeNull()
  expect(abort).toHaveBeenCalledWith(generate.mock.calls[0]![0].streamId)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start a title cancelled before dispatch', async () => {
  const { service, generate } = fixture()
  const controller = new AbortController()
  controller.abort()
  expect(
    await service.generateTitle('Question', 'Answer', { abortSignal: controller.signal }),
  ).toBeNull()
  expect(generate).not.toHaveBeenCalled()
})
