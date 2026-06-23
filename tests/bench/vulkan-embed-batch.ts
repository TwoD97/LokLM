/**
 * Decisive embedder-on-Vulkan test. jina-code native-crashes on this AMD iGPU
 * embedding full ~2040-token inputs (proven), even with a small batchSize and
 * even clamped to 1024. Run the IDENTICAL payload against another model:
 *
 *   npx tsx tests/bench/vulkan-embed-batch.ts qwen3        # Qwen3-Embedding-0.6B
 *   npx tsx tests/bench/vulkan-embed-batch.ts jina 512     # jina, ubatch 512
 *   npx tsx tests/bench/vulkan-embed-batch.ts bge
 *   SURVIVED → that model can embed full-length code on the iGPU GPU (the win)
 *   crash    → same fragility as jina; keep this embedder on CPU
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const which = (process.argv[2] ?? 'qwen3').toLowerCase()
const batchSize = Number(process.argv[3] ?? '0') // 0 → node-llama default
const MODELS = join(process.cwd(), 'models')
const MODEL =
  which === 'jina'
    ? join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf')
    : which === 'bge'
      ? join(MODELS, 'bge-m3-Q4_K_M.gguf')
      : join(MODELS, 'Qwen3-Embedding-0.6B-Q8_0.gguf')
const LOG = join(process.cwd(), 'tests', 'bench', `embed-batch-${which}.log`)
writeFileSync(LOG, '')
function log(m: string): void {
  try {
    appendFileSync(LOG, m + '\n')
  } catch {
    /* ignore */
  }
  // eslint-disable-next-line no-console
  console.log(m)
}

function bigCode(seed: number): string {
  const block = [
    `export async function handler${seed}(req: Request<{ id: string }>, res: Response): Promise<void> {`,
    `  const rows = await db.query('SELECT id,label,score,owner FROM widgets WHERE owner=? AND deleted=0', [req.userId])`,
    `  const seen = new Set<string>(); const out: WidgetDTO[] = []; let total = 0`,
    `  for (const row of rows) { if (seen.has(row.key)) continue; seen.add(row.key); total += row.score ?? 0`,
    `    out.push({ id: row.id, label: String(row.label).trim(), score: row.score ?? 0, owner: row.owner }) }`,
    `  res.json({ widgets: out, count: out.length, total, ts: Date.now(), seed: ${seed} }) }`,
  ].join('\n')
  let s = ''
  while (s.length < 6000) s += block + '\n'
  return s.slice(0, 6000)
}

async function main(): Promise<void> {
  log(
    `getLlama({ gpu: vulkan }) ${which} (${MODEL.split(/[\\/]/).pop()}) batchSize=${batchSize || 'default'}…`,
  )
  const llama: any = await getLlama({ gpu: 'vulkan' })
  const model: any = await llama.loadModel({ modelPath: MODEL })
  const ctxSize = 2048
  const opts: any = { contextSize: ctxSize }
  if (batchSize > 0) opts.batchSize = batchSize
  const ctx: any = await model.createEmbeddingContext(opts)
  const maxTokens = Math.max(8, ctxSize - 8)
  log(`ready; embedding 100 FULL ~${maxTokens}-token code passages (jina dies here)…`)

  for (let n = 0; n < 100; n++) {
    let t = bigCode(n)
    const ids: number[] = model.tokenize(t)
    if (ids.length > maxTokens) t = model.detokenize(ids.slice(0, maxTokens))
    await ctx.getEmbeddingFor(t)
    if (n % 20 === 0) log(`  embedded ${n}/100`)
  }
  log(`SURVIVED — ${which} embedded 100 full-length passages on Vulkan, no crash`)
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
