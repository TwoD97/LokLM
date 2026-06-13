// report , baut summary.md + summary.json aus einem translation-run.
//
// Liest configs/<label>/result.json (chrF , vom worker) und — falls der
// COMET-pass schon gelaufen ist — configs/<label>/comet-scores.json. Kann
// also zweimal laufen: direkt nach dem pack-run (nur chrF) und nochmal nach
// score_comet.py (dann mit COMET-matrix + COMET-basierten verdicts).
//
// Verdict-logik: pro ship-tier (lite/standard/pro) gegen die beste baseline
// (gemma , q6 bevorzugt) in der en→xx-richtung — das ist der LokLM-fall
// "antwort in der sprache des users". Eine sprache gilt als fallback-fall
// wenn die baseline um mehr als COMET_DELTA / CHRF_DELTA vorne liegt , und
// als kaputt wenn das tier-modell unter dem absolut-floor liegt.
//
// CLI:
//   tsx tests/evals/translation/report.ts [--run-dir <dir>]   (default: letzter run)

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useRunDir } from '../runDir'
import { LANGUAGES, languageOf } from './languages'
import type { TranslationResult } from './run-translation'
import type { TranslationPack } from './run-pack'

const __dirname = dirname(fileURLToPath(import.meta.url))

// deltas ab denen der fallback-download als gerechtfertigt gilt. COMET-deltas
// ab ~0.02-0.03 sind in WMT-metaevals als "human-wahrnehmbar" etabliert ;
// chrF ist gröber , da erst ab ~3 punkten reden. Floors markieren "kaputt
// unabhängig vom vergleich" (chrF < 30 ist in der MT-praxis kaum brauchbar).
const COMET_DELTA = 0.03
const CHRF_DELTA = 3
const COMET_FLOOR = 0.75
const CHRF_FLOOR = 30

interface CometScores {
  model: string
  directions: Record<string, { mean: number; n: number }>
}

interface ConfigData {
  label: string
  tier: string
  result: TranslationResult
  comet: CometScores | null
}

interface Verdict {
  tier: string
  model: string
  baseline: string
  metric: 'comet' | 'chrf'
  /** sprachen wo die baseline um mehr als den delta-threshold vorne liegt. */
  fallbackLangs: Array<{ lang: string; model: number; baseline: number }>
  /** sprachen unterm absolut-floor (kaputt , egal was die baseline macht). */
  brokenLangs: Array<{ lang: string; value: number }>
}

export async function buildReport(
  runRootDir: string,
): Promise<{ markdown: string; json: unknown }> {
  const pack = await readPack(runRootDir)
  const configs = await readConfigs(runRootDir, pack)
  if (configs.length === 0) {
    return {
      markdown: `# Translation-Eval\n\nkeine results unter ${runRootDir}/configs\n`,
      json: {},
    }
  }

  const hasComet = configs.some((c) => c.comet !== null)
  const langs = presentLanguages(configs)
  const lines: string[] = []
  lines.push(`# Translation-Eval (FLORES-200 devtest)`)
  lines.push(``)
  lines.push(`- Run-Dir: ${runRootDir}`)
  lines.push(
    `- Sample: ${configs[0]!.result.sampleSize} sätze/richtung , noThink , greedy-default-sampling`,
  )
  lines.push(
    `- Scoring: chrF++ (TS , sofort)${hasComet ? ' + COMET wmt22-comet-da' : ' — COMET-pass fehlt noch (comet/score_comet.py)'}`,
  )
  lines.push(``)
  lines.push(`## Modelle`)
  lines.push(``)
  lines.push(`| Label | Tier | Datei | Laufzeit |`)
  lines.push(`| ----- | ---- | ----- | -------: |`)
  for (const c of configs) {
    const file = c.result.modelPath.split(/[\\/]/).pop()
    lines.push(`| ${c.label} | ${c.tier} | ${file} | ${Math.round(c.result.totalMs / 60000)} min |`)
  }
  lines.push(``)

  if (hasComet) {
    lines.push(
      ...matrixSection(
        'COMET (en→xx , antwort-sprache des users)',
        configs,
        langs,
        'en-xx',
        'comet',
      ),
    )
    lines.push(...matrixSection('COMET (xx→en , verständnis)', configs, langs, 'xx-en', 'comet'))
  }
  lines.push(...matrixSection('chrF++ (en→xx)', configs, langs, 'en-xx', 'chrf'))
  lines.push(...matrixSection('chrF++ (xx→en)', configs, langs, 'xx-en', 'chrf'))

  const verdicts = buildVerdicts(configs, langs, hasComet)
  lines.push(`## Verdicts — lohnt sich der Gemma-fallback-download?`)
  lines.push(``)
  if (verdicts.length === 0) {
    lines.push(`keine tier-modelle oder keine baseline im pack — keine verdicts.`)
  }
  for (const v of verdicts) {
    const metricName = v.metric === 'comet' ? 'COMET' : 'chrF++'
    const delta = v.metric === 'comet' ? COMET_DELTA : CHRF_DELTA
    lines.push(`### ${v.tier} (${v.model}) vs ${v.baseline} — ${metricName} , en→xx`)
    lines.push(``)
    if (v.fallbackLangs.length === 0 && v.brokenLangs.length === 0) {
      lines.push(`kein fallback nötig: keine sprache mit delta > ${delta} , kein floor-breach.`)
    }
    if (v.fallbackLangs.length > 0) {
      lines.push(`fallback lohnt sich für (baseline um > ${delta} vorne):`)
      lines.push(``)
      for (const f of v.fallbackLangs) {
        lines.push(
          `- **${f.lang}**: ${fmt(f.model, v.metric)} vs ${fmt(f.baseline, v.metric)} (baseline)`,
        )
      }
    }
    if (v.brokenLangs.length > 0) {
      lines.push(``)
      lines.push(
        `unterm absolut-floor (${v.metric === 'comet' ? COMET_FLOOR : CHRF_FLOOR}) , quasi unbrauchbar:`,
      )
      lines.push(``)
      for (const b of v.brokenLangs) lines.push(`- **${b.lang}**: ${fmt(b.value, v.metric)}`)
    }
    lines.push(``)
  }
  if (!hasComet) {
    lines.push(
      `> verdicts basieren noch auf chrF++. Für die finale entscheidung den COMET-pass laufen lassen` +
        ` (siehe README) und den report neu bauen — COMET korreliert deutlich besser mit human judgment.`,
    )
    lines.push(``)
  }

  const json = {
    runDir: runRootDir,
    sampleSize: configs[0]!.result.sampleSize,
    hasComet,
    models: configs.map((c) => ({ label: c.label, tier: c.tier, modelPath: c.result.modelPath })),
    scores: Object.fromEntries(
      configs.map((c) => [
        c.label,
        {
          chrf: Object.fromEntries(c.result.perDirection.map((d) => [d.direction, d.chrf])),
          comet: c.comet
            ? Object.fromEntries(Object.entries(c.comet.directions).map(([d, s]) => [d, s.mean]))
            : null,
          meanMs: Object.fromEntries(c.result.perDirection.map((d) => [d.direction, d.meanMs])),
        },
      ]),
    ),
    verdicts,
    thresholds: { COMET_DELTA, CHRF_DELTA, COMET_FLOOR, CHRF_FLOOR },
  }
  return { markdown: lines.join('\n') + '\n', json }
}

function fmt(value: number, metric: 'comet' | 'chrf'): string {
  return metric === 'comet' ? value.toFixed(4) : value.toFixed(1)
}

function score(c: ConfigData, direction: string, metric: 'comet' | 'chrf'): number | null {
  if (metric === 'comet') {
    const s = c.comet?.directions[direction]
    return s ? s.mean : null
  }
  const d = c.result.perDirection.find((x) => x.direction === direction)
  return d ? d.chrf : null
}

function matrixSection(
  title: string,
  configs: ConfigData[],
  langs: string[],
  directionClass: 'en-xx' | 'xx-en',
  metric: 'comet' | 'chrf',
): string[] {
  const out: string[] = []
  out.push(`## ${title}`)
  out.push(``)
  out.push(`| Sprache | ${configs.map((c) => c.label).join(' | ')} |`)
  out.push(`| ------- | ${configs.map(() => '-:').join(' | ')} |`)
  for (const code of langs) {
    const direction = directionClass === 'en-xx' ? `en-${code}` : `${code}-en`
    const lang = languageOf(direction)
    // bestwert der zeile fett — macht die matrix auf einen blick lesbar.
    const values = configs.map((c) => score(c, direction, metric))
    const best = Math.max(...values.filter((v): v is number => v !== null))
    const cells = values.map((v) =>
      v === null ? '-' : v === best ? `**${fmt(v, metric)}**` : fmt(v, metric),
    )
    out.push(`| ${lang.label} (${code}) | ${cells.join(' | ')} |`)
  }
  out.push(``)
  return out
}

function buildVerdicts(configs: ConfigData[], langs: string[], hasComet: boolean): Verdict[] {
  const baselines = configs.filter((c) => c.tier === 'baseline')
  if (baselines.length === 0) return []
  // q6 ist der eigentliche download-kandidat — bevorzugen wenn gelaufen.
  const baseline = baselines.find((c) => /q6/i.test(c.label)) ?? baselines[0]!
  const tiers = configs.filter((c) => c.tier !== 'baseline')

  const verdicts: Verdict[] = []
  for (const tierModel of tiers) {
    // COMET nur verwenden wenn BEIDE seiten gescort sind , sonst chrF.
    const metric: 'comet' | 'chrf' =
      hasComet && tierModel.comet && baseline.comet ? 'comet' : 'chrf'
    const deltaMin = metric === 'comet' ? COMET_DELTA : CHRF_DELTA
    const floor = metric === 'comet' ? COMET_FLOOR : CHRF_FLOOR
    const fallbackLangs: Verdict['fallbackLangs'] = []
    const brokenLangs: Verdict['brokenLangs'] = []
    for (const code of langs) {
      const direction = `en-${code}`
      const lang = languageOf(direction)
      const own = score(tierModel, direction, metric)
      const base = score(baseline, direction, metric)
      if (own === null) continue
      if (own < floor) brokenLangs.push({ lang: `${lang.label} (${code})`, value: own })
      if (base !== null && base - own > deltaMin) {
        fallbackLangs.push({ lang: `${lang.label} (${code})`, model: own, baseline: base })
      }
    }
    verdicts.push({
      tier: tierModel.tier,
      model: tierModel.label,
      baseline: baseline.label,
      metric,
      fallbackLangs,
      brokenLangs,
    })
  }
  return verdicts
}

async function readPack(runRootDir: string): Promise<TranslationPack | null> {
  const p = join(runRootDir, 'pack.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf-8')) as TranslationPack
  } catch {
    return null
  }
}

async function readConfigs(
  runRootDir: string,
  pack: TranslationPack | null,
): Promise<ConfigData[]> {
  const configsRoot = join(runRootDir, 'configs')
  if (!existsSync(configsRoot)) return []
  const subdirs = (await readdir(configsRoot, { withFileTypes: true })).filter((d) =>
    d.isDirectory(),
  )
  const out: ConfigData[] = []
  for (const d of subdirs) {
    const resultPath = join(configsRoot, d.name, 'result.json')
    if (!existsSync(resultPath)) continue
    try {
      const result = JSON.parse(await readFile(resultPath, 'utf-8')) as TranslationResult
      const cometPath = join(configsRoot, d.name, 'comet-scores.json')
      const comet = existsSync(cometPath)
        ? (JSON.parse(await readFile(cometPath, 'utf-8')) as CometScores)
        : null
      const tier =
        pack?.models.find((m) => m.label === result.label)?.tier ??
        (/gemma/i.test(result.label) ? 'baseline' : 'unknown')
      out.push({ label: result.label, tier, result, comet })
    } catch {
      /* malformed config überspringen statt den ganzen report zu killen */
    }
  }
  // pack-reihenfolge beibehalten (tiers zuerst , baselines hinten) statt readdir-alphabet.
  if (pack) {
    const order = new Map(pack.models.map((m, i) => [m.label, i]))
    out.sort((a, b) => (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99))
  }
  return out
}

/** sprachen die in mindestens einem result vorkommen , in LANGUAGES-reihenfolge. */
function presentLanguages(configs: ConfigData[]): string[] {
  const present = new Set<string>()
  for (const c of configs) {
    for (const d of c.result.perDirection) present.add(languageOf(d.direction).code)
  }
  return LANGUAGES.filter((l) => present.has(l.code)).map((l) => l.code)
}

async function latestRunDir(): Promise<string> {
  const root = join(__dirname, '..', 'report', 'translation-runs')
  if (!existsSync(root)) throw new Error(`${root} existiert nicht — erst pnpm evals:translation`)
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  if (dirs.length === 0) throw new Error(`keine runs unter ${root}`)
  return join(root, dirs[dirs.length - 1]!)
}

async function main(): Promise<void> {
  let runDir: string | null = null
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run-dir' && argv[i + 1] !== undefined) runDir = resolve(argv[i + 1]!)
  }
  const dir = runDir ?? (await latestRunDir())
  const { markdown, json } = await buildReport(dir)
  const handle = await useRunDir(dir)
  await handle.writeSummary(markdown, json)
  console.error(`[report] ${join(dir, 'summary.md')}`)
}

// nur als CLI ausführen wenn direkt aufgerufen — run-pack importiert buildReport.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
