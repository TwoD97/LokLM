import { describe, it, expect } from 'vitest'
import { resolveAlternates } from './alternates'

const ORIGIN = 'https://loklm.com'

describe('resolveAlternates', () => {
  it('without paths, falls back to the homepage in both locales (DE as x-default)', () => {
    expect(resolveAlternates(ORIGIN)).toEqual({
      de: 'https://loklm.com',
      en: 'https://loklm.com/en',
      xDefault: 'https://loklm.com',
    })
  })

  it('expands explicit DE/EN paths into absolute alternates', () => {
    expect(resolveAlternates(ORIGIN, { de: '/lokale-ki', en: '/en/local-ai' })).toEqual({
      de: 'https://loklm.com/lokale-ki',
      en: 'https://loklm.com/en/local-ai',
      xDefault: 'https://loklm.com/lokale-ki',
    })
  })

  it('normalises a trailing slash on the site url before joining', () => {
    expect(resolveAlternates('https://loklm.com/', { de: '/x', en: '/en/x' }).de).toBe(
      'https://loklm.com/x',
    )
  })
})
