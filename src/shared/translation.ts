/**
 * Shared renderer/main types for the MADLAD translation layer. The model is
 * MADLAD-400-3B-MT via the loklm-translator sidecar (see sidecars/translator/
 * README.md for the protocol and the why-a-sidecar rationale).
 */

export type TranslatorState =
  /** Model files missing — install() downloads ~2.76 GB. */
  | 'not_installed'
  /** install() in flight; progress comes via the download event channel. */
  | 'downloading'
  /** Files present , sidecar not running. First translate() starts it. */
  | 'installed'
  /** Sidecar spawned , model loading (5-30 s from cold disk). */
  | 'starting'
  | 'ready'
  | 'error'

export interface TranslatorStatus {
  state: TranslatorState
  /** Detail for 'error' , null otherwise. */
  message: string | null
  /** False when the sidecar binary isn't shipped/built — translation can't
   *  start even if the model is installed. Surfaced separately from `state`
   *  so the UI can distinguish "needs download" from "this build can't". */
  sidecarAvailable: boolean
}

export interface TranslateOptions {
  /** MADLAD target code — the `<2xx>` token , e.g. 'de' , 'en' , 'uk'.
   *  Validated by the sidecar against the model vocabulary. */
  target: string
  /** CTranslate2 beam size. Default 1 (greedy , matches the reference
   *  CT2-MADLAD usage); raise to 4 for the quality-over-speed path. */
  beam?: number
}

export interface TranslateResult {
  text: string
  /** ISO-639-1 source language per eld , null when too short/unreliable.
   *  Informational — MADLAD doesn't need the source language , only the
   *  `<2xx>` target token. */
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
 * Curated subset of MADLAD-400's 400+ targets — the ones worth a dropdown.
 * Codes follow the model's vocabulary (Google-style: Hebrew is 'iw' ,
 * Filipino is 'fil'). Any other code the vocabulary knows also works when
 * passed straight to translate(); the sidecar validates either way.
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
  { code: 'iw', name: 'Hebrew' },
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
