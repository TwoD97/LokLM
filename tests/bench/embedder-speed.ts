/**
 * Speed-only embedder/reranker benchmark (no quality checks).
 *
 * Decides where the embedder should run if we consolidate to a single
 * Qwen3-Embedding-0.6B: is it fast enough on CPU (like bge-m3, an encoder) or
 * does its decoder architecture push it onto the GPU (like jina-code)?
 *
 * Talks to node-llama-cpp directly — same calls modelsWorker.embedderEmbed /
 * rerankerRank use (loadModel → createEmbeddingContext → getEmbeddingFor ;
 * createRankingContext → rankAll) — so the numbers are representative.
 *
 * Run:  npx tsx tests/bench/embedder-speed.ts
 * Flags: --cpu-only | --gpu-only | --no-jina
 */
import { getLlama } from 'node-llama-cpp'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { existsSync, appendFileSync, writeFileSync } from 'node:fs'

// Tee all output to a file with synchronous flush — piped stdout is block-
// buffered on Windows, and the GPU pass can hard-crash the process (fragile
// iGPU driver), which would lose buffered console output.
const LOG_FILE = join(process.cwd(), 'tests', 'bench', 'embedder-speed.log')
try {
  writeFileSync(LOG_FILE, '')
} catch {
  /* ignore */
}
{
  const c = console as unknown as {
    log: (...a: unknown[]) => void
    error: (...a: unknown[]) => void
  }
  const origLog = c.log.bind(console)
  const origErr = c.error.bind(console)
  const tee = (s: string): void => {
    try {
      appendFileSync(LOG_FILE, s + '\n')
    } catch {
      /* ignore */
    }
  }
  c.log = (...a: unknown[]): void => {
    const s = a.map(String).join(' ')
    tee(s)
    origLog(s)
  }
  c.error = (...a: unknown[]): void => {
    const s = a.map(String).join(' ')
    tee('ERR ' + s)
    origErr(s)
  }
}

const MODELS_DIR = join(process.cwd(), 'models')
const EMBED_CONTEXT_SIZE = 2048
const RERANK_CONTEXT_SIZE = 1024
const CPU_THREADS = Math.max(1, cpus().length - 1)

const args = new Set(process.argv.slice(2))
const DEVICES: Array<false | 'vulkan'> = args.has('--cpu-only')
  ? [false]
  : args.has('--gpu-only')
    ? ['vulkan']
    : [false, 'vulkan']

const EMBEDDERS = [
  { name: 'Qwen3-0.6B  (Q8_0) ', file: 'Qwen3-Embedding-0.6B-Q8_0.gguf' },
  { name: 'bge-m3      (Q4_K_M)', file: 'bge-m3-Q4_K_M.gguf' },
  ...(args.has('--no-jina')
    ? []
    : [{ name: 'jina-code   (IQ4_XS)', file: 'jina-code-embeddings-0.5b-IQ4_XS.gguf' }]),
]
const RERANKER = { name: 'bge-reranker-v2-m3 (Q4_K_M)', file: 'bge-reranker-v2-m3-Q4_K_M.gguf' }

// ---- corpus: 64 passages (~32 prose, ~32 code), ~200–500 tokens each --------
function buildCorpus(): string[] {
  const proseSeed =
    'Die Authentifizierung erfolgt über eine Kombination aus Login-Seite, Passwort-Reset via ' +
    'Recovery-Code und Sitzungsmanagement. Die Datenbank-Tabellen speichern Benutzerdaten, ' +
    'aktive Sitzungen und Antwortversuche. Local-first retrieval augmented generation keeps every ' +
    'document, embedding and conversation on the user device; nothing is sent to a remote server. ' +
    'The pipeline chunks each document, embeds the chunks into a vector store and reranks the top ' +
    'candidates before the language model drafts a grounded, source-verified answer. '
  const codeSeed = [
    'export async function embedPassages(texts: string[]): Promise<Array<number[] | null>> {',
    '  if (texts.length === 0) return []',
    '  if (!(await this.ensureReady())) return texts.map(() => null)',
    '  const prepared = texts.map((raw) => sanitize(raw))',
    '  try { return await this.client.embedderEmbed(prepared) }',
    '  catch (err) { console.warn("embedPassages failed", err); return texts.map(() => null) }',
    '}',
    'async function ensureBackend(key: BackendKey, forceCpu: boolean): Promise<unknown> {',
    '  const existing = backends.get(key); if (existing) return existing',
    '  const llama = await getLlama({ gpu: forceCpu ? false : "auto", maxThreads })',
    '  backends.set(key, llama); return llama',
    '}',
  ].join('\n')
  const out: string[] = []
  const N = 3 // per kind — 6 total; per-passage timing is logged individually
  for (let i = 0; i < N; i++) {
    // vary length: repeat the seed 2–4× so passages span ~200–500 tokens
    const reps = 2 + (i % 3)
    out.push((proseSeed.repeat(reps) + ` [passage ${i}]`).trim())
  }
  for (let i = 0; i < N; i++) {
    const reps = 2 + (i % 3)
    out.push((codeSeed + '\n').repeat(reps) + `// code passage ${i}`)
  }
  return out
}
const CORPUS = buildCorpus()

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}
const fmt = (n: number): string => n.toFixed(1).padStart(8)

type Row = {
  model: string
  device: string
  passagesPerSec: number
  tokensPerSec: number
  dim: number
}
const rows: Row[] = []

async function benchEmbedder(
  llama: any,
  modelName: string,
  modelPath: string,
  deviceLabel: string,
): Promise<void> {
  const model = await llama.loadModel({ modelPath })
  const ctx = await model.createEmbeddingContext({ contextSize: EMBED_CONTEXT_SIZE })
  try {
    let dim = 0
    const perMs: number[] = []
    const perTok: number[] = []
    for (let i = 0; i < CORPUS.length; i++) {
      const text = CORPUS[i]!
      const toks = model.tokenize(text).length
      const t0 = performance.now()
      const r = await ctx.getEmbeddingFor(text)
      const dt = performance.now() - t0
      if (!dim) dim = (r.vector as ArrayLike<number>).length
      perMs.push(dt)
      perTok.push(toks)
      // eslint-disable-next-line no-console
      console.log(
        `  ${modelName} | ${deviceLabel.padEnd(3)} | p${i}: ${dt.toFixed(0).padStart(6)} ms  ${String(
          toks,
        ).padStart(4)} tok  ${(toks / (dt / 1000)).toFixed(1).padStart(7)} tok/s`,
      )
    }
    // stats skip p0 (warmup)
    const ms = perMs.slice(1).reduce((a, b) => a + b, 0)
    const toks = perTok.slice(1).reduce((a, b) => a + b, 0)
    const passagesPerSec = (CORPUS.length - 1) / (ms / 1000)
    const tokensPerSec = toks / (ms / 1000)
    rows.push({ model: modelName, device: deviceLabel, passagesPerSec, tokensPerSec, dim })
    // eslint-disable-next-line no-console
    console.log(
      `  ${modelName} | ${deviceLabel.padEnd(3)} | AVG ${fmt(passagesPerSec)} pass/s | ${fmt(
        tokensPerSec,
      )} tok/s | dim ${dim}`,
    )
  } finally {
    await ctx.dispose()
    await model.dispose()
  }
}

async function benchReranker(llama: any, modelPath: string, deviceLabel: string): Promise<void> {
  const model = await llama.loadModel({ modelPath })
  const ctx = await model.createRankingContext({ contextSize: RERANK_CONTEXT_SIZE })
  try {
    const query = 'Wie funktioniert die Authentifizierung im Projekt?'
    const docs = CORPUS.slice(0, 30) // realistic rerank set
    await ctx.rankAll(query, docs.slice(0, 4)) // warm
    const times: number[] = []
    for (let run = 0; run < 2; run++) {
      const t0 = performance.now()
      await ctx.rankAll(query, docs)
      times.push(performance.now() - t0)
    }
    const ms = median(times)
    // eslint-disable-next-line no-console
    console.log(
      `  ${RERANKER.name} | ${deviceLabel.padEnd(6)} | ${fmt(ms)} ms for ${docs.length} docs | ${fmt(
        docs.length / (ms / 1000),
      )} docs/s`,
    )
  } finally {
    await ctx.dispose()
    await model.dispose()
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `\nEmbedder/reranker SPEED benchmark — ${CORPUS.length} passages, CPU threads=${CPU_THREADS}\n`,
  )
  // sanity: files present
  for (const e of EMBEDDERS) {
    if (!existsSync(join(MODELS_DIR, e.file)))
      throw new Error(`missing model: ${join(MODELS_DIR, e.file)}`)
  }

  for (const device of DEVICES) {
    const deviceLabel = device === false ? 'CPU' : 'GPU'
    // eslint-disable-next-line no-console
    console.log(`\n=== ${deviceLabel} (gpu=${String(device)}) ===`)
    let llama: any
    try {
      llama = await getLlama({ gpu: device, maxThreads: CPU_THREADS })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${deviceLabel} backend unavailable: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    // eslint-disable-next-line no-console
    console.log(`  backend resolved: gpu=${String(llama.gpu)}`)
    for (const e of EMBEDDERS) {
      try {
        await benchEmbedder(llama, e.name, join(MODELS_DIR, e.file), deviceLabel)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(
          `  ${e.name} | ${deviceLabel} | FAILED: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (existsSync(join(MODELS_DIR, RERANKER.file))) {
      try {
        await benchReranker(llama, join(MODELS_DIR, RERANKER.file), deviceLabel)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(
          `  reranker | ${deviceLabel} | FAILED: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    try {
      await llama.dispose?.()
    } catch {
      /* ignore */
    }
  }

  // ---- summary: Qwen3 vs bge-m3 on CPU (the decision number) ----
  // eslint-disable-next-line no-console
  console.log('\n=== SUMMARY (relative CPU throughput) ===')
  const cpu = rows.filter((r) => r.device === 'CPU')
  const bge = cpu.find((r) => r.model.includes('bge-m3'))
  for (const r of cpu) {
    const rel = bge ? (r.tokensPerSec / bge.tokensPerSec).toFixed(2) + '×' : 'n/a'
    // eslint-disable-next-line no-console
    console.log(`  ${r.model} CPU: ${fmt(r.tokensPerSec)} tok/s  (${rel} vs bge-m3)`)
  }
  // eslint-disable-next-line no-console
  console.log('')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
