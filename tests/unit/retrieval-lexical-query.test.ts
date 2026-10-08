import { describe, expect, it } from 'vitest'
import { documentLexicalQuery } from '@main/services/retrieval/heuristics'

describe('document lexical query', () => {
  it.each([
    ['List the counts with the observation times.', 'List counts observation times'],
    ['Nenne die Bestände mit den zugehörigen Uhrzeiten.', 'Nenne Bestände zugehörigen Uhrzeiten'],
    ['Widersprechen sich die Halden-Bestandsangaben?', 'Widersprechen Halden Bestandsangaben'],
    ['the values and limits in the report', 'values limits report'],
    ['THE Werte mit DEN Einheiten', 'Werte Einheiten'],
    ['für Łódź und 東京 with Δοκιμή', 'Łódź 東京 Δοκιμή'],
    [
      'the AuthService and AB12 values for item 2034-06-01',
      'AuthService AB12 values item 2034 06 01',
    ],
    ['the 7 kg and 125 ms values', '7 kg 125 ms values'],
  ])('removes only shared function words from %s', (query, expected) => {
    expect(documentLexicalQuery(query)).toBe(expected)
  })

  it.each([
    'Find "to be" in the play',
    "Find 'and or' in the source",
    'What does `is` mean in the expression?',
    'Suche „die Werte“ im Bericht',
    'Find «the count» in the report',
    'Find “the count” in the report',
    '~~~js\nconst value = a && b\n~~~',
    'the and in',
    'die mit den',
    'the a 7',
    '  and  ',
    '',
    '...?!',
  ])('preserves literal or no-substantive-token query bytes: %s', (query) => {
    expect(documentLexicalQuery(query)).toBe(query)
  })

  it('keeps the input unchanged for callers of the semantic arm', () => {
    const query = 'Nenne die Bestände mit den zugehörigen Uhrzeiten.'
    const original = query
    expect(documentLexicalQuery(query)).not.toBe(query)
    expect(query).toBe(original)
  })
})
