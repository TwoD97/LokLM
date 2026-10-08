/** Interpret a deliberately small, side-effect-free numeric JavaScript subset.
 * This never executes source code. Results describe the shown function only;
 * they do not establish which source version is deployed or authoritative. */
export interface CalculationPassage {
  document_id: number
  chunk_id: number
  document_title: string
  text: string
}

export interface SourceCalculation {
  documentId: number
  chunkId: number
  start: number
  end: number
  source: string
  call: string
  result: number
}

const LIMITS = { question: 4096, passages: 16, chars: 16_000, results: 16, tokens: 256, depth: 24 }
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?/
const IDENTIFIER = /^[A-Za-z_$][\w$]*/
const RESERVED = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield arguments eval'.split(
    ' ',
  ),
)
const FUNCTIONS: Readonly<
  Record<string, { min: number; max: number; run: (...args: number[]) => number }>
> = {
  min: { min: 1, max: 8, run: Math.min },
  max: { min: 1, max: 8, run: Math.max },
  abs: { min: 1, max: 1, run: Math.abs },
  floor: { min: 1, max: 1, run: Math.floor },
  ceil: { min: 1, max: 1, run: Math.ceil },
  round: { min: 1, max: 1, run: Math.round },
  trunc: { min: 1, max: 1, run: Math.trunc },
}

function numericExpression(
  expression: string,
  variables: ReadonlyMap<string, number>,
): number | null {
  if (expression.length > 700 || /\+\+|--|\*\*|\/\/|\/\*/.test(expression)) return null
  const tokens: string[] = []
  for (let i = 0; i < expression.length; ) {
    if (/\s/.test(expression[i]!)) {
      i++
      continue
    }
    const rest = expression.slice(i)
    const token =
      NUMBER.exec(rest)?.[0] ?? IDENTIFIER.exec(rest)?.[0] ?? /^[+\-*/%(),.]/.exec(rest)?.[0]
    if (!token || /^0\d/.test(token) || tokens.length >= LIMITS.tokens) return null
    tokens.push(token)
    i += token.length
  }
  let position = 0
  const take = (expected: string): void => {
    if (tokens[position++] !== expected) throw new Error('Unsupported expression')
  }
  const finite = (value: number): number => {
    if (!Number.isFinite(value)) throw new Error('Non-finite result')
    return value
  }
  const primary = (depth: number): number => {
    if (depth > LIMITS.depth) throw new Error('Expression too deep')
    const token = tokens[position++]
    if (!token) throw new Error('Incomplete expression')
    if (token === '+' || token === '-') {
      const value = primary(depth + 1)
      return token === '-' ? -value : value
    }
    if (token === '(') {
      const value = sum(depth + 1)
      take(')')
      return value
    }
    if (NUMBER.exec(token)?.[0] === token) return finite(Number(token))
    if (variables.has(token)) return variables.get(token)!
    if (token !== 'Math') throw new Error('Unknown name')
    take('.')
    const name = tokens[position++]!
    if (!Object.hasOwn(FUNCTIONS, name)) throw new Error('Unsupported function')
    const fn = FUNCTIONS[name]!
    take('(')
    const args: number[] = []
    if (tokens[position] !== ')') {
      args.push(sum(depth + 1))
      while (tokens[position] === ',') {
        position++
        if (args.length >= fn.max) throw new Error('Too many arguments')
        args.push(sum(depth + 1))
      }
    }
    take(')')
    if (args.length < fn.min || args.length > fn.max) throw new Error('Wrong arity')
    return finite(fn.run(...args))
  }
  const product = (depth: number): number => {
    let value = primary(depth)
    while (['*', '/', '%'].includes(tokens[position] ?? '')) {
      const op = tokens[position++]!
      const right = primary(depth)
      value = finite(op === '*' ? value * right : op === '/' ? value / right : value % right)
    }
    return value
  }
  const sum = (depth: number): number => {
    let value = product(depth)
    while (tokens[position] === '+' || tokens[position] === '-') {
      const op = tokens[position++]!
      const right = product(depth)
      value = finite(op === '+' ? value + right : value - right)
    }
    return value
  }
  try {
    const value = sum(0)
    return position === tokens.length ? value : null
  } catch {
    return null
  }
}

function codeWindows(passage: CalculationPassage): Array<{ text: string; start: number }> {
  if (/\.(?:[cm]?[jt]s)$/i.test(passage.document_title)) return [{ text: passage.text, start: 0 }]
  const windows: Array<{ text: string; start: number }> = []
  const fenced =
    /^ {0,3}(`{3,}|~{3,})(?:js|ts|javascript|typescript)[ \t]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*\r?$/gm
  for (const match of passage.text.matchAll(fenced)) {
    const start = match.index! + match[0].indexOf('\n') + 1
    windows.push({ text: match[2]!, start })
  }
  return windows
}

/** A textual call must refer to this unqualified function. Decline ambiguous
 * member/constructor calls and tails of Unicode or escaped identifiers. Removing
 * comments here is only a conservative admission check, never source execution. */
function unsupportedCallPrefix(question: string, start: number): boolean {
  const before = question.slice(0, start)
  if (/[\p{ID_Continue}$\\\u200c\u200d]$/u.test(before)) return true
  const previous = before
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .trimEnd()
  return previous.endsWith('.') || /(?:^|[^\p{ID_Continue}$])new$/u.test(previous)
}

type NumericCall = { call: string; args: number[] }
type NamedInput = { literal: string; value: number } | null

/** Explicit question bindings only. A malformed or repeated assignment poisons
 * that name instead of letting a later match silently choose another value. */
function namedInputs(question: string): Map<string, NamedInput> {
  const inputs = new Map<string, NamedInput>()
  for (const match of question.matchAll(/([A-Za-z_$][\w$]{0,63})\s*([+\-*/%&|^]?=)/g)) {
    const name = match[1]!
    if (inputs.has(name)) {
      inputs.set(name, null)
      continue
    }
    const rest = question.slice(match.index! + match[0].length).trimStart()
    const literal = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?/.exec(rest)?.[0]
    const after = literal === undefined ? '' : rest.slice(literal.length)
    const tail = after.trimStart()
    if (
      unsupportedCallPrefix(question, match.index!) ||
      /\p{Cf}$/u.test(question.slice(0, match.index!)) ||
      match[2] !== '=' ||
      literal === undefined ||
      !Number.isFinite(Number(literal)) ||
      // A literal cannot stop in the middle of attached numeric decoration.
      // Only prose punctuation/whitespace can follow it without a separator.
      (after.length > 0 && !/^[\s,;'"`!?]/u.test(after)) ||
      /^[\p{ID_Continue}$\\.\u200c\u200d]/u.test(after) ||
      /^[\p{Cf}\p{Sc}\p{N}\u066b\u066c\uff0c\uff0e‰‱]/u.test(tail) ||
      '+-*/%<>=&|^?:()[]{}\\×÷−–—·∙⋅∕⁄~≈≤≥±√∛∜'.includes(tail[0] ?? '\0') ||
      /^,\s*(?:[+\-.\d]|\(|\[|\])/u.test(tail) ||
      /^['’]\s*\d/u.test(tail) ||
      /^\s+\d/u.test(after)
    ) {
      inputs.set(name, null)
      continue
    }
    inputs.set(name, { literal, value: Number(literal) })
  }
  return inputs
}

/** Only a bare, exact function name qualifies; a nonliteral call, member,
 * constructor or identifier fragment is not a substitute for a literal call. */
function namedCall(
  question: string,
  name: string,
  parameters: readonly string[],
  inputs: ReadonlyMap<string, NamedInput>,
): NumericCall[] {
  const values = parameters.map((parameter) => inputs.get(parameter))
  if (!parameters.length || values.some((value) => value == null)) return []
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let mentioned = false
  for (const match of question.matchAll(new RegExp(escapedName, 'g'))) {
    const after = question.slice(match.index! + name.length)
    // A longer identifier is not a mention of this function at all.
    if (/^[\p{ID_Continue}$\\\u200c\u200d]/u.test(after)) continue
    if (
      unsupportedCallPrefix(question, match.index!) ||
      /\p{Cf}$/u.test(question.slice(0, match.index!))
    )
      return []
    const next = after
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\r\n]*/g, ' ')
      .trimStart()
    if (/^(?:\p{Cf}|\(|\[|[.=]|\?\s*\.)/u.test(next)) return []
    mentioned = true
  }
  if (!mentioned) return []
  const bindings = values as Array<Exclude<NamedInput, null>>
  return [
    {
      call: `${name}(${bindings.map((binding) => binding.literal).join(', ')})`,
      args: bindings.map((binding) => binding.value),
    },
  ]
}

/** Unselected declarations must still have supported bindings: a malformed
 * sibling would make the purportedly complete snippet invalid. */
function supportedBindings(name: string, parameters: string): boolean {
  if (RESERVED.has(name)) return false
  const parametersText = parameters.trim()
  if (!parametersText) return true
  return parametersText.split(',').every((entry) => {
    const match = /^([A-Za-z_$][\w$]*)(?:\s*:\s*number)?$/.exec(entry.trim())
    return match !== null && !RESERVED.has(match[1]!)
  })
}

/** Literal calls or explicit named literal inputs in the question, plus complete
 * straight-line source functions. Unsupported syntax is omitted, not approximated. */
export function sourceCalculationAnnotations(
  question: string,
  passages: readonly CalculationPassage[],
) {
  const calculations: SourceCalculation[] = []
  if (!question.trim() || question.length > LIMITS.question) return { calculations, annotation: '' }
  const calls = new Map<string, NumericCall[]>()
  for (const match of question.matchAll(
    /(?<![\w$.])([A-Za-z_$][\w$]{0,63})\(([\d\s.,eE+-]{1,100})\)/g,
  )) {
    if (unsupportedCallPrefix(question, match.index!)) continue
    const inputs = match[2]!.split(',').map((arg) => arg.trim())
    if (
      inputs.length > 4 ||
      inputs.some(
        (arg) => !/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/.test(arg),
      )
    )
      continue
    const args = inputs.map(Number)
    if (args.some((value) => !Number.isFinite(value))) continue
    const list = calls.get(match[1]!) ?? []
    if (!list.some((entry) => entry.call === match[0])) list.push({ call: match[0], args })
    calls.set(match[1]!, list)
  }
  const bindings = namedInputs(question)
  if (!calls.size && !bindings.size) return { calculations, annotation: '' }
  const seen = new Set<string>()
  for (const passage of passages.slice(0, LIMITS.passages)) {
    if (
      !Number.isSafeInteger(passage.document_id) ||
      passage.document_id <= 0 ||
      !Number.isSafeInteger(passage.chunk_id) ||
      passage.chunk_id <= 0 ||
      passage.text.length > LIMITS.chars
    )
      continue
    const key = `${passage.document_id}:${passage.chunk_id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (
      passages
        .slice(0, LIMITS.passages)
        .some(
          (other) =>
            other.document_id === passage.document_id &&
            other.chunk_id === passage.chunk_id &&
            (other.text !== passage.text || other.document_title !== passage.document_title),
        )
    )
      continue
    for (const window of codeWindows(passage)) {
      const declaration =
        /^(?:[ \t]*)(?:export\s+(?:default\s+)?)?function\s+([A-Za-z_$][\w$]{0,63})\s*\(([^(){}]{0,160})\)\s*(?::\s*number\s*)?\{\s*return[ \t]+([^{};]{1,700});?\s*\}/gm
      const functions = [...window.text.matchAll(declaration)]
      // Require a complete snippet consisting only of these declarations. A
      // declaration inside a comment/string/conditional or alongside shadowing
      // bindings is not a supported standalone function.
      if (
        window.text.replace(declaration, '').trim() ||
        functions.some((entry) => entry[1] === 'Math' || !supportedBindings(entry[1]!, entry[2]!))
      )
        continue
      for (const match of functions) {
        const name = match[1]!
        // A line terminator after return triggers JavaScript's automatic
        // semicolon insertion even if spaces precede that terminator.
        if (/^[^\S\r\n\u2028\u2029]*[\r\n\u2028\u2029]/.test(match[3]!)) continue
        // Duplicate definitions require resolving JavaScript binding scope,
        // which this bounded interpreter deliberately does not attempt.
        if (RESERVED.has(name) || functions.filter((entry) => entry[1] === name).length !== 1)
          continue
        const parameters = match[2]!.split(',').map((arg) => arg.trim())
        if (
          parameters.length > 4 ||
          parameters.some((arg) => !/^[A-Za-z_$][\w$]*(?:\s*:\s*number)?$/.test(arg))
        )
          continue
        const names = parameters.map((arg) => arg.split(':')[0]!.trim())
        if (
          new Set(names).size !== names.length ||
          names.includes('Math') ||
          names.some((param) => RESERVED.has(param))
        )
          continue
        const requested = calls.get(name) ?? namedCall(question, name, names, bindings)
        for (const call of requested) {
          if (calculations.length >= LIMITS.results) break
          if (call.args.length !== names.length) continue
          const result = numericExpression(
            match[3]!,
            new Map(names.map((param, i) => [param, call.args[i]!])),
          )
          if (result === null) continue
          const start = window.start + match.index!
          calculations.push({
            documentId: passage.document_id,
            chunkId: passage.chunk_id,
            start,
            end: start + match[0].length,
            source: match[0],
            call: call.call,
            result,
          })
        }
      }
    }
  }
  const lines = calculations.map(
    (entry) =>
      `[doc:${entry.documentId}, chunk:${entry.chunkId}] ${entry.call} = ${Object.is(entry.result, -0) ? '-0' : String(entry.result)}`,
  )
  const annotation = lines.length
    ? [
        'Numeric interpretation of the shown functions with standard JavaScript Math only; this does not establish deployment, authority or applicability.',
        ...lines,
      ].join('\n')
    : ''
  return { calculations, annotation }
}
