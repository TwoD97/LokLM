// Deterministic corpus builder for the code-retrieval eval.
//
//   tsx tests/evals/code/buildCorpus.ts [--roots src,docs,README.md]
//                                       [--out <path>] [--max-doc-chunks N]
//
// Walks the given roots, applies the SAME ignore + track rules the production
// indexer uses (src/main/services/codebase/ignore.ts), chunks code with the
// REAL codeChunker (so heading_path == [relPath, symbol] exactly as production),
// and chunks prose docs with a small section splitter (distractors only — exact
// doc-chunk fidelity matters less than reproducing a realistically MIXED corpus
// where prose can bury code). Output is a single CodeCorpus JSON.
//
// No model load, no electron — pure file walk + pure chunkers, runs under tsx.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chunkCode } from '../../../src/main/services/codebase/codeChunker'
import { fileTrack, isPathIgnored } from '../../../src/main/services/codebase/ignore'
import type { CodeChunk, CodeCorpus } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

interface Args {
  roots: string[]
  out: string
  maxDocChunks: number
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--roots' && next) {
      out.roots = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      i++
    } else if (a === '--out' && next) {
      out.out = next
      i++
    } else if (a === '--max-doc-chunks' && next) {
      out.maxDocChunks = Number(next)
      i++
    }
  }
  return {
    roots: out.roots ?? ['src'],
    out: out.out ?? join(__dirname, '..', 'data', 'code-corpus', 'loklm.json'),
    maxDocChunks: out.maxDocChunks ?? Infinity,
  }
}

/** Recursively list files under an absolute path, honouring the production
 *  ignore deny-list on the repo-relative path. */
function walk(absRoot: string): string[] {
  const found: string[] = []
  const stack = [absRoot]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      const abs = join(cur, name)
      const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/')
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        // isPathIgnored checks any path segment against IGNORED_DIRS; append a
        // trailing filename so the dir itself is segment-checked.
        if (isPathIgnored(rel + '/_')) continue
        stack.push(abs)
      } else if (st.isFile()) {
        found.push(rel)
      }
    }
  }
  return found.sort()
}

/** Minimal markdown section splitter -> {headingPath, text} pieces. Splits on
 *  ATX heading lines, tracks a shallow heading stack, and caps body length so a
 *  single mega-section can't dominate. Distractor-grade, not production-faithful. */
function splitMarkdownSections(
  source: string,
  relPath: string,
  maxChars = 2000,
): Array<{ headingPath: string[]; text: string }> {
  const lines = source.split('\n')
  const out: Array<{ headingPath: string[]; text: string }> = []
  const stack: Array<{ level: number; title: string }> = []
  let body: string[] = []
  const flush = (): void => {
    const text = body.join('\n').trim()
    body = []
    if (text.length === 0) return
    const headingPath = [relPath, ...stack.map((s) => s.title)]
    for (let i = 0; i < text.length; i += maxChars) {
      out.push({ headingPath, text: text.slice(i, i + maxChars) })
    }
  }
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      flush()
      const level = m[1]!.length
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, title: m[2]!.trim() })
    } else {
      body.push(line)
    }
  }
  flush()
  return out
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const chunks: CodeChunk[] = []
  let fileCount = 0
  let codeChunkCount = 0
  let docChunkCount = 0
  let docChunkBudget = args.maxDocChunks

  for (const root of args.roots) {
    const abs = resolve(REPO_ROOT, root)
    let st
    try {
      st = statSync(abs)
    } catch {
      console.error(`skip missing root: ${root}`)
      continue
    }
    const files = st.isDirectory() ? walk(abs) : [relative(REPO_ROOT, abs).replace(/\\/g, '/')]
    for (const rel of files) {
      const track = fileTrack(rel)
      if (track === 'skip') continue
      let source: string
      try {
        source = readFileSync(join(REPO_ROOT, rel), 'utf-8')
      } catch {
        continue
      }
      if (source.trim().length === 0) continue
      fileCount++

      if (track === 'code') {
        for (const c of chunkCode(source, { relPath: rel })) {
          const symbol =
            c.headingPath && c.headingPath.length > 1
              ? c.headingPath[c.headingPath.length - 1]!
              : null
          chunks.push({
            id: `${rel}#${c.ordinal}`,
            file: rel,
            track: 'code',
            ordinal: c.ordinal,
            text: c.text,
            headingPath: c.headingPath,
            symbol,
            pageFrom: c.pageFrom,
            pageTo: c.pageTo,
          })
          codeChunkCount++
        }
      } else {
        // doc track
        const sections = splitMarkdownSections(source, rel)
        for (let i = 0; i < sections.length; i++) {
          if (docChunkBudget <= 0) break
          const s = sections[i]!
          chunks.push({
            id: `${rel}#${i}`,
            file: rel,
            track: 'doc',
            ordinal: i,
            text: s.text,
            headingPath: s.headingPath,
            symbol: null,
            pageFrom: null,
            pageTo: null,
          })
          docChunkCount++
          docChunkBudget--
        }
      }
    }
  }

  const corpus: CodeCorpus = {
    generatedAt: new Date().toISOString(),
    roots: args.roots,
    fileCount,
    chunkCount: chunks.length,
    codeChunkCount,
    docChunkCount,
    chunks,
  }
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, JSON.stringify(corpus, null, 2), 'utf-8')
  console.error(
    `corpus: ${fileCount} files -> ${chunks.length} chunks ` +
      `(${codeChunkCount} code, ${docChunkCount} doc)\nwrote ${args.out}`,
  )
}

main()
