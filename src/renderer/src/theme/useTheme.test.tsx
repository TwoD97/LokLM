import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTheme, applyTheme } from './useTheme'

describe('resolveTheme', () => {
  it('system + OS-dark → dark', () => expect(resolveTheme('system', true)).toBe('dark'))
  it('system + OS-light → light', () => expect(resolveTheme('system', false)).toBe('light'))
  it('explicit light ignores OS', () => expect(resolveTheme('light', true)).toBe('light'))
  it('explicit dark ignores OS', () => expect(resolveTheme('dark', false)).toBe('dark'))
})

describe('applyTheme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
  })
  function stubMatch(matches: boolean): void {
    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia
  }
  it('writes dark when OS prefers dark and pref is system', () => {
    stubMatch(true)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('explicit light wins over an OS dark preference', () => {
    stubMatch(true)
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
