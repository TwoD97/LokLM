import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FixedSizeChunker } from '../pipeline/Chunker'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { OllamaDocGenerator } from './OllamaDocGenerator'
import { AnthropicDocGenerator } from './AnthropicDocGenerator'
import type { DocumentGenerator, TopicSeed } from './DocumentGenerator'
import type { SourceChunk } from '../synth/QuestionGenerator'

// build-library , CLI:
//   tsx tests/evals/scale/build-library.ts [--size tiny|small|medium|large]
//                                          [--provider ollama|anthropic]
//                                          [--resume]
//
// generiert distractor-docs bis die ziel-chunk-anzahl erreicht ist und
// schreibt tests/evals/data/libraries/<size>.json. mit --resume liest es
// eine vorhandene library und füllt nur die fehlenden chunks nach.

interface SizePreset {
  name: string
  targetChunks: number
}

const SIZES: Record<string, SizePreset> = {
  tiny: { name: 'tiny', targetChunks: 50 },
  small: { name: 'small', targetChunks: 500 },
  medium: { name: 'medium', targetChunks: 5_000 },
  large: { name: 'large', targetChunks: 50_000 },
}

interface Library {
  size: string
  generator: string
  generatedAt: string
  chunker: string
  chunks: SourceChunk[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const preset = SIZES[args.size ?? 'tiny']
  if (!preset) throw new Error(`unbekannte size: ${args.size}`)

  const provider = args.provider ?? 'ollama'
  const generator = buildGenerator(provider)
  const chunker = new FixedSizeChunker({ name: 'fixed-512-64', size: 512, overlap: 64 })

  const outDir = join(__dirname, '..', 'data', 'libraries')
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${preset.name}.json`)

  let chunks: SourceChunk[] = []
  let docIndex = 0
  if (args.resume && (await exists(outPath))) {
    const existing = JSON.parse(await readFile(outPath, 'utf-8')) as Library
    chunks = existing.chunks
    docIndex = countExistingDocs(chunks)
    console.error(`resume: ${chunks.length} chunks aus ${docIndex} docs schon da`)
  }

  console.error(`ziel: ${preset.targetChunks} chunks , provider: ${generator.name}`)

  while (chunks.length < preset.targetChunks) {
    const seed = nextSeed(docIndex)
    docIndex++
    console.error(
      `[${chunks.length}/${preset.targetChunks}] doc ${seed.id} (${seed.topic.slice(0, 60)}...)`,
    )
    let text: string
    try {
      text = await generator.generate(seed)
    } catch (err) {
      console.error(`  fehler , skip: ${(err as Error).message}`)
      continue
    }
    if (text.length < 200) {
      console.error(`  zu kurz (${text.length} chars) , skip`)
      continue
    }
    const newChunks = chunker.chunk({ id: seed.id, text })
    chunks.push(...newChunks)

    // jede 10 docs persistieren damit unterbrechungen nicht alles kosten
    if (docIndex % 10 === 0) {
      await persist(outPath, preset, generator.name, chunker.name, chunks)
    }
  }

  // auf ziel-anzahl trimmen damit der report sauber ist
  chunks = chunks.slice(0, preset.targetChunks)
  await persist(outPath, preset, generator.name, chunker.name, chunks)
  console.error(`geschrieben: ${outPath}`)
  console.error(`chunks: ${chunks.length} aus ${docIndex} docs`)
}

async function persist(
  outPath: string,
  preset: SizePreset,
  generatorName: string,
  chunkerName: string,
  chunks: SourceChunk[],
): Promise<void> {
  const lib: Library = {
    size: preset.name,
    generator: generatorName,
    generatedAt: new Date().toISOString(),
    chunker: chunkerName,
    chunks,
  }
  await writeFile(outPath, JSON.stringify(lib, null, 2), 'utf-8')
}

function buildGenerator(provider: string): DocumentGenerator {
  if (provider === 'ollama') return new OllamaDocGenerator()
  if (provider === 'anthropic') return new AnthropicDocGenerator()
  throw new Error(`unbekannter provider: ${provider}`)
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function countExistingDocs(chunks: SourceChunk[]): number {
  const ids = new Set(chunks.map((c) => c.docId))
  return ids.size
}

// rotierender pool an topic-seeds. die topics sind bewusst weit weg von
// LokLM-architektur , RAG-grundlagen und eval-metriken (= die themen der
// echten sample-docs) , damit die distractors keine antworten zu unseren
// eval-fragen enthalten.
const TOPIC_POOL: Array<{ topic: string; style?: string }> = [
  { topic: 'die geschichte der wiener kaffeehauskultur' },
  { topic: 'wie funktioniert ein elektrisches gitarrenpedal mit verzerrung' },
  { topic: 'pflege von obstbäumen im hochsommer' },
  { topic: 'grundlagen der gezeitenenergie an der nordsee' },
  { topic: 'das ökosystem der bayerischen alpenseen' },
  { topic: 'wie bienen ihren stock klimatisieren' },
  { topic: 'einsteigerleitfaden für brot mit sauerteig' },
  { topic: 'die rolle der baumwolle in der industriellen revolution' },
  { topic: 'wie ein scheibenbremssystem an einem fahrrad arbeitet' },
  { topic: 'sprachverwandtschaft zwischen niederländisch und plattdeutsch' },
  { topic: 'astronomische beobachtungen mit kleinem refraktor-teleskop' },
  { topic: 'tierhaltung in der alpenregion vor 100 jahren' },
  { topic: 'die entwicklung der schweizer uhrmacherei seit 1850' },
  { topic: 'wie ein dampfkessel in einer lokomotive funktioniert' },
  { topic: 'pilzkunde für hobby-sammler im mischwald' },
  { topic: 'die geologie der dolomiten' },
  { topic: 'einführung in das schachendspiel turm gegen läufer' },
  { topic: 'wie eine pumpspeicher-anlage strom zwischenspeichert' },
  { topic: 'die nahrungskette in einem mitteleuropäischen waldsee' },
  { topic: 'wie eine drehbank metallteile auf zehntel millimeter dreht' },
  { topic: 'geschichte der wikinger-handelsrouten in der ostsee' },
  { topic: 'wie ein passivhaus ohne klassische heizung warm bleibt' },
  { topic: 'die akustik einer barocken kirchenorgel' },
  { topic: 'glasbläserei in der lausitz' },
  { topic: 'pflanzliche heilmittel in der traditionellen chinesischen medizin' },
  { topic: 'fermentation von gemüse zur haltbarmachung' },
  { topic: 'die navigationstechnik der polynesischen seefahrer' },
  { topic: 'wie ein verbrennungsmotor mit otto-prozess arbeitet' },
  { topic: 'wetterphänomene über dem skandinavischen schild' },
  { topic: 'wie ein moderner windkraft-rotor lasten kontrolliert' },
]

function nextSeed(i: number): TopicSeed {
  const t = TOPIC_POOL[i % TOPIC_POOL.length]!
  // i / pool.length als variation-counter sorgt dafür dass wir das gleiche
  // topic mit unterschiedlichen "runden" mehrfach generieren können ,
  // bei genug iterations für medium/large.
  const round = Math.floor(i / TOPIC_POOL.length)
  return {
    id: `distractor-${String(i).padStart(5, '0')}`,
    topic: round === 0 ? t.topic : `${t.topic} (variante ${round + 1})`,
    ...(t.style !== undefined ? { style: t.style } : {}),
  }
}

function parseArgs(argv: string[]): { size?: string; provider?: string; resume?: boolean } {
  const out: { size?: string; provider?: string; resume?: boolean } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--size' && next !== undefined) {
      out.size = next
      i++
    } else if (a === '--provider' && next !== undefined) {
      out.provider = next
      i++
    } else if (a === '--resume') {
      out.resume = true
    }
  }
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
