import { describe, it, expect } from 'vitest'
import { getLangFromUrl, localisedPath } from './utils'

describe('getLangFromUrl', () => {
  it.each([
    ['https://loklm.com/en', 'en', 'bare /en'],
    ['https://loklm.com/en/', 'en', '/en/ with trailing slash'],
    ['https://loklm.com/en/imprint', 'en', 'nested english route'],
    ['https://loklm.com/', 'de', 'site root falls back to the default'],
    ['https://loklm.com/imprint', 'de', 'unprefixed route falls back to the default'],
    ['https://loklm.com/fr/foo', 'de', 'unsupported locale segment falls back to the default'],
  ])('%s -> %s (%s)', (url, lang) => {
    expect(getLangFromUrl(new URL(url))).toBe(lang)
  })

  it('is unaffected by query string and fragment', () => {
    expect(getLangFromUrl(new URL('https://loklm.com/en?x=1#features'))).toBe('en')
    expect(getLangFromUrl(new URL('https://loklm.com/?x=1#features'))).toBe('de')
  })
})

describe('localisedPath', () => {
  it.each([
    ['de', '/', '/', 'de root stays the site root'],
    ['de', '/imprint', '/imprint', 'de paths carry no prefix'],
    ['de', 'imprint', '/imprint', 'a missing leading slash is added for de'],
    ['en', '/', '/en', 'en root becomes /en'],
    ['en', '/imprint', '/en/imprint', 'en paths get the /en prefix'],
    ['en', 'privacy', '/en/privacy', 'relative en input is normalised and prefixed'],
  ] as const)('(%s, %s) -> %s (%s)', (lang, input, want, _why) => {
    expect(localisedPath(lang, input)).toBe(want)
  })
})
