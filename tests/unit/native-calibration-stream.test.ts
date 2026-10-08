import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '../../src/shared/documents'
import {
  collectCalibrationStream,
  calibrationCollectionDecision,
} from '../evals/native-calibration/streamCapture'

type Terminal = Extract<StreamEvent, { type: 'done' | 'error' }>
const input = {
  id: 1,
  entry: { id: 'test', question: 'A question?', language: 'en' as const },
  repetition: 0,
}
const done: Terminal = {
  type: 'done',
  full_text: 'Final answer.',
  citations: [],
  outcome: 'completed',
}

function fixture(run: (emit: (event: StreamEvent) => void) => Promise<Terminal | void>) {
  let emit: (event: StreamEvent) => void = () => undefined
  const offEvents = vi.fn()
  const offActivity = vi.fn()
  const api: NonNullable<Parameters<typeof collectCalibrationStream>[1]> = {
    chat: {
      onEvent: vi.fn((_id, listener) => {
        emit = listener
        return offEvents
      }),
      stream: vi.fn(() => run((event) => emit(event))),
      cancel: vi.fn(async () => undefined),
    },
    models: { onActivity: vi.fn(() => offActivity) },
  }
  return { api, offEvents, offActivity }
}

afterEach(() => vi.useRealTimers())

describe('native calibration authoritative stream capture', () => {
  it.each([undefined, false, true])(
    'forwards document expansion only when explicitly enabled (%s)',
    async (wholeDocFallback) => {
      const { api } = fixture(async () => done)
      await collectCalibrationStream(
        { ...input, ...(wholeDocFallback === undefined ? {} : { wholeDocFallback }) },
        api,
      )
      expect(api.chat.stream).toHaveBeenCalledWith(
        'calibration-test-0',
        1,
        'A question?',
        expect.objectContaining({ wholeDocFallback: wholeDocFallback === true }),
      )
    },
  )

  it('uses an invoke-only terminal immediately and replaces accumulated tokens', async () => {
    const { api, offEvents, offActivity } = fixture(async (emit) => {
      emit({ type: 'token', text: 'Provisional text.' })
      return done
    })
    const result = await collectCalibrationStream(input, api)
    expect(result.answer).toBe('Final answer.')
    expect(result.terminalReceived).toBe(true)
    expect(result.terminalOrigin).toBe('invoke')
    expect(result.terminalOutcome).toBe('completed')
    expect(result.invokeSettled).toBe(true)
    expect(offEvents).toHaveBeenCalledOnce()
    expect(offActivity).toHaveBeenCalledOnce()
  })

  it('retains authoritative partial error text and citations without inventing success', async () => {
    const partial: Terminal = {
      type: 'error',
      message: 'Failed to persist',
      full_text: 'Partial answer. Save failed.',
      citations: [{ doc_id: 2, chunk_id: 4, score: 0.7 }],
      persisted: false,
    }
    const { api } = fixture(async (emit) => {
      emit({ type: 'token', text: 'Partial' })
      return partial
    })
    const result = await collectCalibrationStream(input, api)
    expect(result.answer).toBe(partial.full_text)
    expect(result.citations).toEqual(partial.citations)
    expect(result.terminalOutcome).toBe('error')
    expect(result.events.at(-1)).toEqual(partial)
  })

  it('deduplicates the same terminal delivered through push and invoke', async () => {
    const { api } = fixture(async (emit) => {
      emit(done)
      return { ...done }
    })
    const result = await collectCalibrationStream(input, api)
    expect(result.events.filter((event) => event.type === 'done')).toHaveLength(1)
    expect(result.terminalMismatch).toBe(false)
  })

  it('flags disagreeing terminal channels while preserving the returned final answer', async () => {
    const { api } = fixture(async (emit) => {
      emit({ ...done, full_text: 'Old final.' })
      return done
    })
    const result = await collectCalibrationStream(input, api)
    expect(result.terminalMismatch).toBe(true)
    expect(result.answer).toBe(done.full_text)
  })

  it('records cancellation distinctly even when done contains nonempty answer text', async () => {
    const { api } = fixture(async () => ({ ...done, outcome: 'cancelled' }))
    expect((await collectCalibrationStream(input, api)).terminalOutcome).toBe('cancelled')
  })

  it('keeps invocation failure and partial tokens visible without a successful terminal', async () => {
    const { api } = fixture(async (emit) => {
      emit({ type: 'token', text: 'Partial' })
      throw new Error('Transport rejected')
    })
    const result = await collectCalibrationStream(input, api)
    expect(result.answer).toBe('Partial')
    expect(result.invokeError).toBe('Transport rejected')
    expect(result.terminalReceived).toBe(false)
    expect(result.terminalOutcome).toBeNull()
  })

  it('bounds a non-settling invoke, cancels once, and ignores its later response', async () => {
    vi.useFakeTimers()
    let settle!: (value: Terminal) => void
    const { api, offEvents } = fixture(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    const pending = collectCalibrationStream(
      { ...input, timeoutMs: 20, cancellationGraceMs: 10 },
      api,
    )
    await vi.advanceTimersByTimeAsync(30)
    const result = await pending
    expect(result.timedOut).toBe(true)
    expect(result.invokeSettled).toBe(false)
    expect(result.terminalReceived).toBe(false)
    expect(api.chat.cancel).toHaveBeenCalledOnce()
    expect(offEvents).toHaveBeenCalledOnce()
    settle(done)
    await Promise.resolve()
    await Promise.resolve()
    expect(result.events).toEqual([])
  })

  it('supports older invoke responses whose push terminal arrives just afterward', async () => {
    vi.useFakeTimers()
    const { api } = fixture(async (emit) => {
      setTimeout(() => emit(done), 4)
    })
    const pending = collectCalibrationStream({ ...input, terminalGraceMs: 10 }, api)
    await vi.advanceTimersByTimeAsync(4)
    const result = await pending
    expect(result.answer).toBe(done.full_text)
    expect(result.terminalOrigin).toBe('event')
    expect(result.terminalMismatch).toBe(false)
  })
})

describe('calibration continuation policy', () => {
  const failure: Terminal = {
    type: 'error',
    message: 'Source comparison failed',
    full_text: '',
    citations: [],
    persisted: false,
  }
  const captureFailure = async () => {
    const { api } = fixture(async (emit) => {
      emit(failure)
      return failure
    })
    return collectCalibrationStream(input, api)
  }

  it('can observe a settled authoritative error and continue only with the explicit option', async () => {
    const observation = await captureFailure()
    expect(calibrationCollectionDecision(observation)).toBe('stop')
    expect(calibrationCollectionDecision(observation, true)).toBe('continue-error')
    expect(observation.terminalOutcome).toBe('error')
    expect(observation.events.filter((event) => event.type === 'error')).toHaveLength(1)
  })

  it.each([
    ['timeout', { timedOut: true }],
    ['unsettled invocation', { invokeSettled: false }],
    ['invocation rejection', { invokeError: 'renderer lost' }],
    ['terminal mismatch', { terminalMismatch: true }],
    ['missing terminal', { terminalReceived: false }],
    ['cancelled terminal', { terminalOutcome: 'cancelled' as const }],
    ['cancellation error', { cancellationError: 'cancel failed' }],
    ['no terminal events', { events: [] }],
    ['mixed terminals', { events: [failure, done] }],
  ] satisfies Array<[string, Partial<Awaited<ReturnType<typeof collectCalibrationStream>>>]>)(
    'never continues after %s, even when errors are permitted',
    async (_label, overrides) => {
      const observation = await captureFailure()
      expect(calibrationCollectionDecision({ ...observation, ...overrides }, true)).toBe('stop')
    },
  )

  it('keeps successful completion unchanged with either option', async () => {
    const { api } = fixture(async () => done)
    const observation = await collectCalibrationStream(input, api)
    expect(calibrationCollectionDecision(observation)).toBe('complete')
    expect(calibrationCollectionDecision(observation, true)).toBe('complete')
  })
})
