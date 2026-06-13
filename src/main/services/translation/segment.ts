/**
 * Sentence segmentation for the MADLAD sidecar. The model is sentence-level —
 * feeding it whole paragraphs degrades quality and overruns max_input_length ,
 * so we split per sentence , translate , and reassemble preserving the
 * paragraph structure (newline runs) exactly.
 *
 * Pure functions , no I/O — unit-tested in tests/unit/translation-segment.test.ts.
 */

/** Hard cap per sentence. MADLAD silently truncates past its input limit ,
 *  wrapping at word boundaries loses less than truncation does. */
const MAX_SENTENCE_CHARS = 800

export interface SegmentedText {
  /** Sentences in document order , ready to batch into the sidecar. */
  sentences: string[]
  /** Rebuild the full text from the translated sentences (same order+count). */
  reassemble: (translated: readonly string[]) => string
}

type PlanItem = { kind: 'sep'; value: string } | { kind: 'block'; count: number }

export function segmentForTranslation(text: string): SegmentedText {
  // Capture newline runs as separators so blank-line structure survives the
  // round trip; everything between them is segmented per sentence.
  const parts = text.split(/(\n+)/)
  const sentences: string[] = []
  const plan: PlanItem[] = []

  for (const part of parts) {
    if (part === '') continue
    if (/^\n+$/.test(part)) {
      plan.push({ kind: 'sep', value: part })
      continue
    }
    const blockSentences = splitSentences(part)
    plan.push({ kind: 'block', count: blockSentences.length })
    sentences.push(...blockSentences)
  }

  return {
    sentences,
    reassemble: (translated) => {
      if (translated.length !== sentences.length) {
        throw new Error(
          `reassemble expects ${sentences.length} sentences , got ${translated.length}`,
        )
      }
      let i = 0
      let out = ''
      for (const item of plan) {
        if (item.kind === 'sep') {
          out += item.value
          continue
        }
        out += translated.slice(i, i + item.count).join(' ')
        i += item.count
      }
      return out
    },
  }
}

function splitSentences(block: string): string[] {
  // Locale left undefined on purpose: sentence boundaries are punctuation-
  // driven in UAX #29 and the source language is unknown at this point.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  const out: string[] = []
  for (const s of segmenter.segment(block)) {
    const t = s.segment.trim()
    if (t) out.push(...hardWrap(t))
  }
  return out
}

/** Guard against unsegmentable input (tables , minified text , OCR runs):
 *  wrap at word boundaries near the cap. A single space-free token longer
 *  than the cap passes through whole — truncation is then the model's call. */
function hardWrap(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence]
  const words = sentence.split(/\s+/)
  const chunks: string[] = []
  let current = ''
  for (const w of words) {
    if (current && current.length + 1 + w.length > MAX_SENTENCE_CHARS) {
      chunks.push(current)
      current = w
    } else {
      current = current ? `${current} ${w}` : w
    }
  }
  if (current) chunks.push(current)
  return chunks
}
