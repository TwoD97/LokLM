// Prompt templates for the quiz generator. Bilingual: each builder takes a
// `lang` and returns the localized string. The model is told to output JSON
// only — the generator validates and retries once on bad output.

import type { QuizLanguage } from '../../../shared/quiz'

/** Token budget used by themes.ts to decide whole-doc vs outline path. The
 *  prompt scaffolding around the doc content + the requested output reserves
 *  ~1.4k tokens; the remainder is what we can give to the document itself. */
export const THEME_PROMPT_RESERVE_TOKENS = 600
export const THEME_OUTPUT_RESERVE_TOKENS = 800
export const QUESTION_PROMPT_RESERVE_TOKENS = 800
export const QUESTION_OUTPUT_RESERVE_TOKENS = 500

/** Conservative ceiling on usable content tokens when we can't probe the live
 *  LLM context window. Lite / Full / XL all fit this; Ollama models usually do
 *  too. The theme path uses this when LlamaService.lastPlan isn't available. */
export const FALLBACK_CONTEXT_TOKENS = 8192

export interface ThemeExtractionInput {
  language: QuizLanguage
  /** Document title — gives the model context for naming themes. */
  docTitle: string
  /** Either the whole-doc text or the outline, already trimmed to budget. */
  body: string
  /** Whether `body` is a full text dump or an outline. Affects wording. */
  bodyKind: 'whole-doc' | 'outline'
  /** Approximate number of themes to extract. Generator tunes to deck size. */
  targetCount: number
}

export function buildThemeExtractionPrompt(input: ThemeExtractionInput): string {
  const { language, docTitle, body, bodyKind, targetCount } = input
  if (language === 'de') {
    const bodyLabel = bodyKind === 'whole-doc' ? 'Dokumentinhalt' : 'Dokumentgliederung'
    return `Du analysierst ein Studienmaterial und extrahierst die wichtigsten Lernthemen.

Dokumenttitel: ${docTitle}

${bodyLabel}:
${body}

Gib eine JSON-Liste mit ungefähr ${targetCount} verschiedenen, didaktisch wertvollen Lernthemen zurück. Jedes Thema:
- "title": kurze, konzeptuelle Überschrift (max. 80 Zeichen)
- "summary": ein bis zwei Sätze, die das zu verstehende Konzept beschreiben
- "weight": ganzzahliges Gewicht 1–10, basierend auf der Wichtigkeit im Material

Themen müssen sich klar voneinander unterscheiden — keine Wiederholungen, keine Trivialwiederkennung. Konzentriere dich auf Verständnis und Anwendung, nicht auf reine Auswendiglerngegenstände.

Antworte AUSSCHLIESSLICH mit gültigem JSON-Array, keine Erklärung, keinen Vorspann, keinen Code-Block.

/no_think`
  }
  const bodyLabel = bodyKind === 'whole-doc' ? 'Document content' : 'Document outline'
  return `You are analysing study material to extract its key learning themes.

Document title: ${docTitle}

${bodyLabel}:
${body}

Return a JSON list of approximately ${targetCount} distinct, pedagogically valuable learning themes. Each theme:
- "title": short conceptual heading (max 80 chars)
- "summary": one or two sentences describing the concept to be understood
- "weight": integer 1–10 reflecting how prominent the theme is in the material

Themes must be clearly distinct — no repetition, no pure recall trivia. Focus on understanding and application, not memorisation.

Reply with ONLY a valid JSON array, no preamble, no explanation, no code fences.

/no_think`
}

export interface QuestionGenerationInput {
  language: QuizLanguage
  themeTitle: string
  themeSummary: string
  /** Chunks formatted as "[chunk:42] <text>" — the LLM is told to cite by id. */
  groundingBlock: string
  /** Stems already accepted in this deck — the avoid-list. */
  avoidStems: string[]
}

export function buildQuestionGenerationPrompt(input: QuestionGenerationInput): string {
  const { language, themeTitle, themeSummary, groundingBlock, avoidStems } = input
  const avoidBlock =
    avoidStems.length > 0 ? avoidStems.map((s) => `- ${s}`).join('\n') : '(noch keine — none yet)'
  if (language === 'de') {
    return `Du schreibst genau EINE Multiple-Choice-Frage für eine Studierende.

Thema: ${themeTitle}
Konzept: ${themeSummary}

Quellmaterial (jeder Eintrag ist ein zitierbarer Chunk):
${groundingBlock}

Bereits gestellte Fragen (NICHT wiederholen, nicht umformulieren):
${avoidBlock}

Anforderungen:
- Teste Verständnis oder Anwendung, NICHT triviales Auswendiglernen.
- Genau 4 Antwortmöglichkeiten, alle plausibel, genau EINE richtig.
- Die Erklärung muss begründen, warum die richtige Antwort stimmt, und sich auf das Material stützen.
- "source_chunk_ids" enthält nur Chunk-IDs, die oben tatsächlich vorkommen, primär zuerst.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{
  "stem": "...",
  "options": ["A", "B", "C", "D"],
  "correct_index": 0,
  "explanation": "...",
  "source_chunk_ids": [1, 2]
}

Kein Vorspann, kein Code-Block, keine zusätzlichen Felder.

/no_think`
  }
  return `Write exactly ONE multiple-choice question for a learner.

Theme: ${themeTitle}
Concept: ${themeSummary}

Source material (each entry is a citable chunk):
${groundingBlock}

Questions already asked (do NOT repeat, do NOT paraphrase):
${avoidBlock}

Requirements:
- Test understanding or application, NOT trivial recall.
- Exactly 4 plausible options, exactly ONE correct.
- The explanation must justify the correct answer using the material.
- "source_chunk_ids" lists only chunk ids that actually appear above, primary first.

Reply with ONLY a JSON object:
{
  "stem": "...",
  "options": ["A", "B", "C", "D"],
  "correct_index": 0,
  "explanation": "...",
  "source_chunk_ids": [1, 2]
}

No preamble, no code fences, no extra fields.

/no_think`
}

/** Retry prompt when the previous output failed JSON validation. We send it as
 *  a new generateRaw call (not a multi-turn chat) — the LLM provider's
 *  generateRaw is single-turn. The retry prompt restates the contract. */
export function buildJsonRetryPrompt(language: QuizLanguage, original: string): string {
  if (language === 'de') {
    return `Deine vorherige Antwort war kein gültiges JSON. Antworte JETZT NUR mit einem JSON-Objekt, das genau dem geforderten Schema folgt. Keine Erklärung, kein Code-Block.

Ursprüngliche Aufgabe:
${original}

/no_think`
  }
  return `Your previous output was not valid JSON. Reply NOW with ONLY a JSON object matching the required schema. No preamble, no code fences.

Original task:
${original}

/no_think`
}
