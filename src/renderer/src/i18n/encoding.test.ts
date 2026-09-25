import { describe, expect, it } from 'vitest'
import { DICT } from './index'

describe('Interface text encoding', () => {
  it('does not contain replacement characters or question marks substituted inside words', () => {
    for (const [locale, dict] of Object.entries(DICT)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${locale}: ${key}`).not.toMatch(/\uFFFD|[\p{L}]\?[\p{L}]|(?:^|\s)\?[\p{L}]/u)
      }
    }
    expect(DICT.de['prefs.skipped']).toBe('Übersprungen')
    expect(DICT.de['prefs.externalHint']).toContain('ausgewählter')
  })
})
