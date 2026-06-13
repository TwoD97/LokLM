import type { ResponseLanguage } from '../llm/prompt'
import type { WritingMode } from '../../../shared/writing'

// Output ceiling for a rewrite , and headroom reserved for the instruction
// text when budgeting how much input fits one call. A rewrite is roughly the
// length of its input; the per-call cap is computed from the input in the
// service , this is just the hard ceiling.
export const WRITE_MAX_TOKENS = 2048
export const WRITE_PROMPT_RESERVE_TOKENS = 300

/**
 * Build a writing-assistant prompt for `generateRaw`. Written natively per
 * language (DE/EN) for the same small-model consistency reason as the
 * summarization + QA prompts. Every mode preserves the source language — the
 * model must rewrite , never translate.
 *
 * The hard part with small models is the preamble reflex ("Here is the
 * improved version:") and stray quotes; the instruction is blunt about
 * outputting only the rewritten text so the service's cleanup has little to do.
 */
export function buildWritePrompt(lang: ResponseLanguage, mode: WritingMode, text: string): string {
  return lang === 'de' ? buildDe(mode, text) : buildEn(mode, text)
}

const EN_INSTRUCTION: Record<WritingMode, string> = {
  improve:
    'Improve the writing below: fix grammar, spelling, and punctuation, and make it clearer and more natural to read.',
  formal: 'Rewrite the text below in a more formal, professional tone.',
  casual: 'Rewrite the text below in a more casual, friendly tone.',
  concise:
    'Rewrite the text below to be more concise — cut redundancy and tighten the wording while keeping every key point.',
  expand:
    'Rewrite the text below with more detail and elaboration, developing the ideas more fully.',
  simplify:
    'Rewrite the text below in simpler, plainer language that is easier to read, avoiding jargon and long sentences.',
}

const DE_INSTRUCTION: Record<WritingMode, string> = {
  improve:
    'Verbessere den folgenden Text: korrigiere Grammatik, Rechtschreibung und Zeichensetzung und mache ihn klarer und natürlicher zu lesen.',
  formal: 'Schreibe den folgenden Text in einem förmlicheren, professionelleren Ton um.',
  casual: 'Schreibe den folgenden Text in einem lockereren, freundlicheren Ton um.',
  concise:
    'Schreibe den folgenden Text knapper — entferne Redundanz und straffe die Formulierung, bewahre dabei jeden Kernpunkt.',
  expand:
    'Schreibe den folgenden Text ausführlicher und detaillierter und entwickle die Gedanken vollständiger.',
  simplify:
    'Schreibe den folgenden Text in einfacherer, klarerer Sprache um, die leichter zu lesen ist; vermeide Fachjargon und lange Sätze.',
}

function buildEn(mode: WritingMode, text: string): string {
  return (
    `${EN_INSTRUCTION[mode]} Keep the original meaning and write in the same language as the input (English). ` +
    `Output only the rewritten text — no preamble, no explanation, no quotation marks.\n\n` +
    `Text:\n${text}\n\nRewritten text:`
  )
}

function buildDe(mode: WritingMode, text: string): string {
  return (
    `${DE_INSTRUCTION[mode]} Bewahre die ursprüngliche Bedeutung und schreibe in derselben Sprache wie die Eingabe (Deutsch). ` +
    `Gib nur den umgeschriebenen Text aus — keine Einleitung, keine Erklärung, keine Anführungszeichen.\n\n` +
    `Text:\n${text}\n\nUmgeschriebener Text:`
  )
}
