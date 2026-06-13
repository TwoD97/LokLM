/**
 * Shared renderer/main types for the writing assistant ("Write" , the DeepL
 * Write analogue). Unlike translation it runs on the bundled chat LLM (Qwen) —
 * it's same-language rewriting , not translation — so there's no separate model
 * to download and the existing LLM TitleBar status dot already covers it.
 */

/** Rewrite intent. 'improve' is the default (grammar + clarity , meaning kept);
 *  the rest are tone/length transforms. The source language is always
 *  preserved — these never translate. */
export type WritingMode = 'improve' | 'formal' | 'casual' | 'concise' | 'expand' | 'simplify'

export const WRITING_MODES: WritingMode[] = [
  'improve',
  'formal',
  'casual',
  'concise',
  'expand',
  'simplify',
]

export interface WriteResult {
  text: string
  /** ISO source language the rewrite was written in (DE/EN — the two the
   *  bundled model is prompted in). */
  detected: 'de' | 'en'
  mode: WritingMode
}
