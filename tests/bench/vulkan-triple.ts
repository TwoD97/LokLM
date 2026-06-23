/**
 * Root-cause probe #2: the app crashes with chat LLM (process 1) + embedder +
 * reranker (process 2) all on the iGPU. Probe #1 proved embedder+reranker
 * co-resident is FINE. This adds the 8B chat LLM (~5 GB) to the same Vulkan
 * backend to see whether the crash is a VRAM ceiling (the 5 GB model squeezing
 * out retrieval → a smaller chat model could share) or a hard limit on having
 * the big model + retrieval contexts together.
 *
 * Run: npx tsx tests/bench/vulkan-triple.ts
 *   crashes at "create LLM context" / "load embedder" → VRAM ceiling (5 GB LLM).
 *   SURVIVED → the app crash is something else (cross-process? sustained load?).
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const MODELS = join(process.cwd(), 'models')
const LOG = join(process.cwd(), 'tests', 'bench', 'triple.log')
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

async function main(): Promise<void> {
  log('getLlama({ gpu: vulkan })…')
  const llama: any = await getLlama({ gpu: 'vulkan' })
  log('backend gpu=' + String(llama.gpu) + '  freeVram(GB)=' + tryVram(llama))

  log('load chat LLM (Qwen3-8B Q4 ~5 GB)…')
  const llm = await llama.loadModel({ modelPath: join(MODELS, 'Qwen_Qwen3-8B-Q4_K_M.gguf') })
  log('  LLM weights resident — freeVram(GB)=' + (await tryVramAsync(llama)))
  log('create LLM context (KV)…')
  const llmCtx = await llm.createContext({ contextSize: { min: 2048, max: 8192 } })
  void llmCtx.getSequence()
  log('  LLM context RESIDENT — freeVram(GB)=' + (await tryVramAsync(llama)))

  log('load embedder + create context (alongside the 5 GB LLM)…')
  const emb = await llama.loadModel({
    modelPath: join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf'),
  })
  const embCtx = await emb.createEmbeddingContext({ contextSize: 2048 })
  log('  embedder RESIDENT')

  log('load reranker + create context…')
  const rer = await llama.loadModel({ modelPath: join(MODELS, 'bge-reranker-v2-m3-Q4_K_M.gguf') })
  const rerCtx = await rer.createRankingContext({ contextSize: 1024 })
  log('  reranker RESIDENT — LLM + embedder + reranker all on the iGPU now')

  for (let i = 0; i < 6; i++) {
    log(`embed #${i}…`)
    await embCtx.getEmbeddingFor('export function ensureBackend() {} // ' + i)
    log(`rank #${i}…`)
    await rerCtx.rankAll('how does ensureBackend work', ['a', 'b', 'c', 'd'])
  }
  log('SURVIVED — 8B LLM + embedder + reranker coexisted on Vulkan, no crash')
}

function tryVram(llama: any): string {
  try {
    return String(llama.getVramState ? 'probe-async' : 'n/a')
  } catch {
    return 'err'
  }
}
async function tryVramAsync(llama: any): Promise<string> {
  try {
    const v = await llama.getVramState()
    return ((v.free as number) / 1e9).toFixed(2) + '/' + ((v.total as number) / 1e9).toFixed(2)
  } catch {
    return 'err'
  }
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
