/**
 * Verify the fix: jina-code on Vulkan native-crashes on OVER-context input
 * (proven by vulkan-embed-stress.ts). The worker now token-truncates every
 * passage to the context window BEFORE getEmbeddingFor. This replicates exactly
 * that logic and feeds jina the over-context dense-code passages that killed it.
 *
 *   npx tsx tests/bench/vulkan-embed-clamp.ts
 *   SURVIVED → the token-clamp removes the crash trigger (the real fix works)
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const MODELS = join(process.cwd(), 'models')
const JINA = join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf')
const LOG = join(process.cwd(), 'tests', 'bench', 'embed-clamp.log')
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

// ~6000 chars of dense code (the worker's SANITIZE_MAX_CHARS), which tokenizes
// to WELL over 2048 — the exact over-context payload that crashes un-clamped.
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
  log('getLlama({ gpu: vulkan }) jina-code…')
  const llama: any = await getLlama({ gpu: 'vulkan' })
  const model: any = await llama.loadModel({ modelPath: JINA })
  const ctxSize = 2048
  const ctx: any = await model.createEmbeddingContext({ contextSize: ctxSize })
  const maxTokens = Number(process.argv[2] ?? String(ctxSize - 8))
  log(`ready; embedding 200 OVER-context (6000-char) passages WITH token-clamp to ${maxTokens}…`)

  for (let n = 0; n < 200; n++) {
    let t = bigCode(n)
    const ids: number[] = model.tokenize(t)
    const before = ids.length
    if (ids.length > maxTokens) t = model.detokenize(ids.slice(0, maxTokens))
    await ctx.getEmbeddingFor(t)
    if (n % 25 === 0) log(`  embedded ${n}/200 (raw ${before} tok → clamped ${maxTokens})`)
  }
  log('SURVIVED — jina embedded 200 clamped over-context passages on Vulkan, no crash')
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
