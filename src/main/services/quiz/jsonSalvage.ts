// Salvage helper for the quiz pipeline. A slow CPU model often hits maxTokens
// mid-array, leaving a truncated `[...]` whose final object is incomplete.
// JSON.parse on the whole slice then throws and we lose EVERY question. Instead
// we walk the array body, extract each top-level `{...}` by brace-matching
// (respecting string literals + escapes), and let the caller JSON.parse each
// object independently — keeping the valid prefix and dropping only the
// truncated tail.

/** Extract the raw text of each top-level JSON object from a string. Scans for
 *  balanced `{...}` runs at depth 1, ignoring braces inside string literals.
 *  Stops collecting once it hits an unbalanced (truncated) trailing object, so
 *  the prefix of complete objects is preserved. */
export function extractJsonObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  return out
}
