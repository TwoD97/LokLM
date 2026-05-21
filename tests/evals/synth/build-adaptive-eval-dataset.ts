import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GeneratedQuestion, SourceChunk } from './QuestionGenerator'

const __dirname = dirname(fileURLToPath(import.meta.url))

// One-shot CLI:
//   tsx tests/evals/synth/build-adaptive-eval-dataset.ts
//
// Liest die staging-chunks (alle 5 docs , 109 chunks via dump-chunks.ts) und
// schreibt einen handgemachten Eval-Datensatz mit 25 Fragen über die 2 neuen
// docs (chunking-strategien , llm-inferenz-optimierung). Mix aus:
//   - 6 summary-fragen (doc-level Zusammenfassungen)
//   - 13 broad-fragen (Listen + Vergleiche)
//   - 6 focused-fragen (Single-Chunk-Faktoid , als Kontroll-Gruppe)
//
// Jede Frage hat:
//   - chunkId (primärer Chunk , für single-relevant-Backward-Compat)
//   - requiredChunkIds (Multi-Relevant-Set , kann mehrere Chunks enthalten)
//   - intent (für die Judge-Prompt-Auswahl)
//
// Required-Chunk-Sets wurden manuell aus den Quell-Dokumenten ausgewählt nach
// inhaltlicher Relevanz. Die existierenden 3 docs (eval-metriken , loklm-
// architektur , rag-grundlagen) sind nur als Distraktoren im Korpus.

const QUESTIONS: GeneratedQuestion[] = [
  // ============================================================
  // SUMMARY (6) — whole-doc / multi-section recap intent
  // ============================================================
  {
    intent: 'summary',
    question: 'Fasse die wichtigsten Chunking-Strategien für RAG zusammen.',
    chunkId: 'chunking-strategien::2',
    requiredChunkIds: [
      'chunking-strategien::2', // festes Token-Fenster
      'chunking-strategien::4', // satzweise
      'chunking-strategien::5', // strukturiert
      'chunking-strategien::7', // semantisch
      'chunking-strategien::9', // sentence-window
      'chunking-strategien::10', // hierarchisch
      'chunking-strategien::12', // late chunking
    ],
  },
  {
    intent: 'summary',
    question:
      'Gib mir einen Überblick über die wichtigsten Optimierungs-Stellschrauben für lokale LLM-Inferenz.',
    chunkId: 'llm-inferenz-optimierung::2',
    requiredChunkIds: [
      'llm-inferenz-optimierung::2', // Quantisierung
      'llm-inferenz-optimierung::4', // KV-Cache
      'llm-inferenz-optimierung::6', // n_ctx
      'llm-inferenz-optimierung::9', // GPU offload
      'llm-inferenz-optimierung::11', // Flash-Attention
      'llm-inferenz-optimierung::15', // Sampling
    ],
  },
  {
    intent: 'summary',
    question: 'Zusammenfassung: welche Quantisierungsformate für lokale LLM-Inferenz gibt es?',
    chunkId: 'llm-inferenz-optimierung::2',
    requiredChunkIds: [
      'llm-inferenz-optimierung::2',
      'llm-inferenz-optimierung::3',
      'llm-inferenz-optimierung::22',
    ],
  },
  {
    intent: 'summary',
    question: 'Fasse zusammen, was bei der Wahl der Chunk-Größe zu beachten ist.',
    chunkId: 'chunking-strategien::13',
    requiredChunkIds: [
      'chunking-strategien::13',
      'chunking-strategien::14',
      'chunking-strategien::15',
      'chunking-strategien::16',
    ],
  },
  {
    intent: 'summary',
    question: 'Übersicht: welche Phasen der LLM-Inferenz haben welche Performance-Charakteristik?',
    chunkId: 'llm-inferenz-optimierung::6',
    requiredChunkIds: [
      'llm-inferenz-optimierung::6', // Prefill
      'llm-inferenz-optimierung::8', // Batch + Decode
      'llm-inferenz-optimierung::17', // TTFT
    ],
  },
  {
    intent: 'summary',
    question:
      'Fasse den Trade-off zwischen Geschwindigkeit und Antwort-Qualität bei der Wahl der Quantisierungsstufe zusammen.',
    chunkId: 'llm-inferenz-optimierung::25',
    requiredChunkIds: ['llm-inferenz-optimierung::25', 'llm-inferenz-optimierung::26'],
  },
  // ============================================================
  // BROAD (13) — list / compare / multi-topic intent
  // ============================================================
  {
    intent: 'broad',
    question: 'Welche Chunking-Strategien gibt es und wann eignet sich welche?',
    chunkId: 'chunking-strategien::2',
    requiredChunkIds: [
      'chunking-strategien::2',
      'chunking-strategien::4',
      'chunking-strategien::5',
      'chunking-strategien::7',
      'chunking-strategien::10',
      'chunking-strategien::12',
    ],
  },
  {
    intent: 'broad',
    question: 'Vergleiche semantisches und strukturiertes Chunking.',
    chunkId: 'chunking-strategien::5',
    requiredChunkIds: [
      'chunking-strategien::5',
      'chunking-strategien::6',
      'chunking-strategien::7',
      'chunking-strategien::8',
    ],
  },
  {
    intent: 'broad',
    question: 'Vergleiche Q4_K_M, Q5_K_M, Q6_K und Q8_0 bei lokaler LLM-Inferenz.',
    chunkId: 'llm-inferenz-optimierung::2',
    requiredChunkIds: ['llm-inferenz-optimierung::2', 'llm-inferenz-optimierung::3'],
  },
  {
    intent: 'broad',
    question: 'Nenne die wichtigsten Stellschrauben für CPU-Inferenz von LLMs.',
    chunkId: 'llm-inferenz-optimierung::12',
    requiredChunkIds: ['llm-inferenz-optimierung::12', 'llm-inferenz-optimierung::13'],
  },
  {
    intent: 'broad',
    question: 'Welche Inferenz-Engines für lokale LLMs gibt es und wie unterscheiden sie sich?',
    chunkId: 'llm-inferenz-optimierung::20',
    requiredChunkIds: ['llm-inferenz-optimierung::20', 'llm-inferenz-optimierung::21'],
  },
  {
    intent: 'broad',
    question: 'Liste die GGUF-, AWQ-, EXL2- und GPTQ-Modellformate mit ihren Eigenschaften auf.',
    chunkId: 'llm-inferenz-optimierung::22',
    requiredChunkIds: ['llm-inferenz-optimierung::22', 'llm-inferenz-optimierung::23'],
  },
  {
    intent: 'broad',
    question: 'Vergleich: festes Token-Fenster vs. hierarchisches Chunking.',
    chunkId: 'chunking-strategien::2',
    requiredChunkIds: [
      'chunking-strategien::2',
      'chunking-strategien::3',
      'chunking-strategien::10',
      'chunking-strategien::11',
    ],
  },
  {
    intent: 'broad',
    question: 'Welche sprachspezifischen Probleme treten beim Chunking deutscher Texte auf?',
    chunkId: 'chunking-strategien::17',
    requiredChunkIds: ['chunking-strategien::17', 'chunking-strategien::18'],
  },
  {
    intent: 'broad',
    question: 'Welche Sampling-Parameter beeinflussen die Generation eines lokalen LLM?',
    chunkId: 'llm-inferenz-optimierung::15',
    requiredChunkIds: ['llm-inferenz-optimierung::15', 'llm-inferenz-optimierung::16'],
  },
  {
    intent: 'broad',
    question: 'Welche Vorteile hat Late Chunking gegenüber traditionellem Chunking?',
    chunkId: 'chunking-strategien::11',
    requiredChunkIds: ['chunking-strategien::11', 'chunking-strategien::12'],
  },
  {
    intent: 'broad',
    question: 'Vergleiche n_batch und n_ctx als Stellschrauben bei llama.cpp.',
    chunkId: 'llm-inferenz-optimierung::6',
    requiredChunkIds: ['llm-inferenz-optimierung::6', 'llm-inferenz-optimierung::8'],
  },
  {
    intent: 'broad',
    question: 'Welche Domänen-Spezifika sind beim Chunking zu beachten?',
    chunkId: 'chunking-strategien::18',
    requiredChunkIds: ['chunking-strategien::18', 'chunking-strategien::19'],
  },
  {
    intent: 'broad',
    question:
      'Liste die alternativen Mechanismen auf, die das Problem von Präzision vs. Kontext lösen können, jenseits der reinen Chunking-Strategie.',
    chunkId: 'chunking-strategien::27',
    requiredChunkIds: ['chunking-strategien::8', 'chunking-strategien::27'],
  },
  // ============================================================
  // FOCUSED (6) — single-chunk control group
  // ============================================================
  {
    intent: 'focused',
    question:
      'Was ist die typische Überlappung zwischen benachbarten Chunks bei einer 512-Token-Chunk-Größe?',
    chunkId: 'chunking-strategien::15',
    requiredChunkIds: ['chunking-strategien::15'],
  },
  {
    intent: 'focused',
    question: 'Was bedeutet GGUF und wofür wird es verwendet?',
    chunkId: 'llm-inferenz-optimierung::22',
    requiredChunkIds: ['llm-inferenz-optimierung::22'],
  },
  {
    intent: 'focused',
    question: 'Was ist Flash-Attention?',
    chunkId: 'llm-inferenz-optimierung::11',
    requiredChunkIds: ['llm-inferenz-optimierung::11'],
  },
  {
    intent: 'focused',
    question:
      'Welche Ähnlichkeitsschwelle wird beim semantischen Chunking üblicherweise verwendet?',
    chunkId: 'chunking-strategien::7',
    requiredChunkIds: ['chunking-strategien::7'],
  },
  {
    intent: 'focused',
    question: 'Was ist Late Chunking?',
    chunkId: 'chunking-strategien::11',
    requiredChunkIds: ['chunking-strategien::11'],
  },
  {
    intent: 'focused',
    question: 'Welche Threadzahl ist für CPU-Inferenz optimal?',
    chunkId: 'llm-inferenz-optimierung::13',
    requiredChunkIds: ['llm-inferenz-optimierung::13'],
  },
]

async function main(): Promise<void> {
  const stagingPath = join(__dirname, '..', 'data', 'staging', 'sample-doc-chunks.json')
  const stagingBytes = await readFile(stagingPath, 'utf-8')
  const staging = JSON.parse(stagingBytes) as { chunker: string; chunks: SourceChunk[] }

  // Sanity-check: jede questionId muss zu einem chunk im korpus passen.
  const chunkIds = new Set(staging.chunks.map((c) => c.id))
  const missing: string[] = []
  for (const q of QUESTIONS) {
    if (!chunkIds.has(q.chunkId)) missing.push(`primary chunkId: ${q.chunkId}`)
    for (const id of q.requiredChunkIds ?? []) {
      if (!chunkIds.has(id)) missing.push(`requiredChunkId: ${id} (in "${q.question}")`)
    }
  }
  if (missing.length > 0) {
    console.error('FEHLER: folgende chunkIds existieren nicht im korpus:')
    for (const m of missing) console.error(`  - ${m}`)
    process.exit(1)
  }

  const counts = { focused: 0, broad: 0, summary: 0 }
  for (const q of QUESTIONS) counts[q.intent ?? 'focused']++

  const dataset = {
    generator: 'manual-handcrafted:adaptive-topk-eval',
    generatedAt: new Date().toISOString(),
    chunker: staging.chunker,
    chunks: staging.chunks,
    questions: QUESTIONS,
  }

  const outPath = join(
    __dirname,
    '..',
    'data',
    'datasets',
    `handcrafted-adaptive-topk-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
  )
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf-8')
  console.error(`geschrieben: ${outPath}`)
  console.error(
    `chunks: ${staging.chunks.length} , fragen: ${QUESTIONS.length} (focused=${counts.focused} , broad=${counts.broad} , summary=${counts.summary})`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
