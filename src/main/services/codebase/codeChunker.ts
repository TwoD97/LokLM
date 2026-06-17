import type { Chunk } from '../documents/chunker'

// Structural code chunker (ADR-0006). Splits a source file into chunks that
// respect code structure — it breaks at top-level declaration boundaries
// (functions, classes, …) and blank lines rather than mid-statement, packs each
// chunk to a character budget, and records the source LINE range (carried in
// pageFrom/pageTo so the SourceViewer shows "L120–L168" the same way it shows PDF
// pages). A lightweight enclosing-symbol breadcrumb goes in headingPath.
//
// This is a dependency-free heuristic, not a full AST parse: it ships now with no
// native/WASM risk and is fully deterministic + unit-tested. A tree-sitter
// backend can later replace `chunkCode` while keeping this exact Chunk output
// (ADR-0006 §tree-sitter packaging).

export interface CodeChunkOptions {
  /** Character budget per chunk (defaults to the doc chunk size). */
  maxChars?: number
  /** Relative path of the file — becomes the first headingPath segment so the
   *  citation breadcrumb and library filename match stay meaningful. */
  relPath?: string
}

const DEFAULT_MAX_CHARS = 2000

// Loose, multi-language "this line starts a top-level declaration" detector. We
// only need it to find reasonable break points + a symbol name for the
// breadcrumb, so false positives/negatives just shift a boundary by a line.
const DECL_PATTERNS: RegExp[] = [
  // JS/TS: export? default? async? function/class/interface/type/enum/const fn
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|enum|type|namespace|module)\s+([A-Za-z0-9_$]+)/,
  // Python / Ruby
  /^(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)/,
  // Go
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/,
  // Rust / Swift / Kotlin / Scala / C-family
  /^(?:pub\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|open\s+)*(?:fn|func|struct|impl|trait|enum|class|interface|object|protocol|extension|def|val|var)\s+([A-Za-z0-9_:<>]+)/,
]

/** Leading-whitespace width (tabs count as 1) — our "indentation depth" proxy. */
function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ' || ch === '\t') n++
    else break
  }
  return n
}

/** Returns the declared symbol name when `line` looks like a top-level
 *  declaration (shallow indentation), else null. */
function topLevelSymbol(line: string): string | null {
  if (indentOf(line) > 2) return null
  const trimmed = line.trimStart()
  for (const re of DECL_PATTERNS) {
    const m = re.exec(trimmed)
    if (m && m[1]) return m[1]
  }
  return null
}

/** Hard-splits an over-long single line into ≤maxChars pieces (minified-ish or
 *  generated lines), so the budget invariant always holds. */
function hardSplit(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const out: string[] = []
  for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars))
  return out
}

/**
 * Chunks source code into structure-aware, budget-bounded `Chunk`s. Output line
 * ranges are 1-based and inclusive (pageFrom/pageTo). Empty / whitespace-only
 * files yield no chunks.
 */
export function chunkCode(source: string, opts: CodeChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS
  const head = opts.relPath ? [opts.relPath] : []
  // Pre-split any pathological long lines so a single line can't blow the budget.
  const rawLines = source.split('\n')
  const lines: string[] = []
  for (const l of rawLines) for (const piece of hardSplit(l, maxChars)) lines.push(piece)

  const chunks: Chunk[] = []
  let ordinal = 0
  let cur: string[] = []
  let curStart = 0 // 0-based index of the first line in `cur`
  let curChars = 0
  let scope: string | null = null

  const flush = (endIdx: number): void => {
    if (cur.length === 0) return
    const text = cur.join('\n').trim()
    if (text.length > 0) {
      chunks.push({
        text,
        ordinal: ordinal++,
        pageFrom: curStart + 1,
        pageTo: endIdx + 1,
        headingPath: scope ? [...head, scope] : head.length > 0 ? [...head] : null,
        language: null,
      })
    }
    cur = []
    curChars = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const sym = topLevelSymbol(line)
    // Break BEFORE a new top-level declaration once the current chunk holds a
    // meaningful amount, so each top-level construct tends to start a fresh
    // chunk. Also break when adding this line would exceed the budget.
    const wouldOverflow = cur.length > 0 && curChars + line.length + 1 > maxChars
    const declBoundary = cur.length > 0 && sym != null && curChars > maxChars * 0.35
    if (wouldOverflow || declBoundary) {
      flush(i - 1)
      curStart = i
    }
    if (cur.length === 0) curStart = i
    if (sym != null) scope = sym
    cur.push(line)
    curChars += line.length + 1
  }
  flush(lines.length - 1)
  return chunks
}
