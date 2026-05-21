/**
 * Pulls the sentence(s) of an assistant message that cite a specific
 * (documentId, chunkId) pair. Used by the SourceViewer to know which slice of
 * the answer to fuzzy-match against the chunk text for highlighting.
 *
 * Why per-citation and not the whole message: the same chunk often supports
 * just one claim in a longer answer , matching the full message produces
 * noisy false-positive highlights. Per-citation sentences are tight.
 */

import { findCitationMatches, stripCitationMarkers } from './citationMarkers'

const HAS_WORD_CONTENT = /[\p{L}\p{N}]/u
const MAX_LOOKBACK_SENTENCES = 4

/**
 * For each occurrence of `(documentId, chunkId)` in `messageText`, returns the
 * surrounding sentence (citation markers stripped, whitespace collapsed).
 * Duplicates after normalisation collapse to one. Empty array when the marker
 * doesn't appear.
 *
 * When the sentence containing the marker is just a citation dump (e.g.
 * `claim. [m1], [m2], [m3].` — clicking m2 lands inside the comma list, which
 * has no word content of its own), we walk back to the previous sentence so
 * the snippet still carries the assistant's actual claim.
 */
export function extractCitationSnippets(
  messageText: string,
  target: { documentId: number; chunkId: number },
): string[] {
  const hits = findCitationMatches(messageText).filter(
    (m) => m.documentId === target.documentId && m.chunkId === target.chunkId,
  )
  if (hits.length === 0) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const snippet = findContentfulSentence(messageText, hit.start)
    if (snippet.length > 0 && !seen.has(snippet)) {
      seen.add(snippet)
      out.push(snippet)
    }
  }
  return out
}

function findContentfulSentence(text: string, position: number): string {
  let bounds = sentenceBounds(text, position)
  for (let step = 0; step < MAX_LOOKBACK_SENTENCES; step++) {
    const slice = text.slice(bounds.start, bounds.end)
    const normalised = stripCitationsAndCollapse(slice)
    if (HAS_WORD_CONTENT.test(normalised)) return normalised
    if (bounds.start === 0) return normalised
    // Step back into the previous sentence by anchoring just before the
    // current sentence's start.
    bounds = sentenceBounds(text, bounds.start - 1)
  }
  // Gave up — return whatever the original sentence stripped to, even if it's
  // pure punctuation. Caller dedupes empty/duplicate results.
  return stripCitationsAndCollapse(text.slice(bounds.start, bounds.end))
}

function sentenceBounds(text: string, position: number): { start: number; end: number } {
  // Boundary = `. ! ? \n` followed by whitespace OR start/end. Keep it simple,
  // don't try to be clever about abbreviations.
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
  return { start, end }
}

function stripCitationsAndCollapse(s: string): string {
  return (
    stripCitationMarkers(s)
      // Collapse whitespace runs first so "foo  ." becomes "foo .".
      .replace(/\s+/g, ' ')
      // Strip the space that's now stranded before terminal punctuation.
      .replace(/ ([.,;:!?])/g, '$1')
      .trim()
  )
}
