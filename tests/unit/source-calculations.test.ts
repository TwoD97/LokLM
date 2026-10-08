import { describe, expect, it } from 'vitest'
import {
  sourceCalculationAnnotations,
  type CalculationPassage,
} from '@main/services/qa/sourceCalculations'

const passage = (code: string, id = 1): CalculationPassage => ({
  document_id: id,
  chunk_id: id * 10,
  document_title: 'Archive.md',
  text: `# Archive\n\n~~~ts\n${code}\n~~~\n\nDeployment is not recorded.`,
})
const fn = (expression: string, name = 'clip') =>
  `export function ${name}(value: number): number {\n  return ${expression}\n}`

describe('source-linked numeric code interpretation', () => {
  it('evaluates nested calls in both archived copies without choosing a deployed version', () => {
    const sources = [
      passage(fn('Math.min(8, Math.max(0, value))')),
      passage(fn('Math.min(10, Math.max(0, value))'), 2),
    ]
    const result = sourceCalculationAnnotations(
      'What does clip(9) return in each archived copy?',
      sources,
    )
    expect(result.calculations.map((item) => item.result)).toEqual([8, 9])
    expect(result.annotation).toContain('does not establish deployment, authority or applicability')
    for (const [i, item] of result.calculations.entries()) {
      expect(item.documentId).toBe(sources[i]!.document_id)
      expect(sources[i]!.text.slice(item.start, item.end)).toBe(item.source)
      expect(item.call).toBe('clip(9)')
    }
  })

  it.each([
    ['value * 2 + 1', 'clip(4)', 9],
    ['(value + 2) * 3', 'clip(4)', 18],
    ['Math.min(5, Math.max(0, value))', 'clip(-4)', 0],
    ['Math.max(-5, -Math.abs(value))', 'clip(4)', -4],
    ['Math.floor(value / 3)', 'clip(8)', 2],
    ['Math.ceil(value / 3)', 'clip(8)', 3],
    ['Math.round(value / 3)', 'clip(8)', 3],
    ['Math.trunc(-value / 3)', 'clip(8)', -2],
    ['value % 3', 'clip(8)', 2],
    ['value + 0.1', 'clip(0.2)', 0.2 + 0.1],
  ])(
    'interprets %s with literal %s using JavaScript numeric semantics',
    (expression, question, expected) => {
      expect(
        sourceCalculationAnnotations(question, [passage(fn(expression))]).calculations[0]?.result,
      ).toBe(expected)
    },
  )

  it('supports multiple numeric parameters, direct source files, and CRLF', () => {
    const source = {
      ...passage(''),
      document_title: 'scale.ts',
      text: 'function scale(x: number, y: number): number {\r\n  return x * y;\r\n}',
    }
    expect(sourceCalculationAnnotations('scale(3, 7)', [source]).calculations[0]?.result).toBe(21)
  })

  it('derives calls from unique named numeric inputs without selecting a deployed copy', () => {
    const sources = [
      passage(fn('Math.max(0, Math.min(value - 1, 6))')),
      passage(fn('Math.max(0, Math.min(value - 1, 9))'), 2),
    ]
    const result = sourceCalculationAnnotations(
      'For value=8, what does clip return in each archive copy?',
      sources,
    )
    expect(result.calculations.map((entry) => [entry.call, entry.result])).toEqual([
      ['clip(8)', 6],
      ['clip(8)', 7],
    ])
    for (const [index, entry] of result.calculations.entries())
      expect(sources[index]!.text.slice(entry.start, entry.end)).toBe(entry.source)
    expect(result.annotation).toContain('[doc:1, chunk:10] clip(8) = 6')
    expect(result.annotation).not.toMatch(/@\d+:\d+/)
    expect(result.annotation).toContain('does not establish deployment')
  })

  it('binds up to four parameters by source declaration order, not question order', () => {
    const source = passage('function scale(a, b, c, d) { return a * b + c - d }')
    const result = sourceCalculationAnnotations(
      'For d=1, b=2, a=3, c=.5, what does scale return?',
      [source],
    )
    expect(result.calculations.map((entry) => [entry.call, entry.result])).toEqual([
      ['scale(3, 2, .5, 1)', 5.5],
    ])
  })

  it.each([
    ['value=-8; what does clip return?', -8],
    ['Given value = +2e1, what does clip return?', 20],
    ['Given `value=8`, what does `clip` return?', 8],
    ['For value=.25 and unrelated=100, what does clip return?', 0.25],
  ])('accepts complete numeric bindings with ordinary prose punctuation: %s', (question, value) => {
    expect(
      sourceCalculationAnnotations(question, [passage(fn('value'))]).calculations[0]?.result,
    ).toBe(value)
  })

  it.each([
    'value=8 and value=9; what does clip return?',
    'value=8 and value=8; what does clip return?',
    'value=8 and value+=1; what does clip return?',
    'value=8+1; what does clip return?',
    'value=8 / 2; what does clip return?',
    'value=8 × 2; what does clip return?',
    'value=8 · 2; what does clip return?',
    'value=8 ∙ 2; what does clip return?',
    'value=8 ⋅ 2; what does clip return?',
    'value=8 ∕ 2; what does clip return?',
    'value=8 ⁄ 2; what does clip return?',
    'value=8\u066b5; what does clip return?',
    'value=8 \u066b5; what does clip return?',
    'value=8\u066c000; what does clip return?',
    'value=8 \u066c000; what does clip return?',
    'value=8²; what does clip return?',
    'value=8 ½; what does clip return?',
    'value=8€; what does clip return?',
    'value=8 ‰; what does clip return?',
    'value=8,500; what does clip return?',
    'value=8, 500; what does clip return?',
    'value=8 000; what does clip return?',
    "value=8'000; what does clip return?",
    'value=8’000; what does clip return?',
    'value=8, .5; what does clip return?',
    'value=8, -5; what does clip return?',
    'value=8.000,5; what does clip return?',
    'value=(8); what does clip return?',
    'value==8; what does clip return?',
    'value=>8; what does clip return?',
    'value=NaN; what does clip return?',
    'value=Infinity; what does clip return?',
    'value=1e999; what does clip return?',
    'value=010; what does clip return?',
    'value=0x10; what does clip return?',
    'value=8n; what does clip return?',
    'value=8é; what does clip return?',
    'value=8\u200b+1; what does clip return?',
    'value=8 \u200b+1; what does clip return?',
    'value=8\\u0061; what does clip return?',
    'object.value=8; what does clip return?',
    'object . value=8; what does clip return?',
    'évalue=8; what does clip return?',
    '\u200bvalue=8; what does clip return?',
    'value=8; what does object.clip return?',
    'value=8; what does new clip return?',
    'value=8; what does new /* factory */ clip return?',
    'value=8; what does éclip return?',
    'value=8; what does clipé return?',
    'value=8; what does clip\u200b.value return?',
    'value=8; what does \u200bclip return?',
    'value=8; what does clip\\u0061 return?',
    'value=8; what does clip.value return?',
    'value=8; what does clip[value] return?',
    'value=8; what does clip(value) return?',
    'value=8; what does clip /* call */ (value) return?',
    'value=8; what does clip return at value=unknown?',
    'For value equal to 8, what does clip return?',
  ])('declines ambiguous or nonliteral named inputs: %s', (question) => {
    expect(sourceCalculationAnnotations(question, [passage(fn('value'))]).calculations).toEqual([])
  })

  it('declines missing parameters and more than four source parameters', () => {
    expect(
      sourceCalculationAnnotations('a=1; what does scale return?', [
        passage('function scale(a, b) { return a + b }'),
      ]).calculations,
    ).toEqual([])
    expect(
      sourceCalculationAnnotations('a=1,b=2,c=3,d=4,e=5; what does scale return?', [
        passage('function scale(a, b, c, d, e) { return a + b + c + d + e }'),
      ]).calculations,
    ).toEqual([])
  })

  it('retains explicit call behavior without adding a conflicting named-derived call', () => {
    const result = sourceCalculationAnnotations('value=8; compare clip(2) and clip(3)', [
      passage(fn('value')),
    ])
    expect(result.calculations.map((entry) => [entry.call, entry.result])).toEqual([
      ['clip(2)', 2],
      ['clip(3)', 3],
    ])
    expect(result.annotation).not.toMatch(/@\d+:\d+/)
  })

  it.each([
    'process.exit(0)',
    'eval(value)',
    'Math.random()',
    'Math.constructor(value)',
    'value.toFixed(2)',
    'other + value',
    'value = 9',
    'value++',
    'value+++1',
    'value ** 2',
    'value / 0',
    'Math.min()',
    'Math.abs(value, 2)',
    'value > 0 ? 1 : 0',
    'value /* comment */ + 1',
    'value // comment\n + 1',
    '"9"',
    'new Number(value)',
    '[value][0]',
    '1e999',
    '010 + value',
  ])('declines unsupported expressions without executing them: %s', (expression) => {
    expect(sourceCalculationAnnotations('clip(9)', [passage(fn(expression))]).calculations).toEqual(
      [],
    )
  })

  it.each([
    `/*\n${fn('value')}\n*/`,
    `const Math = custom;\n${fn('Math.abs(value)')}`,
    `if (ready) {\n${fn('value')}\n}`,
    `${fn('value')}\n${fn('value + 1')}`,
    'function clip(value) { return\n value + 1 }',
    'function clip(value) { return \n value + 1 }',
    'function clip(value) { return \r\n value + 1 }',
    'function clip(value) { return \u2028 value + 1 }',
    'function clip(value) { return \u00a0\n value + 1 }',
    'function clip(class) { return class + 1 }',
    'function class(value) { return value }\nfunction clip(value) { return value + 1 }',
    'function other(class) { return class }\nfunction clip(value) { return value + 1 }',
    'function other(1value) { return 1 }\nfunction clip(value) { return value + 1 }',
    'function Math(x) { return x }\nfunction clip(value) { return Math.abs(value) }',
    'function clip(value = 9) { return value }',
    'function clip(value) { sideEffect(); return value }',
    'async function clip(value) { return value }',
  ])('declines ambiguous declarations and surrounding code', (code) => {
    expect(sourceCalculationAnnotations('clip(9)', [passage(code)]).calculations).toEqual([])
  })

  it.each([
    'clip(x)',
    'clip(2+3)',
    'object.clip(9)',
    'other(9)',
    'clip(9,4)',
    'clip(NaN)',
    'clip(010)',
    'new clip(9)',
    'new /* factory */ clip(9)',
    'new // factory\nclip(9)',
    'object . clip(9)',
    'object . /* method */ clip(9)',
    'object ? . clip(9)',
    'éclip(9)',
    '字clip(9)',
    'x\u200dclip(9)',
    '\\clip(9)',
  ])('declines nonliteral or mismatched call %s', (question) => {
    expect(sourceCalculationAnnotations(question, [passage(fn('value'))]).calculations).toEqual([])
  })

  it('does not interpret prose, unsupported languages, or open code fences as code', () => {
    for (const text of [fn('value'), `~~~python\n${fn('value')}\n~~~`, `~~~ts\n${fn('value')}`]) {
      expect(
        sourceCalculationAnnotations('clip(9)', [{ ...passage(''), text }]).calculations,
      ).toEqual([])
    }
  })

  it('declines invalid identifiers and bounds work and output', () => {
    expect(
      sourceCalculationAnnotations('clip(9)', [{ ...passage(fn('value')), document_id: 0 }])
        .calculations,
    ).toEqual([])
    expect(
      sourceCalculationAnnotations('clip(9)'.repeat(1000), [passage(fn('value'))]).calculations,
    ).toEqual([])
    expect(
      sourceCalculationAnnotations('clip(9)', [
        passage(fn('('.repeat(100) + 'value' + ')'.repeat(100))),
      ]).calculations,
    ).toEqual([])
    const sources = Array.from({ length: 100 }, (_, i) => passage(fn('value'), i + 1))
    expect(sourceCalculationAnnotations('clip(9)', sources).calculations).toHaveLength(16)
  })

  it('retains immutable source bytes', () => {
    const sources = Object.freeze([Object.freeze(passage(fn('value')))])
    const before = JSON.stringify(sources)
    expect(sourceCalculationAnnotations('clip(9)', sources).calculations).toHaveLength(1)
    expect(JSON.stringify(sources)).toBe(before)
  })

  it('declines different source bytes claiming the same passage identity', () => {
    expect(
      sourceCalculationAnnotations('clip(9)', [passage(fn('value')), passage(fn('value + 1'))])
        .calculations,
    ).toEqual([])
  })
})
