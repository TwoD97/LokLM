import { describe, expect, it } from 'vitest'
import { parseOrderedAnswer20261005 } from '../evals/native-calibration/orderedAnswer20261005'

const hits = [{ document_id: 8, chunk_id: 21 }]
const valid = { check: 'The supplied value is 12.', answer: 'It is 12. [doc:8, chunk:21]' }

describe('bounded ordered-answer diagnostic parser', () => {
  it('keeps the final answer separate from the unverified check', () => {
    expect(parseOrderedAnswer20261005(JSON.stringify(valid), hits)).toEqual(valid)
  })
  it('rejects an unknown source without retargeting the marker', () => {
    expect(
      parseOrderedAnswer20261005(
        JSON.stringify({ ...valid, answer: 'It is 12. [doc:8, chunk:22]' }),
        hits,
      ),
    ).toBeNull()
  })
  it('rejects duplicate keys including escaped spellings and reordered fields', () => {
    expect(
      parseOrderedAnswer20261005('{"check":"x","ch\\u0065ck":"y","answer":"z"}', hits),
    ).toBeNull()
    expect(parseOrderedAnswer20261005('{"answer":"z","check":"x"}', hits)).toBeNull()
  })
  it('handles escaped key-looking text inside values without false duplication', () => {
    const input = { check: 'The text says "check": "one".', answer: 'Quoted text only.' }
    expect(parseOrderedAnswer20261005(JSON.stringify(input), hits)).toEqual(input)
  })
  it('enforces code-point bounds and rejects incomplete or empty strings', () => {
    expect(
      parseOrderedAnswer20261005(JSON.stringify({ ...valid, check: 'x'.repeat(241) }), hits),
    ).toBeNull()
    expect(
      parseOrderedAnswer20261005(JSON.stringify({ ...valid, answer: 'x'.repeat(2001) }), hits),
    ).toBeNull()
    expect(
      parseOrderedAnswer20261005(
        JSON.stringify({ ...valid, check: '\u{1f642}'.repeat(240) }),
        hits,
      ),
    ).not.toBeNull()
    expect(parseOrderedAnswer20261005('{"check":"x","answer":', hits)).toBeNull()
    expect(parseOrderedAnswer20261005(JSON.stringify({ ...valid, check: ' ' }), hits)).toBeNull()
  })
  it('does not claim semantic verification from known marker membership', () => {
    const falseClaim = {
      check: 'A model-authored comparison.',
      answer: 'The supplied value is 999. [doc:8, chunk:21]',
    }
    expect(parseOrderedAnswer20261005(JSON.stringify(falseClaim), hits)).toEqual(falseClaim)
  })
})
