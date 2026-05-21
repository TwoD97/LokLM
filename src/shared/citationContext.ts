/**
 * Pulls the sentence(s) of an assistant message that cite a specific
 * (documentId, chunkId) pair. Used by the SourceViewer to know which slice of
 * the answer to fuzzy-match against the chunk text for highlighting.
 *
 * Why per-citation and not the whole message: the same chunk often supports
 * just one claim in a longer answer , matching the full message produces
 * noisy false-positive highlights. Per-citation sentences are tight.
 */

import { extractCitationMarkers } from './citationMarkers'

const ANY_CITATION = /\[doc:(\d+),\s*chunk:(\d+)\]/g

/**
 * Returns every sentence in `messageText` that contains the citation marker
 * for `(documentId, chunkId)`. Each returned snippet has citation markers
 * removed and whitespace collapsed. Duplicates are deduped after
 * normalisation , so two identical sentences (rare) collapse to one.
 *
 * Empty array when the marker doesn't appear in the text.
 */
export function extractCitationSnippets(
  messageText: string,
  target: { documentId: number; chunkId: number },
): string[] {
  const found = extractCitationMarkers(messageText).some(
    (m) => m.documentId === target.documentId && m.chunkId === target.chunkId,
  )
  if (!found) return []

  const markerNeedle = `[doc:${target.documentId}, chunk:${target.chunkId}]`
  const altNeedle = `[doc:${target.documentId},chunk:${target.chunkId}]` // tolerated no-space form
  const out: string[] = []
  const seen = new Set<string>()

  let cursor = 0
  while (cursor < messageText.length) {
    const a = messageText.indexOf(markerNeedle, cursor)
    const b = messageText.indexOf(altNeedle, cursor)
    const next = a === -1 ? b : b === -1 ? a : Math.min(a, b)
    if (next === -1) break
    const sentence = sentenceAround(messageText, next)
    const normalised = stripCitationsAndCollapse(sentence)
    if (normalised.length > 0 && !seen.has(normalised)) {
      seen.add(normalised)
      out.push(normalised)
    }
    cursor = next + 1
  }
  return out
}

function sentenceAround(text: string, position: number): string {
  // Walk back to the previous sentence boundary (or start of text). Boundary =
  // `. ! ? \n` followed by whitespace OR start. Keep it simple , don't try to
  // be clever about abbreviations.
  let start = 0
  for (let i = position - 1; i >= 0; i--) {
    const c = text[i]
    if (c === '\n') {
      start = i + 1
      break
    }
    if (c === '.' || c === '!' || c === '?') {
      const next = text[i + 1]
      if (next === undefined || /\s/.test(next)) {
        start = i + 1
        break
      }
    }
  }
  let end = text.length
  for (let i = position; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') {
      end = i
      break
    }
    if (c === '.' || c === '!' || c === '?') {
      const next = text[i + 1]
      if (next === undefined || /\s/.test(next)) {
        end = i + 1
        break
      }
    }
  }
  return text.slice(start, end)
}

function stripCitationsAndCollapse(s: string): string {
  return (
    s
      .replace(ANY_CITATION, '')
      // Collapse whitespace runs first so "foo  ." becomes "foo .".
      .replace(/\s+/g, ' ')
      // Strip the space that's now stranded before terminal punctuation.
      .replace(/ ([.,;:!?])/g, '$1')
      .trim()
  )
}
