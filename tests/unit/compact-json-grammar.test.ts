import { describe, expect, it } from 'vitest'
import { compactJsonGrammarOptions } from '@main/services/workers/compactJsonGrammar'

// Public getters and GBNF spelling emitted by node-llama-cpp 3.21.1's JSON
// converter. No native backend/model is created by these pure transform tests.
const source = String.raw`root ::= "{" whitespace-b-1-4-rule "\"value\"" ":" [ ]? string-rule comma-whitespace-b-1-4-rule "\"kind\"" ":" [ ]? val0 whitespace-b-0-4-rule "}" "\n\n\n\n" [\n]*
string-char-rule ::= [^"\\\x7F\x00-\x1F] | "\\" ["\\/bfnrt] | "\\u" [0-9a-fA-F]{4}
string-rule ::= "\"" string-char-rule* "\""
val0 ::= "\"literal whitespace-b-1-4-rule ::= [ ]? with spaces and \\n escape\""
whitespace-b-1-4-rule ::= [\n] ("    " | "\t") | [ ]?
comma-whitespace-b-1-4-rule ::= "," ([\n] ("    " | "\t") | [ ]?)
whitespace-b-0-4-rule ::= [\n] | [ ]?`

function base(grammar = source) {
  const stopGenerationTriggers = [{ toString: () => '\n\n\n\n' }]
  return {
    get grammar() {
      return grammar
    },
    get rootRuleName() {
      return 'root'
    },
    get stopGenerationTriggers() {
      return stopGenerationTriggers
    },
    get trimWhitespaceSuffix() {
      return true
    },
  }
}

describe('compact JSON grammar', () => {
  it('changes only the recognized whole whitespace rules and preserves public metadata', () => {
    const original = base()
    const result = compactJsonGrammarOptions(original)
    const before = source.split('\n')
    const after = result.grammar.split('\n')
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
    expect(after.slice(4)).toEqual([
      'whitespace-b-1-4-rule ::= [ ]?',
      'comma-whitespace-b-1-4-rule ::= "," [ ]?',
      'whitespace-b-0-4-rule ::= [ ]?',
    ])
    expect(result.rootRuleName).toBe(original.rootRuleName)
    expect(result.stopGenerationTriggers).toBe(original.stopGenerationTriggers)
    expect(result.trimWhitespaceSuffix).toBe(true)
    expect(original.grammar).toBe(source)
  })

  it.each([
    ['whitespace-b-2-4-rule', String.raw`[\n] (" "{8} | "\t\t") | [ ]?`, '[ ]?'],
    ['whitespace-a-3-4-rule', String.raw`(" "{12} | "\t"{3}) [\n] | [ ]?`, '[ ]?'],
    ['comma-whitespace-a-3-4-rule', String.raw`"," ((" "{12} | "\t"{3}) [\n] | [ ]?)`, '"," [ ]?'],
    ['whitespace-no-new-lines-rule', '[ ]?', '[ ]?'],
    ['comma-whitespace-no-new-lines-rule', '"," [ ]?', '"," [ ]?'],
    ['whitespace-b-1-0-rule', String.raw`[\n] ("" | "\t") | [ ]?`, '[ ]?'],
  ])('recognizes the exact converter terminal %s', (name, rhs, compact) => {
    const result = compactJsonGrammarOptions(base(`${source}\n${name} ::= ${rhs}`))
    expect(result.grammar.split('\n').at(-1)).toBe(`${name} ::= ${compact}`)
  })

  it('preserves CRLF and trailing line endings without touching literals or the root terminator', () => {
    const original = source.replaceAll('\n', '\r\n') + '\r\n'
    const result = compactJsonGrammarOptions(base(original))
    expect(result.grammar.split('\r\n').slice(0, 4)).toEqual(original.split('\r\n').slice(0, 4))
    expect(result.grammar.endsWith('\r\n')).toBe(true)
    expect(result.grammar.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it.each([
    ['whitespace-b-1-4-rule', '[ ]*'],
    ['whitespace-b-1-4-rule', 'PRIVATE_SOURCE_VALUE'],
    ['whitespace-b-1-4-rule', String.raw`[\n] (" "{4} | "\t") | [ ]?`],
    ['comma-whitespace-b-1-4-rule', String.raw`([\n] ("    " | "\t") | [ ]?)`],
    ['whitespace-x-1-4-rule', '[ ]?'],
    ['whitespace-b-01-4-rule', '[ ]?'],
    ['whitespace-b-9007199254740992-4-rule', '[ ]?'],
  ])('rejects changed/unknown terminal %s without exposing its RHS', (name, rhs) => {
    const changed = source
      .split('\n')
      .filter((line) => !line.startsWith(`${name} ::= `))
      .concat(`${name} ::= ${rhs}`)
      .join('\n')
    expect(() => compactJsonGrammarOptions(base(changed))).toThrow(
      'Structured output whitespace grammar is unsupported.',
    )
  })

  it('rejects duplicate rules, absent whitespace and changed termination rather than repairing them', () => {
    for (const grammar of [
      `${source}\nwhitespace-b-1-4-rule ::= [ ]?`,
      source.split('\n').slice(0, 4).join('\n'),
      source.replace(String.raw`"\n\n\n\n" [\n]*`, String.raw`"\n"`),
      source.replace('root ::= ', 'unexpected-root ::= '),
    ])
      expect(() => compactJsonGrammarOptions(base(grammar))).toThrow(
        'Structured output whitespace grammar is unsupported.',
      )
  })

  it.each([
    null,
    undefined,
    {},
    { grammar: source },
    { ...base(), trimWhitespaceSuffix: undefined },
  ])('rejects incomplete public grammar metadata', (grammar) => {
    expect(() => compactJsonGrammarOptions(grammar)).toThrow(
      'Structured output whitespace grammar is unsupported.',
    )
  })
})
