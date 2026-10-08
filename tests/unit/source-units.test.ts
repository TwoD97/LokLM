import { describe, expect, it } from 'vitest'
import { createSourceUnitCatalog, SOURCE_UNIT_LIMITS } from '@main/services/qa/sourceUnits'

const passage = (text: string, document_id = 1, chunk_id = 10) => ({ document_id, chunk_id, text })
const catalog = (text: string) => {
  const result = createSourceUnitCatalog([passage(text)])
  if (!result.ok) throw new Error(result.reason)
  return result
}

describe('immutable complete source units', () => {
  it('labels every prose sentence once without changing any original byte, including CRLF and surrogate offsets', () => {
    const text =
      '  A sensor reads 2.25 m³.\r\nIt measures 🧪 samples.\r\n\r\nEine zweite Messung folgt!  '
    const result = catalog(text)
    expect(result.units.map((unit) => unit.text)).toEqual([
      'A sensor reads 2.25 m³.',
      'It measures 🧪 samples.',
      'Eine zweite Messung folgt!',
    ])
    expect(result.promptSourceText(1, 10).replace(/\[U\d+\] /gu, '')).toBe(text)
    for (const unit of result.units) expect(text.slice(unit.start, unit.end)).toBe(unit.text)
    expect(result.units.map((unit) => unit.id)).toEqual(['U1', 'U2', 'U3'])
  })

  it.each([
    '- First condition.\n\n  A qualifying continuation.\n- Another item.\n',
    '| Measure | Value |\n| --- | --- |\n| First. | 2.5 |\n',
    '```py\nif value:\n    return 2\n\nreturn 3\n```\n',
    '~~~text\nA sentence.\n\nAn unclosed fence remains complete.',
    '> One statement.\n> Another qualification.\n\n> Continued quotation.',
    '    first();\n\n    second();\n',
    'Dr. Vega recorded 2.25 m. The next record differs.',
  ])('does not sentence-split a structured or abbreviation-ambiguous block: %s', (text) => {
    const result = catalog(text)
    expect(result.units).toHaveLength(1)
    expect(result.units[0]?.text).toBe(text)
    expect(result.promptSourceText(1, 10).replace('[U1] ', '')).toBe(text)
  })

  it('preserves an entire code-file passage including significant leading indentation', () => {
    const text = '    return 1.0\n\n    return 2.0\n'
    const result = createSourceUnitCatalog([{ ...passage(text), document_title: 'function.py' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ start: 0, end: text.length, text })
  })

  it('keeps separately supplied duplicate text as distinct source identities and captures input immutably', () => {
    const input = [
      passage('The rule stays unchanged.'),
      passage('The rule stays unchanged.', 2, 20),
    ]
    const result = createSourceUnitCatalog(input)
    if (!result.ok) throw new Error(result.reason)
    input[0]!.text = 'Changed after catalog creation.'
    expect(result.units.map((unit) => unit.source)).toEqual(['1:10', '2:20'])
    expect(result.get('U1')?.text).toBe('The rule stays unchanged.')
    expect(Object.isFrozen(result.units)).toBe(true)
    expect(Object.isFrozen(result.get('U1'))).toBe(true)
    expect(() => result.promptSourceText(99, 10)).toThrow('Unknown source unit passage')
    expect(result.get('U99')).toBeUndefined()
  })

  it('declines the entire catalog beyond its unit bound without excluding a source', () => {
    const allowed = 'A complete sentence. '.repeat(SOURCE_UNIT_LIMITS.units)
    expect(catalog(allowed).units).toHaveLength(SOURCE_UNIT_LIMITS.units)
    expect(createSourceUnitCatalog([passage(allowed + 'One more complete sentence.')])).toEqual({
      ok: false,
      reason: 'unit_bounds',
    })
  })

  it('rejects unsafe, duplicate, empty and oversized source catalogs before labelling', () => {
    for (const input of [
      [],
      [passage(' ')],
      [passage('Text.', 0)],
      [passage('Text.', Number.MAX_SAFE_INTEGER + 1)],
      [passage('Text.'), passage('Other.')],
      [passage('x'.repeat(64_001))],
      Array.from({ length: 33 }, (_, i) => passage('Text.', i + 1)),
      Array.from({ length: 5 }, (_, i) => passage('x'.repeat(60_000), i + 1)),
    ])
      expect(createSourceUnitCatalog(input)).toEqual({ ok: false, reason: 'source_bounds' })
  })

  it('keeps possible qualifiers available but does not certify independently selected sentences as self-contained', () => {
    const result = catalog('The charge is 18 units. This applies only to members.')
    expect(result.units).toHaveLength(2)
    expect(result.get('U2')?.text).toBe('This applies only to members.')
    expect(result.promptSourceText(1, 10)).toContain(
      '[U1] The charge is 18 units. [U2] This applies only to members.',
    )
  })
})
