/** Bounded, contiguous text chunks. Keep nearby sentences together for context. */
export interface TranslationChunks {
  chunks: string[]
  sentences: number
  reassemble: (translations: readonly string[]) => string
}

export function chunkForTranslation(text: string, maxBytes: number): TranslationChunks {
  if (!Number.isInteger(maxBytes) || maxBytes < 4)
    throw new Error('Invalid translation chunk budget.')
  const chunks: string[] = []
  const plan: Array<string | { index: number }> = []
  let rest = text
  while (rest) {
    let end = 0
    let bytes = 0
    for (const char of rest) {
      const size = Buffer.byteLength(char, 'utf8')
      if (bytes + size > maxBytes) break
      bytes += size
      end += char.length
    }
    if (end < rest.length) {
      const head = rest.slice(0, end)
      // Prefer paragraphs/sentences, then spaces. Split oversized space-free
      // input by code point so CJK, emoji and OCR cannot overrun the model.
      for (const pattern of [/\r?\n[\t ]*\r?\n/g, /[.!?。！？][\t \r\n]+/g, /\s+/g]) {
        const matches = [...head.matchAll(pattern)]
        const last = matches.at(-1)
        if (last && last.index >= end / 3) {
          end = last.index + last[0].length
          break
        }
      }
    }
    const part = rest.slice(0, end)
    rest = rest.slice(end)
    const content = part.trim()
    if (!content) {
      plan.push(part)
      continue
    }
    const start = part.indexOf(content)
    plan.push(part.slice(0, start), { index: chunks.length }, part.slice(start + content.length))
    chunks.push(content)
  }
  const sentences = [
    ...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
  ].filter((s) => s.segment.trim()).length
  return {
    chunks,
    sentences,
    reassemble: (translations) => {
      if (translations.length !== chunks.length) throw new Error('Incomplete translation.')
      return plan
        .map((part) => (typeof part === 'string' ? part : translations[part.index]))
        .join('')
    },
  }
}
