// Renderer/preload-visible codebase types (ADR-0006). The classification logic
// lives in main (services/codebase/classify.ts); these shapes are shared so the
// IPC surface + renderer badge/override can consume them without reaching into
// src/main.

export interface LanguageCount {
  language: string
  files: number
}

export interface CodebaseClassification {
  /** True ⇒ the folder should be treated as a 'codebase' workspace. */
  isCodebase: boolean
  /** Most-common code language, or null when no code files were found. */
  primaryLanguage: string | null
  /** Per-language code-file counts, descending. */
  languages: LanguageCount[]
  /** Ecosystem tags from matched marker files (e.g. ['node','rust']). */
  ecosystems: string[]
  /** The marker filenames that matched (relative paths), for diagnostics/UI. */
  markers: string[]
  /** Fraction of non-ignored files that are recognised code (0..1). */
  codeFileRatio: number
}
