// prep-gen-batches , bereitet die fragen-generierung vor: liest den
// wikipedia-korpus (chunks.json) , filtert "gute" chunks (lang genug , prosa) ,
// sampelt deterministisch ein ziel-set pro thema und schreibt kleine
// batch-dateien auf disk , die die generierungs-agents selbst lesen.
//
// Warum batch-dateien auf disk statt chunk-text durch workflow-args:
//   die generierungs-agents (general-purpose) lesen ihre batch-datei per Read
//   selbst → workflow-args bleiben winzig (nur pfade) , kein 300-KB-blob durch
//   den tool-call , beliebig skalierbar über themen.
//
// Output je thema:
//   <out>/<theme>/batch-00.json … { theme , batchId , chunks: [{id,text}] }
//   <out>/index.json … { theme: [absolute batch-pfade] }  (winzig , für args)
//
// CLI:
//   tsx tests/evals/synth/prep-gen-batches.ts
//     [--themes a,b]         default: alle in chunks.json
//     [--per-theme N]        ziel-anzahl gesampelter chunks/thema (default 160)
//     [--batch-size N]       chunks pro batch-datei (default 15)
//     [--corpus <chunks.json>]
//     [--out <dir>]          default data/staging/wiki-gen
//     [--min-chars N]        gute-chunk-schwelle (default 380)

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ChunksFile {
  byTheme: Record<string, string[]>
  chunks: SourceChunk[]
}

interface Args {
  themes: string[] | null
  perTheme: number
  batchSize: number
  corpus: string
  out: string
  minChars: number
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    themes: null,
    perTheme: 160,
    batchSize: 15,
    corpus: join(__dirname, '..', 'data', 'corpora', 'wikipedia-survival', 'chunks.json'),
    out: join(__dirname, '..', 'data', 'staging', 'wiki-gen'),
    minChars: 380,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--themes' && next !== undefined) {
      out.themes = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      i++
    } else if (a === '--per-theme' && next !== undefined) {
      out.perTheme = Number(next)
      i++
    } else if (a === '--batch-size' && next !== undefined) {
      out.batchSize = Number(next)
      i++
    } else if (a === '--corpus' && next !== undefined) {
      out.corpus = next
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    } else if (a === '--min-chars' && next !== undefined) {
      out.minChars = Number(next)
      i++
    }
  }
  return out
}

/** docId aus chunk-id "docId::ordinal". */
function docIdOf(chunkId: string): string {
  const ix = chunkId.lastIndexOf('::')
  return ix >= 0 ? chunkId.slice(0, ix) : chunkId
}

/** prosa-heuristik: lang genug , genug satzzeichen , nicht überwiegend
 *  zahlen/listen. Hält header-fragmente und referenz-reste raus. */
function isGoodChunk(text: string, minChars: number): boolean {
  if (text.length < minChars) return false
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length
  if (letters / text.length < 0.55) return false
  const words = text.split(/\s+/).filter((w) => w.length >= 4)
  if (words.length < 25) return false
  return true
}

/** deterministischer stride über eine liste — spreizt das sample über die
 *  ganze artikel-folge statt nur die ersten chunks zu nehmen. */
function strideSample<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr.slice()
  const out: T[] = []
  const step = arr.length / n
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]!)
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(await readFile(args.corpus, 'utf-8')) as ChunksFile
  const byId = new Map(corpus.chunks.map((c) => [c.id, c]))
  const themes = args.themes ?? Object.keys(corpus.byTheme)

  await mkdir(args.out, { recursive: true })
  interface BatchItem {
    theme: string
    batchId: string
    batchPath: string
    genPath: string
    verifiedPath: string
  }
  const index: Record<string, BatchItem[]> = {}
  let grandTotal = 0

  for (const theme of themes) {
    const docIds = corpus.byTheme[theme]
    if (!docIds) {
      console.error(`[warn] thema "${theme}" nicht im korpus , skip`)
      continue
    }
    // alle chunks dieses themas in dokument-/ordinal-reihenfolge.
    const themeChunks = corpus.chunks
      .filter((c) => docIds.includes(docIdOf(c.id)))
      .filter((c) => isGoodChunk(c.text, args.minChars))
    const sampled = strideSample(themeChunks, args.perTheme)

    const themeDir = join(args.out, theme)
    await rm(themeDir, { recursive: true, force: true })
    await mkdir(join(themeDir, 'gen'), { recursive: true })
    await mkdir(join(themeDir, 'verified'), { recursive: true })

    const items: BatchItem[] = []
    for (let b = 0; b * args.batchSize < sampled.length; b++) {
      const slice = sampled.slice(b * args.batchSize, (b + 1) * args.batchSize)
      const nn = String(b).padStart(2, '0')
      const batchId = `${theme}-${nn}`
      const batchPath = resolve(join(themeDir, `batch-${nn}.json`))
      await writeFile(
        batchPath,
        JSON.stringify(
          { theme, batchId, chunks: slice.map((c) => ({ id: c.id, text: byId.get(c.id)!.text })) },
          null,
          2,
        ),
        'utf-8',
      )
      items.push({
        theme,
        batchId,
        batchPath,
        genPath: resolve(join(themeDir, 'gen', `${batchId}.jsonl`)),
        verifiedPath: resolve(join(themeDir, 'verified', `${batchId}.jsonl`)),
      })
    }
    index[theme] = items
    grandTotal += sampled.length
    console.error(
      `[${theme}] gute chunks: ${themeChunks.length} , gesampelt: ${sampled.length} , batches: ${items.length}`,
    )
  }

  const indexPath = join(args.out, 'index.json')
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  console.error(`\n[done] gesampelte chunks gesamt: ${grandTotal}`)
  console.error(`[done] index: ${indexPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
