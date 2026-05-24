// failure-patterns , liest existierende per-question.jsonl files und pivotiert
// sie zu nützlichen views ohne neuen eval-run. Drei tabellen:
//
//   1. Per-config aggregate: für jeden config getrennte zeile mit
//      recall@5 , judge.score , judge.parsedFraction , und der per-intent
//      aufgeteilten judge-mittelwerte (focused vs broad vs summary).
//
//   2. Per-intent leaderboard: für jeden intent (focused/broad/summary) eine
//      tabelle mit allen configs sortiert nach judge.score. Zeigt: "auf
//      broad-fragen gewinnt modell X , auf summary modell Y".
//
//   3. Hit-bucket × judge: pivotet (rank-bucket) × (judge-tertil). Zeigt z.B.
//      "wenn der gold-chunk @ rank > 5 landet , kollabiert judge.score
//      systematisch". Validiert ob ranking überhaupt wirkt.
//
// Output ist markdown auf stdout. CLI:
//   tsx tests/evals/answer/failure-patterns.ts --run-dir <path>
//                                              [--out <markdown.md>]

import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { JudgeScore } from '../judge/Judge'
import type { QuestionIntent } from '../synth/QuestionGenerator'

interface PerQ {
  question: string
  intent: QuestionIntent
  rank: number | null
  hit: boolean
  judge: JudgeScore | null
  llm: { text: string } | null
}

interface ConfigResult {
  config: string
  numQueries: number
  recallAt5: number
  recallAt10: number
  judgeAvg: { score: number; parsedFraction: number } | null
  composite: number
  phased: { ttft: { p50: number }; fullResponse: { p50: number } }
}

interface ConfigSummary {
  name: string
  result: ConfigResult
  records: PerQ[]
}

interface Args {
  runDir: string
  out?: string
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--run-dir' && next !== undefined) {
      out.runDir = next
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    }
  }
  if (!out.runDir) throw new Error('--run-dir <path> ist required')
  return out as Args
}

async function loadConfigs(runDir: string): Promise<ConfigSummary[]> {
  const configsRoot = join(runDir, 'configs')
  const dirs = (await readdir(configsRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  const out: ConfigSummary[] = []
  for (const d of dirs) {
    const resultPath = join(configsRoot, d, 'result.json')
    const perQPath = join(configsRoot, d, 'per-question.jsonl')
    if (!existsSync(resultPath) || !existsSync(perQPath)) continue
    const result = JSON.parse(await readFile(resultPath, 'utf-8')) as ConfigResult
    const perQRaw = await readFile(perQPath, 'utf-8')
    const records: PerQ[] = perQRaw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as PerQ)
    out.push({ name: d, result, records })
  }
  return out
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Bucket den rank: hit@1 , hit@2-5 , hit@6-10 , miss. Hilft zu sehen ob
 *  reranking nur den top-1 verschiebt oder das ganze top-5-fenster. */
function rankBucket(rank: number | null): string {
  if (rank === null) return 'miss'
  if (rank === 1) return 'r=1'
  if (rank <= 5) return 'r=2-5'
  if (rank <= 10) return 'r=6-10'
  return 'r>10'
}

function fmt(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : '-'
}

function tableAggregate(configs: ConfigSummary[]): string {
  const intents: QuestionIntent[] = ['focused', 'broad', 'summary']
  const lines = [
    `## Per-config aggregate`,
    ``,
    `| Config | n | recall@5 | judge | parsed% | composite | TTFT p50 | FullResp p50 | ${intents.map((i) => `j(${i})`).join(' | ')} |`,
    `| ------ | -: | -: | -: | -: | -: | -: | -: | ${intents.map(() => '-:').join(' | ')} |`,
  ]
  // sort by composite desc
  const sorted = [...configs].sort((a, b) => b.result.composite - a.result.composite)
  for (const c of sorted) {
    const intentScores = intents.map((it) => {
      const parsed = c.records
        .filter((r) => r.intent === it && r.judge && r.judge.parsed)
        .map((r) => r.judge!.score)
      return parsed.length > 0 ? fmt(avg(parsed)) : '-'
    })
    const j = c.result.judgeAvg
    lines.push(
      `| ${c.name} | ${c.result.numQueries} | ${fmt(c.result.recallAt5)} | ` +
        `${j ? fmt(j.score) : '-'} | ${j ? fmt(j.parsedFraction * 100, 0) + '%' : '-'} | ` +
        `${fmt(c.result.composite)} | ${fmt(c.result.phased.ttft.p50, 0)} | ` +
        `${fmt(c.result.phased.fullResponse.p50, 0)} | ${intentScores.join(' | ')} |`,
    )
  }
  return lines.join('\n')
}

function tableByIntent(configs: ConfigSummary[]): string {
  const intents: QuestionIntent[] = ['focused', 'broad', 'summary']
  const parts: string[] = []
  for (const it of intents) {
    const rows = configs.map((c) => {
      const parsed = c.records
        .filter((r) => r.intent === it && r.judge && r.judge.parsed)
        .map((r) => r.judge!.score)
      const n = c.records.filter((r) => r.intent === it).length
      const hit = c.records.filter((r) => r.intent === it && r.hit).length
      return {
        name: c.name,
        n,
        hitRate: n > 0 ? hit / n : 0,
        judgeAvg: parsed.length > 0 ? avg(parsed) : null,
      }
    })
    rows.sort((a, b) => (b.judgeAvg ?? -1) - (a.judgeAvg ?? -1))
    parts.push(`## Leaderboard — intent = ${it}`)
    parts.push('')
    parts.push('| Rang | Config | n | hit-rate | judge.score |')
    parts.push('| -: | ------ | -: | -: | -: |')
    rows.forEach((r, i) => {
      parts.push(
        `| ${i + 1} | ${r.name} | ${r.n} | ${fmt(r.hitRate)} | ${r.judgeAvg === null ? '-' : fmt(r.judgeAvg)} |`,
      )
    })
    parts.push('')
  }
  return parts.join('\n')
}

function tableRankBucket(configs: ConfigSummary[]): string {
  // global pivot: alle records über alle configs zusammenfassen , dann
  // rank-bucket × judge-tertil ausgeben. Anschließend pro config ob diese
  // verteilung sich stark unterscheidet — aber für V1 reicht das global.
  const buckets = ['r=1', 'r=2-5', 'r=6-10', 'r>10', 'miss']
  // bucket → judge-scores
  const groups = new Map<string, number[]>()
  let total = 0
  let scored = 0
  for (const c of configs) {
    for (const r of c.records) {
      const b = rankBucket(r.rank)
      if (!groups.has(b)) groups.set(b, [])
      total++
      if (r.judge && r.judge.parsed) {
        groups.get(b)!.push(r.judge.score)
        scored++
      }
    }
  }
  const lines = [
    `## Judge-score vs retrieval-rank-bucket`,
    ``,
    `Pooled über alle configs , ${total} records , ${scored} gescored.`,
    ``,
    `| Bucket | n total | n gescored | judge.score mean | judge.score p50 |`,
    `| ------ | -: | -: | -: | -: |`,
  ]
  for (const b of buckets) {
    const all = configs.flatMap((c) => c.records.filter((r) => rankBucket(r.rank) === b))
    const parsed = (groups.get(b) ?? []).filter((s) => Number.isFinite(s))
    parsed.sort((a, b) => a - b)
    const mean = parsed.length > 0 ? avg(parsed) : 0
    const p50 = parsed.length > 0 ? parsed[Math.floor(parsed.length / 2)]! : 0
    lines.push(
      `| ${b} | ${all.length} | ${parsed.length} | ${parsed.length > 0 ? fmt(mean) : '-'} | ${parsed.length > 0 ? fmt(p50) : '-'} |`,
    )
  }
  return lines.join('\n')
}

function tableMissingJudge(configs: ConfigSummary[]): string {
  // Welche configs haben gar keinen judge ODER konstant unparsed?
  const lines = [
    `## Judge-coverage warnings`,
    ``,
    `| Config | judge missing | judge unparsed | total records |`,
    `| ------ | -: | -: | -: |`,
  ]
  let any = false
  for (const c of configs) {
    const missing = c.records.filter((r) => r.judge === null).length
    const unparsed = c.records.filter((r) => r.judge && !r.judge.parsed).length
    if (missing > 0 || unparsed > c.records.length / 5) {
      lines.push(`| ${c.name} | ${missing} | ${unparsed} | ${c.records.length} |`)
      any = true
    }
  }
  if (!any) lines.push(`| — | — | — | alle configs sauber , kein warning |`)
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const runDir = resolve(args.runDir)
  const configs = await loadConfigs(runDir)
  if (configs.length === 0) {
    console.error(`[failure-patterns] keine configs in ${runDir}/configs/ gefunden`)
    process.exit(1)
  }
  const sections = [
    `# Failure-Pattern Report`,
    ``,
    `Run-Dir: ${runDir}`,
    `Configs: ${configs.length}`,
    `Total records: ${configs.reduce((s, c) => s + c.records.length, 0)}`,
    ``,
    tableAggregate(configs),
    ``,
    tableByIntent(configs),
    tableRankBucket(configs),
    ``,
    tableMissingJudge(configs),
    ``,
  ]
  const md = sections.join('\n')
  if (args.out) {
    await writeFile(args.out, md, 'utf-8')
    console.error(`[failure-patterns] geschrieben: ${args.out}`)
  } else {
    process.stdout.write(md)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
