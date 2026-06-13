// download-flores , holt den FLORES-200 devtest-slice für die translation-eval.
//
// Quelle: haoranxu/FLORES-200 (öffentlicher HF-mirror des ALMA-papers ,
// parquet per sprachpaar , 1012 devtest-zeilen). Wir laden pro sprache nur
// das xx-en file — FLORES ist multi-parallel , beide richtungen kommen aus
// demselben satzpaar (src/ref getauscht).
//
// Output: data/flores200-slice.json (gitignored , CC-BY-SA-4.0). Deterministisch:
// gleiche indizes für alle sprachen via strideIndices() , damit läufe über
// zeit vergleichbar bleiben solange n gleich ist.
//
// CLI:
//   tsx tests/evals/translation/download-flores.ts [--n 100] [--langs de,fr] [--out <path>]

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from 'hyparquet'
import { DEFAULT_SAMPLE_SIZE, LANGUAGES, strideIndices, type EvalLanguage } from './languages'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIRROR = 'haoranxu/FLORES-200'
const parquetUrl = (code: string): string =>
  `https://huggingface.co/datasets/${MIRROR}/resolve/main/${code}-en/test-00000-of-00001.parquet`

export interface SliceRow {
  /** zeilen-index im originalen devtest (0-basiert) — stabil über läufe. */
  ix: number
  en: string
  xx: string
}

export interface SliceLanguage extends EvalLanguage {
  rows: SliceRow[]
}

export interface FloresSlice {
  source: string
  fetchedAt: string
  sampleSize: number
  totalRows: number
  languages: Record<string, SliceLanguage>
}

export function defaultSlicePath(): string {
  return join(__dirname, 'data', 'flores200-slice.json')
}

async function fetchLanguage(lang: EvalLanguage, indices: number[]): Promise<SliceLanguage> {
  const url = parquetUrl(lang.code)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${lang.code}: HTTP ${res.status} für ${url}`)
  const file = await res.arrayBuffer()
  // spalten-name im mirror ist das sprachpaar selbst , z.b. { "de-en": { de, en } }.
  const records = (await parquetReadObjects({ file })) as Array<
    Record<string, Record<string, string>>
  >
  const rows: SliceRow[] = []
  for (const ix of indices) {
    const t = records[ix]?.[`${lang.code}-en`]
    const en = t?.['en']
    const xx = t?.[lang.code]
    if (typeof en !== 'string' || typeof xx !== 'string') {
      throw new Error(`${lang.code}: zeile ${ix} hat kein {en, ${lang.code}} paar`)
    }
    rows.push({ ix, en: en.trim(), xx: xx.trim() })
  }
  return { ...lang, rows }
}

interface Args {
  n: number
  langs: string[] | null
  out: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = { n: DEFAULT_SAMPLE_SIZE, langs: null, out: defaultSlicePath() }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--n' && next !== undefined) {
      out.n = Number(next)
      i++
    } else if (a === '--langs' && next !== undefined) {
      out.langs = next.split(',').map((s) => s.trim().toLowerCase())
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    }
  }
  if (!Number.isInteger(out.n) || out.n < 1) throw new Error(`--n muss eine zahl >= 1 sein`)
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const wanted = args.langs ? LANGUAGES.filter((l) => args.langs!.includes(l.code)) : LANGUAGES
  if (wanted.length === 0) {
    throw new Error(`--langs matcht keine sprache aus languages.ts (${args.langs?.join(',')})`)
  }

  // erst eine sprache laden um die zeilen-anzahl zu kennen , dann die
  // stride-indizes EINMAL berechnen und für alle wiederverwenden.
  console.error(`[flores] mirror ${MIRROR} , ${wanted.length} sprachen , n=${args.n}`)
  const first = wanted[0]!
  const probeRes = await fetch(parquetUrl(first.code))
  if (!probeRes.ok) throw new Error(`probe ${first.code}: HTTP ${probeRes.status}`)
  const probeBuf = await probeRes.arrayBuffer()
  const probeRecords = (await parquetReadObjects({ file: probeBuf })) as Array<
    Record<string, Record<string, string>>
  >
  const totalRows = probeRecords.length
  const indices = strideIndices(totalRows, args.n)
  console.error(`[flores] devtest hat ${totalRows} zeilen , sample ${indices.length}`)

  const languages: Record<string, SliceLanguage> = {}
  // erste sprache aus dem probe-buffer , rest sequenziell (HF mag keine
  // 17 parallelen range-requests von anonym , und 200 KB/file ist eh schnell).
  {
    const rows: SliceRow[] = indices.map((ix) => {
      const t = probeRecords[ix]![`${first.code}-en`]
      if (!t?.['en'] || !t[first.code]) {
        throw new Error(`${first.code}: zeile ${ix} hat kein {en, ${first.code}} paar`)
      }
      return { ix, en: t['en'].trim(), xx: t[first.code]!.trim() }
    })
    languages[first.code] = { ...first, rows }
    console.error(`[flores] ${first.code} ok (probe)`)
  }
  for (const lang of wanted.slice(1)) {
    languages[lang.code] = await fetchLanguage(lang, indices)
    console.error(`[flores] ${lang.code} ok`)
  }

  const slice: FloresSlice = {
    source: MIRROR,
    fetchedAt: new Date().toISOString(),
    sampleSize: indices.length,
    totalRows,
    languages,
  }
  await mkdir(dirname(args.out), { recursive: true })
  await writeFile(args.out, JSON.stringify(slice, null, 1), 'utf-8')
  const segments = Object.keys(languages).length * indices.length
  console.error(`[flores] geschrieben: ${args.out} (${segments} satzpaare)`)
}

// nur als CLI ausführen — run-pack/run-translation importieren defaultSlicePath
// + typen von hier , dabei darf kein download losgehen.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
