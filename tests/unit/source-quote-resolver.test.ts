import { describe, expect, it } from 'vitest'
import { createSourceQuoteResolver } from '@main/services/qa/sourceQuoteResolver'

const source = (text: string, document_id = 1, chunk_id = 10) => ({ text, document_id, chunk_id })

describe('unique quotation provenance across the complete source catalog', () => {
  it('derives an original UTF-16 span without model-supplied IDs or whitespace mutation', () => {
    const text = '😀 Preface.\nThe limit is\r\n  four units.\nEnd.'
    const resolve = createSourceQuoteResolver([source('Unrelated.'), source(text, 7, 91)])!
    const actual = resolve('The limit is four units.')
    expect(actual).toEqual({
      span: {
        source: '7:91',
        start: text.indexOf('The'),
        end: text.indexOf('\nEnd.'),
        text: 'The limit is\r\n  four units.',
        ambiguous: false,
      },
    })
  })

  it.each([
    [source('The limit is four.'), source('Copy: The limit is four.', 2, 20)],
    [source('The limit is four.\nThe limit is four.')],
    [source('The limit is four.'), source('The\n\nlimit is four.', 2, 20)],
    [source('The limit is four.'), source('The' + ' '.repeat(500) + 'limit is four.', 2, 20)],
  ])(
    'declines every global or repeated match, including whitespace-heavy duplicates: %j',
    (...passages) => {
      expect(createSourceQuoteResolver(passages)!('The limit is four.')).toEqual({
        reason: 'quote_ambiguous',
      })
    },
  )

  it('detects overlapping locations instead of selecting the first one', () => {
    expect(createSourceQuoteResolver([source('ababa')])!('aba')).toEqual({
      reason: 'quote_ambiguous',
    })
  })

  it.each([
    'The limit is five.',
    'the limit is four.',
    'The limit is four!',
    'The limit … four.',
    '',
    ' ',
    null,
    { quote: 'The limit is four.' },
  ])('does not repair, coerce or retarget an unmatched quotation: %j', (quote) => {
    expect(createSourceQuoteResolver([source('The limit is four.')])!(quote)).toEqual({
      reason: 'quote_missing',
    })
  })

  it('bounds quotes by code points and original source span, not escaped JSON length', () => {
    const unicode = '😀'.repeat(199) + '.'
    expect(createSourceQuoteResolver([source(unicode)])!(unicode)).toHaveProperty('span.end', 399)
    expect(createSourceQuoteResolver([source('x'.repeat(201))])!('x'.repeat(201))).toEqual({
      reason: 'quote_missing',
    })
    expect(createSourceQuoteResolver([source('a' + ' '.repeat(201) + 'b')])!('a b')).toEqual({
      reason: 'quote_missing',
    })
  })

  it('snapshots source input and protects cached spans from caller mutation', () => {
    const input = [source('Original source words.')]
    const resolve = createSourceQuoteResolver(input)!
    input[0]!.text = 'Modified after admission.'
    const result = resolve('Original source words.')
    if ('span' in result) result.span.source = '999:999'
    expect(resolve(' Original\nsource words. ')).toHaveProperty('span.source', '1:10')
    expect(resolve('Modified after admission.')).toEqual({ reason: 'quote_missing' })
  })

  it('does not claim a unique but irrelevant quotation entails the answer', () => {
    expect(
      createSourceQuoteResolver([source('The unrelated colour is blue.')])!(
        'The unrelated colour is blue.',
      ),
    ).toHaveProperty('span.source', '1:10')
  })

  it('rejects invalid identities, duplicate identities, empty and oversized catalogs', () => {
    for (const input of [
      [],
      [source('x', 0)],
      [source('x', Number.MAX_SAFE_INTEGER + 1)],
      [source('x'), source('y')],
      [source(' ')],
      [source('x'.repeat(64_001))],
      Array.from({ length: 33 }, (_, i) => source('x', i + 1)),
      Array.from({ length: 5 }, (_, i) => source('x'.repeat(64_000), i + 1)),
    ])
      expect(createSourceQuoteResolver(input)).toBeNull()
  })
})
