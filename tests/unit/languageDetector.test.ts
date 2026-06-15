import { describe, it, expect } from 'vitest'
import {
  detectChunkLanguage,
  detectChunkLanguages,
  detectResponseLanguage,
} from '@main/services/documents/languageDetector'
import { tagChunkLanguages } from '@main/services/documents/chunker'
import type { Chunk } from '@main/services/documents/chunker'

// eld lazy-loads its L ngram DB (~140 MB resident) on first detect call.
// The first test in this file pays that cost ; the rest reuse the cached
// module. Whole file runs comfortably under a second on a warm worker.

describe('detectChunkLanguage', () => {
  it('detects German text', async () => {
    const text =
      'Die Schnellrechnung der Quartalskennzahlen zeigt deutlich, dass die Betriebsausgaben gestiegen sind.'
    expect(await detectChunkLanguage(text)).toBe('de')
  })

  it('detects English text', async () => {
    const text =
      'The quarterly figures clearly show that operating expenses have increased substantially this period.'
    expect(await detectChunkLanguage(text)).toBe('en')
  })

  it("collapses non-DE/EN languages to 'other'", async () => {
    // Spanish — recognisable to eld but outside LokLM's bilingual scope, so
    // the schema bucket is 'other' and the prompt formatter ignores it.
    const text =
      'El informe trimestral muestra claramente que los gastos operativos han aumentado este periodo.'
    expect(await detectChunkLanguage(text)).toBe('other')
  })

  it('returns null for text below the minimum detection length', async () => {
    // Below the 40-char threshold — too noisy for eld's L DB, so the wrapper
    // refuses rather than guessing. NULL flows through to the schema and the
    // prompt formatter omits the cross-language hint.
    expect(await detectChunkLanguage('Hallo Welt.')).toBeNull()
  })

  it('returns null for whitespace-only input', async () => {
    expect(await detectChunkLanguage('     \n\n  ')).toBeNull()
  })
})

describe('detectChunkLanguages (batch)', () => {
  it('returns a parallel array of buckets', async () => {
    const de =
      'Die Schnellrechnung der Quartalskennzahlen zeigt deutlich, dass die Betriebsausgaben gestiegen sind.'
    const en =
      'The quarterly figures clearly show that operating expenses have increased substantially this period.'
    const tooShort = 'Hi'
    const out = await detectChunkLanguages([de, en, tooShort])
    expect(out).toEqual(['de', 'en', null])
  })

  it('returns an empty array for an empty input (no eld load triggered)', async () => {
    expect(await detectChunkLanguages([])).toEqual([])
  })
})

describe('detectResponseLanguage', () => {
  // Always resolves to one of the two supported answer languages — never
  // 'other' or null, unlike the per-chunk detector.
  it('detects German from a long query via eld', async () => {
    const q =
      'Was sagen die Quartalskennzahlen über die gestiegenen Betriebsausgaben im letzten Jahr?'
    expect(await detectResponseLanguage(q)).toBe('de')
  })

  it('detects English from a long query via eld', async () => {
    const q = 'What do the quarterly figures say about the increased operating expenses last year?'
    expect(await detectResponseLanguage(q)).toBe('en')
  })

  it('collapses a non-DE/EN long query to English', async () => {
    const q =
      '¿Qué muestran las cifras trimestrales sobre los gastos operativos del último periodo?'
    expect(await detectResponseLanguage(q)).toBe('en')
  })

  // eld is consulted for EVERY prompt — no char-count floor. A short, umlaut-free
  // German prompt with no whitelisted function word ("Fasse Kapitel 3 zusammen")
  // is reliably detected as German by eld and used to be misrouted to English by
  // the regex when eld was gated behind a length floor. eld wins even when the
  // fallback (UI language) is English, proving it's a real detection.
  it('detects short umlaut-free German via eld (no char floor)', async () => {
    expect(await detectResponseLanguage('Fasse Kapitel 3 zusammen', 'en')).toBe('de')
  })

  it('detects short English via eld even with a German fallback', async () => {
    expect(await detectResponseLanguage('hi there', 'de')).toBe('en')
  })

  // eld marks a very short umlaut prompt unreliable; the regex umlaut signal
  // then marks DE, ahead of the fallback.
  it('uses the umlaut regex signal when eld is not confident', async () => {
    expect(await detectResponseLanguage('Wofür?', 'en')).toBe('de')
  })

  // Genuinely ambiguous: eld unreliable AND no German regex signal — defer to
  // the caller's fallback (the UI language) instead of assuming English.
  it('falls back to the given language for a genuinely ambiguous prompt', async () => {
    expect(await detectResponseLanguage('ok', 'de')).toBe('de')
  })

  it('defaults the fallback to English when none is given (back-compat)', async () => {
    expect(await detectResponseLanguage('ok')).toBe('en')
  })
})

describe('tagChunkLanguages', () => {
  it('fills the language field on each chunk preserving other fields', async () => {
    const chunks: Chunk[] = [
      {
        text: 'Die Quartalsbericht-Daten der Buchhaltung zeigen eine deutliche Veränderung im Aufwand.',
        ordinal: 0,
        pageFrom: 1,
        pageTo: 1,
        headingPath: null,
        language: null,
      },
      {
        text: 'The accounting report data clearly indicates a noticeable change in the expense pattern.',
        ordinal: 1,
        pageFrom: 2,
        pageTo: 2,
        headingPath: ['Section'],
        language: null,
      },
    ]
    const tagged = await tagChunkLanguages(chunks)
    expect(tagged).toHaveLength(2)
    expect(tagged[0]!.language).toBe('de')
    expect(tagged[1]!.language).toBe('en')
    // Other fields untouched — tagger is a pure post-pass.
    expect(tagged[0]!.ordinal).toBe(0)
    expect(tagged[1]!.headingPath).toEqual(['Section'])
  })

  it('returns the same empty list (no-op fast path)', async () => {
    expect(await tagChunkLanguages([])).toEqual([])
  })
})
