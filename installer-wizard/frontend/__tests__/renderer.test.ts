import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const frontend = resolve(process.cwd(), 'installer-wizard/frontend')
let dom: JSDOM
const state = { payloadReady: true, existingInstallDir: null, defaultInstallDir: '/apps/LokLM' }

function start(overrides: Record<string, unknown> = {}) {
  dom = new JSDOM(readFileSync(resolve(frontend, 'index.html'), 'utf8'), {
    runScripts: 'outside-only',
  })
  const installer = {
    getLicense: vi.fn().mockResolvedValue('MIT License'),
    getState: vi.fn().mockResolvedValue(state),
    probeHardware: vi.fn().mockResolvedValue({ gpuName: 'Discrete GPU', recommendedTier: 'pro' }),
    onProgress: vi.fn(),
    close: vi.fn(),
    minimize: vi.fn(),
    ...overrides,
  }
  Object.assign(dom.window, { installer })
  dom.window.eval(readFileSync(resolve(frontend, 'i18n.js'), 'utf8'))
  dom.window.eval(readFileSync(resolve(frontend, 'renderer.js'), 'utf8'))
  return installer
}

const element = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  dom?.window.close()
  vi.useRealTimers()
})

describe('installer startup and delayed hardware results', () => {
  it.each(['getLicense', 'getState'])('offers a usable retry after %s rejects', async (method) => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValue(method === 'getLicense' ? 'MIT License' : state)
    start({ [method]: read })
    await vi.advanceTimersByTimeAsync(800)
    expect(dom.window.document.body.classList.contains('is-booted')).toBe(false)
    expect(element('boot-error').textContent).toContain('IPC unavailable')
    const retry = element<HTMLButtonElement>('boot-retry')
    expect(retry.hidden).toBe(false)
    expect(retry.disabled).toBe(false)
    expect(dom.window.document.activeElement).toBe(retry)
    expect(dom.window.document.querySelector('.installer-shell')?.hasAttribute('inert')).toBe(true)
    retry.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    expect(dom.window.document.body.classList.contains('is-booted')).toBe(true)
    expect(dom.window.document.querySelector('.installer-shell')?.hasAttribute('inert')).toBe(false)
    expect(dom.window.document.activeElement).toBe(element('next'))
  })

  it('treats a missing license as recoverable startup failure', async () => {
    start({ getLicense: vi.fn().mockResolvedValue(null) })
    await vi.advanceTimersByTimeAsync(800)
    expect(element('boot-error').hidden).toBe(false)
    expect(element('boot-error').textContent).toContain('license')
    expect(dom.window.document.body.classList.contains('is-booted')).toBe(false)
  })

  it('measures the license when visible before enabling acceptance', async () => {
    start()
    await vi.advanceTimersByTimeAsync(800)
    const license = element('license-body')
    Object.defineProperties(license, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } })
    element('next').click()
    expect(element<HTMLInputElement>('license-accept').disabled).toBe(true)
    license.scrollTop = 400
    license.dispatchEvent(new dom.window.Event('scroll'))
    expect(element<HTMLInputElement>('license-accept').disabled).toBe(false)
  })

  it.each([false, true])(
    'preserves an explicit Standard choice when a slow probe recommends Pro (reselected=%s)',
    async (reselected) => {
      let finish!: (profile: unknown) => void
      start({
        probeHardware: vi.fn().mockReturnValue(
          new Promise((resolve) => {
            finish = resolve
          }),
        ),
      })
      await vi.advanceTimersByTimeAsync(800)
      element('next').click()
      const accept = element<HTMLInputElement>('license-accept')
      accept.checked = true
      accept.dispatchEvent(new dom.window.Event('change'))
      element('next').click()
      for (const tier of reselected ? ['pro', 'standard'] : ['standard']) {
        const radio = dom.window.document.querySelector<HTMLInputElement>(
          `input[name="tier"][value="${tier}"]`,
        )!
        radio.click()
      }
      finish({ gpuName: 'Discrete GPU', recommendedTier: 'pro' })
      await vi.advanceTimersByTimeAsync(0)
      expect(
        dom.window.document.querySelector<HTMLInputElement>('input[name="tier"][value="standard"]')
          ?.checked,
      ).toBe(true)
    },
  )
})
