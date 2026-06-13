/**
 * Sentence segmentation + reassembly for the MADLAD translation layer.
 * Pure-function tests — the sidecar protocol is covered separately in
 * translator-sidecar.test.ts. Assertions stick to stable invariants
 * (counts , paragraph structure , round-trip identity on simple input)
 * rather than pinning Intl.Segmenter's exact boundary decisions on
 * abbreviation-heavy text , which vary by ICU version.
 */

import { describe, it, expect } from 'vitest'

import { segmentForTranslation } from '../../src/main/services/translation/segment'

describe('segmentForTranslation', () => {
  it('splits a simple paragraph into sentences', () => {
    const seg = segmentForTranslation('Das ist ein Satz. Das ist noch einer.')
    expect(seg.sentences).toEqual(['Das ist ein Satz.', 'Das ist noch einer.'])
  })

  it('round-trips identity when "translated" sentences are the originals', () => {
    const text = 'Das ist ein Satz. Das ist noch einer.'
    const seg = segmentForTranslation(text)
    expect(seg.reassemble(seg.sentences)).toBe(text)
  })

  it('reassembles with translated sentences in order', () => {
    const seg = segmentForTranslation('Erster Satz. Zweiter Satz.')
    expect(seg.reassemble(['First sentence.', 'Second sentence.'])).toBe(
      'First sentence. Second sentence.',
    )
  })

  it('preserves paragraph breaks exactly , including multi-newline runs', () => {
    const text = 'Absatz eins.\n\nAbsatz zwei.\n\n\nAbsatz drei.'
    const seg = segmentForTranslation(text)
    expect(seg.sentences).toHaveLength(3)
    expect(seg.reassemble(['One.', 'Two.', 'Three.'])).toBe('One.\n\nTwo.\n\n\nThree.')
  })

  it('returns no sentences for empty input', () => {
    const seg = segmentForTranslation('')
    expect(seg.sentences).toEqual([])
    expect(seg.reassemble([])).toBe('')
  })

  it('keeps pure-newline input as separators with zero sentences', () => {
    const seg = segmentForTranslation('\n\n')
    expect(seg.sentences).toEqual([])
    expect(seg.reassemble([])).toBe('\n\n')
  })

  it('throws on a translated-count mismatch instead of silently dropping text', () => {
    const seg = segmentForTranslation('Eins. Zwei.')
    expect(() => seg.reassemble(['only one'])).toThrow(/expects 2/)
  })

  it('hard-wraps an unsegmentable monster sentence at word boundaries', () => {
    // 300 words , no sentence punctuation — OCR/table-extraction shape.
    const text = Array.from({ length: 300 }, (_, i) => `wort${i}`).join(' ')
    const seg = segmentForTranslation(text)
    expect(seg.sentences.length).toBeGreaterThan(1)
    for (const s of seg.sentences) expect(s.length).toBeLessThanOrEqual(800)
    // No words lost in the wrap.
    expect(seg.sentences.join(' ')).toBe(text)
  })

  it('passes a space-free token longer than the cap through whole', () => {
    const blob = 'x'.repeat(1200)
    const seg = segmentForTranslation(blob)
    expect(seg.sentences).toEqual([blob])
  })
})
