import { describe, expect, it } from 'vitest'
import {
  sourceQuantityAnnotations,
  SOURCE_QUANTITY_LIMITS,
  type SourceQuantityPassage,
} from '@main/services/qa/sourceQuantities'

const passage = (text: string, document_id = 1, chunk_id = 2): SourceQuantityPassage => ({
  document_id,
  chunk_id,
  text,
})

describe('source-linked exact quantity annotations', () => {
  it('normalizes 90 seconds and 1.5 minutes equally, preserving intact source offsets', () => {
    const input = [
      passage('⏱️ Delay: 90 seconds.', 7, 41),
      passage('Other delay is 1.5 minutes.', 8, 42),
    ]
    const result = sourceQuantityAnnotations(input)
    expect(result.limited).toBe(false)
    expect(result.quantities).toHaveLength(2)
    expect(result.quantities.map((quantity) => quantity.normalized)).toEqual([
      { numerator: '90', denominator: '1', value: '90', unit: 's' },
      { numerator: '90', denominator: '1', value: '90', unit: 's' },
    ])
    result.quantities.forEach((quantity, i) => {
      const source = input[i]!
      expect(quantity.documentId).toBe(source.document_id)
      expect(quantity.chunkId).toBe(source.chunk_id)
      expect(source.text.slice(quantity.start, quantity.end)).toBe(quantity.text)
      expect(result.annotation).toContain(`[doc:${source.document_id}, chunk:${source.chunk_id}]`)
    })
    expect(result.annotation).toContain(
      'do not establish shared scope, authority, or applicability',
    )
  })

  it.each([
    ['1 ms', '0.001', '1', '1000', 's'],
    ['0.1 seconds', '0.1', '1', '10', 's'],
    ['0.002 min', '0.12', '3', '25', 's'],
    ['0.25 hours', '900', '900', '1', 's'],
    ['2 days', '172800', '172800', '1', 's'],
    ['12 cm', '0.12', '3', '25', 'm'],
    ['1 mm', '0.001', '1', '1000', 'm'],
    ['1.5 km', '1500', '1500', '1', 'm'],
    ['0.1 kg', '100', '100', '1', 'g'],
    ['9007199254740993 g', '9007199254740993', '9007199254740993', '1', 'g'],
    ['0 h', '0', '0', '1', 's'],
    ['1,5 minutes', '90', '90', '1', 's'],
    ['0,05 mL', '0.00005', '1', '20000', 'L'],
    ['2,25 m³', '2250', '2250', '1', 'L'],
    ['0.125 cubic metres', '125', '125', '1', 'L'],
  ])('converts %s using exact rational arithmetic', (text, value, numerator, denominator, unit) => {
    expect(sourceQuantityAnnotations([passage(text)]).quantities[0]?.normalized).toEqual({
      value,
      numerator,
      denominator,
      unit,
    })
  })

  it('normalizes both volume spellings to litres with exact bilingual source spans', () => {
    const input = [
      passage('🧪 The measured volume is 2.25 cubic metres.', 21, 31),
      passage('Die gemessene Menge ist 2250 Liter.', 22, 32),
      passage('Eine Probe enthält 2,25\u2009L.', 23, 33),
    ]
    const result = sourceQuantityAnnotations(input)
    expect(
      result.quantities.map((quantity) => [
        quantity.dimension,
        quantity.normalized.value,
        quantity.normalized.unit,
      ]),
    ).toEqual([
      ['volume', '2250', 'L'],
      ['volume', '2250', 'L'],
      ['volume', '2.25', 'L'],
    ])
    result.quantities.forEach((quantity, index) => {
      expect(quantity.documentId).toBe(input[index]!.document_id)
      expect(quantity.chunkId).toBe(input[index]!.chunk_id)
      expect(input[index]!.text.slice(quantity.start, quantity.end)).toBe(quantity.text)
    })
    expect(result.quantities[2]?.text).toBe('2,25\u2009L')
    expect(input[2]!.text).toBe('Eine Probe enthält 2,25\u2009L.')
  })

  it.each([
    ['1 L', '1'],
    ['1 l', '1'],
    ['1250 mL', '1.25'],
    ['1250 ml', '1.25'],
    ['2 litres', '2'],
    ['2 liters', '2'],
    ['2 Litern', '2'],
    ['250 millilitres', '0.25'],
    ['250 milliliters', '0.25'],
    ['250 Millilitern', '0.25'],
    ['2 m³', '2000'],
    ['2 cubic metre', '2000'],
    ['2 cubic meters', '2000'],
    ['2 Cubic metres', '2000'],
    ['2 Kubikmeter', '2000'],
    ['2 Kubikmetern', '2000'],
    ['0,5 litre', '0.5'],
    ['1,00 L', '1'],
    ['1234,56 L', '1234.56'],
  ])(
    'recognizes the explicit volume notation %s without source-locale inference',
    (text, value) => {
      expect(sourceQuantityAnnotations([passage(text)]).quantities[0]).toMatchObject({
        text,
        dimension: 'volume',
        normalized: { value, unit: 'L' },
      })
    },
  )

  it('keeps catalog IDs and offsets internal while exposing only source-linked arithmetic', () => {
    const text = '🧪 Record: 2,25 m³.'
    const result = sourceQuantityAnnotations([passage(text, 8, 91)])
    const quantity = result.quantities[0]!
    expect(quantity.id).toBe('Q1')
    expect(quantity.start).toBe(text.indexOf('2,25'))
    expect(text.slice(quantity.start, quantity.end)).toBe('2,25 m³')
    expect(result.annotation).toContain('[doc:8, chunk:91] "2,25 m³" = 2250 L')
    expect(result.annotation).not.toMatch(/\bQ\d+\b|@\d+:\d+/u)
  })

  it.each([
    ',25 m',
    ',5 L',
    '2\u066b25 m',
    '1\u066c500 L',
    '1\u066c 500 L',
    '2\u066b\u00a025 m',
    '1\u066c\u202f500 L',
    '2 ML',
    '2 Ml',
    '2 M³',
    '2 m²',
    '2 cm²',
    '2 m^3',
    '2,250 L',
    '0,125 L',
    '12,345 L',
    '1.250 L',
    '1,250.5 L',
    '1.250,5 L',
    '2,25,5 L',
    '00,5 L',
    '-2,25 L',
    '+2,25 m³',
    '±2,25 L',
    '€2,25 L',
    '2,25 L\u2009€',
    'USD\u202f2,25 m³',
    '2 m³/s',
    '3 L/min',
    '3 L per hour',
    '3 L pro Minute',
    '90 s\u2009/min',
    '2 m³\u202f/s',
    '3 L\u2009per hour',
    '3 L\u2007× 2',
    '2 L\u2009+ 3 L',
    '1,5 L\u2009to\u20092,5 L',
    '2 L\u20093 mL',
    '1,\u2009250 L',
  ])(
    'declines unsupported volume/number/compound notation without extracting a tail: %s',
    (text) => {
      expect(sourceQuantityAnnotations([passage(text)]).quantities).toEqual([])
    },
  )

  it('retains ordinary prose punctuation and Unicode spacing around valid quantities', () => {
    const result = sourceQuantityAnnotations([
      passage('First, 25 L. Then wait\u200990\u2009s. Volume:\u202f2,25\u202fm³.'),
    ])
    expect(result.quantities.map((quantity) => [quantity.text, quantity.normalized.value])).toEqual(
      [
        ['25 L', '25'],
        ['90\u2009s', '90'],
        ['2,25\u202fm³', '2250'],
      ],
    )
  })

  it.each([
    '$3mm',
    '€3 mm',
    '3mm €',
    '£3mm',
    '¥3 mm',
    '$\u20093mm',
    '€\u00a03 mm',
    '3mm\u202f€',
    'USD 3mm',
    'EUR\u20093 mm',
    '3 mm USD',
    '3mm\u00a0EUR',
  ])('declines currency-adjacent unit symbols without interpreting finance: %s', (text) => {
    expect(sourceQuantityAnnotations([passage(text)]).quantities).toEqual([])
  })

  it('preserves a physical measurement when a currency mention is separate', () => {
    const text = 'Thickness:3mm. Price: €5. Revenue is reported in USD.'
    const result = sourceQuantityAnnotations([passage(text)])
    expect(result.quantities).toHaveLength(1)
    expect(result.quantities[0]).toMatchObject({
      text: '3mm',
      dimension: 'length',
      normalized: { value: '0.003', unit: 'm' },
    })
    const quantity = result.quantities[0]!
    expect(text.slice(quantity.start, quantity.end)).toBe('3mm')
  })

  it('keeps distinct values and dimensions distinct without classifying conflict', () => {
    const result = sourceQuantityAnnotations([passage('A: 90 s; B: 1.6 min; C: 90 m; D: 90 g.')])
    expect(
      result.quantities.map((quantity) => [quantity.dimension, quantity.normalized.value]),
    ).toEqual([
      ['duration', '90'],
      ['duration', '96'],
      ['length', '90'],
      ['mass', '90'],
    ])
    expect(result).not.toHaveProperty('relation')
    expect(result).not.toHaveProperty('authority')
  })

  it('supports common German duration words and compact SI symbols', () => {
    const result = sourceQuantityAnnotations([
      passage('1 Millisekunde; 2 Sekunden; 3 Minuten; 4 Stunden; 5 Tage; 6 Tagen; 90s; 12cm; 8kg.'),
    ])
    expect(result.quantities.map((quantity) => quantity.normalized.value)).toEqual([
      '0.001',
      '2',
      '180',
      '14400',
      '432000',
      '518400',
      '90',
      '0.12',
      '8000',
    ])
  })

  it.each([
    '1,500 s',
    '1, 500 s',
    '1 ,500 s',
    '1.500 s',
    '12.345 kg',
    '1.234,5 m',
    '1,234.5 m',
    '1 500 s',
    "1'500 s",
    '1\u202f500 s',
    '1\u2009500 s',
    '1\u2007500 s',
    '1,\u00a0500 s',
    '1,\u2009500 s',
    '1e3 s',
    '.5 min',
    '005 s',
    '-5 s',
    '−5 s',
    '+5 s',
    '±5 s',
    '- 5 s',
    '~5 s',
    '≈ 5 s',
    '<5 s',
    'about 5 s',
    'approximately 5 s',
    'at least 5 s',
    'up to 5 s',
    'ca. 5 s',
    'etwa 5 s',
    '3-5 min',
    '3 to 5 min',
    '3 bis 5 min',
    '5 s to 7 s',
    '5 s bis 7 s',
    '5s–7s',
    '5s±0.1s',
    '1 h and 30 min',
    'between 3 and 5 min',
    '2026-10-05 h',
    '10/05 s',
    '2026.10.05 s',
    '12:30 h',
    'A90s',
    'code_90s',
    'rev-90s',
    '90secondsSuffix',
    '90s_code',
    '5 kg/m',
    '5 m/s',
    '5 m per second',
    '5 m pro Sekunde',
    '5 m²',
    '5 m^2',
    '10^3 s',
    '10**3 s',
    '2 × 5 m',
    '2·5 m',
    '2 ⋅ 5 m',
    '1 ÷ 2 min',
    '1∕2 min',
    '1⁄2 min',
    '√4 m',
    '∛8 m',
    '∜16 m',
    '5 m⋅s',
    '5 m ÷ s',
    '5 m s',
    '1h30min',
    '1 h 30 min',
    '1 min−1',
    '1/2 min',
    '1 M',
    '1 MS',
    '1 G',
    '1 d',
    '5 seconds\nminutes',
    '1234567890123456789 s',
  ])('declines uncertain, ambiguous or unsupported notation: %s', (text) => {
    expect(sourceQuantityAnnotations([passage(text)]).quantities).toEqual([])
  })

  it('does not join independent quantities or treat different sources as corroboration', () => {
    const text = 'The first delay is 90 seconds; the other delay is 1.5 minutes.'
    const result = sourceQuantityAnnotations([passage(text), passage(text, 3, 4)])
    expect(result.quantities).toHaveLength(4)
    expect(new Set(result.quantities.map((quantity) => quantity.id)).size).toBe(4)
  })

  it('does not mutate frozen source records', () => {
    const input = Object.freeze([Object.freeze(passage('Delay: 90 seconds.'))])
    const snapshot = JSON.stringify(input)
    expect(sourceQuantityAnnotations(input).quantities).toHaveLength(1)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('deduplicates the same source and declines conflicting text for the same source ID', () => {
    expect(sourceQuantityAnnotations([passage('5 s'), passage('5 s')]).quantities).toHaveLength(1)
    expect(sourceQuantityAnnotations([passage('5 s'), passage('6 s')]).quantities).toEqual([])
  })

  it('rejects invalid source identifiers', () => {
    expect(
      sourceQuantityAnnotations([passage('5 s', 0), passage('5 s', -1), passage('5 s', 1, NaN)])
        .quantities,
    ).toEqual([])
  })

  it('skips oversized passages whole and reports passage/total input limits', () => {
    const oversized = passage('5 s ' + 'x'.repeat(SOURCE_QUANTITY_LIMITS.passageChars))
    expect(sourceQuantityAnnotations([oversized])).toEqual({
      quantities: [],
      annotation: '',
      limited: true,
    })
    const many = Array.from({ length: SOURCE_QUANTITY_LIMITS.passages + 1 }, (_, i) =>
      passage('5 s', i + 1),
    )
    expect(sourceQuantityAnnotations(many)).toMatchObject({ limited: true })
    const large = Array.from({ length: 5 }, (_, i) => passage('5 s.' + ' '.repeat(15_996), i + 1))
    const result = sourceQuantityAnnotations(large)
    expect(result.limited).toBe(true)
    expect(result.quantities).toHaveLength(4)
  })

  it('bounds returned candidates and annotations while preserving valid original spans', () => {
    const source = passage('5 s; '.repeat(100))
    const result = sourceQuantityAnnotations([source])
    expect(result.limited).toBe(true)
    expect(result.quantities).toHaveLength(SOURCE_QUANTITY_LIMITS.quantities)
    expect(result.annotation.length).toBeLessThanOrEqual(SOURCE_QUANTITY_LIMITS.annotationChars)
    expect(
      result.quantities.every(
        (quantity) => source.text.slice(quantity.start, quantity.end) === quantity.text,
      ),
    ).toBe(true)
  })
})
