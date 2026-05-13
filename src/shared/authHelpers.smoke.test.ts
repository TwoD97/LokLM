import { describe, it, expect } from 'vitest'
import { PASSPHRASE_WORDS, getWordlist, normalisePassphrase } from './authHelpers'

describe('shared/authHelpers (smoke)', () => {
  it('exposes the passphrase length constant', () => {
    expect(PASSPHRASE_WORDS).toBeGreaterThan(0)
  })

  it('returns a non-empty wordlist for both supported languages', () => {
    expect(getWordlist('de').length).toBeGreaterThan(0)
    expect(getWordlist('en').length).toBeGreaterThan(0)
  })

  it('normalises whitespace in a passphrase', () => {
    expect(normalisePassphrase('  one   two  ')).toBe('one two')
  })
})
