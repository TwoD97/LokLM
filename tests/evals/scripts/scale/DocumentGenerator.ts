// provider-interface für synthetisch erzeugte distractor-dokumente.
// im gegensatz zu QuestionGenerator (chunk → fragen) liefert dieser hier
// einen ganzen text zu einem topic , den der library-builder dann selbst
// chunkt und in den korpus mischt.

export interface TopicSeed {
  /** stabiler bezeichner , wandert in die docId */
  id: string
  /** kurze themen-beschreibung , kommt in den prompt */
  topic: string
  /** optional ein register/genre , z.B. "fachartikel" oder "ratgeber" */
  style?: string
}

export interface DocumentGenerator {
  /** name für reports und logs , z.B. "ollama:llama3" */
  readonly name: string

  /**
   * generiert einen text zum gegebenen seed. der text soll thematisch
   * eigenständig sein und _nicht_ die antworten zu den eval-fragen enthalten ,
   * sondern als plausibler distractor wirken.
   * länge zwischen ~500 und ~2000 zeichen anstreben.
   */
  generate(seed: TopicSeed): Promise<string>
}
