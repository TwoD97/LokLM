// inspect-dataset , menschliche stichprobe + verteilungs-stats für ein
// assembliertes eval-dataset. Druckt N zufällige (frage , gold-chunk-text)-
// paare , damit man die answerability per auge prüfen kann , plus die
// frage/chunk-verteilung pro thema und intent.
//
// CLI:
//   tsx tests/evals/synth/inspect-dataset.ts <dataset.json> [--sample 12] [--seed 7]

import { readFile } from 'node:fs/promises'

interface Dataset {
  generator: string
  chunker: string
  source?: Record<string, unknown>
  stats?: Record<string, unknown>
  chunks: Array<{ id: string; docId: string; text: string }>
  questions: Array<{
    chunkId: string
    question: string
    intent?: string
    requiredChunkIds?: string[]
    meta?: Record<string, string>
  }>
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) throw new Error('usage: inspect-dataset <dataset.json> [--sample N] [--seed N]')
  let sample = 12
  let seed = 7
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--sample') sample = Number(process.argv[++i])
    else if (process.argv[i] === '--seed') seed = Number(process.argv[++i])
  }

  const ds = JSON.parse(await readFile(path, 'utf-8')) as Dataset
  const byId = new Map(ds.chunks.map((c) => [c.id, c]))

  // verteilungen.
  const byIntent: Record<string, number> = {}
  const byTheme: Record<string, number> = {}
  let danglingRefs = 0
  let metaRefMissing = 0
  for (const q of ds.questions) {
    byIntent[q.intent ?? 'focused'] = (byIntent[q.intent ?? 'focused'] ?? 0) + 1
    const theme = q.meta?.['theme'] ?? '?'
    byTheme[theme] = (byTheme[theme] ?? 0) + 1
    for (const id of q.requiredChunkIds ?? [q.chunkId]) if (!byId.has(id)) danglingRefs++
    if (!byId.has(q.chunkId)) metaRefMissing++
  }

  console.log(`# ${path}`)
  console.log(`generator: ${ds.generator} , chunker: ${ds.chunker}`)
  if (ds.source) console.log(`source: ${JSON.stringify(ds.source)}`)
  console.log(`questions: ${ds.questions.length} , chunks: ${ds.chunks.length}`)
  console.log(`intent: ${JSON.stringify(byIntent)}`)
  console.log(`per-theme: ${JSON.stringify(byTheme)}`)
  console.log(`integrity: danglingRequiredRefs=${danglingRefs} , missingChunkId=${metaRefMissing}`)
  console.log(``)

  // stichprobe.
  const rng = makeRng(seed)
  const idxs = ds.questions.map((_, i) => i)
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[idxs[i], idxs[j]] = [idxs[j]!, idxs[i]!]
  }
  const picked = idxs.slice(0, Math.min(sample, idxs.length))
  console.log(`## sample (${picked.length})\n`)
  for (const i of picked) {
    const q = ds.questions[i]!
    const chunk = byId.get(q.chunkId)
    console.log(`Q [${q.intent ?? 'focused'} | ${q.meta?.['theme'] ?? '?'}]: ${q.question}`)
    console.log(`  chunkId: ${q.chunkId}`)
    console.log(`  chunk:   ${chunk ? JSON.stringify(chunk.text.slice(0, 360)) : '<<MISSING>>'}`)
    console.log(``)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
