// run-translation , single-model worker der translation-eval.
//
// Läuft als kindprozess des orchestrators (run-pack.ts) — gleiche begründung
// wie bei answer/run-pack: node-llama-cpp leaked state über load/unload-zyklen
// (ACCESS_VIOLATION nach modell 4-5) , also ein prozess pro modell.
//
// Pro sprache zwei richtungen: en→xx ("kann das modell in sprache X schreiben" —
// der LokLM-fall: antwort in der sprache des users) und xx→en (verständnis).
// Jeder satz ist ein eigener generateRaw-call mit noThink (mirrort den
// produktions-chat-pfad , der thinking ebenfalls via budget abdreht).
//
// Output (runDir-konvention , configs/<label>/):
//   per-question.jsonl   eine zeile pro satz: {direction, ix, src, ref, hyp, ms}
//   result.json          chrF++ pro richtung + timing
//
// Resume: existierende (direction, ix)-paare in per-question.jsonl werden
// übersprungen — ein crash mitten im lauf kostet nur den angefangenen satz.
//
// CLI:
//   tsx tests/evals/translation/run-translation.ts
//     --model <gguf> --label <name> --run-dir <dir>
//     [--slice <path>] [--limit <n>] [--langs de,fr] [--placement auto|cpu]
//     [--context 4096]

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LlmBridge } from '../bridges/LlmBridge'
import type { Placement } from '../bridges/common'
import { useRunDir } from '../runDir'
import { chrfCorpus } from './chrf'
import { defaultSlicePath, type FloresSlice } from './download-flores'
import { directionsFor, type Direction } from './languages'

// die format-anweisung steht AUCH im user-prompt (buildTranslationPrompt) —
// gemma-3-it gewichtet den system-prompt schwach und liefert sonst
// "Here are a few options..." mit drei varianten + erklär-prosa , was chrF/
// COMET als sprachversagen werten würden obwohl nur das format daneben ist.
const TRANSLATION_SYSTEM_PROMPT = [
  'You are a professional translator.',
  'Translate the text exactly as given.',
  'Output only the translation — no explanations, no notes, no quotation marks around it.',
].join(' ')

export function buildTranslationPrompt(srcName: string, tgtName: string, text: string): string {
  return (
    `Translate the following text from ${srcName} to ${tgtName}. ` +
    `Reply with ONLY the ${tgtName} translation — exactly one translation , ` +
    `no alternatives , no options , no explanations , no notes.\n\n${text}`
  )
}

export interface SegmentRecord {
  direction: Direction
  /** devtest-zeilen-index , stabil über läufe (siehe download-flores). */
  ix: number
  src: string
  ref: string
  hyp: string
  ms: number
}

export interface DirectionResult {
  direction: Direction
  n: number
  chrf: number
  meanMs: number
}

export interface TranslationResult {
  label: string
  modelPath: string
  contextSize: number
  placement: Placement
  sampleSize: number
  noThink: boolean
  startedAt: string
  totalMs: number
  perDirection: DirectionResult[]
}

interface Args {
  model: string
  label: string
  runDir: string
  slice: string
  limit: number | null
  langs: string[] | null
  placement: Placement
  context: number
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    slice: defaultSlicePath(),
    limit: null,
    langs: null,
    placement: 'auto',
    context: 4096,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--model' && next !== undefined) {
      out.model = resolve(next)
      i++
    } else if (a === '--label' && next !== undefined) {
      out.label = next
      i++
    } else if (a === '--run-dir' && next !== undefined) {
      out.runDir = resolve(next)
      i++
    } else if (a === '--slice' && next !== undefined) {
      out.slice = resolve(next)
      i++
    } else if (a === '--limit' && next !== undefined) {
      out.limit = Number(next)
      i++
    } else if (a === '--langs' && next !== undefined) {
      out.langs = next.split(',').map((s) => s.trim().toLowerCase())
      i++
    } else if (a === '--placement' && next !== undefined) {
      out.placement = next as Placement
      i++
    } else if (a === '--context' && next !== undefined) {
      out.context = Number(next)
      i++
    }
  }
  if (!out.model || !out.label || !out.runDir) {
    throw new Error('--model , --label und --run-dir sind required')
  }
  return out as Args
}

/** modelle labeln ihren output trotz system-prompt gern mit "Translation:" —
 *  das ist kein übersetzungsfehler , also runter damit bevor gescort wird.
 *  Mehr post-processing machen wir bewusst NICHT (gleiches treatment für
 *  alle modelle , und COMET/chrF bestrafen extra-geschwätz zu recht). */
export function cleanHypothesis(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^(translation|übersetzung)\s*:\s*/i, '')
  return text.trim()
}

async function readDone(perQuestionPath: string): Promise<Set<string>> {
  const done = new Set<string>()
  if (!existsSync(perQuestionPath)) return done
  const body = await readFile(perQuestionPath, 'utf-8')
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line) as SegmentRecord
      done.add(`${rec.direction}:${rec.ix}`)
    } catch {
      /* halbe zeile vom crash , wird neu übersetzt */
    }
  }
  return done
}

async function readAll(perQuestionPath: string): Promise<SegmentRecord[]> {
  const body = await readFile(perQuestionPath, 'utf-8')
  const out: SegmentRecord[] = []
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as SegmentRecord)
    } catch {
      /* skip */
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const slice = JSON.parse(await readFile(args.slice, 'utf-8')) as FloresSlice
  const langs = Object.values(slice.languages).filter(
    (l) => !args.langs || args.langs.includes(l.code),
  )
  if (langs.length === 0) throw new Error(`--langs matcht keine sprache im slice`)

  const handle = await useRunDir(args.runDir)
  const writer = handle.configWriter(args.label)
  const perQuestionPath = join(writer.rootDir, 'per-question.jsonl')
  const done = await readDone(perQuestionPath)
  if (done.size > 0) console.error(`[translate] resume: ${done.size} segmente schon da`)

  const bridge = new LlmBridge({
    modelPath: args.model,
    contextSize: args.context,
    placement: args.placement,
    systemPrompt: TRANSLATION_SYSTEM_PROMPT,
    label: args.label,
  })

  const startedAt = new Date().toISOString()
  const t0 = performance.now()
  let segmentsRun = 0

  for (const lang of langs) {
    const rows = args.limit !== null ? lang.rows.slice(0, args.limit) : lang.rows
    for (const direction of directionsFor(lang.code)) {
      const intoEnglish = direction.endsWith('-en')
      const srcName = intoEnglish ? lang.promptName : 'English'
      const tgtName = intoEnglish ? 'English' : lang.promptName
      let dirRun = 0
      for (const row of rows) {
        if (done.has(`${direction}:${row.ix}`)) continue
        const src = intoEnglish ? row.xx : row.en
        const ref = intoEnglish ? row.en : row.xx
        const prompt = buildTranslationPrompt(srcName, tgtName, src)
        const s0 = performance.now()
        const raw = await bridge.generateRaw(prompt, { maxTokens: 512, noThink: true })
        const ms = Math.round(performance.now() - s0)
        const rec: SegmentRecord = {
          direction,
          ix: row.ix,
          src,
          ref,
          hyp: cleanHypothesis(raw),
          ms,
        }
        await writer.appendPerQuestion(rec)
        segmentsRun++
        dirRun++
      }
      console.error(
        `[translate] ${args.label} ${direction}: ${dirRun} neu , ${rows.length - dirRun} resumed`,
      )
    }
  }
  // WICHTIG: result.json MUSS vor dem entladen geschrieben werden. node-llama-cpp
  // crasht auf windows beim CUDA-context-dispose nach einem langen lauf NATIV
  // (exit 0xC0000409 , ggml-cuda.cu:98) — ein fast-fail den JS nicht try/catchen
  // kann , er killt den ganzen prozess. Die per-question.jsonl ist da streaming
  // schon komplett , aber result.json ginge verloren. Also: erst scoren + result
  // schreiben , dann erst (best-effort) entladen.

  // chrF über ALLE records (inkl. resumed) , pro richtung.
  const records = await readAll(perQuestionPath)
  const byDirection = new Map<Direction, SegmentRecord[]>()
  for (const rec of records) {
    const list = byDirection.get(rec.direction) ?? []
    list.push(rec)
    byDirection.set(rec.direction, list)
  }
  const perDirection: DirectionResult[] = [...byDirection.entries()]
    .map(([direction, recs]) => ({
      direction,
      n: recs.length,
      chrf: Math.round(chrfCorpus(recs) * 100) / 100,
      meanMs: Math.round(recs.reduce((s, r) => s + r.ms, 0) / recs.length),
    }))
    .sort((a, b) => a.direction.localeCompare(b.direction))

  const result: TranslationResult = {
    label: args.label,
    modelPath: args.model,
    contextSize: args.context,
    placement: args.placement,
    sampleSize: slice.sampleSize,
    noThink: true,
    startedAt,
    totalMs: Math.round(performance.now() - t0),
    perDirection,
  }
  await writer.writeResult(result)
  console.error(
    `[translate] ${args.label} fertig: ${segmentsRun} segmente neu , ` +
      `${perDirection.length} richtungen , ${Math.round(result.totalMs / 1000)}s`,
  )

  // sauberer exit OHNE auf den dispose zu warten. der worker ist ein
  // wegwerf-prozess (crash-isolation , ein modell pro prozess) — beim exit
  // gibt das OS die VRAM frei , der nächste model-worker startet eh frisch.
  // Wir umgehen damit den nativen CUDA-cleanup-crash komplett: result.json
  // ist schon sicher auf disk , exit 0 macht den lauf für den orchestrator
  // als erfolg sichtbar.
  void bridge.unload().catch(() => {})
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
