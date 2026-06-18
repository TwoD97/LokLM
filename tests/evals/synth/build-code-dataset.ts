// build-code-dataset — CODE-RETRIEVAL eval dataset builder.
//   Scans src/**/*.ts + src/**/*.tsx for documented functions/methods/consts,
//   treats the JSDoc prose as the query and the function body as the corpus
//   document, and writes a LapDataset (same format as the LAP/Wikipedia sets)
//   to tests/evals/data/datasets/code-dataset.json.
//
//   Usage:
//     pnpm exec tsx tests/evals/synth/build-code-dataset.ts

import * as ts from 'typescript'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLapDataset } from './build-lap-dataset.js'
import { FixedSizeChunker } from '../pipeline/Chunker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKTREE_ROOT = join(__dirname, '..', '..', '..')

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SRC_ROOT = join(WORKTREE_ROOT, 'src')
const CORPUS_DIR = join(WORKTREE_ROOT, 'tests', 'evals', 'data', 'code-corpus')
const QUESTIONS_PATH = join(CORPUS_DIR, 'questions.jsonl')
const DATASET_OUT = join(WORKTREE_ROOT, 'tests', 'evals', 'data', 'datasets', 'code-dataset.json')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CAP = 450
const MIN_DOC_CHARS = 40
const MIN_BODY_CHARS = 60
const CHUNKER = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })

// ---------------------------------------------------------------------------
// Collect source files
// ---------------------------------------------------------------------------
async function collectSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true })
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile()) {
        const name = e.name
        // Only .ts / .tsx
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
        // Exclude test / spec / declaration files
        if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
        if (name.endsWith('.spec.ts') || name.endsWith('.spec.tsx')) continue
        if (name.endsWith('.d.ts')) continue
        out.push(full)
      }
    }
  }
  await walk(dir)
  out.sort()
  return out
}

// ---------------------------------------------------------------------------
// JSDoc extraction
// ---------------------------------------------------------------------------
function extractJsDocText(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  // ts.getJSDocCommentsAndTags returns comment ranges. Instead we use the
  // jsDoc property attached by the parser (available on many node kinds).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jsDocNodes: ts.JSDoc[] = (node as any).jsDoc as ts.JSDoc[] | undefined ?? []
  if (jsDocNodes.length === 0) return null

  // Take the last JSDoc block (closest to the node).
  const doc = jsDocNodes[jsDocNodes.length - 1]
  if (!doc) return null

  // Build prose: collect comment text + non-param/returns/throws tags.
  let prose = ''

  // Top-level comment text
  if (typeof doc.comment === 'string') {
    prose += doc.comment
  } else if (Array.isArray(doc.comment)) {
    for (const part of doc.comment as ts.NodeArray<ts.JSDocComment>) {
      if (typeof (part as ts.JSDocText).text === 'string') {
        prose += (part as ts.JSDocText).text
      }
    }
  }

  // Tags: keep descriptive tags, skip @param / @returns / @throws / @type
  const skipTags = new Set(['param', 'returns', 'return', 'throws', 'throw', 'type', 'template'])
  for (const tag of doc.tags ?? []) {
    const tagName = tag.tagName.text.toLowerCase()
    if (skipTags.has(tagName)) continue
    const tagComment =
      typeof tag.comment === 'string'
        ? tag.comment
        : Array.isArray(tag.comment)
          ? (tag.comment as ts.NodeArray<ts.JSDocComment>)
              .map((p) => (typeof (p as ts.JSDocText).text === 'string' ? (p as ts.JSDocText).text : ''))
              .join('')
          : ''
    if (tagComment) prose += (prose ? ' ' : '') + tagComment
  }

  // Normalise whitespace
  const cleaned = prose.replace(/\s+/g, ' ').trim()
  return cleaned.length >= MIN_DOC_CHARS ? cleaned : null
}

// ---------------------------------------------------------------------------
// Symbol name extraction
// ---------------------------------------------------------------------------
function symbolName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (node as any).name as ts.Identifier | undefined
    return name?.text ?? '(anon)'
  }
  if (ts.isVariableStatement(node)) {
    // Arrow function in a const declaration: take the first declarator name
    const decl = node.declarationList.declarations[0]
    if (decl) {
      if (ts.isIdentifier(decl.name)) return decl.name.text
    }
    return '(anon)'
  }
  if (ts.isClassDeclaration(node)) {
    return node.name?.text ?? '(anon)'
  }
  return '(anon)'
}

// ---------------------------------------------------------------------------
// Pair collection
// ---------------------------------------------------------------------------
interface CodePair {
  relPath: string // src-relative, forward slashes
  symbol: string
  docText: string // cleaned JSDoc prose
  bodyText: string // full node source text (signature + body, no JSDoc)
  filePos: number // byte position in file for deterministic ordering
}

function isArrowFunctionDeclaration(node: ts.VariableStatement): boolean {
  const decl = node.declarationList.declarations[0]
  if (!decl) return false
  const init = decl.initializer
  return (
    init !== undefined &&
    (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
  )
}

function collectPairsFromFile(filePath: string, sourceText: string): CodePair[] {
  const relPath = relative(SRC_ROOT, filePath).replace(/\\/g, '/')
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ESNext, true)
  const pairs: CodePair[] = []

  function visit(node: ts.Node): void {
    let doc: string | null = null
    let isCandidate = false

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      isCandidate = true
    } else if (ts.isVariableStatement(node) && isArrowFunctionDeclaration(node)) {
      isCandidate = true
    } else if (ts.isClassDeclaration(node)) {
      isCandidate = true
    }

    if (isCandidate) {
      doc = extractJsDocText(node, sourceFile)
      if (doc !== null) {
        // Get the full source text of the node (includes JSDoc comment in the raw text)
        const fullText = node.getText(sourceFile)
        // Strip the leading JSDoc comment from the body text.
        // JSDoc always appears as /* ... */ at the start of the node's full text.
        const bodyText = stripLeadingJsDoc(fullText).trim()
        if (bodyText.length >= MIN_BODY_CHARS) {
          pairs.push({
            relPath,
            symbol: symbolName(node),
            docText: doc,
            bodyText,
            filePos: node.getStart(sourceFile),
          })
        }
      }
    }

    // Continue walking into children (to pick up methods inside classes, etc.)
    // But don't walk into function bodies — their nested functions are internal.
    if (ts.isClassDeclaration(node)) {
      // Walk class members
      ts.forEachChild(node, visit)
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      // Don't descend into function bodies
    } else {
      ts.forEachChild(node, visit)
    }
  }

  ts.forEachChild(sourceFile, visit)
  return pairs
}

function stripLeadingJsDoc(text: string): string {
  // A leading JSDoc looks like: optional whitespace, then /** ... */
  // We strip the first such block if present.
  const match = text.match(/^(\s*\/\*\*[\s\S]*?\*\/\s*)/)
  if (match) return text.slice(match[0].length)
  return text
}

// ---------------------------------------------------------------------------
// Dedup by cleaned docstring
// ---------------------------------------------------------------------------
function deduplicatePairs(pairs: CodePair[]): { kept: CodePair[]; droppedDup: number } {
  const seen = new Set<string>()
  const kept: CodePair[] = []
  let droppedDup = 0
  for (const p of pairs) {
    if (seen.has(p.docText)) {
      droppedDup++
      continue
    }
    seen.add(p.docText)
    kept.push(p)
  }
  return { kept, droppedDup }
}

// ---------------------------------------------------------------------------
// Deterministic ID generation
// ---------------------------------------------------------------------------
function makeId(pair: CodePair, index: number): string {
  // e.g. code__main-services-auth-AuthService__embedderModelStem__0
  const pathPart = pair.relPath
    .replace(/\.(ts|tsx)$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
  const symbolPart = pair.symbol.replace(/[^a-zA-Z0-9_]/g, '_')
  return `code__${pathPart}__${symbolPart}__${index}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.error('[build-code-dataset] Scanning src/ for documented functions…')

  const sourceFiles = await collectSourceFiles(SRC_ROOT)
  console.error(`[build-code-dataset] Found ${sourceFiles.length} source files`)

  // Collect all pairs
  let allPairs: CodePair[] = []
  let droppedTrivial = 0

  for (const filePath of sourceFiles) {
    const text = await readFile(filePath, 'utf-8')
    const pairs = collectPairsFromFile(filePath, text)
    // droppedTrivial already excluded inside collectPairsFromFile (MIN_DOC_CHARS / MIN_BODY_CHARS)
    allPairs.push(...pairs)
  }

  const totalFound = allPairs.length
  console.error(`[build-code-dataset] Raw pairs found (with doc): ${totalFound}`)

  // Dedup
  const { kept: deduped, droppedDup } = deduplicatePairs(allPairs)
  console.error(`[build-code-dataset] After dedup: ${deduped.length} (dropped ${droppedDup} duplicates)`)

  // Cap at 450
  let droppedCap = 0
  let finalPairs = deduped
  if (deduped.length > CAP) {
    droppedCap = deduped.length - CAP
    finalPairs = deduped.slice(0, CAP)
    console.error(`[build-code-dataset] Capped at ${CAP}, dropped ${droppedCap} by position`)
  }

  console.error(`[build-code-dataset] Final pairs: ${finalPairs.length}`)

  // Prepare output dirs
  await mkdir(CORPUS_DIR, { recursive: true })
  await mkdir(dirname(DATASET_OUT), { recursive: true })

  // Write corpus files + collect question rows
  const questionLines: string[] = []
  const sampleItems: Array<{ query: string; docId: string }> = []

  for (let i = 0; i < finalPairs.length; i++) {
    const pair = finalPairs[i]!
    const id = makeId(pair, i)

    // Write body text to corpus
    const corpusFile = join(CORPUS_DIR, `${id}.txt`)
    await writeFile(corpusFile, pair.bodyText, 'utf-8')

    // Compute chunk ids using the same FixedSizeChunker
    const chunks = CHUNKER.chunk({ id, text: pair.bodyText })
    const chunkIds = chunks.map((c) => c.id)
    const firstChunkId = chunkIds[0]
    if (!firstChunkId) {
      console.error(`[build-code-dataset] WARN: no chunks for ${id}, skipping`)
      continue
    }

    const questionRow = {
      chunkId: firstChunkId,
      question: pair.docText,
      requiredChunkIds: chunkIds,
      lang: 'en',
    }
    questionLines.push(JSON.stringify(questionRow))

    if (sampleItems.length < 3) {
      sampleItems.push({ query: pair.docText, docId: id })
    }
  }

  // Write questions.jsonl
  await writeFile(QUESTIONS_PATH, questionLines.join('\n') + '\n', 'utf-8')
  console.error(`[build-code-dataset] Wrote ${questionLines.length} questions to ${QUESTIONS_PATH}`)

  // Build dataset using buildLapDataset
  console.error('[build-code-dataset] Building LapDataset…')
  const dataset = await buildLapDataset({
    corpusDir: CORPUS_DIR,
    questionsPath: QUESTIONS_PATH,
    generator: 'code-retrieval-builder',
  })

  await writeFile(DATASET_OUT, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`[build-code-dataset] Written: ${DATASET_OUT}`)

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------
  const chunkById = new Map(dataset.chunks.map((c) => [c.id, c]))
  let allResolved = true
  let zeroGoldSpans = 0
  for (const q of dataset.questions) {
    if (!chunkById.has(q.chunkId)) {
      console.error(`[build-code-dataset] ERROR: chunkId not found: ${q.chunkId}`)
      allResolved = false
    }
    if (!q.goldSpans || q.goldSpans.length === 0) {
      zeroGoldSpans++
    }
  }

  console.error('')
  console.error('=== STATS ===')
  console.error(`Functions found (with JSDoc):  ${totalFound}`)
  console.error(`Dropped (trivial doc/body):    ${droppedTrivial}`)
  console.error(`Dropped (duplicate docstring): ${droppedDup}`)
  console.error(`Dropped (cap at ${CAP}):        ${droppedCap}`)
  console.error(`Pairs kept:                    ${finalPairs.length}`)
  console.error(`Chunks in dataset:             ${dataset.chunks.length}`)
  console.error(`Questions in dataset:          ${dataset.questions.length}`)
  console.error(`GoldSpans 100% resolve:        ${allResolved && zeroGoldSpans === 0}`)
  if (zeroGoldSpans > 0) {
    console.error(`  WARN: ${zeroGoldSpans} questions have no goldSpans`)
  }
  console.error('')
  console.error('=== 3 SAMPLES ===')
  for (const sample of sampleItems) {
    const querySnippet = sample.query.slice(0, 80) + (sample.query.length > 80 ? '…' : '')
    console.error(`  query: "${querySnippet}"`)
    console.error(`  doc:    ${sample.docId}`)
    console.error('')
  }

  if (!allResolved) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
