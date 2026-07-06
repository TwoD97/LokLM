/**
 * Citation marker handling — shared between the renderer chip pipeline and
 * the unit tests so we can verify edge cases.
 *
 * The model is instructed (system prompt in LlamaService) to cite as
 *   [doc:<document_id>, chunk:<chunk_id>]
 * but real outputs occasionally contain whitespace variation, repeated
 * markers, or markers in code-block fences. We accept what we can and let
 * everything else fall through as plain text.
 */

export interface CitationMarker {
  documentId: number
  chunkId: number
}

export interface CitationMatch extends CitationMarker {
  /** Inclusive offset of the opening `[` in the source text. */
  start: number
  /** Exclusive offset just past the closing `]`. */
  end: number
}

const CITATION_REGEX = /\[doc:(\d+),\s*chunk:(\d+)\]/g

/**
 * Returns every citation match with its character offsets. Order = document
 * order, **duplicates retained**.
 */
export function findCitationMatches(text: string): CitationMatch[] {
  const out: CitationMatch[] = []
  const re = new RegExp(CITATION_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const documentId = Number(match[1])
    const chunkId = Number(match[2])
    if (Number.isFinite(documentId) && Number.isFinite(chunkId)) {
      out.push({ documentId, chunkId, start: match.index, end: match.index + match[0].length })
    }
  }
  return out
}

/**
 * Returns every (documentId, chunkId) pair found in `text`, in document
 * order, **including duplicates**. Callers that want unique pairs dedupe
 * themselves; keeping duplicates lets the chip pipeline assign stable
 * index numbers in mention order.
 */
export function extractCitationMarkers(text: string): CitationMarker[] {
  return findCitationMatches(text).map(({ documentId, chunkId }) => ({ documentId, chunkId }))
}

/** Removes every `[doc:X, chunk:Y]` marker from `text` (single source of truth
 *  for the marker grammar — callers that need to strip markers go through this
 *  instead of re-declaring the regex). */
export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(CITATION_REGEX.source, 'g'), '')
}

/**
 * Reconcile the chunks fed to the model against the `[doc:X, chunk:Y]` markers
 * it actually emitted, returning the subset to persist as the answer's sources.
 *
 * When the answer cited chunks inline, only those validated citations are kept
 * — the chips the renderer derives from the markers then match the persisted
 * set exactly, and a hallucinated marker has nothing to validate against.
 *
 * When the answer cited NOTHING inline (small / terse / German outputs skip
 * markers often), the full fed list is returned instead, so the answer still
 * carries its sources. The renderer surfaces those as the fallback "Sources /
 * Quellen" footer (MessageBubble.fallbackSources) rather than leaving the
 * answer source-less. Without this fallback that footer can never fire: it
 * needs persisted citations, which a grounded-only reconcile empties in exactly
 * the no-marker case the footer was built for.
 *
 * `keyOf` maps a fed citation to its `documentId-chunkId` key so this stays
 * agnostic to the caller's citation shape (the IPC path uses snake_case).
 */
export function reconcileCitations<T>(
  answerText: string,
  fed: readonly T[],
  keyOf: (c: T) => string,
): T[] {
  const cited = new Set(
    extractCitationMarkers(answerText).map((m) => `${m.documentId}-${m.chunkId}`),
  )
  const grounded = fed.filter((c) => cited.has(keyOf(c)))
  return grounded.length > 0 ? grounded : [...fed]
}

/**
 * Replaces each `[doc:X, chunk:Y]` marker with a numbered short form
 * `[N](#cite-X-Y)` so a markdown renderer can convert it into a clickable
 * citation chip. Repeated markers reuse the first index they were assigned —
 * mention order, not appearance order.
 *
 * The href `#cite-<docId>-<chunkId>` is parsed back out by the CitationChip
 * component to wire the click handler.
 */
export function transformCitationMarkers(
  text: string,
  /** When provided, only markers whose `documentId-chunkId` key is in this set
   *  become chips; any other marker is stripped from the output (rendered as
   *  nothing rather than a broken, clickable chip). Pass the message's persisted
   *  citations — the chunks that were actually fed AND cited — so a model that
   *  hallucinates `[doc:999, chunk:999]` doesn't produce a chip that opens the
   *  wrong source. Omit to transform every well-formed marker (the default used
   *  while a turn is still streaming, before its citations are known). */
  allowed?: ReadonlySet<string>,
): {
  text: string
  markers: Array<CitationMarker & { index: number }>
} {
  const markers: Array<CitationMarker & { index: number }> = []
  const keyToIndex = new Map<string, number>()
  const transformed = text.replace(
    new RegExp(CITATION_REGEX.source, 'g'),
    (full, doc: string, chunk: string) => {
      const documentId = Number(doc)
      const chunkId = Number(chunk)
      if (!Number.isFinite(documentId) || !Number.isFinite(chunkId)) return full
      const key = `${documentId}-${chunkId}`
      if (allowed && !allowed.has(key)) return ''
      let idx = keyToIndex.get(key)
      if (idx === undefined) {
        idx = markers.length + 1
        keyToIndex.set(key, idx)
        markers.push({ documentId, chunkId, index: idx })
      }
      return `[${idx}](#cite-${documentId}-${chunkId})`
    },
  )
  return { text: transformed, markers }
}

/**
 * Parses a `#cite-X-Y` href back into a marker. Returns null for any other
 * href. Used by CitationChip to wire its click handler from the rendered
 * `<a href="...">` element.
 */
export function parseCiteHref(href: string | undefined): CitationMarker | null {
  if (!href) return null
  const m = href.match(/^#cite-(\d+)-(\d+)$/)
  if (!m) return null
  const documentId = Number(m[1])
  const chunkId = Number(m[2])
  if (!Number.isFinite(documentId) || !Number.isFinite(chunkId)) return null
  return { documentId, chunkId }
}
