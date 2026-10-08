/** Exact display fragments, not an entailment or completeness checker. A valid
 * substring can still omit a negation, condition, or another relevant fact. */
export type SourceFragment = {
  start: number
  end: number
  text: string
  ambiguous: boolean
}
export type SourceExcerpt = {
  selected: SourceFragment
  /** Same selected occurrence; ambiguity counts complete original selections. */
  display: SourceFragment
}
/** Fixed categories only; never source text, identities, spans or counts. */
export type SourceFragmentRejection = 'display' | 'missing' | 'boundary'

const word = (text: string): boolean => /[\p{L}\p{N}\p{M}\p{Pc}\u200c\u200d]/u.test(text)
const number = (text: string): boolean => /\p{N}/u.test(text)
const joiner = (text: string): boolean => /[-‐‑‒–—−'’/⁄∕]/u.test(text)
const numericConnector = (text: string): boolean =>
  /[.,\u066b\u066c:/⁄∕+\-‐‑‒–—−﹢﹣＋－×÷·∙⋅*^]/u.test(text)
const numericDecoration = (text: string): boolean => /[%‰‱°\p{Sc}]/u.test(text)
const comparator = (text: string): boolean => /[<>=≤≥≠≈≃≅≲≳∼~]/u.test(text)
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

function before(text: string, at: number): string {
  return Array.from(text.slice(Math.max(0, at - 2), at)).at(-1) ?? ''
}
function after(text: string, at: number): string {
  const value = text.codePointAt(at)
  return value === undefined ? '' : String.fromCodePoint(value)
}

/** No trimming, normalization, delimiter removal or source repair. */
export function isDisplayFragment(
  value: unknown,
  maxCodePoints: number,
  completeTitle = false,
): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    Array.from(value).length > maxCodePoints ||
    /[\r\n\u2028\u2029]/u.test(value) ||
    /[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\u200c\u200d]/gu, '')) ||
    /[.!?…。！？;:,]$/u.test(value) ||
    /[!?…。！？]/u.test(value)
  )
    return false
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) return false
  }
  // Complete filenames are valid captured titles. This exception cannot turn
  // a source substring into a guessed title or split a sentence into clauses.
  const fileTitle =
    completeTitle && /^[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*(?:\.[\p{L}\p{N}_-]+)+$/u.test(value)
  const abbreviationDots = new Set<number>()
  for (const match of value.matchAll(
    /\b(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc)\.(?=\s+\S)|\b(?:e\.g|i\.e|z\.\s*B|d\.\s*h)\.(?=\s+\S)/giu,
  )) {
    for (let offset = 0; offset < match[0].length; offset++)
      if (match[0][offset] === '.') abbreviationDots.add(match.index + offset)
  }
  for (let at = 0; at < value.length; at++) {
    if (
      value[at] === '.' &&
      !fileTitle &&
      !abbreviationDots.has(at) &&
      !(number(before(value, at)) && number(after(value, at + 1)))
    )
      return false
  }
  return true
}

function wholeBoundary(source: string, start: number, end: number): boolean {
  const first = after(source, start),
    last = before(source, end)
  const left = before(source, start),
    right = after(source, end)
  if ((word(left) && word(first)) || (word(last) && word(right))) return false
  if (
    (joiner(left) && word(first) && word(before(source, start - left.length))) ||
    (word(left) && joiner(first)) ||
    (word(last) && joiner(right) && word(after(source, end + right.length))) ||
    (joiner(last) && word(right))
  )
    return false
  let leftAt = start,
    rightAt = end
  while (leftAt > 0 && /[ \t\u00a0\u202f]/u.test(before(source, leftAt)))
    leftAt -= before(source, leftAt).length
  while (rightAt < source.length && /[ \t\u00a0\u202f]/u.test(after(source, rightAt)))
    rightAt += after(source, rightAt).length
  const previous = before(source, leftAt),
    next = after(source, rightAt)
  if (number(first)) {
    if (
      number(previous) ||
      numericDecoration(previous) ||
      comparator(previous) ||
      /[+\-−﹢﹣＋－]/u.test(previous)
    )
      return false
    // A leading decimal separator belongs to the number even with no integer
    // part. Across whitespace, only an actual preceding number forms a join.
    if (/[.,\u066b\u066c]/u.test(left)) return false
    if (numericConnector(previous)) {
      let preceding = leftAt - previous.length
      while (preceding > 0 && /[ \t\u00a0\u202f]/u.test(before(source, preceding)))
        preceding -= before(source, preceding).length
      if (number(before(source, preceding))) return false
    }
  }
  if (number(last)) {
    if (number(next) || numericDecoration(next) || comparator(next)) return false
    if (numericConnector(next)) {
      let following = rightAt + next.length
      while (following < source.length && /[ \t\u00a0\u202f]/u.test(after(source, following)))
        following += after(source, following).length
      if (number(after(source, following))) return false
    }
  }
  // Spaced word joins remain ambiguous; a plain bullet before a word is not
  // confused with a joined prefix when no preceding word exists.
  const leftEmDashSeparator =
    previous === '—' && leftAt < start && /[ \t\u00a0\u202f]/u.test(before(source, leftAt - 1))
  const rightEmDashSeparator =
    next === '—' && rightAt > end && /[ \t\u00a0\u202f]/u.test(after(source, rightAt + 1))
  if (word(first) && joiner(previous) && !leftEmDashSeparator) {
    let preceding = leftAt - previous.length
    while (preceding > 0 && /[ \t\u00a0\u202f]/u.test(before(source, preceding)))
      preceding -= before(source, preceding).length
    if (word(before(source, preceding))) return false
  }
  if (word(last) && joiner(next) && !rightEmDashSeparator) {
    let following = rightAt + next.length
    while (following < source.length && /[ \t\u00a0\u202f]/u.test(after(source, following)))
      following += after(source, following).length
    if (word(after(source, following))) return false
  }
  return true
}

/** Lazily captures grapheme boundaries once per immutable supplied passage.
 * Return the first VALID occurrence and flag repeated valid occurrences. */
export function createSourceFragmentMatcher(source: string) {
  let boundaries: Set<number> | undefined
  return (
    fragment: unknown,
    maxCodePoints = 160,
    onReject?: (reason: SourceFragmentRejection) => void,
  ): SourceFragment | null => {
    const reject = (reason: SourceFragmentRejection): null => {
      try {
        onReject?.(reason)
      } catch {
        // Diagnostics cannot affect exact fragment admission.
      }
      return null
    }
    if (!isDisplayFragment(fragment, maxCodePoints)) return reject('display')
    boundaries ??= new Set([
      0,
      source.length,
      ...Array.from(graphemes.segment(source), (part) => part.index),
    ])
    let selected: SourceFragment | undefined
    let foundOccurrence = false
    let offset = 0
    while (offset <= source.length - fragment.length) {
      const start = source.indexOf(fragment, offset)
      if (start < 0) break
      foundOccurrence = true
      const end = start + fragment.length
      offset = start + 1
      if (!boundaries.has(start) || !boundaries.has(end) || !wholeBoundary(source, start, end))
        continue
      if (selected) return { ...selected, ambiguous: true }
      selected = { start, end, text: fragment, ambiguous: false }
    }
    return selected ?? reject(foundOccurrence ? 'boundary' : 'missing')
  }
}

// Terminal abbreviation forms are ambiguous without linguistic interpretation.
// Decline these common EN/DE forms, initials and short all-capital abbreviations;
// this is a conservative lexical policy, not a general sentence-boundary oracle.
const terminalAbbreviation =
  /(?:^|[^\p{L}\p{M}])(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|approx|ca|cf|e\.g|i\.e|z\.\s*B|d\.\s*h|bzw|usw|u\.\s*a|ggf|inkl|zzgl|Nr|No|Abb|Abs|Art|Aufl|Bd|S|vgl|Str|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Okt|Dez)\.$/iu

/** Bounded inline presentation only, not source provenance, language detection,
 * entailment or a universal linguistic sentence counter. Accept unchanged text
 * or its exact subspan excluding one terminal ASCII full stop; never trim,
 * normalize, join sentences or repair other punctuation. */
export function inlineSentenceBody(value: unknown, maxCodePoints: number): string | null {
  if (!Number.isSafeInteger(maxCodePoints) || maxCodePoints < 1) return null
  if (typeof value !== 'string' || !value.endsWith('.'))
    return isDisplayFragment(value, maxCodePoints) ? value : null
  const display = value.slice(0, -1)
  if (
    Array.from(value).length > maxCodePoints ||
    !isDisplayFragment(display, maxCodePoints) ||
    terminalAbbreviation.test(value) ||
    /(?:^|[^\p{L}\p{M}])\p{L}\.$/u.test(value) ||
    /(?:^|[^\p{L}\p{M}])\p{Lu}{2,5}\.$/u.test(value) ||
    /^[+\-−]?\p{N}+\.$/u.test(value)
  )
    return null
  return display
}

/** An excerpt may include one final ASCII full stop. Keep that exact selection
 * for provenance and display its exact subspan without the stop. Both spans
 * must validate at the SAME occurrence. Labels retain the stricter matcher.
 * No whitespace, Unicode, punctuation or source content is repaired. */
export function createSourceExcerptMatcher(source: string) {
  const strictMatch = createSourceFragmentMatcher(source)
  let boundaries: Set<number> | undefined
  return (
    excerpt: unknown,
    maxCodePoints = 160,
    onReject?: (reason: SourceFragmentRejection) => void,
  ): SourceExcerpt | null => {
    if (typeof excerpt !== 'string' || !excerpt.endsWith('.')) {
      const matched = strictMatch(excerpt, maxCodePoints, onReject)
      return matched ? { selected: matched, display: { ...matched } } : null
    }
    const reject = (reason: SourceFragmentRejection): null => {
      try {
        onReject?.(reason)
      } catch {
        // Diagnostics cannot affect admission or expose rejected text.
      }
      return null
    }
    const display = inlineSentenceBody(excerpt, maxCodePoints)
    if (display === null) return reject('display')
    boundaries ??= new Set([
      0,
      source.length,
      ...Array.from(graphemes.segment(source), (part) => part.index),
    ])
    let matched: SourceExcerpt | undefined
    let foundOccurrence = false
    let offset = 0
    while (offset <= source.length - excerpt.length) {
      const start = source.indexOf(excerpt, offset)
      if (start < 0) break
      const end = start + excerpt.length
      const displayEnd = end - 1
      foundOccurrence = true
      offset = start + 1
      const following = after(source, end)
      if (
        (following && !/[\s\])}"'»”’]/u.test(following)) ||
        !boundaries.has(start) ||
        !boundaries.has(end) ||
        !boundaries.has(displayEnd) ||
        !wholeBoundary(source, start, end) ||
        !wholeBoundary(source, start, displayEnd)
      )
        continue
      if (matched)
        return {
          selected: { ...matched.selected, ambiguous: true },
          display: { ...matched.display, ambiguous: true },
        }
      matched = {
        selected: { start, end, text: excerpt, ambiguous: false },
        display: { start, end: displayEnd, text: display, ambiguous: false },
      }
    }
    return matched ?? reject(foundOccurrence ? 'boundary' : 'missing')
  }
}
