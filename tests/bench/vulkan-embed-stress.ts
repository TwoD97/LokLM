/**
 * Hypothesis: the 0xC0000409 / DeviceLostError is the DECODER-style embedder
 * (jina-code = Qwen2 causal) on AMD Vulkan — a known llama.cpp bug (#20098,
 * jina-specific, closed-stale). ENCODER embedders (bge-m3 = XLM-RoBERTa) should
 * be stable. Earlier probes used TINY inputs and never reproduced it; the real
 * backfill embeds LONG passages (up to the context window), sustained — #20515
 * says the AMD crash is sensitive to ubatch-size + sequence length.
 *
 * This hammers ONE embedder on Vulkan with long, realistic passages, sequential
 * (like the worker's getEmbeddingFor loop). Run per model:
 *   npx tsx tests/bench/vulkan-embed-stress.ts jina
 *   npx tsx tests/bench/vulkan-embed-stress.ts bge
 *   jina crashes + bge survives  → swap to bge-m3, run it on GPU (the real fix)
 *   both survive                 → plain-Node can't repro; fault is Electron-only
 *   both crash                   → no embedder is safe on this iGPU Vulkan
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const which = (process.argv[2] ?? 'jina').toLowerCase()
const MODELS = join(process.cwd(), 'models')
const MODEL =
  which === 'bge'
    ? join(MODELS, 'bge-m3-Q4_K_M.gguf')
    : join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf')
const LOG = join(process.cwd(), 'tests', 'bench', `embed-stress-${which}.log`)
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

// Build a passage of roughly `tokens` length out of code-like text (jina-code's
// domain). ~1.4 tokens/word is a rough GGUF-tokenizer ratio, so words≈tokens/1.4.
function passage(tokens: number, seed: number): string {
  const lines = [
    `export async function handler${seed}(req: Request, res: Response): Promise<void> {`,
    `  const items = await db.query('SELECT * FROM widgets WHERE owner = ?', [req.userId])`,
    `  // accumulate, dedupe, and project the rows into the response DTO shape`,
    `  const seen = new Set<string>(); const out: WidgetDTO[] = []`,
    `  for (const row of items) { if (seen.has(row.key)) continue; seen.add(row.key)`,
    `    out.push({ id: row.id, label: row.label.trim(), score: row.score ?? 0 }) }`,
    `  res.json({ widgets: out, count: out.length, ts: Date.now() }) }`,
  ]
  const want = Math.max(8, Math.round(tokens / 1.4))
  const words: string[] = []
  let i = 0
  while (words.length < want) {
    words.push(...lines[i % lines.length].split(/\s+/))
    i++
  }
  return words.slice(0, want).join(' ')
}

async function main(): Promise<void> {
  log(`getLlama({ gpu: vulkan }) for ${which} (${MODEL.split(/[\\/]/).pop()})…`)
  const llama: any = await getLlama({ gpu: 'vulkan' })
  log('backend gpu=' + String(llama.gpu))
  const model = await llama.loadModel({ modelPath: MODEL })
  const ctx = await model.createEmbeddingContext({ contextSize: 2048 })
  log('embedder context ready (contextSize 2048); starting sustained long-passage embed…')

  // 200 passages at NORMAL chunk sizes that fit the 2048 window (code tokenizes
  // dense, ~5x my word estimate, so keep estimates modest). Tests whether jina
  // crashes on ordinary backfill chunks, not just over-long ones.
  const buckets = [60, 110, 160, 220]
  for (let n = 0; n < 200; n++) {
    const tok = buckets[n % buckets.length]
    const text = passage(tok, n)
    await ctx.getEmbeddingFor(text)
    if (n % 20 === 0) log(`  embedded ${n}/300 (last ~${tok} tok)`)
  }
  log(`SURVIVED — ${which} embedded 300 long passages on Vulkan, no crash`)
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
