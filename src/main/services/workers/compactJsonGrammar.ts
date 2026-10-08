import type { LlamaGrammarOptions } from 'node-llama-cpp'

const INVALID_GRAMMAR = 'Structured output whitespace grammar is unsupported.'

function reject(): never {
  throw new Error(INVALID_GRAMMAR)
}

/** The JSON converter's whitespace terminals, pinned to its public GBNF output.
 * Reconstruct the complete RHS before narrowing it; rule names alone are not
 * enough to distinguish whitespace from a changed SDK grammar contract. */
function whitespaceRule(name: string): { original: string; compact: string } | null {
  if (!name.startsWith('whitespace-') && !name.startsWith('comma-whitespace-')) return null
  const match =
    /^(comma-)?whitespace-(?:no-new-lines|([ba])-(0|[1-9]\d*)-(0|[1-9]\d*))-rule$/u.exec(name)
  if (!match) return reject()
  const comma = match[1] !== undefined
  if (match[2] === undefined)
    return { original: comma ? '"," [ ]?' : '[ ]?', compact: comma ? '"," [ ]?' : '[ ]?' }
  const depth = Number(match[3])
  const pad = Number(match[4])
  if (
    !Number.isSafeInteger(depth) ||
    !Number.isSafeInteger(pad) ||
    !Number.isSafeInteger(depth * pad)
  )
    return reject()
  const repeatedLiteral = (character: ' ' | '\t', count: number): string => {
    const escaped = character === '\t' ? '\\t' : ' '
    const repetition = `"${escaped}"{${count}}`
    // Avoid allocating a large intermediate string when the converter would
    // choose repetition syntax. Equal lengths use its verbatim representation.
    if (count > 1 && repetition.length < 2 + escaped.length * count) return repetition
    return `"${escaped.repeat(count)}"`
  }
  const parts = [
    ...(match[2] === 'b' ? ['[\\n]'] : []),
    ...(depth === 0
      ? []
      : [`(${repeatedLiteral(' ', depth * pad)} | ${repeatedLiteral('\t', depth)})`]),
    ...(match[2] === 'a' ? ['[\\n]'] : []),
  ]
  const whitespace = `${parts.join(' ')} | [ ]?`
  return {
    original: comma ? `"," (${whitespace})` : whitespace,
    compact: comma ? '"," [ ]?' : '[ ]?',
  }
}

/** Narrow only the SDK JSON converter's recognized whitespace rules. String
 * contents/escapes, punctuation, bounds, enums and the final four-newline
 * terminator remain byte-identical. This does not validate answer semantics. */
export function compactJsonGrammarOptions(base: unknown): LlamaGrammarOptions {
  if (!base || typeof base !== 'object') return reject()
  const grammar = base as Partial<{
    grammar: string
    rootRuleName: string
    stopGenerationTriggers: LlamaGrammarOptions['stopGenerationTriggers']
    trimWhitespaceSuffix: boolean
  }>
  const { grammar: source, rootRuleName, stopGenerationTriggers, trimWhitespaceSuffix } = grammar
  if (
    typeof source !== 'string' ||
    !source ||
    typeof rootRuleName !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9-]*$/u.test(rootRuleName) ||
    !Array.isArray(stopGenerationTriggers) ||
    typeof trimWhitespaceSuffix !== 'boolean'
  )
    return reject()
  const names = new Set<string>()
  let whitespaceRules = 0
  let rootFound = false
  const compact = source
    .split(/(?<=\n)/u)
    .map((line) => {
      const match = /^([A-Za-z][A-Za-z0-9-]*) ::= ([^\r\n]+)(\r?\n)?$/u.exec(line)
      if (!match) return reject()
      const name = match[1]!
      const rhs = match[2]!
      const ending = match[3] ?? ''
      if (names.has(name)) return reject()
      names.add(name)
      if (name === rootRuleName) {
        rootFound = true
        if (!rhs.endsWith(' "\\n\\n\\n\\n" [\\n]*')) return reject()
      }
      const rule = whitespaceRule(name)
      if (!rule) return line
      if (rhs !== rule.original) return reject()
      whitespaceRules++
      return `${name} ::= ${rule.compact}${ending}`
    })
    .join('')
  if (!rootFound || whitespaceRules === 0) return reject()
  return { grammar: compact, rootRuleName, stopGenerationTriggers, trimWhitespaceSuffix }
}
