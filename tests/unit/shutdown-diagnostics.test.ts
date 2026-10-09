import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { write } = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeSync: write,
}))
vi.mock('electron', () => ({ app: {} }))
vi.mock('electron-log/main', () => ({ default: {} }))

import { logShutdownStage } from '../../src/main/services/logging/logger'

beforeEach(() => {
  write.mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000)
})
afterEach(() => vi.restoreAllMocks())

describe('content-free shutdown diagnostics', () => {
  it('writes only the four fixed stages and a timestamp directly to stderr', () => {
    for (const stage of ['private-writes', 'indexing', 'vault-lock', 'exit'] as const)
      logShutdownStage(stage)
    expect(write.mock.calls).toEqual([
      [2, '[app] shutdown stage=private-writes at=1790000000000\n'],
      [2, '[app] shutdown stage=indexing at=1790000000000\n'],
      [2, '[app] shutdown stage=vault-lock at=1790000000000\n'],
      [2, '[app] shutdown stage=exit at=1790000000000\n'],
    ])
  })

  it.each(['vault content\nexit', '__proto__', 'constructor', '', null, undefined, 42, {}])(
    'does not serialize or log unsupported runtime input %j',
    (input) => {
      logShutdownStage(input as Parameters<typeof logShutdownStage>[0])
      expect(write).not.toHaveBeenCalled()
    },
  )

  it('does not coerce an object into a printable value', () => {
    const toString = vi.fn(() => 'exit')
    logShutdownStage({ toString } as unknown as Parameters<typeof logShutdownStage>[0])
    expect(toString).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('does not fail shutdown when the desktop launcher has no writable stderr', () => {
    write.mockImplementation(() => {
      throw Object.assign(new Error('closed descriptor'), { code: 'EBADF' })
    })
    expect(() => logShutdownStage('exit')).not.toThrow()
  })
})
