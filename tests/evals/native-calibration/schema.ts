export type CalibrationSplit = 'dev' | 'heldout' | 'conflict-regression'

export type CalibrationKind =
  | 'exact-amount'
  | 'cross-language'
  | 'exact-date'
  | 'table-unit'
  | 'table-arithmetic'
  | 'multi-document-comparison'
  | 'exact-identifier'
  | 'code-semantics'
  | 'missing-fact'
  | 'conflicting-sources'

export interface CalibrationSource {
  key: string
  /** Relative to tests/evals/native-calibration, not the current directory. */
  file: string
  title: string
  format: 'markdown' | 'text' | 'pdf'
}

export interface CalibrationCase {
  id: string
  question: string
  language: 'en' | 'de'
  kind: CalibrationKind
  requiredSourceKeys: string[]
  /** The requested definitive fact is unavailable or unresolved. An explicit
   * conflict explanation is a correct abstention, not an empty answer. */
  expectedAbstention: boolean
  referenceAnswer: string
  /** Mechanical aids only. Matching facts does not prove grounding, correct
   * negation, language, or absence of unsupported additional claims. */
  answerChecks: Array<{ label: string; pattern: string }>
  forbiddenPatterns?: string[]
  /** A partial answer must never count as a full pass. false requires all
   * requested facts and sources; an abstention cannot substitute for an
   * answerable fact. */
  allowPartial: boolean
}

export interface CalibrationManifest {
  schemaVersion: 1
  split: CalibrationSplit
  sources: CalibrationSource[]
  cases: CalibrationCase[]
}

export interface LoadedCalibrationManifest extends Omit<CalibrationManifest, 'sources'> {
  sources: Array<CalibrationSource & { absolutePath: string }>
}
