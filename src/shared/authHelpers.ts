export function validatePassword(pw: string): void {
  if (pw.length < 10) {
    throw new Error('Password must be at least 10 characters.')
  }
  const classes = countCharacterClasses(pw)
  if (classes < 3) {
    throw new Error(
      'Password must contain at least three of: uppercase, lowercase, digit, special.',
    )
  }
}

export function countCharacterClasses(pw: string): number {
  return [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].reduce((n, re) => (re.test(pw) ? n + 1 : n), 0)
}

// passphrase helpers (replacing the old recovery codes)

import { WORDLIST_DE } from './passPhraseWords/wordlist-de'
import { WORDLIST_EN } from './passPhraseWords/wordlist-en'

export type WordlistLang = 'de' | 'en'

export function getWordlist(lang: WordlistLang): readonly string[] {
  return lang === 'de' ? WORDLIST_DE : WORDLIST_EN
}

export const PASSPHRASE_WORDS = 18

/**
 * sample `count` words uniformly from `wordlist` using `randomBytes`.
 *
 * modulo bias note , wordlist length is 2048 = 2^11. we consume 2 bytes per
 * word and mask to 11 bits , so its bias-free no matter the byte source.
 */
export function generatePassphrase(
  wordlist: readonly string[],
  count: number,
  randomBytes: (n: number) => Uint8Array,
): string[] {
  if (wordlist.length !== 2048) {
    throw new Error(`generatePassphrase expects a 2048-entry wordlist, got ${wordlist.length}`)
  }
  const out: string[] = []
  const bytes = randomBytes(count * 2)
  for (let i = 0; i < count; i++) {
    const hi = bytes[i * 2]!
    const lo = bytes[i * 2 + 1]!
    const idx = ((hi << 8) | lo) & 0x07ff // 11 bits -> 0..2047
    out.push(wordlist[idx]!)
  }
  return out
}

export function normalisePassphrase(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .join(' ')
}

export type PassphraseValidation =
  | { ok: true }
  | { ok: false; reason: 'wrong-length' }
  | { ok: false; reason: 'unknown-word'; badIndex: number }

export function validatePassphrase(
  words: readonly string[],
  wordlist: readonly string[],
): PassphraseValidation {
  if (words.length !== PASSPHRASE_WORDS) return { ok: false, reason: 'wrong-length' }
  const set = new Set(wordlist)
  for (let i = 0; i < words.length; i++) {
    if (!set.has(words[i]!)) return { ok: false, reason: 'unknown-word', badIndex: i }
  }
  return { ok: true }
}

export function isCanonicalPassphrase(s: string, wordlist: readonly string[]): boolean {
  const words = normalisePassphrase(s).split(' ')
  return validatePassphrase(words, wordlist).ok
}
