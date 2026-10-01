import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch } }))
import { launchApp } from '../e2e/helpers/launch'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
const fakeApp = () => {
  const page = { waitForLoadState: vi.fn().mockResolvedValue(undefined) }
  return {
    page,
    app: {
      evaluate: vi.fn().mockResolvedValue(undefined),
      firstWindow: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
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
})
