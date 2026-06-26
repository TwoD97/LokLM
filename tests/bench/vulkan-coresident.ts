/**
 * Root-cause probe (systematic-debugging): does the AMD iGPU Vulkan stack
 * fast-fail when TWO model contexts (embedder + reranker) are resident on one
 * Vulkan backend at the same time — independent of Electron, the chat LLM, and
 * any cross-process concern?
 *
 * Mirrors exactly what the retrieval worker does: ONE getLlama({gpu:'vulkan'}),
 * embedder createEmbeddingContext + reranker createRankingContext BOTH resident,
 * then interleave embed + rank ops. The benchmark never hit this because it
 * loaded one model at a time and disposed between.
 *
 * Run: npx tsx tests/bench/vulkan-coresident.ts
 *   "SURVIVED" → two Vulkan contexts are fine (look elsewhere: chat LLM / VRAM).
 *   process dies (0xC0000409, no SURVIVED) → confirmed: can't co-resident on iGPU.
 */
import { getLlama } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const MODELS = join(process.cwd(), 'models')
const LOG = join(process.cwd(), 'tests', 'bench', 'coresident.log')
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
  log('backend gpu=' + String(llama.gpu))

  log('load embedder (jina-code) + create embedding context…')
  const emb = await llama.loadModel({
    modelPath: join(MODELS, 'jina-code-embeddings-0.5b-IQ4_XS.gguf'),
  })
  const embCtx = await emb.createEmbeddingContext({ contextSize: 2048 })
  log('  embedder context RESIDENT')

  log('load reranker (bge) + create ranking context — SECOND context, same backend…')
  const rer = await llama.loadModel({ modelPath: join(MODELS, 'bge-reranker-v2-m3-Q4_K_M.gguf') })
  const rerCtx = await rer.createRankingContext({ contextSize: 1024 })
  log('  reranker context RESIDENT — BOTH now coexist on the iGPU')

  for (let i = 0; i < 6; i++) {
    log(`embed #${i}…`)
    await embCtx.getEmbeddingFor('export function ensureBackend() { return getLlama() } // ' + i)
    log(`rank #${i}…`)
    await rerCtx.rankAll('how does ensureBackend work', ['doc a', 'doc b', 'doc c', 'doc d'])
  }
  log('SURVIVED — embedder + reranker coexisted on Vulkan with no crash')
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
