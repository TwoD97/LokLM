import { describe, it, expect } from 'vitest'
import { extractCitationSnippets } from './citationContext'

describe('extractCitationSnippets', () => {
  it('returns the sentence containing the cited marker', () => {
    const text =
      'Vorab gilt: die Frist beträgt 14 Tage [doc:5, chunk:12]. Andere Regeln gelten nur in Ausnahmefällen.'
    const snippets = extractCitationSnippets(text, { documentId: 5, chunkId: 12 })
    expect(snippets).toEqual(['Vorab gilt: die Frist beträgt 14 Tage.'])
  })

  it('returns both surrounding sentences when the same chunk is cited twice', () => {
    const text =
      'Foo claim one [doc:1, chunk:2]. Bar claim two with the same source [doc:1, chunk:2].'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 2 })
    expect(snippets).toEqual(['Foo claim one.', 'Bar claim two with the same source.'])
  })

  it('dedupes identical sentences', () => {
    const text = 'Same wording [doc:1, chunk:2]. Other thing. Same wording [doc:1, chunk:2].'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 2 })
    expect(snippets).toEqual(['Same wording.'])
  })

  it('ignores other citations in the same sentence', () => {
    const text = 'A claim [doc:1, chunk:2] backed by another source [doc:9, chunk:3].'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 2 })
    expect(snippets).toEqual(['A claim backed by another source.'])
  })

  it('handles a marker on its own line by treating the line as the sentence', () => {
    const text = 'Heading\nThis is the supporting line [doc:1, chunk:2]\nNext line'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 2 })
    expect(snippets).toEqual(['This is the supporting line'])
  })

  it('tolerates the no-space comma variant', () => {
    const text = 'Tight form [doc:1,chunk:2].'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 2 })
    expect(snippets).toEqual(['Tight form.'])
  })

  it('returns [] when the citation does not appear', () => {
    const text = 'Nothing cites [doc:99, chunk:1] here.'
    expect(extractCitationSnippets(text, { documentId: 1, chunkId: 2 })).toEqual([])
  })

  it('falls back to the previous sentence when the marker sits in a citation dump', () => {
    // Models sometimes emit "claim. [m1], [m2], [m3]." — the sentence around
    // the inner marker is just commas after stripping. The snippet should be
    // the preceding claim sentence so the SourceViewer still has something
    // meaningful to fuzzy-match against the chunk text.
    const text = 'Die Frist beträgt 14 Tage. [doc:1, chunk:2], [doc:1, chunk:3], [doc:1, chunk:4].'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 3 })
    expect(snippets).toEqual(['Die Frist beträgt 14 Tage.'])
  })

  it('falls back across paragraph breaks for citation-only lines', () => {
    const text = 'Beleg für die Frist von 14 Tagen.\n[doc:1, chunk:2], [doc:1, chunk:3]'
    const snippets = extractCitationSnippets(text, { documentId: 1, chunkId: 3 })
    expect(snippets).toEqual(['Beleg für die Frist von 14 Tagen.'])
  })
})
