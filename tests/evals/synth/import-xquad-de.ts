// import-xquad-de , converts the public XQuAD German split (google-deepmind ,
// CC BY-SA 4.0 , 1190 question-answer pairs over 240 Wikipedia passages
// translated from English SQuAD) into our eval dataset format.
//
// Why XQuAD-de instead of GermanQuAD:
//   GermanQuAD's S3 download returns 403 since deepset moved the bucket ,
//   and the HF mirror only ships a loader script (no inline data). XQuAD-de
//   is one-file JSON on GitHub raw , standard SQuAD format , trivially
//   accessible. Smaller (1190 vs 2204 q) but covers the same purpose:
//   external Wikipedia-DE QA benchmark for cross-check against LokLM's
//   internal-docs eval.
//
// Pipeline:
//   1. fetch https://raw.githubusercontent.com/google-deepmind/xquad/master/xquad.de.json
//   2. parse SQuAD-shape: data[].paragraphs[].qas[]
//   3. flatten passages → chunks , qas → questions , subsample if --limit
//   4. write tests/evals/data/datasets/xquad-de-<N>q-<stamp>.json
//
// SQuAD-shape:
//   { data: [ { paragraphs: [ { context, qas: [ { id, question, answers: [{text}] } ] } ] } ] }
//
// Our shape mirrors handcrafted-adaptive-topk and focused-260q artifacts.
//
// CLI:
//   tsx tests/evals/synth/import-xquad-de.ts
//     [--limit <n>]      default 300 , subsample
//     [--seed <n>]       default 42 , deterministic subsample
//     [--output <path>]

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOURCE_URL = 'https://raw.githubusercontent.com/google-deepmind/xquad/master/xquad.de.json'
const STAGING_DIR = join(tmpdir(), 'loklm-xquad')

interface SquadAnswer {
  text: string
  answer_start?: number
}
interface SquadQA {
  id: string
  question: string
  answers: SquadAnswer[]
}
interface SquadParagraph {
  context: string
  qas: SquadQA[]
}
interface SquadData {
  data: Array<{ title?: string; paragraphs: SquadParagraph[] }>
}

interface Args {
  limit?: number
  seed: number
  output?: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 42 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--seed' && next !== undefined) {
      out.seed = Number(next)
      i++
    } else if (a === '--output' && next !== undefined) {
      out.output = next
      i++
    }
  }
  if (out.limit === undefined) out.limit = 300
  return out
}

async function ensureDownloaded(): Promise<string> {
  await mkdir(STAGING_DIR, { recursive: true })
  const jsonPath = join(STAGING_DIR, 'xquad.de.json')
  if (existsSync(jsonPath)) {
    const stat = await (await import('node:fs/promises')).stat(jsonPath)
    if (stat.size > 100_000) {
      console.error(`[xquad-de] cached: ${jsonPath}`)
      return jsonPath
    }
  }
  console.error(`[xquad-de] downloading ${SOURCE_URL} …`)
  const res = await fetch(SOURCE_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  await writeFile(jsonPath, text, 'utf-8')
  console.error(`[xquad-de] saved ${jsonPath} (${(text.length / 1024).toFixed(1)} KB)`)
  return jsonPath
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

interface ConvertedDataset {
  generator: string
  generatedAt: string
  chunker: string
  source: { url: string; license: string; cite: string }
  subsample: { limit: number; seed: number; totalAvailable: number }
  chunks: Array<{ id: string; docId: string; text: string }>
  questions: Array<{
    chunkId: string
    question: string
    intent: 'focused'
    requiredChunkIds: string[]
  }>
}

function convert(squad: SquadData, args: Args): ConvertedDataset {
  const chunks: ConvertedDataset['chunks'] = []
  const allQuestions: ConvertedDataset['questions'] = []
  let idx = 0
  for (const article of squad.data) {
    for (const p of article.paragraphs) {
      const chunkId = `xquad-de::${idx}`
      chunks.push({ id: chunkId, docId: 'xquad-de', text: p.context })
      for (const qa of p.qas) {
        if (!qa.answers || qa.answers.length === 0) continue
        allQuestions.push({
          chunkId,
          question: qa.question,
          intent: 'focused',
          requiredChunkIds: [chunkId],
        })
      }
      idx++
    }
  }

  const totalAvailable = allQuestions.length
  const rng = makeRng(args.seed)
  shuffleInPlace(allQuestions, rng)
  const subsampled =
    args.limit !== undefined && args.limit < allQuestions.length
      ? allQuestions.slice(0, args.limit)
      : allQuestions

  const referencedIds = new Set(subsampled.map((q) => q.chunkId))
  console.error(
    `[xquad-de] subsample: ${subsampled.length}/${totalAvailable} questions ; ` +
      `${referencedIds.size}/${chunks.length} chunks referenced (rest = distractors , bleibt im korpus)`,
  )

  return {
    generator: 'xquad-de-subset',
    generatedAt: new Date().toISOString(),
    chunker: 'xquad-passage',
    source: {
      url: SOURCE_URL,
      license: 'CC BY-SA 4.0',
      cite: 'Artetxe et al. 2020 , arXiv:1910.11856 , XQuAD: Cross-lingual QA',
    },
    subsample: {
      limit: args.limit ?? totalAvailable,
      seed: args.seed,
      totalAvailable,
    },
    chunks,
    questions: subsampled,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[xquad-de] limit=${args.limit} seed=${args.seed}`)

  const jsonPath = await ensureDownloaded()
  const squad = JSON.parse(await readFile(jsonPath, 'utf-8')) as SquadData
  const paragraphs = squad.data.reduce((s, a) => s + a.paragraphs.length, 0)
  console.error(`[xquad-de] parsed: ${squad.data.length} articles , ${paragraphs} paragraphs`)

  const converted = convert(squad, args)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath =
    args.output ??
    join(
      __dirname,
      '..',
      'data',
      'datasets',
      `xquad-de-${converted.questions.length}q-${stamp}.json`,
    )
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(converted, null, 2), 'utf-8')
  console.error(`[xquad-de] written: ${outPath}`)
  console.error(
    `[xquad-de]   chunks: ${converted.chunks.length} , questions: ${converted.questions.length}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
