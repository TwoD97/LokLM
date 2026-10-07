import { describe, it, expect } from 'vitest'
import { resolveAlternates } from './alternates'

const ORIGIN = 'https://loklm.com'

describe('resolveAlternates', () => {
  it.each(['/', '/en', '/en/'])('resolves the homepage pair for %s', (pathname) => {
    expect(resolveAlternates(ORIGIN, pathname)).toEqual({
      de: 'https://loklm.com',
      en: 'https://loklm.com/en',
      xDefault: 'https://loklm.com',
    })
  })

  it('expands explicit DE/EN paths into absolute alternates', () => {
    expect(
      resolveAlternates(ORIGIN, '/en/local-ai', { de: '/lokale-ki', en: '/en/local-ai' }),
    ).toEqual({
      de: 'https://loklm.com/lokale-ki',
      en: 'https://loklm.com/en/local-ai',
      xDefault: 'https://loklm.com/lokale-ki',
    })
  })

  it('normalises a trailing slash on the site url before joining', () => {
    expect(resolveAlternates('https://loklm.com/', '/x', { de: '/x', en: '/en/x' })?.de).toBe(
      'https://loklm.com/x',
    )
  })

  it.each(['imprint', 'privacy'])('resolves reciprocal %s pages rather than homepages', (page) => {
    const expected = {
      de: `${ORIGIN}/${page}`,
      en: `${ORIGIN}/en/${page}`,
      xDefault: `${ORIGIN}/${page}`,
    }
    expect(resolveAlternates(ORIGIN, `/${page}`)).toEqual(expected)
    expect(resolveAlternates(ORIGIN, `/en/${page}`)).toEqual(expected)
  })

  it.each(['/blog/untranslated', '/en/blog/untranslated', '/new-page'])(
    'does not invent a translation for %s',
    (pathname) => expect(resolveAlternates(ORIGIN, pathname)).toBeUndefined(),
  )
})
