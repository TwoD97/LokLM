/**
 * Translation uses the selected chat model and the same inference queue.
 */

export type TranslatorState =
  /** No local chat model is available. */
  | 'not_installed'
  /** Chat model available; loaded lazily on first use. */
  | 'installed'
  /** Shared language model loading. */
  | 'starting'
  | 'ready'
  | 'error'

export interface TranslatorStatus {
  state: TranslatorState
  /** Detail for 'error' , null otherwise. */
  message: string | null
  modelName: string | null
}

export interface TranslateOptions {
  /** Target language from TRANSLATION_LANGUAGES. */
  target: string
  /** Renderer-generated ID for progress and cancellation of this request. */
  requestId?: string
}

export interface TranslationProgress {
  requestId: string
  completed: number
  total: number
}

export interface TranslateResult {
  text: string
  /** ISO-639-1 source language per eld , null when too short/unreliable.
   *  Informational; the LLM identifies the source language itself. */
  detected: string | null
  /** Sentences sent through the model — diagnostics , not UI-critical. */
  sentences: number
  ms: number
}

export interface TranslationLanguage {
  code: string
  /** English display name; the renderer i18n layer may localize on top. */
  name: string
}

/**
 * Language choices. Translation quality depends on the selected LLM.
 */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'ar', name: 'Arabic' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'cs', name: 'Czech' },
  { code: 'cy', name: 'Welsh' },
  { code: 'da', name: 'Danish' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'et', name: 'Estonian' },
  { code: 'eu', name: 'Basque' },
  { code: 'fa', name: 'Persian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fr', name: 'French' },
  { code: 'ga', name: 'Irish' },
  { code: 'gl', name: 'Galician' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hr', name: 'Croatian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'hy', name: 'Armenian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'it', name: 'Italian' },
  { code: 'he', name: 'Hebrew' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ka', name: 'Georgian' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ms', name: 'Malay' },
  { code: 'mt', name: 'Maltese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'zh', name: 'Chinese' },
]
