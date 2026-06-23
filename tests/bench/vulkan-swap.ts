/**
 * Root-cause probe #3: the single-process fix STILL crashed (0xC0000409), now
 * with an embedder model SWAP in flight (embedder.unload + embedder.load —
 * jina-code <-> bge-m3, the doc<->code switch). Probes #1/#2 only LOADED models
 * and kept them resident; they never DISPOSED + RELOADED a Vulkan context while
 * other contexts (LLM + reranker) are live on the same backend. This does.
 *
 * Run: npx tsx tests/bench/vulkan-swap.ts
 *   crashes during dispose/reload → disposing+recreating a context on the shared
 *     backend is the trigger (→ avoid the swap thrash, or keep both resident).
 *   SURVIVED → the swap is fine; the app crash is concurrency the serializer
 *     should be stopping (→ look at the dispatch/serializer wiring in the build).
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const MODELS = join(process.cwd(), 'models')
const LOG = join(process.cwd(), 'tests', 'bench', 'swap.log')
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

const JINA = join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf')
const BGE = join(MODELS, 'bge-m3-Q4_K_M.gguf')

async function main(): Promise<void> {
  log('getLlama({ gpu: vulkan })…')
  const llama: any = await getLlama({ gpu: 'vulkan' })
  log('backend gpu=' + String(llama.gpu))

  log('load chat LLM (resident) + reranker (resident) — mimic the app…')
  const llm = await llama.loadModel({ modelPath: join(MODELS, 'Qwen_Qwen3-8B-Q4_K_M.gguf') })
  const llmCtx = await llm.createContext({ contextSize: { min: 2048, max: 8192 } })
  void llmCtx.getSequence()
  const rer = await llama.loadModel({ modelPath: join(MODELS, 'bge-reranker-v2-m3-Q4_K_M.gguf') })
  const rerCtx = await rer.createRankingContext({ contextSize: 1024 })
  log('  LLM + reranker RESIDENT')

  // Single embedder SLOT that swaps model, exactly like EmbeddingService.
  let embModel: any = null
  let embCtx: any = null
  async function loadEmbedder(path: string): Promise<void> {
    // dispose the old one first (embedderUnloadInternal), then load the new.
    if (embCtx) await embCtx.dispose()
    if (embModel) await embModel.dispose()
    embModel = await llama.loadModel({ modelPath: path })
    embCtx = await embModel.createEmbeddingContext({ contextSize: 2048 })
  }

  for (let round = 0; round < 4; round++) {
    log(`round ${round}: SWAP -> jina-code (dispose old + load)…`)
    await loadEmbedder(JINA)
    log(`  jina resident; embed x3 (alongside LLM + reranker)…`)
    for (let i = 0; i < 3; i++) await embCtx.getEmbeddingFor('export function f' + i + '() {}')
    await rerCtx.rankAll('q', ['a', 'b'])

    log(`round ${round}: SWAP -> bge-m3 (dispose jina + load)…`)
    await loadEmbedder(BGE)
    log(`  bge resident; embed x3…`)
    for (let i = 0; i < 3; i++) await embCtx.getEmbeddingFor('a paragraph of prose ' + i)
    await rerCtx.rankAll('q', ['a', 'b'])
  }
  log('SURVIVED — repeated embedder dispose+reload swaps on the shared backend, no crash')
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
