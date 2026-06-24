// Debug a single query against the whole-repo corpus: print the top-N retrieved
// files + roles for a config, so we can see WHAT actually wins (e.g. AuthService
// vs the retrieval system's own heuristics.ts on a self-referential corpus).
//
//   tsx tests/evals/code/debugQuery.ts "wie funktioniert die auth klasse" [config]

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContext, runQuery } from './pipeline'
import { ABLATIONS } from './ablations'
import { fileRole } from '../../../src/main/services/codebase/fileRole'
import type { CodeCorpus } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '..', 'data')
const INSTR =
  process.env.LOKLM_EVAL_QUERY_INSTRUCTION ??
  'Instruct: Given a question about a codebase, retrieve the source code file that answers it.\nQuery: '

function l2(v: number[] | Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  const n = Math.sqrt(s) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n
  return out
}

async function main(): Promise<void> {
  const queries = (process.argv[2] ?? 'wie funktioniert die auth klasse')
    .split('||')
    .map((q) => q.trim())
  const configNames = (process.argv[3] ?? 'base_norr,all_fixes').split(',')
  const corpus = JSON.parse(
    readFileSync(join(DATA, 'code-corpus', 'loklm.json'), 'utf-8'),
  ) as CodeCorpus
  const label = 'Qwen3-Embedding-0.6B-Q8_0.gguf'
  const binPath = join(DATA, 'code-corpus', '.vec-cache', `${label}-${corpus.chunkCount}.bin`)
  const metaPath = join(DATA, 'code-corpus', '.vec-cache', `${label}-${corpus.chunkCount}.json`)
  if (!existsSync(binPath))
    throw new Error(`no vec cache for ${corpus.chunkCount} chunks — run run.ts first`)
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { n: number; dim: number }
  const buf = readFileSync(binPath)
  const flat = new Float32Array(buf.buffer, buf.byteOffset, meta.n * meta.dim)
  const vecs: Float32Array[] = []
  for (let i = 0; i < meta.n; i++) vecs.push(flat.slice(i * meta.dim, (i + 1) * meta.dim))

  const { EmbedderBridge } = await import('../bridges/EmbedderBridge')
  const { RerankerBridge } = await import('../bridges/RerankerBridge')
  const embedder = new EmbedderBridge({
    placement: 'auto',
    modelPath: join(process.cwd(), 'models', label),
    label,
  })
  const reranker = new RerankerBridge({ placement: 'auto' })
  const ctx = buildContext(corpus.chunks, vecs, reranker, { candidateK: 40, finalK: 10 })

  for (const query of queries) {
    const qVec = l2(await embedder.embed(INSTR + query))
    console.error(`\n════ QUERY: "${query}"  (corpus ${corpus.chunkCount} chunks) ════`)
    for (const name of configNames) {
      const abl = ABLATIONS.find((a) => a.name === name)
      if (!abl) {
        console.error(`(unknown config ${name})`)
        continue
      }
      const ids = await runQuery(query, qVec, abl, ctx)
      console.error(`── ${name} — top ${ids.length}:`)
      ids.forEach((id, r) => {
        const c = corpus.chunks[id]!
        const role = fileRole(c.file)
        console.error(
          `  ${String(r + 1).padStart(2)}. [${role.padEnd(8)}] ${c.file}  L${c.pageFrom ?? '?'}`,
        )
      })
    }
  }
  await (embedder as { unload?: () => Promise<void> }).unload?.()
  await (reranker as { unload?: () => Promise<void> }).unload?.()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
