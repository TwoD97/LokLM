/** Arithmetic annotations for literal quantities, not claim extraction. Equal
 * normalized values do not establish equal scope, authority or applicability. */
export interface SourceQuantityPassage {
  document_id: number
  chunk_id: number
  text: string
}

export type QuantityDimension = 'duration' | 'length' | 'mass' | 'volume'
export type QuantityBaseUnit = 's' | 'm' | 'g' | 'L'
export interface SourceQuantity {
  /** Per-result identifier; never reuse it with a different candidate list. */
  id: string
  documentId: number
  chunkId: number
  /** UTF-16 offsets into the intact original passage; end is exclusive. */
  start: number
  end: number
  text: string
  dimension: QuantityDimension
  normalized: {
    /** Reduced exact rational, serialized without BigInt/float loss. */
    numerator: string
    denominator: string
    value: string
    unit: QuantityBaseUnit
  }
}

export interface SourceQuantityResult {
  quantities: SourceQuantity[]
  annotation: string
  /** Some input was not scanned/returned because of a resource limit. This is
   * not a claim that all semantic quantities were found when false. */
  limited: boolean
}

export const SOURCE_QUANTITY_LIMITS = Object.freeze({
  passages: 16,
  passageChars: 16_000,
  totalChars: 64_000,
  quantities: 32,
  annotationChars: 6_000,
  numberDigits: 18,
})

interface Unit {
  dimension: QuantityDimension
  base: QuantityBaseUnit
  numerator: bigint
  denominator: bigint
}
const units = new Map<string, Unit>()
function add(
  names: string[],
  dimension: QuantityDimension,
  base: QuantityBaseUnit,
  numerator: bigint,
  denominator = 1n,
): void {
  const unit = { dimension, base, numerator, denominator }
  for (const name of names) units.set(name, unit)
}
add(
  ['ms', 'millisecond', 'milliseconds', 'Millisekunde', 'Millisekunden'],
  'duration',
  's',
  1n,
  1000n,
)
add(['s', 'second', 'seconds', 'Sekunde', 'Sekunden'], 'duration', 's', 1n)
add(['min', 'minute', 'minutes', 'Minute', 'Minuten'], 'duration', 's', 60n)
add(['h', 'hour', 'hours', 'Stunde', 'Stunden'], 'duration', 's', 3600n)
add(['day', 'days', 'Tag', 'Tage', 'Tagen'], 'duration', 's', 86400n)
add(['m'], 'length', 'm', 1n)
add(['cm'], 'length', 'm', 1n, 100n)
add(['mm'], 'length', 'm', 1n, 1000n)
add(['km'], 'length', 'm', 1000n)
add(['g'], 'mass', 'g', 1n)
add(['kg'], 'mass', 'g', 1000n)
add(['L', 'l', 'litre', 'litres', 'liter', 'liters', 'Liter', 'Litern'], 'volume', 'L', 1n)
add(
  [
    'mL',
    'ml',
    'millilitre',
    'millilitres',
    'milliliter',
    'milliliters',
    'Milliliter',
    'Millilitern',
  ],
  'volume',
  'L',
  1n,
  1000n,
)
add(
  ['m³', 'cubic metre', 'cubic metres', 'cubic meter', 'cubic meters', 'Kubikmeter', 'Kubikmetern'],
  'volume',
  'L',
  1000n,
)
// Full words allow sentence capitalization; symbols stay case-sensitive (M and
// MS do not mean metres and milliseconds). Never infer a language/number locale.
for (const [name, unit] of [...units]) {
  if (name.length > 3 || ['Tag'].includes(name)) {
    units.set(name.toLowerCase(), unit)
    units.set(name[0]!.toUpperCase() + name.slice(1), unit)
  }
}
const unitPattern = [...units.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')
const quantityPattern = new RegExp(
  `(?<![\\p{L}\\p{N}_])([0-9]+(?:[.,][0-9]+)*)([\\t\\p{Zs}]*)(?:${unitPattern})(?![\\p{L}\\p{N}_])`,
  'gu',
)
const standaloneUnitPattern = new RegExp(`^(?:${unitPattern})(?![\\p{L}\\p{N}_])`, 'u')
const compoundPrefixPattern = new RegExp(`[0-9][\\t\\p{Zs}]*(?:${unitPattern})[\\t\\p{Zs}]+$`, 'u')
const joinedQuantityPrefixPattern = new RegExp(
  `(?:${unitPattern})[\\t\\p{Zs}]+(?:to|bis|and|und|or|oder)[\\t\\p{Zs}]+$`,
  'u',
)
const ANNOTATION_HEADER =
  'Exact unit arithmetic only; these conversions do not establish shared scope, authority, or applicability.'

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

/** Accept one comma with 1–2 fractional digits without choosing a source locale.
 * Reject signs, exponents, grouping, ranges and mixed/repeated separators. A
 * nonzero 1–3 digit prefix with exactly three dot decimals may instead be
 * thousands grouping; keep rejecting it, while preserving unambiguous 0.125. */
function decimal(value: string): [bigint, bigint] | null {
  if (value.includes(',')) {
    if (!/^(?:0|[1-9][0-9]*),[0-9]{1,2}$/.test(value)) return null
    value = value.replace(',', '.')
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return null
  if (/^[1-9][0-9]{0,2}\.[0-9]{3}$/.test(value)) return null
  const digits = value.replace('.', '')
  if (digits.length > SOURCE_QUANTITY_LIMITS.numberDigits) return null
  const fraction = value.split('.')[1] ?? ''
  return [BigInt(digits), 10n ** BigInt(fraction.length)]
}

function exactDecimal(numerator: bigint, denominator: bigint): string {
  const integer = numerator / denominator
  let remainder = numerator % denominator
  if (!remainder) return String(integer)
  let fraction = ''
  // All supported input/factor denominators contain only factors of 2 and 5.
  while (remainder) {
    remainder *= 10n
    fraction += String(remainder / denominator)
    remainder %= denominator
  }
  return `${integer}.${fraction}`
}

function uncertainContext(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 80), start)
  const after = text.slice(end, end + 40)
  // Currency-adjacent SI-looking symbols may be financial abbreviations
  // (for example $3mm), not physical quantities. Decline rather than guess.
  if (/\p{Sc}[\t\p{Zs}]*$/u.test(before) || /^[\t\p{Zs}]*\p{Sc}/u.test(after)) return true
  // These explicit currency codes are unambiguous enough to decline nearby
  // measures; this is not a general currency or semantic-disambiguation parser.
  if (/(?<![\p{L}\p{N}_])(?:USD|EUR)[\t\p{Zs}]+$/u.test(before)) return true
  if (/^[\t\p{Zs}]+(?:USD|EUR)(?![\p{L}\p{N}_])/u.test(after)) return true
  // Do not extract the tail of a signed value, grouped number, identifier,
  // date, ratio or range. Newline is excluded from inter-token whitespace.
  // Unsupported leading-comma and Arabic decimal/group separators must not
  // leave a magnitude-changing numeric tail (for example ,25 m becoming 25 m).
  if (/[\p{L}\p{N}_.,\u066b\u066c]$/u.test(before)) return true
  if (/[/\\∕⁄+\-−–—±~≈<>≤≥*^×·∙⋅÷√∛∜][\t\p{Zs}]*$/u.test(before)) return true
  if (/[0-9](?:[\t\p{Zs}]+|[\t\p{Zs}]*[.,:'’\u066b\u066c][\t\p{Zs}]*)$/u.test(before)) return true
  if (
    /(?:about|around|roughly|approximately|circa|ca\.?|ungefähr|etwa|rund|mindestens|höchstens|at least|at most|up to|bis zu|between|zwischen)\s*$/iu.test(
      before,
    )
  )
    return true
  if (/[0-9][\t\p{Zs}]*(?:to|bis|and|und)[\t\p{Zs}]*$/iu.test(before)) return true
  // Products, rates, powers and clock/duration compounds need a different
  // parser; do not turn one of their operands into a standalone measure.
  if (/^[\t\p{Zs}]*(?:[/\\∕⁄·∙⋅÷×*^²³⁻%:±]|[-−–—][0-9]|per\b|pro\b)/iu.test(after)) return true
  if (/^[\t\p{Zs}]+(?:[0-9]|[+\-−–—±])/u.test(after)) return true
  if (/^[\t\p{Zs}]+(?:to|bis|and|und|or|oder)[\t\p{Zs}]+[0-9]/iu.test(after)) return true
  if (standaloneUnitPattern.test(after.trimStart())) return true
  if (compoundPrefixPattern.test(before)) return true
  if (joinedQuantityPrefixPattern.test(before)) return true
  return false
}

function annotationLine(quantity: SourceQuantity): string {
  // Source offsets and catalog IDs are internal metadata, not model instructions
  // or answer material. The prompt needs only the literal, result and source.
  return `[doc:${quantity.documentId}, chunk:${quantity.chunkId}] ${JSON.stringify(quantity.text)} = ${quantity.normalized.value} ${quantity.normalized.unit}`
}

/** Scan bounded original passages without mutating or rewriting their contents.
 * Unsupported/ambiguous notation is omitted, never guessed. An oversized
 * passage is skipped whole rather than cutting off a possible qualifier. */
export function sourceQuantityAnnotations(
  passages: readonly SourceQuantityPassage[],
): SourceQuantityResult {
  const quantities: SourceQuantity[] = []
  const lines: string[] = []
  let limited = passages.length > SOURCE_QUANTITY_LIMITS.passages
  let chars = 0
  let annotationChars = ANNOTATION_HEADER.length
  const bounded = passages.slice(0, SOURCE_QUANTITY_LIMITS.passages)
  const sourceTexts = new Map<string, string | null>()
  for (const passage of bounded) {
    const key = `${passage.document_id}:${passage.chunk_id}`
    if (passage.text.length > SOURCE_QUANTITY_LIMITS.passageChars) {
      limited = true
      sourceTexts.set(key, null)
      continue
    }
    const previous = sourceTexts.get(key)
    sourceTexts.set(key, previous === undefined || previous === passage.text ? passage.text : null)
  }
  const seen = new Set<string>()
  for (const passage of bounded) {
    const key = `${passage.document_id}:${passage.chunk_id}`
    if (
      !Number.isSafeInteger(passage.document_id) ||
      passage.document_id <= 0 ||
      !Number.isSafeInteger(passage.chunk_id) ||
      passage.chunk_id <= 0 ||
      sourceTexts.get(key) == null ||
      seen.has(key)
    )
      continue
    seen.add(key)
    if (
      passage.text.length > SOURCE_QUANTITY_LIMITS.passageChars ||
      chars + passage.text.length > SOURCE_QUANTITY_LIMITS.totalChars
    ) {
      limited = true
      continue
    }
    chars += passage.text.length
    for (const match of passage.text.matchAll(quantityPattern)) {
      const start = match.index!
      const end = start + match[0].length
      if (uncertainContext(passage.text, start, end)) continue
      const parsed = decimal(match[1]!)
      if (!parsed) continue
      const unit = units.get(match[0].slice(match[1]!.length + match[2]!.length))!
      const rawNumerator = parsed[0] * unit.numerator
      const rawDenominator = parsed[1] * unit.denominator
      const divisor = gcd(rawNumerator, rawDenominator)
      const numerator = rawNumerator / divisor
      const denominator = rawDenominator / divisor
      const quantity: SourceQuantity = {
        id: `Q${quantities.length + 1}`,
        documentId: passage.document_id,
        chunkId: passage.chunk_id,
        start,
        end,
        text: match[0],
        dimension: unit.dimension,
        normalized: {
          numerator: String(numerator),
          denominator: String(denominator),
          value: exactDecimal(numerator, denominator),
          unit: unit.base,
        },
      }
      const line = annotationLine(quantity)
      if (
        quantities.length >= SOURCE_QUANTITY_LIMITS.quantities ||
        annotationChars + line.length + 1 > SOURCE_QUANTITY_LIMITS.annotationChars
      ) {
        limited = true
        break
      }
      quantities.push(quantity)
      lines.push(line)
      annotationChars += line.length + 1
    }
  }
  return {
    quantities,
    annotation: lines.length ? [ANNOTATION_HEADER, ...lines].join('\n') : '',
    limited,
  }
}
