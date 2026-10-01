import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chunkMarkdown, chunkPages } from '@main/services/documents/chunker'
import { parseMarkdownSections } from '@main/services/documents/markdownParser'

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/rag/tourism-table.md', import.meta.url)),
  'utf8',
)

describe('source structure in document chunks', () => {
  it('keeps German table rows with their original years, units and column headers', () => {
    // The checked-in table keeps padded Markdown cells. Its complete header
    // plus one row must fit, while the whole table must still be fragmented.
    const lines = fixture.split(/\r?\n/)
    const header = lines.find((line) => line.startsWith('| Region'))!
    const delimiter = lines.find((line) => line.startsWith('| :---'))!
    const chunks = chunkMarkdown(parseMarkdownSections(fixture), { maxChars: 260, overlap: 24 })
    const tableChunks = chunks.filter((chunk) => chunk.text.includes('| :---'))
    expect(tableChunks.length).toBeGreaterThan(1)
    for (const chunk of tableChunks) {
      expect(chunk.text).toContain(header)
      expect(chunk.text).toContain(delimiter)
      expect(chunk.headingPath).toEqual(['Tourismusbericht 2026', 'Regionen'])
      expect(chunk.text).not.toContain('Beispieldaten')
      expect(chunk.text).not.toContain('Die Tabelle')
    }
    for (const row of lines.filter((line) => /^\| (Nord|Süd|Ost|West|Stadt|Küste)/.test(line))) {
      expect(tableChunks.filter((chunk) => chunk.text.includes(row))).toHaveLength(1)
    }
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(260)
    expect(chunks.at(-1)?.headingPath).toEqual(['Tourismusbericht 2026', 'Hinweise'])
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
  })

  it('keeps a short table intact between long paragraphs', () => {
    const table = 'Year | Value\n--- | ---:\n2025 | 17\n2026 | 19'
    const chunks = chunkMarkdown(
      [
        {
          headingPath: ['Results'],
          text: 'Before. '.repeat(30) + '\n\n' + table + '\n\n' + 'After. '.repeat(30),
        },
      ],
      { maxChars: 90, overlap: 15 },
    )
    const tables = chunks.filter((chunk) => chunk.text.includes('2025 | 17'))
    expect(tables).toHaveLength(1)
    expect(tables[0]?.text).toBe(table)
  })

  it('does not treat table examples in fenced code as live tables', () => {
    const table =
      '| Name | Count |\n| --- | ---: |\n' +
      Array.from({ length: 12 }, (_, i) => `| Region ${i} | ${i} |`).join('\n')
    for (const fence of ['```markdown', '~~~~markdown']) {
      const close = fence.startsWith('`') ? '```' : '~~~~'
      const chunks = chunkMarkdown([{ headingPath: [], text: `${fence}\n${table}\n${close}` }], {
        maxChars: 90,
        overlap: 0,
      })
      expect(chunks.filter((chunk) => chunk.text.includes('| Name | Count |'))).toHaveLength(1)
    }
  })

  it('does not close a four-backtick fence at an inner three-backtick fence', () => {
    const text =
      '````text\n```\n| Name | Count |\n| --- | ---: |\n' +
      Array.from({ length: 12 }, (_, i) => `| Region ${i} | ${i} |`).join('\n') +
      '\n````'
    const chunks = chunkMarkdown([{ headingPath: [], text }], { maxChars: 90, overlap: 0 })
    expect(chunks.filter((chunk) => chunk.text.includes('| Name | Count |'))).toHaveLength(1)
  })

  it('does not invent tables from pipe-containing prose or mismatched delimiters', () => {
    const text = '| left | right |\n| --- |\n' + '| prose | text |\n'.repeat(15)
    const chunks = chunkMarkdown([{ headingPath: [], text }], { maxChars: 90, overlap: 0 })
    expect(chunks.filter((chunk) => chunk.text.includes('| left | right |'))).toHaveLength(1)
  })

  it('falls back to bounded text for a row that cannot fit without losing cells', () => {
    const text = '| Key | Value |\n| --- | --- |\n| large | ' + 'x'.repeat(260) + ' |'
    const chunks = chunkMarkdown([{ headingPath: [], text }], { maxChars: 80, overlap: 0 })
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(80)
    expect(
      chunks
        .map((chunk) => chunk.text)
        .join('')
        .match(/x/g),
    ).toHaveLength(260)
    expect(chunks.map((chunk) => chunk.text).join('')).toContain('large')
  })

  it('counts the Markdown heading in the first fragment size limit', () => {
    const chunks = chunkMarkdown(
      [{ headingPath: ['Parent', 'A detailed section'], text: 'a'.repeat(240) }],
      { maxChars: 80, overlap: 0 },
    )
    expect(chunks[0]?.text).toMatch(/^# A detailed section\n\n/)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(80)
      expect(chunk.headingPath).toEqual(['Parent', 'A detailed section'])
    }
    expect(
      chunks.map((chunk) => chunk.text.replace(/^# A detailed section\n\n/, '')).join(''),
    ).toBe('a'.repeat(240))
  })

  it('retains an oversized heading as metadata without dropping its body', () => {
    const heading = 'Long heading '.repeat(20)
    const chunks = chunkMarkdown([{ headingPath: [heading], text: 'source '.repeat(30) }], {
      maxChars: 60,
      overlap: 0,
    })
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(60)
      expect(chunk.headingPath).toEqual([heading])
    }
    expect(
      chunks
        .map((chunk) => chunk.text)
        .join(' ')
        .match(/source/g),
    ).toHaveLength(30)
  })

  it('does not produce tiny body fragments when a heading nearly fills the budget', () => {
    const heading = 'H'.repeat(75)
    const chunks = chunkMarkdown([{ headingPath: [heading], text: 'a'.repeat(240) }], {
      maxChars: 80,
      overlap: 0,
    })
    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.headingPath?.[0] === heading)).toBe(true)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('a'.repeat(240))
  })

  it('includes the overlap separator in the PDF/plain-text size budget', () => {
    const chunks = chunkPages([{ num: 7, text: 'aaaaaaaaaa\nbbbbbbb' }], {
      maxChars: 10,
      overlap: 3,
    })
    expect(chunks.map((chunk) => chunk.text)).toEqual(['aaaaaaaaaa', 'bbbbbbb'])
    expect(chunks.every((chunk) => chunk.pageFrom === 7 && chunk.pageTo === 7)).toBe(true)
  })
})
