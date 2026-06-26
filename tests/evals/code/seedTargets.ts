// Deterministic target seeding for the code-retrieval eval dataset.
//
//   tsx tests/evals/code/seedTargets.ts [--corpus <path>] [--per-subsystem 4]
//
// Picks GROUNDED (file, symbol) pairs straight out of the corpus so dataset
// targets can never be hallucinated. Preference order, highest signal first:
//   1. files whose stem IS a defined symbol (AuthService.ts -> class AuthService)
//      — these are exactly the "the X class" needs the eval is about.
// Spread across subsystems (top dirs under src/main/services + src/renderer) so
// the dataset isn't auth-heavy. Emits seeds the dataset workflow turns into
// 5-phrasing CodeQueryItems. Pure JSON in/out, no models.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CodeCorpus } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Seed {
  file: string
  symbol: string
  subsystem: string
  /** how many chunks this file has in the corpus (bigger = more to retrieve) */
  chunks: number
}

function subsystemOf(file: string): string {
  // src/main/services/<sub>/... -> <sub> ; else the 2nd path segment.
  const m = /^src\/main\/services\/([^/]+)\//.exec(file)
  if (m) return m[1]!
  const parts = file.split('/')
  return parts.slice(0, 2).join('/')
}

function stemOf(file: string): string {
  const base = file.split('/').pop() ?? file
  return base.replace(/\.[^.]+$/, '')
}

function parseArgs(argv: string[]): { corpus: string; perSubsystem: number; out: string } {
  let corpus = join(__dirname, '..', 'data', 'code-corpus', 'loklm.json')
  let perSubsystem = 4
  let out = join(__dirname, '..', 'data', 'code-queries', 'seeds.json')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--corpus' && argv[i + 1]) corpus = argv[++i]!
    else if (argv[i] === '--per-subsystem' && argv[i + 1]) perSubsystem = Number(argv[++i])
    else if (argv[i] === '--out' && argv[i + 1]) out = argv[++i]!
  }
  return { corpus, perSubsystem, out }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(readFileSync(args.corpus, 'utf-8')) as CodeCorpus

  // symbols + chunk counts per file
  const byFile = new Map<string, { symbols: Set<string>; chunks: number }>()
  for (const c of corpus.chunks) {
    if (c.track !== 'code') continue
    const e = byFile.get(c.file) ?? { symbols: new Set<string>(), chunks: 0 }
    e.chunks++
    if (c.symbol) e.symbols.add(c.symbol)
    byFile.set(c.file, e)
  }

  // Seed = file whose stem matches one of its defined symbols (case-insensitive).
  const seeds: Seed[] = []
  for (const [file, e] of byFile) {
    const stem = stemOf(file).toLowerCase()
    const match = [...e.symbols].find((s) => s.toLowerCase() === stem)
    if (!match) continue
    seeds.push({ file, symbol: match, subsystem: subsystemOf(file), chunks: e.chunks })
  }

  // Spread across subsystems: bucket, sort each bucket by chunk count desc
  // (meatier files make better retrieval targets), take perSubsystem from each.
  const buckets = new Map<string, Seed[]>()
  for (const s of seeds) {
    const arr = buckets.get(s.subsystem) ?? []
    arr.push(s)
    buckets.set(s.subsystem, arr)
  }
  const picked: Seed[] = []
  for (const [, arr] of [...buckets].sort((a, b) => a[0].localeCompare(b[0]))) {
    arr.sort((a, b) => b.chunks - a.chunks)
    picked.push(...arr.slice(0, args.perSubsystem))
  }

  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(
    args.out,
    JSON.stringify({ generatedAt: new Date().toISOString(), seeds: picked }, null, 2),
  )
  const subs = [...buckets.keys()].sort()
  console.error(`seeds: ${picked.length} across ${subs.length} subsystems`)
  console.error(`subsystems: ${subs.join(', ')}`)
  console.error(
    picked.map((s) => `  ${s.symbol.padEnd(28)} ${s.file} (${s.chunks} chunks)`).join('\n'),
  )
}

main()
