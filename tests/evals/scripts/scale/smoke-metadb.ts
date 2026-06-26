// Smoke: drive the REAL app meta.db (WorkspaceDb, SQLCipher + FTS5) + the REAL
// production chunker under Electron-as-Node, on the existing wikipedia-survival
// corpus. Proves the headless meta.db unblock end-to-end and prints the first
// MEASURED meta.db/FTS footprint ratio (vector-independent, no embedder needed).
//
// Run:
//   ELECTRON_RUN_AS_NODE=1 node_modules/.pnpm/electron@42.4.0/node_modules/electron/dist/electron.exe \
//     --import ./node_modules/tsx/dist/esm/index.mjs \
//     tests/evals/scripts/scale/smoke-metadb.ts

import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat, readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { WorkspaceDb } from '../../../../src/main/db/sqlite/WorkspaceDb'
import { chunkPages } from '../../../../src/main/services/documents/chunker'

const __dirname = dirname(fileURLToPath(import.meta.url))

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

async function main(): Promise<void> {
  console.error(
    `versions: node ${process.versions.node} | modules ${process.versions.modules} | electron ${process.versions.electron ?? '(plain node)'}`,
  )

  const corpusDir = join(__dirname, '..', '..', 'data', 'corpora', 'wikipedia-survival')
  const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.txt'))
  let rawBytes = 0
  let chunkCount = 0
  let tokenCharTotal = 0

  const base = await mkdtemp(join(tmpdir(), 'loklm-metadb-smoke-'))
  const wdek = randomBytes(32)
  const db = await WorkspaceDb.open(join(base, 'meta.db'), wdek.toString('hex'), 1)

  const t0 = performance.now()
  for (const f of files) {
    const text = await readFile(join(corpusDir, f), 'utf-8')
    rawBytes += Buffer.byteLength(text, 'utf-8')
    const doc = await db.addDocument({
      title: f.replace(/\.txt$/, ''),
      sourcePath: f,
      status: 'ready',
    })
    // production chunker: one synthetic "page" per file, maxChars 2000 / overlap 200
    const chunks = chunkPages([{ num: 1, text }])
    await db.persistChunks(
      doc.id,
      chunks.map((c) => ({
        ordinal: c.ordinal,
        text: c.text,
        pageFrom: c.pageFrom,
        pageTo: c.pageTo,
        tokenCount: Math.ceil(c.text.length / 4),
        headingPath: c.headingPath,
        language: null,
      })),
    )
    await db.setDocumentStatus(doc.id, 'ready')
    chunkCount += chunks.length
    tokenCharTotal += chunks.reduce((n, c) => n + c.text.length, 0)
  }
  const ingestMs = performance.now() - t0

  // FTS sanity: a real BM25 query through the production searchChunks path.
  const hits = await db.searchChunks('charcoal forge OR cholera water', 5)
  db.close()

  const metaBytes = await stat(join(base, 'meta.db'))
    .then((s) => s.size)
    .catch(() => 0)

  console.error('')
  console.error(`docs:           ${files.length}`)
  console.error(`raw text:       ${fmtBytes(rawBytes)}`)
  console.error(
    `chunks:         ${chunkCount}  (avg ${(tokenCharTotal / chunkCount).toFixed(0)} chars)`,
  )
  console.error(
    `ingest:         ${(ingestMs / 1000).toFixed(2)} s  (${(chunkCount / (ingestMs / 1000)).toFixed(0)} chunks/s)`,
  )
  console.error(`meta.db:        ${fmtBytes(metaBytes)}  (chunks + FTS5 + SQLCipher)`)
  console.error(
    `meta.db / text: ${(metaBytes / rawBytes).toFixed(2)}x  (the multiplier on raw text)`,
  )
  console.error(`bytes / chunk:  ${(metaBytes / chunkCount).toFixed(0)} B`)
  console.error('')
  console.error(`100 GB-text extrapolation: meta.db ~= ${fmtBytes(100e9 * (metaBytes / rawBytes))}`)
  console.error(
    `BM25 top hit: ${hits[0]?.document_title ?? '(none)'} — "${(hits[0]?.text ?? '').slice(0, 70)}…"`,
  )

  await rm(base, { recursive: true, force: true }).catch(() => undefined)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
