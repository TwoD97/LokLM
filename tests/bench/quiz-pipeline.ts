// Wall-time benchmark for the quiz pipeline. Loads a real LLM via
// node-llama-cpp (bypassing the production LlamaService, which is worker-only
// and won't run under tsx) and drives the chunk-driven pipeline directly:
//
//   1. planQuiz                 — pure-code unit building (no LLM, ~ms)
//   2. generateQuestionsForUnit — one grammar-constrained call per unit
//
// Output: per-unit timings + totals. No embeddings anywhere — the rework
// removed them from the quiz path entirely.
//
// Usage:
//   pnpm test:quiz-pipeline                          # auto-discover lite, German
//   pnpm test:quiz-pipeline -- --cpu                 # force CPU backend
//   pnpm test:quiz-pipeline -- --profile full        # use 8B model
//   pnpm test:quiz-pipeline -- --model <path.gguf>   # explicit GGUF
//   pnpm test:quiz-pipeline -- --lang en             # English test doc

import { performance } from 'node:perf_hooks'
import { existsSync, readdirSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import type { ChunkRow } from '../../src/main/db/database'
import type { ModelStatus } from '../../src/shared/documents'
import type { LlmProvider, ProviderStatus } from '../../src/main/services/providers/types'
import type { QuizLanguage } from '../../src/shared/quiz'
import { generateQuestionsForUnit } from '../../src/main/services/quiz/generation'
import { planQuiz } from '../../src/main/services/quiz/units'
import { REPO_MODELS_DIR } from '../evals/bridges/common'

// Kept in sync with src/main/services/llm/LlamaService.ts LLM_PROFILES.
// Including Qwen3.5 2B as a lite candidate matters: the production installer
// downloads exactly that file for the lite tier, so a dev pointing the bench
// at their installed app's models/ dir picks it up automatically.
const PROFILE_PATTERNS: Record<'lite' | 'full' | 'xl', RegExp[]> = {
  lite: [/qwen3\.5.*[-_]?2b/i, /qwen3.*[-_]?4b/i, /qwen2\.5.*[-_]?3b/i, /llama.*3\.2.*[-_]?3b/i],
  full: [/qwen3\.5.*[-_]?4b/i, /qwen3.*[-_]?8b/i, /qwen2\.5.*[-_]?7b/i],
  xl: [
    /qwen3\.5.*[-_]?9b/i,
    /nemotron.*3.*nano.*30b/i,
    /nemotron.*nano.*30b/i,
    /qwen3.*[-_]?30b.*a3b/i,
    /qwen3.*[-_]?32b/i,
    /qwen2\.5.*[-_]?32b/i,
    /nemotron.*super.*49b/i,
    /llama.*3\.3.*70b/i,
  ],
}

/** Common locations where the installed LokLM app keeps its models, across
 *  platforms. Filtered to existing dirs so the resolver can append these to
 *  the repo-local models/ search list — a dev who installed the app + already
 *  has the lite GGUF on disk shouldn't need to re-download it for the bench. */
function getInstalledModelsDirs(): string[] {
  const dirs: string[] = []
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const appData = process.env.APPDATA
  if (localAppData) {
    dirs.push(join(localAppData, 'Programs', 'LokLM', 'models'))
    dirs.push(join(localAppData, 'Programs', 'loklm', 'models'))
    dirs.push(join(localAppData, 'LokLM', 'models'))
    dirs.push(join(localAppData, 'loklm', 'models'))
  }
  if (programFiles) {
    dirs.push(join(programFiles, 'LokLM', 'models'))
    dirs.push(join(programFiles, 'loklm', 'models'))
  }
  if (appData) {
    dirs.push(join(appData, 'loklm', 'models'))
    dirs.push(join(appData, 'LokLM', 'models'))
  }
  if (home) {
    // macOS
    dirs.push(join(home, 'Library', 'Application Support', 'loklm', 'models'))
    // Linux
    dirs.push(join(home, '.config', 'loklm', 'models'))
    dirs.push(join(home, '.local', 'share', 'loklm', 'models'))
  }
  // System-wide installs
  dirs.push('/Applications/LokLM.app/Contents/Resources/models')
  dirs.push('/opt/loklm/models')
  dirs.push('/usr/share/loklm/models')
  return dirs.filter(existsSync)
}

/** All directories the bench searches for GGUFs, in priority order: the
 *  repo-local models/ first ( a dev who placed a file there meant to use it ) ,
 *  then any detected install location. */
function getAllSearchDirs(): string[] {
  return [REPO_MODELS_DIR, ...getInstalledModelsDirs()]
}

type Profile = 'lite' | 'full' | 'xl'

/** STRICT profile resolver: walks every search dir (repo-local + installed
 *  app locations) looking for a GGUF matching the requested profile's
 *  patterns. Returns the first hit, in priority order. */
function resolveLlmPathStrict(profile: Profile): string | null {
  for (const dir of getAllSearchDirs()) {
    const entries = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'))
    const match = entries.find((f) => PROFILE_PATTERNS[profile].some((re) => re.test(f)))
    if (match) return join(dir, match)
  }
  return null
}

/** Permissive resolver: tries the requested profile first, then the other
 *  profiles ( smallest-first when --cpu , largest-first otherwise ) , then any
 *  non-embedder/reranker GGUF. Returns the chosen profile alongside the path so
 *  the caller can warn loudly when it had to fall back — silently swapping an
 *  8B in for lite is exactly the bug we just fixed in the previous commit. */
function resolveLlmPathPermissive(
  requested: Profile,
  preferSmaller: boolean,
): { path: string; chosen: Profile | null } | null {
  const exact = resolveLlmPathStrict(requested)
  if (exact) return { path: exact, chosen: requested }
  const fallbackOrder: Profile[] = preferSmaller ? ['lite', 'full', 'xl'] : ['xl', 'full', 'lite']
  for (const p of fallbackOrder) {
    if (p === requested) continue
    const path = resolveLlmPathStrict(p)
    if (path) return { path, chosen: p }
  }
  // Catch-all: any non-embedder/reranker GGUF in any search dir.
  for (const dir of getAllSearchDirs()) {
    const entries = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'))
    const fallback = entries.find((f) => !/embed|reranker|bge/i.test(f))
    if (fallback) return { path: join(dir, fallback), chosen: null }
  }
  return null
}

interface Args {
  modelPath: string
  cpu: boolean
  lang: QuizLanguage
  profile: Profile
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const cpu = argv.includes('--cpu')
  // Profile default: lite on CPU (8B is unusable there), full otherwise.
  // Explicit --profile always wins so you can deliberately bench a heavier
  // model on CPU to measure the gap.
  const profileArg = get('--profile') as Profile | undefined
  const requestedProfile: Profile = profileArg ?? (cpu ? 'lite' : 'full')
  const explicit = get('--model')
  let modelPath: string
  let profile: Profile = requestedProfile
  if (explicit) {
    modelPath = explicit
  } else {
    // Permissive resolution: prefer requested profile, fall back to whatever is
    // available so the bench can run with a dev's current models/ directory
    // without forcing a separate 4B download. Loud warnings tell the operator
    // when the fallback fires.
    const r = resolveLlmPathPermissive(requestedProfile, cpu)
    if (!r) {
      console.error('bench: no GGUF found in any search location:')
      for (const dir of getAllSearchDirs()) console.error(`  • ${dir}`)
      console.error('  Place a .gguf in models/, or pass --model <path-to.gguf>')
      process.exit(1)
    }
    modelPath = r.path
    if (r.chosen !== requestedProfile) {
      console.warn(
        `bench: no GGUF matching profile='${requestedProfile}', falling back to '${r.chosen ?? 'unknown'}' at ${modelPath}`,
      )
      if (cpu && r.chosen !== 'lite') {
        console.warn(
          `bench: running ${r.chosen ?? 'this'} on CPU will be SLOW (minutes per inference call)`,
        )
        console.warn(
          `bench: to get a fast CPU run, drop a 4B GGUF into models/ (https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507-GGUF)`,
        )
      }
      profile = r.chosen ?? requestedProfile
    }
  }
  const lang = (get('--lang') ?? 'de') as QuizLanguage
  return { modelPath, cpu, lang, profile }
}

/** Minimal LlmProvider for the bench: loads node-llama-cpp directly and
 *  routes generateRaw through session.prompt with optional grammar (from
 *  jsonSchema) and budgets.thoughtTokens=0 (from noThink). Mirrors what the
 *  production worker does at a much smaller scale. */
class BenchLlm implements LlmProvider {
  // node-llama-cpp objects (typed as unknown to avoid pulling lib types in).
  private llama: unknown = null
  private model: unknown = null
  private context: unknown = null
  private session: unknown = null
  private warmed = false
  private cpuDetected = false

  constructor(
    private readonly modelPath: string,
    private readonly forceCpu: boolean,
  ) {}

  async warm(): Promise<void> {
    if (this.warmed) return
    const lib = await import('node-llama-cpp')
    const gpu = this.forceCpu ? false : 'auto'
    // Use all but one CPU core. node-llama-cpp's default heuristic underuses
    // physical cores ( observed ~2.4 tok/s decode on a 2B model on a machine
    // with 8+ idle cores ). Matches the production modelsWorker.
    const maxThreads = Math.max(1, cpus().length - 1)
    this.llama = await lib.getLlama({ gpu, maxThreads })
    // node-llama-cpp exposes `.gpu` on the Llama instance — falsy when CPU.
    this.cpuDetected = !(this.llama as { gpu?: unknown }).gpu
    console.error(`[bench] loading ${this.modelPath}`)
    this.model = await (
      this.llama as {
        loadModel: (o: { modelPath: string }) => Promise<unknown>
      }
    ).loadModel({ modelPath: this.modelPath })
    // Smaller KV-cache via the {min, max} contextSize range — same trick the
    // eval LlmBridge uses. Keeps RAM down to a few hundred MB even on big
    // models so the bench runs on a laptop.
    this.context = await (
      this.model as {
        createContext: (o: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>
      }
    ).createContext({
      contextSize: { min: 4096, max: 8192 },
      flashAttention: true,
      experimentalKvCacheKeyType: 'Q8_0',
      experimentalKvCacheValueType: 'Q8_0',
      // Match production: bigger batchSize halves per-batch dispatch overhead
      // for ~1k-token prompts.
      batchSize: 1024,
    })
    this.session = new lib.LlamaChatSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contextSequence: (this.context as { getSequence: () => unknown }).getSequence() as any,
      systemPrompt: 'You output JSON only. No prose. No <think> blocks.',
    })
    this.warmed = true
  }

  async generateRaw(
    prompt: string,
    opts: {
      abortSignal?: AbortSignal | undefined
      maxTokens?: number | undefined
      jsonSchema?: object | undefined
      noThink?: boolean | undefined
    } = {},
  ): Promise<string> {
    await this.warm()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grammar: any
    if (opts.jsonSchema) {
      grammar = await (
        this.llama as {
          createGrammarForJsonSchema: (s: object) => Promise<unknown>
        }
      ).createGrammarForJsonSchema(opts.jsonSchema)
    }
    const session = this.session as {
      prompt: (t: string, o: Record<string, unknown>) => Promise<string>
      resetChatHistory?: () => void
    }
    try {
      session.resetChatHistory?.()
    } catch {
      /* ignore */
    }
    const promptOpts: Record<string, unknown> = {}
    if (grammar) promptOpts.grammar = grammar
    if (opts.maxTokens != null) promptOpts.maxTokens = opts.maxTokens
    if (opts.abortSignal) promptOpts.signal = opts.abortSignal
    if (opts.noThink) promptOpts.budgets = { thoughtTokens: 0 }
    // Live decode feedback: one dot per emitted chunk + final '[N tok, Ts]'.
    // On CPU each call is often 60-120s of silence otherwise — this is the
    // difference between "stuck?" and "30 tokens in, decoding fine".
    const t0 = performance.now()
    let chunks = 0
    let chars = 0
    let firstChunkAt: number | null = null
    promptOpts.onTextChunk = (chunk: string): void => {
      if (firstChunkAt === null) firstChunkAt = performance.now()
      chunks += 1
      chars += chunk.length
      process.stderr.write('.')
    }
    const raw = await session.prompt(prompt, promptOpts)
    const dt = (performance.now() - t0) / 1000
    const ttft = firstChunkAt != null ? ((firstChunkAt - t0) / 1000).toFixed(1) : 'n/a'
    process.stderr.write(
      ` [${chunks} chunks, ${chars} chars, ttft ${ttft}s, total ${dt.toFixed(1)}s]\n`,
    )
    return String(raw).trim()
  }

  isCpuInference(): boolean {
    return this.cpuDetected
  }

  contextWindowTokens(): number {
    return 8192
  }

  isReady(): boolean {
    return this.warmed
  }

  getStatus(): ProviderStatus {
    return { ready: this.warmed, message: null, identity: 'bench' }
  }

  getModelStatus(): ModelStatus {
    return {
      state: 'ready',
      modelPath: this.modelPath,
      modelName: null,
      gpu: this.cpuDetected ? null : 'auto',
      loadProgress: null,
      message: null,
      profile: null,
      source: 'bundled',
      fallback: { active: false, reason: null },
    } as ModelStatus
  }

  // Bench doesn't exercise these; throw to make accidental use loud.
  async ask(): Promise<string> {
    throw new Error('BenchLlm.ask: not implemented (bench only uses generateRaw)')
  }
  async generateTitle(): Promise<string | null> {
    return null
  }
  async setLanguage(): Promise<void> {
    /* no-op */
  }

  async unload(): Promise<void> {
    // node-llama-cpp objects auto-dispose on GC; we just drop refs so the
    // bench script can exit cleanly without hanging on a held context.
    this.session = null
    this.context = null
    this.model = null
    this.llama = null
    this.warmed = false
  }
}

// Self-contained test docs: realistic Studienskript-ish prose so the model has
// something concrete to extract themes from. German variant mirrors the topic
// from the field failure that motivated this bench (Hybride Verschlüsselung).

const TEST_DOC_DE = `
Hybride Verschlüsselung kombiniert die Stärken von symmetrischer und asymmetrischer Kryptographie. Die Idee: für die eigentliche Datenverschlüsselung wird ein schneller symmetrischer Algorithmus wie AES verwendet, während der dazugehörige Sitzungsschlüssel mit einem asymmetrischen Verfahren wie RSA oder ECC sicher zwischen den Kommunikationspartnern ausgetauscht wird. So profitiert man von der hohen Geschwindigkeit symmetrischer Verfahren bei großen Datenmengen und gleichzeitig vom sicheren Schlüsselaustausch ohne vorher geteiltes Geheimnis.

Der Ablauf einer typischen hybriden Verschlüsselung sieht so aus: Der Sender generiert einen zufälligen Sitzungsschlüssel, verschlüsselt damit die Nachricht via AES und verschlüsselt anschließend den Sitzungsschlüssel mit dem öffentlichen Schlüssel des Empfängers. Empfänger erhält beides, entschlüsselt zunächst den Sitzungsschlüssel mit seinem privaten Schlüssel und kann dann die eigentliche Nachricht entschlüsseln. Das Verfahren ist die Grundlage für TLS, S/MIME, PGP und praktisch jede moderne sichere Kommunikation im Internet.

Diffie-Hellman ist eine alternative Methode zum Schlüsselaustausch, die häufig in modernen Protokollen verwendet wird. Anders als RSA-basierter Austausch erlaubt Diffie-Hellman beiden Parteien, gemeinsam einen Sitzungsschlüssel zu berechnen, ohne dass dieser jemals direkt übertragen wird. Die Sicherheit basiert auf dem diskreten Logarithmusproblem. In der Praxis kommt heute fast ausschließlich die elliptische Kurven-Variante ECDH zum Einsatz, weil sie bei gleicher Sicherheit deutlich kürzere Schlüssel und damit weniger Rechenaufwand braucht.

Forward Secrecy ist eine wichtige Eigenschaft hybrider Verschlüsselungssysteme: selbst wenn der langlebige private Schlüssel eines Servers kompromittiert wird, bleiben frühere Sitzungen sicher. Erreicht wird das durch ephemere Sitzungsschlüssel — bei jedem Verbindungsaufbau wird ein frischer Schlüssel ausgehandelt, der nach der Sitzung verworfen wird. TLS 1.3 erzwingt Forward Secrecy standardmäßig durch verpflichtenden ECDH-Schlüsselaustausch ohne RSA-Fallback.
`.trim()

const TEST_DOC_EN = `
Hybrid encryption combines the strengths of symmetric and asymmetric cryptography. The idea: a fast symmetric algorithm such as AES is used to encrypt the actual data, while the associated session key is exchanged securely between communication partners via an asymmetric scheme like RSA or ECC. This way you benefit from the high speed of symmetric ciphers on bulk data and at the same time from secure key exchange without any pre-shared secret.

A typical hybrid encryption flow looks like this: the sender generates a random session key, encrypts the message with AES under that key, then encrypts the session key itself using the recipient's public key. The recipient receives both, first decrypts the session key with their private key, and can then decrypt the actual message. This pattern is the foundation of TLS, S/MIME, PGP and essentially every modern secure communication on the internet.

Diffie-Hellman is an alternative key-exchange method, widely used in modern protocols. Unlike RSA-based exchange, Diffie-Hellman lets both parties jointly compute a session key without ever transmitting it directly. Its security rests on the discrete-logarithm problem. In practice today it is almost always used in its elliptic-curve variant ECDH, which offers the same security with much shorter keys and far less compute.

Forward secrecy is an important property of hybrid encryption systems: even if the long-term private key of a server is compromised, earlier sessions remain secure. This is achieved through ephemeral session keys — a fresh key is negotiated for each connection and discarded after the session ends. TLS 1.3 mandates forward secrecy by default through required ECDH key exchange with no RSA fallback.
`.trim()

/** One chunk per paragraph, each tagged with its own section heading so the
 *  unit builder produces several units (≈ one per paragraph) — that exercises
 *  the per-unit call loop the way a real sectioned document would. */
function makeChunks(text: string, lang: QuizLanguage): ChunkRow[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((paragraph, i) => ({
      id: i + 1,
      document_id: 1,
      ordinal: i + 1,
      text: paragraph,
      token_count: Math.ceil(paragraph.length / 3.5),
      page_from: null,
      page_to: null,
      heading_path: [lang === 'de' ? `Abschnitt ${i + 1}` : `Section ${i + 1}`],
      language: lang,
    }))
}

function rule(): string {
  return '━'.repeat(60)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const llm = new BenchLlm(args.modelPath, args.cpu)

  const tLoad0 = performance.now()
  await llm.warm()
  const tLoad1 = performance.now()

  const cpu = llm.isCpuInference()
  console.log(rule())
  console.log('Quiz pipeline bench (chunk-driven)')
  console.log(`  Model:      ${args.modelPath}`)
  console.log(`  Profile:    ${args.profile}`)
  console.log(`  Backend:    ${cpu ? 'CPU' : 'GPU'}`)
  console.log(`  Language:   ${args.lang}`)
  console.log(`  Load time:  ${((tLoad1 - tLoad0) / 1000).toFixed(1)}s`)
  console.log(rule())

  const docText = args.lang === 'de' ? TEST_DOC_DE : TEST_DOC_EN
  const chunks = makeChunks(docText, args.lang)
  const docTitle = args.lang === 'de' ? 'Hybride Verschlüsselung' : 'Hybrid Encryption'
  console.log(`\nDoc: ${chunks.length} chunks, ${docText.length} chars total`)

  // Stage 1: pure-code plan (section units). No LLM. How many questions each
  // unit yields is the model's decision during generation.
  const tPlan0 = performance.now()
  const { units } = planQuiz([{ docId: 1, docTitle, chunks }])
  const dtPlan = (performance.now() - tPlan0) / 1000
  console.log(`[plan] ${units.length} units in ${(dtPlan * 1000).toFixed(1)}ms`)
  for (const u of units) {
    console.log(`         • "${u.title}" (${u.tokens} tok)`)
  }

  // Stage 2: one grammar-constrained call per unit; the model decides count.
  console.log()
  const acceptedStems: string[] = []
  let totalQ = 0
  const perUnitTimes: number[] = []
  const tGen0 = performance.now()
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]!
    const tQ0 = performance.now()
    const questions = await generateQuestionsForUnit(llm, {
      language: args.lang,
      unit,
      acceptedStems,
    })
    const dt = (performance.now() - tQ0) / 1000
    perUnitTimes.push(dt)
    totalQ += questions.length
    acceptedStems.push(...questions.map((q) => q.stem))
    console.log(
      `[gen] unit ${i + 1}/${units.length} "${unit.title}": ` +
        `${questions.length}Q in ${dt.toFixed(1)}s`,
    )
  }
  const tGenTotal = (performance.now() - tGen0) / 1000
  const avgPerUnit = perUnitTimes.length > 0 ? tGenTotal / perUnitTimes.length : 0

  console.log()
  console.log(rule())
  console.log('Summary')
  console.log(`  Units planned:      ${units.length}`)
  console.log(`  Questions written:  ${totalQ}`)
  console.log(
    `  Question gen:       ${tGenTotal.toFixed(1)}s (avg ${avgPerUnit.toFixed(1)}s per unit)`,
  )
  console.log(rule())

  await llm.unload()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
