// provider-interface für synthetische frage-generierung. ein generator nimmt
// einen text-chunk und liefert n fragen die diesen chunk als antwort haben
// sollten. der eval-runner baut daraus später ground-truth pairs.

export interface SourceChunk {
  /** stabiler bezeichner , z.B. "<docId>::<index>" */
  id: string
  /** voller dokument-id (für context im prompt) */
  docId: string
  /** der chunk-text selbst */
  text: string
}

/**
 * Intent klassifiziert , wie viele Chunks eine Frage braucht , um beantwortet
 * zu werden. Spiegelt die Klassifikation in QAService.classifyQueryBreadth ,
 * damit die Eval direkt prüfen kann , ob das adaptive-topK-Heuristik die
 * richtigen Fragen erwischt.
 *
 *   focused — ein einzelner Chunk reicht (klassische Faktoid-Frage).
 *   broad   — mehrere Chunks für eine Listen- oder Vergleichs-Antwort.
 *   summary — viele Chunks für eine Zusammenfassung / Überblick.
 */
export type QuestionIntent = 'focused' | 'broad' | 'summary'

export interface GeneratedQuestion {
  /** referenz auf den chunk der die antwort enthalten sollte. Bei broad/summary
   *  ist das der "primäre" Chunk; das vollständige Set steht in requiredChunkIds. */
  chunkId: string
  /** die generierte frage */
  question: string
  /** Multi-Relevant-Ground-Truth: alle Chunks , die in den Top-K auftauchen
   *  sollten , damit die Frage gut beantwortet werden kann. Fehlt das Feld ,
   *  fällt die Eval auf `[chunkId]` zurück (Backward-Compat mit dem alten
   *  Single-Relevant-Datensatz). */
  requiredChunkIds?: string[]
  /** Welcher Intent-Bucket. Default 'focused' für rückwärtskompatible Datensätze. */
  intent?: QuestionIntent
  /** optionale begründung / kategorie aus dem generator (für debugging) */
  meta?: Record<string, string>
}

/** Liefert das Multi-Relevant-Set für eine Frage. Backward-compat-Helper:
 *  ältere Datensätze ohne requiredChunkIds fallen auf [chunkId] zurück. */
export function requiredChunkSet(q: GeneratedQuestion): string[] {
  return q.requiredChunkIds ?? [q.chunkId]
}

/** Liefert den Intent einer Frage mit Default 'focused' für alte Datensätze. */
export function questionIntent(q: GeneratedQuestion): QuestionIntent {
  return q.intent ?? 'focused'
}

export interface QuestionGenerator {
  /** name für reports und logs , z.B. "ollama:llama3" oder "anthropic:claude-haiku" */
  readonly name: string

  /** generiert n fragen pro chunk. langsam , also caching auf der aufruferseite. */
  generate(chunk: SourceChunk, n: number): Promise<GeneratedQuestion[]>
}
