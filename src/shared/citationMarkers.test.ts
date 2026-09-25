import { describe, it, expect } from 'vitest'
import {
  extractCitationMarkers,
  transformCitationMarkers,
  parseCiteHref,
  reconcileCitations,
  hasCitedSources,
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
    const out = extractCitationMarkers('[doc: 1,chunk: 1] [doc:1,   chunk:2]')
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
    const out = transformCitationMarkers('foo [doc:5, chunk:42] bar', new Set(['5-42']))
    expect(out.text).toBe('foo [1](#cite-5-42) bar')
    expect(out.markers).toEqual([{ documentId: 5, chunkId: 42, index: 1 }])
  })

  it('assigns indices in mention order, reuses for duplicates', () => {
    const out = transformCitationMarkers(
      'a [doc:1, chunk:1] b [doc:2, chunk:3] c [doc:1, chunk:1]',
      new Set(['1-1', '2-3']),
    )
    expect(out.text).toBe('a [1](#cite-1-1) b [2](#cite-2-3) c [1](#cite-1-1)')
    expect(out.markers).toEqual([
      { documentId: 1, chunkId: 1, index: 1 },
      { documentId: 2, chunkId: 3, index: 2 },
    ])
  })

  it('handles consecutive markers cleanly', () => {
    const out = transformCitationMarkers(
      '[doc:1, chunk:1][doc:2, chunk:2]',
      new Set(['1-1', '2-2']),
    )
    expect(out.text).toBe('[1](#cite-1-1)[2](#cite-2-2)')
  })

  it('keeps only allowed markers as chips, preserving unknown attempts visibly', () => {
    const allowed = new Set(['1-1'])
    const out = transformCitationMarkers('real [doc:1, chunk:1] fake [doc:9, chunk:9] end', allowed)
    expect(out.text).toBe('real [1](#cite-1-1) fake [doc:9, chunk:9] end')
    expect(out.markers).toEqual([{ documentId: 1, chunkId: 1, index: 1 }])
  })

  it('keeps markers literal when none are allowed', () => {
    const out = transformCitationMarkers('a [doc:1, chunk:1] b', new Set<string>())
    expect(out.text).toBe('a [doc:1, chunk:1] b')
    expect(out.markers).toEqual([])
  })

  it('does not trust markers without a supplied allow-set', () => {
    const out = transformCitationMarkers('a [doc:7, chunk:8] b')
    expect(out.text).toBe('a [doc:7, chunk:8] b')
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

  it('does not manufacture valid references when every marker is unknown', () => {
    const out = reconcileCitations('made up [doc:99, chunk:99]', fed, keyOf)
    expect(out).toEqual([])
  })

  it('keeps the first valid mention order and removes duplicates', () => {
    expect(
      reconcileCitations(
        '[doc:7, chunk:9] [doc:99, chunk:99] [doc:2, chunk:3] [doc:7, chunk:9]',
        fed,
        keyOf,
      ),
    ).toEqual([fed[2], fed[1]])
  })

  it('rejects unsafe or nonpositive IDs without falling back to supplied context', () => {
    for (const marker of ['[doc:0, chunk:1]', '[doc:9007199254740993, chunk:1]']) {
      expect(extractCitationMarkers(marker)).toEqual([])
      expect(reconcileCitations(marker, fed, keyOf)).toEqual([])
    }
  })

  it('distinguishes provided context from valid inline citations', () => {
    const keys = new Set(['1-1'])
    expect(hasCitedSources('Answer without markers', keys)).toBe(false)
    expect(hasCitedSources('Answer [doc:99, chunk:99]', keys)).toBe(false)
    expect(hasCitedSources('Answer [doc:1, chunk:1]', keys)).toBe(true)
    expect(hasCitedSources('Literal `[doc:1, chunk:1]`', keys)).toBe(false)
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
    expect(parseCiteHref('#cite-0-1')).toBeNull()
    expect(parseCiteHref('#cite-9007199254740993-1')).toBeNull()
  })
})

describe('citation markers in Markdown literals', () => {
  const marker = '[doc:1, chunk:1]'
  const allowed = new Set(['1-1', '2-2'])
  it.each([
    `\`${marker}\``,
    `\`\`literal \` ${marker}\`\``,
    `\`\`\`text\n${marker}\n\`\`\``,
    `~~~\n${marker}\n~~~`,
    `> \`\`\`\n> ${marker}\n> \`\`\``,
    `    ${marker}`,
    `\\${marker}`,
    `[${marker}](https://example.test)`,
    `![${marker}](image.png)`,
    `[link](path/${marker})`,
    `[${marker}][ref]\n\n[ref]: https://example.test`,
    `${marker}\n\n${marker}: https://example.test`,
    `<!-- ${marker} -->`,
    `<span title="${marker}">`,
    `https://example.test/${marker}`,
  ])('preserves literal bytes and does not classify them as citations: %s', (literal) => {
    expect(transformCitationMarkers(literal, allowed)).toEqual({ text: literal, markers: [] })
    expect(extractCitationMarkers(literal)).toEqual([])
  })

  it.each([
    '\\` escaped tick [doc:1, chunk:1] then `literal`',
    '[link](https://example.test/`path) Claim [doc:1, chunk:1] `code`',
    '[link](https://example.test "a ` title") Claim [doc:1, chunk:1] `code`',
    'x<y Claim [doc:1, chunk:1]',
    '`<!--` is a literal delimiter. Claim [doc:1, chunk:1]',
    '[label `]` [doc:1, chunk:1]](url) Claim [doc:2, chunk:2]',
  ])('keeps later prose citations outside literals visible: %s', (text) => {
    const expected = text.includes('Claim [doc:2')
      ? [{ documentId: 2, chunkId: 2 }]
      : [{ documentId: 1, chunkId: 1 }]
    expect(extractCitationMarkers(text)).toEqual(expected)
  })
})
