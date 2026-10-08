import { access, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch } }))
import { launchApp } from '../e2e/helpers/launch'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  launch.mockReset()
  vi.useRealTimers()
})
const fakeApp = () => {
  const page = { waitForLoadState: vi.fn().mockResolvedValue(undefined) }
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
  })
  const exit = () => {
    child.exitCode = 0
    child.emit('exit', 0, null)
  }
  return {
    page,
    child,
    exit,
    app: {
      evaluate: vi.fn().mockResolvedValue(undefined),
      firstWindow: vi.fn().mockResolvedValue(page),
      process: vi.fn(() => child),
      close: vi.fn(async () => exit()),
    },
  }
}

describe('isolated desktop test launch', () => {
  it('overrides inherited vault paths and removes CLI/development renderer variables on every restart', async () => {
    vi.stubEnv('LOKLM_DATA_DIR', 'D:/must-not-open-real-vault')
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://must-not-load.invalid')
    const first = fakeApp()
    const second = fakeApp()
    launch.mockResolvedValueOnce(first.app).mockResolvedValueOnce(second.app)
    const opened = await launchApp()
    try {
      await opened.restart()
      expect(launch).toHaveBeenCalledTimes(2)
      for (const [options] of launch.mock.calls) {
        expect(options.env.LOKLM_DATA_DIR).toBe(join(opened.userDataDir, 'vault'))
        expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
        expect(options.env.ELECTRON_RENDERER_URL).toBeUndefined()
        expect(options.args).toContain(`--user-data-dir=${opened.userDataDir}`)
      }
      expect(first.app.close).toHaveBeenCalledOnce()
      expect(opened.app).toBe(second.app)
      expect(opened.page).toBe(second.page)
    } finally {
      await opened.cleanup()
    }
    expect(second.app.close).toHaveBeenCalledOnce()
    await expect(access(opened.userDataDir)).rejects.toThrow()
  })

  it('closes a partial application and cleans its owned profile when startup fails', async () => {
    const partial = fakeApp()
    partial.app.firstWindow.mockRejectedValueOnce(new Error('window unavailable'))
    launch.mockResolvedValueOnce(partial.app)
    await expect(launchApp()).rejects.toThrow('window unavailable')
    expect(partial.app.close).toHaveBeenCalledOnce()
    const options = launch.mock.calls[0]![0]
    const profile = options.args
      .find((arg: string) => arg.startsWith('--user-data-dir='))
      .slice('--user-data-dir='.length)
    await expect(access(profile)).rejects.toThrow()
  })

  it('preserves the profile and rejects cleanup when close fails, even if exit follows', async () => {
    const fixture = fakeApp()
    const failure = new Error('close transport failed')
    fixture.app.close.mockImplementationOnce(async () => {
      fixture.exit()
      throw failure
    })
    launch.mockResolvedValueOnce(fixture.app)
    const opened = await launchApp()
    await expect(opened.cleanup()).rejects.toBe(failure)
    await expect(access(opened.userDataDir)).resolves.toBeUndefined()
    expect(fixture.child.listenerCount('exit')).toBe(0)
    // An explicit retry after confirmed exit may now remove the owned profile.
    await opened.cleanup()
    expect(fixture.app.close).toHaveBeenCalledOnce()
    await expect(access(opened.userDataDir)).rejects.toThrow()
  })

  it.each(['cleanup', 'restart'] as const)(
    'waits for a late actual process exit before %s can delete or reopen its profile',
    async (operation) => {
      vi.useFakeTimers()
      const first = fakeApp()
      const second = fakeApp()
      first.app.close.mockImplementationOnce(async () => undefined)
      launch.mockResolvedValueOnce(first.app).mockResolvedValueOnce(second.app)
      const opened = await launchApp({ workingDirectory: 'D:/owned-model-fixture' })
      let complete = false
      const pending = opened[operation]().then(() => {
        complete = true
      })
      await vi.advanceTimersByTimeAsync(2_000)
      expect(complete).toBe(false)
      expect(launch).toHaveBeenCalledOnce()
      await expect(access(opened.userDataDir)).resolves.toBeUndefined()
      first.exit()
      await pending
      expect(first.child.listenerCount('exit')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      if (operation === 'restart') {
        expect(launch.mock.calls[1]?.[0].cwd).toBe('D:/owned-model-fixture')
        await opened.cleanup()
      }
      await expect(access(opened.userDataDir)).rejects.toThrow()
    },
  )

  it('accepts an already manually closed process without calling close again', async () => {
    const fixture = fakeApp()
    launch.mockResolvedValueOnce(fixture.app)
    const opened = await launchApp()
    fixture.exit()
    fixture.app.close.mockRejectedValueOnce(new Error('application already closed'))
    await opened.cleanup()
    expect(fixture.app.close).not.toHaveBeenCalled()
    await expect(access(opened.userDataDir)).rejects.toThrow()
  })

  it('bounds missing exit confirmation and preserves the profile until an explicit confirmed retry', async () => {
    vi.useFakeTimers()
    const fixture = fakeApp()
    fixture.app.close.mockImplementationOnce(async () => undefined)
    launch.mockResolvedValueOnce(fixture.app)
    const opened = await launchApp()
    const failed = expect(opened.cleanup()).rejects.toThrow('did not confirm exit')
    await vi.advanceTimersByTimeAsync(5_000)
    await failed
    expect(opened.lastClosure).toBeNull()
    expect(fixture.child.listenerCount('exit')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await expect(access(opened.userDataDir)).resolves.toBeUndefined()
    fixture.exit()
    await opened.cleanup()
    expect(opened.lastClosure).toEqual({
      mainProcessId: fixture.child.pid,
      exitCode: 0,
      signalCode: null,
      alreadyExited: true,
    })
  })

  it('does not launch a replacement when closing the current process fails', async () => {
    const fixture = fakeApp()
    const failure = new Error('close failed')
    fixture.app.close.mockRejectedValueOnce(failure)
    launch.mockResolvedValueOnce(fixture.app)
    const opened = await launchApp()
    await expect(opened.restart()).rejects.toBe(failure)
    expect(launch).toHaveBeenCalledOnce()
    await expect(access(opened.userDataDir)).resolves.toBeUndefined()
    fixture.exit()
    await opened.cleanup()
  })

  it('preserves both startup and close errors and the partial process profile', async () => {
    const partial = fakeApp()
    const startupError = new Error('window unavailable')
    const closeError = new Error('close unavailable')
    partial.app.firstWindow.mockRejectedValueOnce(startupError)
    partial.app.close.mockRejectedValueOnce(closeError)
    launch.mockResolvedValueOnce(partial.app)
    await expect(launchApp()).rejects.toMatchObject({ errors: [startupError, closeError] })
    const profile = launch.mock.calls[0]![0].args.find((arg: string) =>
      arg.startsWith('--user-data-dir='),
    ).slice('--user-data-dir='.length)
    await expect(access(profile)).resolves.toBeUndefined()
    expect(partial.child.listenerCount('exit')).toBe(0)
    partial.exit()
    await rm(profile, { recursive: true, force: true })
  })
})
