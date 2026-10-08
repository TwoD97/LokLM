import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useT } from './index'

const setting = vi.hoisted(() => ({ language: 'en' as string | undefined }))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { basic: { language: setting.language } } }),
}))
beforeEach(() => {
  setting.language = 'en'
})

describe('translation function identity', () => {
  it('stays stable for the same resolved locale and updates when the locale changes', () => {
    const { result, rerender } = renderHook(() => useT())
    const english = result.current
    rerender()
    expect(result.current).toBe(english)
    setting.language = undefined
    rerender()
    expect(result.current).toBe(english)
    setting.language = 'de'
    rerender()
    expect(result.current).not.toBe(english)
    expect(result.current('common.close')).toBe('Schließen')
    expect(result.current('chat.documentFallback', { id: 7 })).toBe('Dokument #7')
    expect(result.current('unknown.translation.key')).toBe('unknown.translation.key')
    expect(english('common.close')).toBe('Close')
  })
})
