import { execSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { cpus, totalmem, platform, release, arch } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// runDir , baut die versionierten output-folders auf und liefert helpers
// um per-config jsonl / json / md files reinzuschreiben.
//
// layout:
//   tests/evals/report/runs/<stamp>_<sha>[_dirty]/
//     env.json                           hw / os / git / dataset fingerprint
//     dataset.json                       was wurde verwendet (path + hash)
//     summary.md                         vergleichstabelle aller configs
//     summary.json                       maschinen-lesbare variante derselben
//     configs/<config-name>/
//       result.json                      summary stats für diese config
//       per-question.jsonl               eine zeile pro frage , full breakdown + llm-text
//       resource-samples.jsonl           time-series rss/vram/cpu samples
//
// alles ist additiv , bestehende runs werden nie überschrieben.

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface GitInfo {
  shortSha: string
  branch: string
  dirty: boolean
}

export function gitInfo(): GitInfo {
  // execSync ohne shell , damit windows nicht meckert. fehler werden als
  // 'unknown' getarnt damit der eval auch in einem detached-repo läuft.
  const safe = (cmd: string): string => {
    try {
      return execSync(cmd, { encoding: 'utf-8' }).trim()
    } catch {
      return 'unknown'
    }
  }
  const shortSha = safe('git rev-parse --short HEAD')
  const branch = safe('git rev-parse --abbrev-ref HEAD')
  let dirty = false
  try {
    execSync('git diff --quiet')
    execSync('git diff --cached --quiet')
  } catch {
    dirty = true
  }
  return { shortSha, branch, dirty }
}

export interface HardwareInfo {
  platform: NodeJS.Platform
  release: string
  arch: string
  cpuModel: string
  cpuCount: number
  totalRamGB: number
  /** wird wenn möglich vom caller nachgereicht (braucht eine vram-probe) */
  totalVramGB?: number
  /** wenn der caller den llama-backend-name kennt (cuda/vulkan/metal/cpu) */
  gpuBackend?: string | null
}

export function hardwareInfo(): HardwareInfo {
  const cs = cpus()
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cs[0]?.model ?? 'unknown',
    cpuCount: cs.length,
    totalRamGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  }
}

export interface EnvSnapshot {
  startedAt: string
  git: GitInfo
  hardware: HardwareInfo
  node: string
  /** alle env-vars die das verhalten der eval beeinflussen können , maskiert. */
  envFlags: Record<string, string>
}

const RELEVANT_ENV_KEYS = [
  'LLAMA_GPU',
  'LOKLM_LLM_CONTEXT_SIZE',
  'LOKLM_EMBEDDER_PATH',
  'LOKLM_RERANKER_PATH',
  'OLLAMA_HOST',
  'ANTHROPIC_API_KEY',
]

export function envSnapshot(): EnvSnapshot {
  const envFlags: Record<string, string> = {}
  for (const k of RELEVANT_ENV_KEYS) {
    const v = process.env[k]
    if (!v) continue
    // api-key nur als prefix loggen.
    envFlags[k] = k.includes('KEY') || k.includes('TOKEN') ? `${v.slice(0, 6)}…` : v
  }
  return {
    startedAt: new Date().toISOString(),
    git: gitInfo(),
    hardware: hardwareInfo(),
    node: process.version,
    envFlags,
  }
}

export interface DatasetInfo {
  path: string
  /** sha256 der dataset-bytes , damit reports über zeit komparabel sind. */
  sha256: string
  generator: string
  generatedAt: string
  numQuestions: number
  numChunks: number
  /** optional , wenn ein library-file zugemischt wurde. */
  library?: { path: string; size: string; numChunks: number; sha256: string } | null
}

export function hashBytes(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

/** stamp-format: 2026-05-20T15-30-12 (iso ohne ms , doppelpunkte → bindestriche). */
export function timestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/** baut den run-folder-namen. */
export function runFolderName(stamp: string, git: GitInfo): string {
  return `${stamp}_${git.shortSha}${git.dirty ? '_dirty' : ''}`
}

export interface RunDirHandle {
  rootDir: string
  /** schreibt env.json. einmal pro run. */
  writeEnv(env: EnvSnapshot): Promise<void>
  /** schreibt dataset.json. einmal pro run. */
  writeDataset(info: DatasetInfo): Promise<void>
  /** liefert einen pro-config writer. dirname = sanitisierter config-name. */
  configWriter(configName: string): ConfigWriter
  /** schreibt die gesammelte summary (md + json). am ende des sweeps. */
  writeSummary(markdown: string, json: unknown): Promise<void>
}

export interface ConfigWriter {
  rootDir: string
  /** result.json — aggregierte stats. */
  writeResult(result: unknown): Promise<void>
  /** eine zeile in per-question.jsonl anhängen. konkurrierende calls sind
   *  sequenziell durch den event-loop , kein dateilock nötig solange ein
   *  einziger sweep im selben prozess läuft. */
  appendPerQuestion(record: unknown): Promise<void>
  /** schreibt das gesamte per-question.jsonl als ein block (überschreibt
   *  bestehendes file). nützlich für den judge-pass am ende des sweeps , wo
   *  die records mit judge-scores angereichert werden und der ursprüngliche
   *  stream-write ersetzt werden soll. */
  writePerQuestionAll(records: ReadonlyArray<unknown>): Promise<void>
  /** schreibt resource-samples.jsonl en bloc (nicht streaming , sampler
   *  liefert das array beim stop()). */
  writeResourceSamples(samples: ReadonlyArray<unknown>): Promise<void>
}

/** standard-root: tests/evals/report/runs (gitignored über das bestehende report/). */
export function defaultRunsRoot(): string {
  return join(__dirname, 'report', 'runs')
}

export async function createRunDir(
  opts: { runsRoot?: string; stamp?: string; git?: GitInfo } = {},
): Promise<RunDirHandle> {
  const runsRoot = opts.runsRoot ?? defaultRunsRoot()
  const git = opts.git ?? gitInfo()
  const stamp = opts.stamp ?? timestamp()
  const rootDir = join(runsRoot, runFolderName(stamp, git))
  await mkdir(join(rootDir, 'configs'), { recursive: true })
  return {
    rootDir,
    async writeEnv(env) {
      await writeFile(join(rootDir, 'env.json'), JSON.stringify(env, null, 2), 'utf-8')
    },
    async writeDataset(info) {
      await writeFile(join(rootDir, 'dataset.json'), JSON.stringify(info, null, 2), 'utf-8')
    },
    configWriter(configName) {
      const dir = join(rootDir, 'configs', sanitize(configName))
      const perQ = join(dir, 'per-question.jsonl')
      let perQReady: Promise<void> | null = null
      const ensureDir = async (): Promise<void> => {
        if (!perQReady) {
          perQReady = mkdir(dir, { recursive: true }).then(() => undefined)
        }
        await perQReady
      }
      return {
        rootDir: dir,
        async writeResult(result) {
          await ensureDir()
          await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8')
        },
        async appendPerQuestion(record) {
          await ensureDir()
          const { appendFile } = await import('node:fs/promises')
          await appendFile(perQ, `${JSON.stringify(record)}\n`, 'utf-8')
        },
        async writePerQuestionAll(records) {
          await ensureDir()
          const body = records.map((r) => JSON.stringify(r)).join('\n')
          await writeFile(perQ, records.length > 0 ? `${body}\n` : '', 'utf-8')
        },
        async writeResourceSamples(samples) {
          await ensureDir()
          const body = samples.map((s) => JSON.stringify(s)).join('\n')
          await writeFile(join(dir, 'resource-samples.jsonl'), `${body}\n`, 'utf-8')
        },
      }
    },
    async writeSummary(markdown, json) {
      await writeFile(join(rootDir, 'summary.md'), markdown, 'utf-8')
      await writeFile(join(rootDir, 'summary.json'), JSON.stringify(json, null, 2), 'utf-8')
    },
  }
}

/** filesystem-safe config name (windows-paths verbieten z.b. ':' und '/'). */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
}
