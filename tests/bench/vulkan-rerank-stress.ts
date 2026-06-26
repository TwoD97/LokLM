/**
 * The reranker is the query-latency bottleneck we most want on the GPU. It's
 * bge-reranker-v2-m3 (XLM-RoBERTa encoder, the graceful-error class), NOT jina.
 * Confirm it survives sustained Vulkan ranking of realistic (query, doc) sets at
 * the app's RERANK_CONTEXT_SIZE (1024).
 *
 *   npx tsx tests/bench/vulkan-rerank-stress.ts
 *   SURVIVED → reranker on GPU is safe (the big win)
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const MODELS = join(process.cwd(), 'models')
const RER = join(MODELS, 'bge-reranker-v2-m3-Q4_K_M.gguf')
const LOG = join(process.cwd(), 'tests', 'bench', 'rerank-stress.log')
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

function doc(seed: number, approxTokens: number): string {
  const block =
    `function process${seed}(input: Buffer): Result { const parsed = decode(input); ` +
    `for (const item of parsed.items) { validate(item); transform(item) } return collect(parsed) } `
  let s = `Documentation for module ${seed}. `
  while (s.length < approxTokens * 3) s += block
  return s
}

async function main(): Promise<void> {
  log('getLlama({ gpu: vulkan }) bge-reranker…')
  const llama: any = await getLlama({ gpu: 'vulkan' })
  const model: any = await llama.loadModel({ modelPath: RER })
  const ctx: any = await model.createRankingContext({ contextSize: 1024 })
  log('ranking context ready (1024); sustained rankAll over realistic docs…')

  const lens = [80, 250, 500, 900]
  for (let n = 0; n < 60; n++) {
    const docs = Array.from({ length: 8 }, (_, i) => doc(n * 10 + i, lens[(n + i) % lens.length]))
    await ctx.rankAll('how does the request handler validate and transform items', docs)
    if (n % 10 === 0) log(`  ranked ${n}/60 (8 docs each)`)
  }
  log('SURVIVED — bge-reranker ranked 60 batches on Vulkan, no crash')
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
