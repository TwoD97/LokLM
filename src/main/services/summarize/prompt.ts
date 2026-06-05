import type { ResponseLanguage } from '../llm/prompt'

// Output ceiling for a summary generation. A whole-doc overview is short by
// design; this also bounds the map-reduce partials so a long doc doesn't spend
// the whole window per section.
export const SUMMARY_MAX_TOKENS = 512

// Headroom reserved for the instruction text + the worker's own framing when
// budgeting how much document body fits one call. Conservative on purpose.
export const SUMMARY_PROMPT_RESERVE_TOKENS = 400

/** 'whole'   — body is the entire (budget-fitting) document.
 *  'partial' — body is one section of a too-large document (map step).
 *  'reduce'  — body is the concatenated section summaries (reduce step). */
export type SummaryMode = 'whole' | 'partial' | 'reduce'

/**
 * Build a summarization prompt for `generateRaw`. Written natively per language
 * (DE/EN) for the same small-model consistency reason as the QA system prompt.
 * The model is told to stay strictly within the provided text — a summary that
 * invents content is worse than useless for a study tool.
 */
export function buildSummaryPrompt(
  lang: ResponseLanguage,
  title: string,
  body: string,
  mode: SummaryMode,
): string {
  return lang === 'de' ? buildDe(title, body, mode) : buildEn(title, body, mode)
}

function buildEn(title: string, body: string, mode: SummaryMode): string {
  if (mode === 'reduce') {
    return (
      `Below are summaries of consecutive sections of one document. Combine them into a single coherent overview in English, removing repetition and preserving every key point. Write 5–10 sentences. Use only what the section summaries contain. Do not start with a preamble like "This document".\n\n` +
      `Title: ${title}\n\nSection summaries:\n${body}\n\nCombined summary:`
    )
  }
  const what = mode === 'partial' ? 'excerpt of a larger document' : 'document'
  return (
    `Summarize the ${what} below into a clear, faithful overview a student can use to grasp it quickly. Cover the main topics, key facts, and conclusions. Use only the text provided — add no outside information. Write 5–10 sentences in English. Do not start with a preamble like "This document".\n\n` +
    `Title: ${title}\n\n${mode === 'partial' ? 'Excerpt' : 'Document'}:\n${body}\n\nSummary:`
  )
}

function buildDe(title: string, body: string, mode: SummaryMode): string {
  if (mode === 'reduce') {
    return (
      `Unten stehen Zusammenfassungen aufeinanderfolgender Abschnitte eines Dokuments. Füge sie zu einem einzigen, zusammenhängenden Überblick auf Deutsch zusammen, entferne Wiederholungen und bewahre jeden Kernpunkt. Schreibe 5–10 Sätze. Nutze nur, was in den Abschnittszusammenfassungen steht. Beginne nicht mit einer Floskel wie „Dieses Dokument".\n\n` +
      `Titel: ${title}\n\nAbschnittszusammenfassungen:\n${body}\n\nKombinierte Zusammenfassung:`
    )
  }
  const what =
    mode === 'partial' ? 'den folgenden Auszug eines größeren Dokuments' : 'das folgende Dokument'
  return (
    `Fasse ${what} zu einem klaren, getreuen Überblick zusammen, mit dem ein Studierender es schnell erfassen kann. Erfasse die Hauptthemen, wichtigsten Fakten und Schlussfolgerungen. Nutze ausschließlich den bereitgestellten Text — füge kein externes Wissen hinzu. Schreibe 5–10 Sätze auf Deutsch. Beginne nicht mit einer Floskel wie „Dieses Dokument".\n\n` +
    `Titel: ${title}\n\n${mode === 'partial' ? 'Auszug' : 'Dokument'}:\n${body}\n\nZusammenfassung:`
  )
}
