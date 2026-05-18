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

export interface GeneratedQuestion {
  /** referenz auf den chunk der die antwort enthalten sollte */
  chunkId: string
  /** die generierte frage */
  question: string
  /** optionale begründung / kategorie aus dem generator (für debugging) */
  meta?: Record<string, string>
}

export interface QuestionGenerator {
  /** name für reports und logs , z.B. "ollama:llama3" oder "anthropic:claude-haiku" */
  readonly name: string

  /** generiert n fragen pro chunk. langsam , also caching auf der aufruferseite. */
  generate(chunk: SourceChunk, n: number): Promise<GeneratedQuestion[]>
}
