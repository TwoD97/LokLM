import { describe, it, expect } from 'vitest'
import { chunkForTranslation } from '../../src/main/services/translation/segment'

describe('translation chunks', () => {
  it.each([
    '',
    '  \r\n\t',
    'First sentence. Second sentence.',
    '  One.\r\n\r\nTwo.\n\n\nThree.  ',
    '日本語😀'.repeat(100),
    'x'.repeat(1200),
  ])('round-trips bounded chunks: %s', (text) => {
    const result = chunkForTranslation(text, 32)
    expect(result.reassemble(result.chunks)).toBe(text)
    for (const chunk of result.chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(32)
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/u)
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/u)
    }
  })
  it('keeps related sentences together instead of making one LLM call per sentence', () => {
    const result = chunkForTranslation('One. Two. Three.', 1024)
    expect(result.chunks).toEqual(['One. Two. Three.'])
    expect(result.sentences).toBe(3)
  })
  it('retains paragraph separators when reassembling translated chunks', () => {
    const result = chunkForTranslation('  First paragraph.\r\n\r\nSecond paragraph.  ', 24)
    expect(result.reassemble(['Erster Absatz.', 'Zweiter Absatz.'])).toBe(
      '  Erster Absatz.\r\n\r\nZweiter Absatz.  ',
    )
  })
  it('rejects missing output and unsafe budgets', () => {
    expect(() => chunkForTranslation('hello', 100).reassemble([])).toThrow('Incomplete')
    expect(() => chunkForTranslation('hello', 3)).toThrow('budget')
    expect(() => chunkForTranslation('hello', NaN)).toThrow('budget')
  })
})
