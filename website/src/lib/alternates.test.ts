import { describe, it, expect } from 'vitest'
import { resolveAlternates } from './alternates'

const SITE = 'https://loklm.com'

describe('resolveAlternates', () => {
  it('defaults to homepage pair when no paths given', () => {
    expect(resolveAlternates(SITE)).toEqual({
      de: 'https://loklm.com',
      en: 'https://loklm.com/en',
      xDefault: 'https://loklm.com',
    })
  })

  it('builds a translation pair from explicit paths', () => {
    expect(resolveAlternates(SITE, { de: '/lokale-ki', en: '/en/local-ai' })).toEqual({
      de: 'https://loklm.com/lokale-ki',
      en: 'https://loklm.com/en/local-ai',
      xDefault: 'https://loklm.com/lokale-ki',
    })
  })

  it('strips a trailing slash from the site url', () => {
    expect(resolveAlternates('https://loklm.com/', { de: '/x', en: '/en/x' }).de).toBe(
      'https://loklm.com/x',
    )
  })
})
