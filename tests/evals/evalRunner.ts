import { cosineSimilarity } from './pipeline/Embedder'
import type { PipelineConfig } from './pipeline/configs'
import { summarize, type EvalReport, type RankedResult } from './metrics'
import { LatencyTracker, memorySnapshot, type PerfReport } from './perf'
import type { GeneratedQuestion, SourceChunk } from './synth/QuestionGenerator'

// gemeinsamer kern für run.ts und run-scale.ts. nimmt eine config , eine
// liste fragen und einen suchbaren korpus. der korpus kann mehr chunks
// enthalten als die fragen-ground-truth referenzieren , das ist genau
// der trick beim scale-test: ground-truth-inseln in einer großen library.

export interface EvalInputs {
  questions: GeneratedQuestion[]
  /** searchable corpus , = dataset-chunks ∪ optionale library-chunks */
  corpus: SourceChunk[]
  topK: number
}

export interface FullReport {
  eval: EvalReport
  perf: PerfReport
}

export async function evalConfig(cfg: PipelineConfig, inputs: EvalInputs): Promise<FullReport> {
  const { questions, corpus, topK } = inputs

  // build: einmal den gesamten korpus embedden
  const buildStart = performance.now()
  const chunkVecs = await cfg.embedder.embedBatch(corpus.map((c) => c.text))
  const buildMs = performance.now() - buildStart
  const memoryAfterBuildMiB = memorySnapshot().rssMiB

  // queries: pro frage embedden , brute-force-cosinus , reranken , timen
  const queryLatency = new LatencyTracker()
  const ranked: RankedResult[] = []

  for (const q of questions) {
    const result = await queryLatency.time(async () => {
      const qVec = await cfg.embedder.embed(q.question)
      const scored = corpus
        .map((c, i) => ({
          id: c.id,
          text: c.text,
          initialScore: cosineSimilarity(qVec, chunkVecs[i]!),
        }))
        .sort((a, b) => b.initialScore - a.initialScore)
        .slice(0, topK)

      const reranked = await cfg.reranker.rerank(
        q.question,
        scored.map((s) => ({ text: s.text, initialScore: s.initialScore })),
      )

      const chunkIds = reranked
        .map((r) => scored[r.initialIndex])
        .filter((s): s is { id: string; text: string; initialScore: number } => s !== undefined)
        .map((s) => s.id)
      return { chunkIds, expected: q.chunkId }
    })
    ranked.push(result)
  }

  const memoryAfterRunMiB = memorySnapshot().rssMiB

  return {
    eval: summarize(cfg.name, ranked),
    perf: {
      buildMs,
      query: queryLatency.summary(),
      memoryAfterBuildMiB,
      memoryAfterRunMiB,
    },
  }
}
