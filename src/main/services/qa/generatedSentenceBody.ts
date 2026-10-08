/** Bounded generated prose, not an exact source excerpt or a semantic check.
 * The lexical abbreviation policy is deliberately finite: it is not a universal
 * sentence-boundary detector, completeness check or language detector. */
const interiorAbbreviation =
  /(?<![\p{L}\p{M}\p{N}_])(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|bspw|bzw|ca|ggf|inkl|zzgl|Nr|No|Abb|Abs|Art|vgl|usw|e\.g|i\.e|z\.[ \t]*B|d\.[ \t]*h|u\.[ \t]*a)\.(?=[ \t\p{Zs}]+\S)/giu

// Keep incomplete/ambiguous terminal abbreviation forms conservative. Unlike
// exact excerpt matching, a terminal initial or acronym alone is not ambiguous
// source-span provenance: generated "... A." and "... EU." remain unchanged
// when the caller restores the one admitted final stop.
const incompleteTerminalAbbreviation =
  /(?:^|[^\p{L}\p{M}])(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|approx|ca|cf|e\.g|i\.e|z\.\s*B|d\.\s*h|bspw|bzw|usw|u\.\s*a|ggf|inkl|zzgl|Nr|No|Abb|Abs|Art|Aufl|Bd|S|vgl|Str|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Okt|Dez)\.$/iu

/** Accept unchanged prose or its exact subspan excluding one terminal ASCII
 * full stop. Never trim, normalize, join sentences or repair source content.
 * The original input, including its optional stop, consumes the codepoint cap.
 * Canonical citations, HTML and final render bounds remain the caller's guards. */
export function generatedSentenceBody(value: unknown, maxCodePoints: number): string | null {
  if (
    !Number.isSafeInteger(maxCodePoints) ||
    maxCodePoints < 1 ||
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    Array.from(value).length > maxCodePoints ||
    /[\r\n\u2028\u2029]/u.test(value) ||
    /[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\u200c\u200d]/gu, ''))
  )
    return null
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) return null
  }
  const stopped = value.endsWith('.')
  const body = stopped ? value.slice(0, -1) : value
  if (
    !body ||
    body.trim() !== body ||
    /[.!?…。！？;:,]$/u.test(body) ||
    /[!?…。！？]/u.test(body) ||
    (stopped && (incompleteTerminalAbbreviation.test(value) || /^[+\-−]?\p{N}+\.$/u.test(value)))
  )
    return null
  const abbreviationDots = new Set<number>()
  for (const match of body.matchAll(interiorAbbreviation)) {
    for (let offset = 0; offset < match[0].length; offset++)
      if (match[0][offset] === '.') abbreviationDots.add(match.index + offset)
  }
  for (let at = 0; at < body.length; at++) {
    if (body[at] !== '.' || abbreviationDots.has(at)) continue
    const before = Array.from(body.slice(Math.max(0, at - 2), at)).at(-1) ?? ''
    const nextPoint = body.codePointAt(at + 1)
    const after = nextPoint === undefined ? '' : String.fromCodePoint(nextPoint)
    if (!/\p{N}/u.test(before) || !/\p{N}/u.test(after)) return null
  }
  return body
}
