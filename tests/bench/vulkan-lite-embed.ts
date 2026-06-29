/**
 * Lite-tier device-loss probe. Reproduces "vk::Queue::submit: ErrorDeviceLost
 * during bulk embedding" on the 8 GB AMD iGPU and ISOLATES the trigger instead
 * of guessing. Three modes, run each and compare where (if) the device is lost:
 *
 *   npx tsx tests/bench/vulkan-lite-embed.ts embed    # bge-m3 ALONE (baseline)
 *   npx tsx tests/bench/vulkan-lite-embed.ts pair      # Qwen3.5-2B LLM + bge-m3 (pre-0.6 lite)
 *   npx tsx tests/bench/vulkan-lite-embed.ts triple     # LLM + bge-m3 + reranker (current 0.6.x lite)
 *
 * Reads:
 *   embed survives, triple crashes  → co-residency / VRAM is the trigger (the
 *                                     reranker added in 0.6.x tips it over).
 *   embed already crashes           → bge-m3 itself isn't stable on this iGPU
 *                                     (the embedder must move to CPU regardless).
 *   all survive                     → plain-Node can't repro; the fault needs the
 *                                     Electron worker (sustained cross-context load).
 * Logs free/total VRAM after each load + every 25 passages, and the exact passage
 * index where ErrorDeviceLost fires.
 */
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'

const mode = (process.argv[2] ?? 'triple').toLowerCase()
const MODELS = join(process.cwd(), 'models')
const LLM = join(MODELS, 'Qwen3.5-2B-Q4_K_M.gguf')
const EMB = join(MODELS, 'bge-m3-Q4_K_M.gguf')
const RER = join(MODELS, 'bge-reranker-v2-m3-Q4_K_M.gguf')
const N_PASSAGES = 300
const EMB_CONTEXT = 2048

const LOG = join(process.cwd(), 'tests', 'bench', `lite-embed-${mode}.log`)
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

async function vram(llama: any): Promise<string> {
  try {
    const v = await llama.getVramState()
    return `${((v.free as number) / 1e9).toFixed(2)} free / ${((v.total as number) / 1e9).toFixed(2)} total GB`
  } catch {
    return 'vram=err'
  }
}

// A realistic ~500-token German study-note passage (the user's corpus domain),
// padded to roughly the chunk sizes the real backfill embeds.
function passage(seed: number): string {
  const base = [
    'Ein Interpreter ist ein Computerprogramm, das eine Abfolge von Anweisungen direkt ausführt.',
    'Der Interpreter liest die Quelldateien ein, analysiert sie und führt anschließend die Anweisungen aus.',
    'Im Gegensatz dazu übersetzt ein Compiler den gesamten Quellcode vorab in ein ausführbares Programm.',
    'Maschinensprache ist die einzige Sprache, die ein Prozessor direkt versteht; jeder Befehl ist ein Zahlencode.',
    'Hochsprachen benutzen textuelle und mathematische Notation und müssen vor der Ausführung übersetzt werden.',
    'Eine Entwicklungsumgebung besteht mindestens aus Texteditor, Compiler, Linker, Debugger und Hilfesystem.',
  ]
  const out: string[] = []
  let i = seed
  while (out.join(' ').length < 1800) {
    out.push(base[i % base.length]!)
    i++
  }
  return out.join(' ')
}

async function main(): Promise<void> {
  log(`mode=${mode}  passages=${N_PASSAGES}  embContext=${EMB_CONTEXT}`)
  log('getLlama({ gpu: vulkan })…')
  const llama: any = await getLlama({ gpu: 'vulkan' })
  log(`backend gpu=${String(llama.gpu)}  ${await vram(llama)}`)

  let chatSession: any = null
  let rerCtx: any = null

  if (mode === 'pair' || mode === 'triple' || mode === 'app') {
    log('load LLM (Qwen3.5-2B) + KV context…')
    const llm = await llama.loadModel({ modelPath: LLM })
    const llmCtx = await llm.createContext({ contextSize: { min: 2048, max: 8192 } })
    const seq = llmCtx.getSequence()
    if (mode === 'app') chatSession = new LlamaChatSession({ contextSequence: seq })
    log(`  LLM resident — ${await vram(llama)}`)
  }

  log('load bge-m3 embedder + context…')
  const emb = await llama.loadModel({ modelPath: EMB })
  // batchSize 128 = the VULKAN_SAFE_BATCH fix (small vkQueueSubmit → under the
  // iGPU GPU-timeout). Measure that the smaller batch doesn't tank throughput.
  const embCtx = await emb.createEmbeddingContext({ contextSize: EMB_CONTEXT, batchSize: 128 })
  log(`  embedder resident — ${await vram(llama)}`)

  if (mode === 'triple' || mode === 'app') {
    log('load bge-reranker + ranking context (the 0.6.x addition)…')
    const rer = await llama.loadModel({ modelPath: RER })
    rerCtx = await rer.createRankingContext({ contextSize: 1024 })
    log(`  reranker resident — ${await vram(llama)}`)
  }

  const t0 = Date.now()
  const died = async (where: string, e: unknown): Promise<never> => {
    log(`*** DEVICE LOST at ${where} after ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    log(`    ${await vram(llama)}`)
    log(`    ${e && (e as any).message ? (e as any).message : String(e)}`)
    process.exit(2)
  }

  if (mode === 'app') {
    // Mimic the REAL app op sequence the user hit: a chat turn (LLM decode +
    // rerank on the iGPU) and THEN a folder sync (bulk embed), interleaved —
    // the cross-context switching the pure-embed bench never exercised.
    log('interleaving chat decode + rerank + embed batches (app-faithful)…')
    for (let round = 0; round < 8; round++) {
      try {
        const ans = await chatSession.prompt('Was ist ein Interpreter? Antworte kurz.', {
          maxTokens: 60,
        })
        log(`  round ${round}: chat ok (${(ans as string).length} chars)`)
      } catch (e) {
        await died(`chat decode (round ${round})`, e)
      }
      try {
        await rerCtx.rankAll('Was ist ein Interpreter', [
          passage(round),
          passage(round + 1),
          'x',
          'y',
        ])
      } catch (e) {
        await died(`rerank (round ${round})`, e)
      }
      for (let n = 0; n < 40; n++) {
        try {
          await embCtx.getEmbeddingFor(passage(round * 40 + n))
        } catch (e) {
          await died(`embed (round ${round}, #${n})`, e)
        }
      }
      log(`  round ${round}: +40 embeds  ${await vram(llama)}`)
    }
    log(
      `SURVIVED — app sequence (8× chat+rerank+40 embeds) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
    return
  }

  log(`starting bulk embed of ${N_PASSAGES} ~500-token passages (sequential, like the worker)…`)
  for (let n = 0; n < N_PASSAGES; n++) {
    try {
      await embCtx.getEmbeddingFor(passage(n))
    } catch (e) {
      await died(`passage #${n}`, e)
    }
    if (n % 25 === 0) {
      const rate = n > 0 ? (n / ((Date.now() - t0) / 1000)).toFixed(2) : '—'
      log(`  embedded ${n}/${N_PASSAGES}  (${rate} emb/s)  ${await vram(llama)}`)
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  log(`SURVIVED — ${mode} embedded ${N_PASSAGES} passages in ${secs}s, no device loss`)
}

main().catch((e) => {
  log('ERR ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
