import { describe, it, expect } from 'vitest'
import { getLangFromUrl, localisedPath } from './utils'

describe('getLangFromUrl', () => {
  it('returns "en" for /en root', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/en'))).toBe('en')
  })

  it('returns "en" for /en/ with trailing slash', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/en/'))).toBe('en')
  })

  it('returns "en" for nested /en path', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/en/imprint'))).toBe('en')
  })

  it('returns default "de" for root path', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/'))).toBe('de')
  })

  it('returns default "de" for non-en path', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/imprint'))).toBe('de')
  })

  it('returns default "de" for unknown lang segment', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/fr/foo'))).toBe('de')
  })

  it('ignores hash and query', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/en?x=1#features'))).toBe('en')
    expect(getLangFromUrl(new URL('https://loklm.com/?x=1#features'))).toBe('de')
  })
})

describe('localisedPath', () => {
  it('returns / for de + /', () => {
    expect(localisedPath('de', '/')).toBe('/')
  })

  it('keeps non-root path unchanged for de', () => {
    expect(localisedPath('de', '/imprint')).toBe('/imprint')
  })

  it('prefixes leading slash if missing on de', () => {
    expect(localisedPath('de', 'imprint')).toBe('/imprint')
  })

  it('returns /en for en + /', () => {
    expect(localisedPath('en', '/')).toBe('/en')
  })

  it('prefixes /en for en + /imprint', () => {
    expect(localisedPath('en', '/imprint')).toBe('/en/imprint')
  })

  it('prefixes /en for en + relative path', () => {
    expect(localisedPath('en', 'privacy')).toBe('/en/privacy')
  })
})
