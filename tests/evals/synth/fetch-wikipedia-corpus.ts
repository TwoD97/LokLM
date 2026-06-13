// fetch-wikipedia-corpus , baut einen offline-wissens-korpus aus kuratierten
// Wikipedia-artikeln für die RAG-eval. Spiegelt den #1-Tier-1-datensatz der
// LokLM-zielgruppe (Kiwix Wikipedia ZIM) , nur als sauberer plaintext-slice
// statt 110 GB ZIM.
//
// Warum Wikipedia-API statt ZIM/PDF:
//   - explaintext-extract liefert sauberen plaintext , kein OCR , kein
//     HTML-parsing , kein PDF-layout-müll.
//   - CC BY-SA 4.0 — license-konsistent mit dem schon committeten xquad-de.
//   - themenbar: ein curated title-set pro thema → fan-out pro thema bei der
//     fragen-generierung. Themen sind survival/referenz-lastig (erste hilfe ,
//     wasser/nahrung , krankheit/hygiene , navigation , wiederaufbau-technik) ,
//     damit der korpus dem geist der survival-library-liste folgt.
//
// Pipeline:
//   1. pro thema kuratierte titel via action-API extracts (explaintext) holen
//   2. end-sektionen (References/External links/…) abschneiden , whitespace
//      normalisieren
//   3. ein .txt pro artikel + manifest.json (provenienz/attribution) schreiben
//   4. deterministisch chunken (FixedSizeChunker 512/64) → chunks.json
//      { chunks: SourceChunk[] , byTheme: theme→docId[] , provenance }
//
// Die questions kommen NICHT von hier — die fabriziert der generierungs-
// workflow aus chunks.json. Hier entsteht nur der haystack + ground-truth-text.
//
// CLI:
//   tsx tests/evals/synth/fetch-wikipedia-corpus.ts
//     [--themes a,b]        nur diese themen (default: alle)
//     [--max-articles N]    cap artikel pro thema (pilot: z.B. 10)
//     [--lang en|de]        wikipedia-sprache (default en)
//     [--out <dir>]         ziel-dir (default data/corpora/wikipedia-survival[-<lang>])

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'
import type { SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

// polite UA — Wikimedia-API-etikette verlangt eine identifizierbare UA.
const USER_AGENT = 'LokLM-eval-corpus-builder/1.0 (https://github.com/loklm ; eval dataset build)'

// kuratierte themen → artikel-titel. Bewusst dichte , faktenreiche referenz-
// artikel im survival/practical-knowledge-spektrum. Titel sind EN-kanonisch ;
// redirects=1 fängt verschiebungen ab. Für --lang de werden dieselben themen
// über die langlinks NICHT automatisch übersetzt — DE braucht eine eigene
// titel-liste (TODO falls DE-eval gewünscht).
const TOPICS_EN: Record<string, string[]> = {
  'first-aid': [
    'First aid',
    'Cardiopulmonary resuscitation',
    'Choking',
    'Wound',
    'Bleeding',
    'Bone fracture',
    'Burn',
    'Hypothermia',
    'Heat stroke',
    'Dehydration',
    'Shock (circulatory)',
    'Anaphylaxis',
    'Tourniquet',
    'Recovery position',
    'Snakebite',
    'Frostbite',
    'Concussion',
    'Sprain',
    'Wound healing',
    'Cardiac arrest',
  ],
  'water-food': [
    'Water purification',
    'Portable water purification',
    'Water chlorination',
    'Solar water disinfection',
    'Boiling',
    'Food preservation',
    'Canning',
    'Drying (food)',
    'Fermentation in food processing',
    'Foraging',
    'Salting (food)',
    'Smoking (cooking)',
    'Pasteurization',
    'Food drying',
    'Root cellar',
  ],
  'disease-sanitation': [
    'Cholera',
    'Dysentery',
    'Malaria',
    'Tetanus',
    'Typhoid fever',
    'Oral rehydration therapy',
    'Sanitation',
    'Hand washing',
    'Sepsis',
    'Hygiene',
    'Waterborne diseases',
    'Antibiotic',
    'Wound infection',
    'Infection',
  ],
  'wilderness-navigation': [
    'Compass',
    'Orienteering',
    'Celestial navigation',
    'Knot',
    'Bowline',
    'Fire making',
    'Survival skills',
    'Navigation',
    'Dead reckoning',
    'Topographic map',
    'Map',
    'Bushcraft',
  ],
  'rebuild-tech': [
    'Soap',
    'Saponification',
    'Blacksmithing',
    'Solar power',
    'Electric battery',
    'Charcoal',
    'Lime (material)',
    'Concrete',
    'Windmill',
    'Water wheel',
    'Welding',
    'Internal combustion engine',
  ],
}

// end-sektionen die als reiner plaintext-header auf eigener zeile auftauchen.
// Wir schneiden den artikel beim ERSTEN treffer ab — alles danach ist
// referenz/navigations-müll ohne fakten-substanz.
const END_SECTIONS = [
  'References',
  'External links',
  'See also',
  'Further reading',
  'Notes',
  'Citations',
  'Bibliography',
  'Sources',
  'Footnotes',
  'Notes and references',
  'Explanatory notes',
]

interface Args {
  themes: string[] | null
  maxArticles: number | null
  lang: string
  out: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { themes: null, maxArticles: null, lang: 'en', out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--themes' && next !== undefined) {
      out.themes = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      i++
    } else if (a === '--max-articles' && next !== undefined) {
      out.maxArticles = Number(next)
      i++
    } else if (a === '--lang' && next !== undefined) {
      out.lang = next.trim().toLowerCase()
      i++
    } else if (a === '--out' && next !== undefined) {
      out.out = next
      i++
    }
  }
  return out
}

/** url-safer , dateisystem-safer docId aus einem artikel-titel. KEIN "::" (das
 *  ist der chunk-id-trenner) , kein whitespace , lowercase. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface ExtractResult {
  pageid: number
  title: string
  extract: string
}

async function fetchExtract(lang: string, title: string): Promise<ExtractResult | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'plain',
    redirects: '1',
    format: 'json',
    formatversion: '2',
    titles: title,
  })
  const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} für "${title}"`)
  const data = (await res.json()) as {
    query?: {
      pages?: Array<{ pageid?: number; title: string; extract?: string; missing?: boolean }>
    }
  }
  const page = data.query?.pages?.[0]
  if (!page || page.missing || !page.extract || typeof page.pageid !== 'number') {
    console.error(`  [skip] "${title}" — missing oder kein extract`)
    return null
  }
  return { pageid: page.pageid, title: page.title, extract: page.extract }
}

/** schneidet end-sektionen ab + normalisiert whitespace. */
function cleanExtract(raw: string): string {
  let cut = raw.length
  for (const sec of END_SECTIONS) {
    // header steht als eigene zeile (explaintext) — exakter zeilen-match.
    const re = new RegExp(`^${sec}\\s*$`, 'm')
    const m = re.exec(raw)
    if (m && m.index < cut) cut = m.index
  }
  return raw
    .slice(0, cut)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface ArticleProvenance {
  docId: string
  theme: string
  title: string
  pageid: number
  url: string
  chars: number
  chunks: number
}

interface ChunksFile {
  source: {
    project: string
    lang: string
    license: string
    cite: string
    fetchedAt: string
  }
  chunker: string
  byTheme: Record<string, string[]>
  articles: ArticleProvenance[]
  chunks: SourceChunk[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const topics = TOPICS_EN // nur EN kuratiert ; DE bräuchte eigene liste
  if (args.lang !== 'en') {
    console.error(
      `[warn] --lang ${args.lang}: titel-liste ist EN-kuratiert , ` +
        `redirects/langlinks übersetzen nicht automatisch. DE braucht eigene TOPICS.`,
    )
  }

  const wantThemes = args.themes ?? Object.keys(topics)
  const unknown = wantThemes.filter((t) => !(t in topics))
  if (unknown.length > 0) {
    throw new Error(
      `unbekannte themen: ${unknown.join(', ')} — bekannt: ${Object.keys(topics).join(', ')}`,
    )
  }

  const outDir =
    args.out ??
    join(
      __dirname,
      '..',
      'data',
      'corpora',
      args.lang === 'en' ? 'wikipedia-survival' : `wikipedia-survival-${args.lang}`,
    )
  await mkdir(outDir, { recursive: true })

  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })
  const allChunks: SourceChunk[] = []
  const articles: ArticleProvenance[] = []
  const byTheme: Record<string, string[]> = {}
  const seenDocIds = new Set<string>()

  for (const theme of wantThemes) {
    let titles = topics[theme]!
    if (args.maxArticles !== null) titles = titles.slice(0, args.maxArticles)
    byTheme[theme] = []
    console.error(`\n[theme] ${theme} — ${titles.length} artikel`)

    for (const title of titles) {
      const got = await fetchExtract(args.lang, title)
      if (!got) continue
      const cleaned = cleanExtract(got.extract)
      if (cleaned.length < 400) {
        console.error(`  [skip] "${got.title}" — nach cleanup zu kurz (${cleaned.length})`)
        continue
      }
      const docId = slugify(got.title)
      // kollisions-schutz (zwei titel die zum selben slug werden).
      if (seenDocIds.has(docId)) {
        console.error(`  [skip] "${got.title}" — docId "${docId}" doppelt`)
        continue
      }
      seenDocIds.add(docId)

      await writeFile(join(outDir, `${docId}.txt`), cleaned, 'utf-8')
      const chunks = chunker.chunk({ id: docId, text: cleaned })
      allChunks.push(...chunks)
      const url = `https://${args.lang}.wikipedia.org/?curid=${got.pageid}`
      articles.push({
        docId,
        theme,
        title: got.title,
        pageid: got.pageid,
        url,
        chars: cleaned.length,
        chunks: chunks.length,
      })
      byTheme[theme]!.push(docId)
      console.error(`  [ok] ${docId} — ${cleaned.length} chars , ${chunks.length} chunks`)

      // höflich gegenüber der API — kleine pause zwischen requests.
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  const chunksFile: ChunksFile = {
    source: {
      project: `${args.lang}.wikipedia.org`,
      lang: args.lang,
      license: 'CC BY-SA 4.0',
      cite: 'Wikipedia contributors , the free encyclopedia , https://www.wikipedia.org',
      fetchedAt: new Date().toISOString(),
    },
    chunker: chunker.name,
    byTheme,
    articles,
    chunks: allChunks,
  }
  const chunksPath = join(outDir, 'chunks.json')
  await writeFile(chunksPath, JSON.stringify(chunksFile, null, 2), 'utf-8')

  // manifest separat (nur provenienz , klein , leicht zu lesen/committen).
  const manifestPath = join(outDir, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({ source: chunksFile.source, byTheme, articles }, null, 2),
    'utf-8',
  )

  console.error(`\n[done] ${articles.length} artikel , ${allChunks.length} chunks`)
  console.error(`[done] chunks:   ${chunksPath}`)
  console.error(`[done] manifest: ${manifestPath}`)
  if (existsSync(chunksPath)) {
    const themesSummary = Object.entries(byTheme)
      .map(([t, ds]) => `${t}=${ds.length}`)
      .join(' , ')
    console.error(`[done] themen: ${themesSummary}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
