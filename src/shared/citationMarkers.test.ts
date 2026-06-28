import { describe, it, expect } from 'vitest'
import {
  extractCitationMarkers,
  transformCitationMarkers,
  parseCiteHref,
  reconcileCitations,
} from './citationMarkers'

describe('extractCitationMarkers', () => {
  it('returns empty for text without markers', () => {
    expect(extractCitationMarkers('plain prose without citations')).toEqual([])
  })

  it('extracts a single marker', () => {
    const out = extractCitationMarkers('answer [doc:5, chunk:42] there')
    expect(out).toEqual([{ documentId: 5, chunkId: 42 }])
  })

  it('extracts multiple markers in document order', () => {
    const out = extractCitationMarkers('a [doc:1, chunk:1] b [doc:2, chunk:3] c')
    expect(out).toEqual([
      { documentId: 1, chunkId: 1 },
      { documentId: 2, chunkId: 3 },
    ])
  })

  it('keeps duplicates so chip indices reflect mention order', () => {
    const out = extractCitationMarkers('a [doc:1, chunk:1] b [doc:1, chunk:1]')
    expect(out).toHaveLength(2)
  })

  it('tolerates whitespace variation', () => {
    const out = extractCitationMarkers('[doc:1,chunk:1] [doc:1,   chunk:2]')
    expect(out).toEqual([
      { documentId: 1, chunkId: 1 },
      { documentId: 1, chunkId: 2 },
    ])
  })

  it('ignores malformed markers', () => {
    expect(extractCitationMarkers('[doc:abc, chunk:xyz]')).toEqual([])
    expect(extractCitationMarkers('[doc:1]')).toEqual([])
  })
})

describe('transformCitationMarkers', () => {
  it('passes through text without markers', () => {
    const out = transformCitationMarkers('plain text')
    expect(out.text).toBe('plain text')
    expect(out.markers).toEqual([])
  })

  it('replaces marker with [N](#cite-X-Y) form, 1-indexed', () => {
    const out = transformCitationMarkers('foo [doc:5, chunk:42] bar')
    expect(out.text).toBe('foo [1](#cite-5-42) bar')
    expect(out.markers).toEqual([{ documentId: 5, chunkId: 42, index: 1 }])
  })

  it('assigns indices in mention order, reuses for duplicates', () => {
    const out = transformCitationMarkers('a [doc:1, chunk:1] b [doc:2, chunk:3] c [doc:1, chunk:1]')
    expect(out.text).toBe('a [1](#cite-1-1) b [2](#cite-2-3) c [1](#cite-1-1)')
    expect(out.markers).toEqual([
      { documentId: 1, chunkId: 1, index: 1 },
      { documentId: 2, chunkId: 3, index: 2 },
    ])
  })

  it('handles consecutive markers cleanly', () => {
    const out = transformCitationMarkers('[doc:1, chunk:1][doc:2, chunk:2]')
    expect(out.text).toBe('[1](#cite-1-1)[2](#cite-2-2)')
  })

  it('keeps only allowed markers as chips, strips the rest', () => {
    const allowed = new Set(['1-1'])
    const out = transformCitationMarkers('real [doc:1, chunk:1] fake [doc:9, chunk:9] end', allowed)
    expect(out.text).toBe('real [1](#cite-1-1) fake  end')
    expect(out.markers).toEqual([{ documentId: 1, chunkId: 1, index: 1 }])
  })

  it('strips every marker when none are allowed', () => {
    const out = transformCitationMarkers('a [doc:1, chunk:1] b', new Set<string>())
    expect(out.text).toBe('a  b')
    expect(out.markers).toEqual([])
  })

  it('transforms all markers when no allow-set is given (streaming default)', () => {
    const out = transformCitationMarkers('a [doc:7, chunk:8] b')
    expect(out.text).toBe('a [1](#cite-7-8) b')
  })
})

describe('reconcileCitations', () => {
  const fed = [
    { doc_id: 1, chunk_id: 1, score: 0.5 },
    { doc_id: 2, chunk_id: 3, score: 0.4 },
    { doc_id: 7, chunk_id: 9, score: 0.3 },
  ]
  const keyOf = (c: { doc_id: number; chunk_id: number }): string => `${c.doc_id}-${c.chunk_id}`

  it('keeps only the fed chunks the answer cited inline', () => {
    const out = reconcileCitations('argon2id [doc:2, chunk:3] is the KDF', fed, keyOf)
    expect(out).toEqual([{ doc_id: 2, chunk_id: 3, score: 0.4 }])
  })

  it('falls back to the full fed set when the answer cited nothing inline', () => {
    // The no-marker case the fallback Sources footer depends on — otherwise the
    // answer would persist zero citations and render source-less.
    const out = reconcileCitations('Die auth Klasse verwaltet den Tresor.', fed, keyOf)
    expect(out).toEqual(fed)
  })

  it('falls back when every emitted marker is hallucinated (not in the fed set)', () => {
    const out = reconcileCitations('made up [doc:99, chunk:99]', fed, keyOf)
    expect(out).toEqual(fed)
  })

  it('returns empty when nothing was fed (refusal / no-context turn)', () => {
    expect(reconcileCitations('anything', [], keyOf)).toEqual([])
  })
})

describe('parseCiteHref', () => {
  it('parses valid #cite-X-Y href', () => {
    expect(parseCiteHref('#cite-5-42')).toEqual({ documentId: 5, chunkId: 42 })
  })

  it('returns null for non-cite hrefs', () => {
    expect(parseCiteHref('https://example.com')).toBeNull()
    expect(parseCiteHref('#other-anchor')).toBeNull()
    expect(parseCiteHref(undefined)).toBeNull()
  })
})
