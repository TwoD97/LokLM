import { describe, it, expect } from 'vitest'
import { chunkCode } from '@main/services/codebase/codeChunker'

const TS = `import { foo } from './foo'

export function alpha(x: number): number {
  return x + 1
}

export class Beta {
  private n = 0
  inc(): void {
    this.n += 1
  }
}

export const gamma = () => 42
`

describe('chunkCode', () => {
  it('produces chunks with 1-based inclusive line ranges and a path breadcrumb', () => {
    const chunks = chunkCode(TS, { relPath: 'src/sample.ts', maxChars: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    // line ranges are 1-based, ordered, non-overlapping, contiguous-ish
    expect(chunks[0]!.pageFrom).toBe(1)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.pageFrom!).toBeGreaterThan(chunks[i - 1]!.pageTo!)
    }
    // every chunk carries the file path as the first breadcrumb segment
    for (const c of chunks) {
      expect(c.headingPath?.[0]).toBe('src/sample.ts')
      expect(c.ordinal).toBeGreaterThanOrEqual(0)
    }
  })

  it('captures enclosing symbol names in the breadcrumb', () => {
    const chunks = chunkCode(TS, { relPath: 'src/sample.ts', maxChars: 60 })
    const symbols = chunks.flatMap((c) => (c.headingPath ? c.headingPath.slice(1) : []))
    expect(symbols).toContain('alpha')
    expect(symbols).toContain('Beta')
  })

  it('respects the char budget (allowing single-line overflow only)', () => {
    const chunks = chunkCode(TS, { relPath: 'a.ts', maxChars: 100 })
    for (const c of chunks) {
      // a chunk may exceed the budget only when it is a single (already-split) line
      const lines = c.text.split('\n')
      if (lines.length > 1) expect(c.text.length).toBeLessThanOrEqual(100)
    }
  })

  it('hard-splits a pathologically long single line', () => {
    const long = 'x'.repeat(500)
    const chunks = chunkCode(long, { maxChars: 100 })
    expect(chunks.length).toBeGreaterThanOrEqual(5)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100)
  })

  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkCode('')).toEqual([])
    expect(chunkCode('   \n\n  \n')).toEqual([])
  })

  it('chunks Python def/class boundaries', () => {
    const py = `def a():\n    return 1\n\n\ndef b():\n    return 2\n\n\nclass C:\n    pass\n`
    const chunks = chunkCode(py, { relPath: 'm.py', maxChars: 30 })
    const symbols = chunks.flatMap((c) => c.headingPath?.slice(1) ?? [])
    expect(symbols).toEqual(expect.arrayContaining(['a', 'b', 'C']))
  })

  it('omits the breadcrumb when no relPath and no symbol is given', () => {
    const chunks = chunkCode('const x = 1\nconst y = 2\n')
    expect(chunks[0]!.headingPath).toBeNull()
  })
})
