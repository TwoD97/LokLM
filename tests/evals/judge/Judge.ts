// Judge , bewertet die qualität der vom eval-LLM generierten antwort.
//
// Standard-pattern: LLM-as-judge. Ein stärkeres modell (XL-profil lokal , oder
// Anthropic API) bekommt die frage + den gold-chunk + die generierte antwort
// und gibt eine zahl 0..1 zurück. Wir verlangen vom judge ein knappes
// strukturiertes format ("score: X, reason: …") und parsen das robust , damit
// ein einzelner format-fehler nicht die ganze iteration kippt.
//
// Drei dimensionen die wir scoren:
//   correctness  — beantwortet die antwort die frage *richtig* (gegen gold)?
//   groundedness — basiert die antwort auf den geretrieten chunks oder
//                  halluziniert sie? (chunks werden separat reingegeben)
//   helpfulness  — ist die antwort verständlich / direkt / nicht zu lang?
//
// Pro frage: ein judge-call , drei scores , gemittelt zu `score`. Der
// sweep-runner schreibt sowohl die per-dimension-zahlen als auch den
// mittelwert pro per-question.jsonl-zeile.

import type { QuestionIntent } from '../synth/QuestionGenerator'

export interface JudgeInput {
  question: string
  /** der ground-truth chunk-text aus dem dataset (single-relevant , focused). */
  expectedChunkText: string
  /** Multi-Relevant-Ground-Truth: alle Chunk-Texte , die für eine vollständige
   *  Antwort gebraucht werden. Fehlt → fallback auf [expectedChunkText]. Nur
   *  bei intent='broad' / 'summary' aussagekräftig. */
  expectedChunkTexts?: string[]
  /** Intent-Tag aus dem Datensatz. Bestimmt , welcher Judge-Prompt verwendet
   *  wird: focused → klassischer Single-Ground-Truth-Prompt , broad/summary →
   *  Coverage-Prompt , der prüft , ob alle required-Punkte abgedeckt sind. */
  intent?: QuestionIntent
  /** die tatsächlich geretrieten + an den LLM gegebenen chunks */
  providedChunks: string[]
  /** die generierte antwort des unter-test-LLMs */
  generatedAnswer: string
}

export interface JudgeScore {
  /** mittelwert der drei dimensionen , 0..1 , wird vom sweep für composite-ranking benutzt */
  score: number
  correctness: number
  groundedness: number
  helpfulness: number
  /** kurze begründung vom judge , optional , nützlich für debugging falsch-bewerteter cases */
  reason: string | null
  /** wenn das parsen scheitert , wird das ganze record skipped (null) , so dass
   *  ein einzelner formatierungs-aussetzer nicht das mittel verzerrt. */
  parsed: boolean
}

export interface Judge {
  readonly name: string
  /** load model into memory once. callers können explizit warmen damit der
   *  erste judge-call nicht die ladezeit eines XL-modells trägt. */
  warm?(): Promise<void>
  score(input: JudgeInput): Promise<JudgeScore>
  unload?(): Promise<void>
}

/**
 * Baut den prompt für den judge. Strikt strukturiert , damit das parsen
 * deterministisch bleibt. Drei zeilen scores + eine zeile reason.
 *
 * Zwei Modi je nach intent:
 *   focused (default) — Single-Ground-Truth-Prompt , klassische Faktoid-Bewertung.
 *   broad / summary  — Coverage-Prompt , prüft Abdeckung MEHRERER required-Chunks.
 *
 * Das Ausgabeformat (correctness/groundedness/helpfulness/reason) ist in beiden
 * Modi identisch , damit parseJudgeOutput und der composite-score gleich
 * weiterlaufen.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  const intent = input.intent ?? 'focused'
  if (intent === 'focused') return buildFocusedJudgePrompt(input)
  return buildCoverageJudgePrompt(input)
}

function buildFocusedJudgePrompt(input: JudgeInput): string {
  const chunkList = input.providedChunks
    .map((c, i) => `Chunk ${i + 1}: ${truncate(c, 800)}`)
    .join('\n\n')
  return [
    `Du bist ein strenger Bewertungs-Assistent. Du bekommst eine Frage , den korrekten`,
    `Ground-Truth-Quelltext , die Chunks die dem Antwort-LLM gegeben wurden , und die`,
    `tatsächlich generierte Antwort. Bewerte die Antwort entlang drei Achsen auf einer`,
    `Skala von 0 bis 10:`,
    ``,
    `- correctness  — beantwortet die Antwort die Frage RICHTIG im Vergleich zum Ground-Truth?`,
    `- groundedness — stützt sich die Antwort auf die gelieferten Chunks oder halluziniert sie?`,
    `- helpfulness  — ist die Antwort verständlich , direkt und nicht zu lang?`,
    ``,
    `Antworte AUSSCHLIESSLICH in genau diesem Format , nichts davor , nichts danach:`,
    ``,
    `correctness: <0-10>`,
    `groundedness: <0-10>`,
    `helpfulness: <0-10>`,
    `reason: <ein satz>`,
    ``,
    `---`,
    `Frage: ${input.question}`,
    ``,
    `Ground-Truth-Quelltext: ${truncate(input.expectedChunkText, 1500)}`,
    ``,
    `Chunks an den Antwort-LLM:`,
    chunkList,
    ``,
    `Generierte Antwort: ${truncate(input.generatedAnswer, 2000)}`,
    ``,
    `---`,
    `Bewertung:`,
  ].join('\n')
}

/**
 * Coverage-Prompt für broad / summary Fragen. Statt "richtig vs. ein Ground-
 * Truth" wird die Abdeckung MEHRERER required-Chunks bewertet. Wichtig: das
 * Score-Format bleibt identisch zum focused-prompt , nur die Semantik der
 * Dimensionen wechselt:
 *
 *   correctness  → coverage: wie viele der required-Punkte hat die Antwort
 *                  inhaltlich erwischt? Vollständigkeit zählt , nicht nur
 *                  ein einzelner richtiger Treffer.
 *   groundedness → unverändert: stützt sich die Antwort auf die gelieferten
 *                  Chunks oder halluziniert sie?
 *   helpfulness  → unverändert , aber für summary darf die Antwort
 *                  länger sein als bei focused.
 */
function buildCoverageJudgePrompt(input: JudgeInput): string {
  const required = input.expectedChunkTexts ?? [input.expectedChunkText]
  const requiredList = required
    .map((c, i) => `Erforderlicher Punkt ${i + 1}: ${truncate(c, 800)}`)
    .join('\n\n')
  const chunkList = input.providedChunks
    .map((c, i) => `Chunk ${i + 1}: ${truncate(c, 800)}`)
    .join('\n\n')
  const intentLabel = input.intent === 'summary' ? 'Zusammenfassung' : 'Listen-/Vergleichs-Antwort'
  return [
    `Du bist ein strenger Bewertungs-Assistent für eine ${intentLabel}.`,
    `Du bekommst eine Frage , eine Liste der ERFORDERLICHEN PUNKTE , die eine`,
    `vollständige Antwort abdecken muss , die Chunks die dem Antwort-LLM gegeben`,
    `wurden , und die tatsächlich generierte Antwort. Bewerte auf einer Skala 0 bis 10:`,
    ``,
    `- correctness  — COVERAGE: wie vollständig deckt die Antwort die erforderlichen`,
    `                 Punkte ab? 10 = alle Punkte inhaltlich erwischt , 5 = etwa die Hälfte ,`,
    `                 0 = nichts oder völlig falsch. Reihenfolge egal , Paraphrasen ok.`,
    `- groundedness — stützt sich die Antwort auf die gelieferten Chunks oder halluziniert sie?`,
    `- helpfulness  — ist die Antwort gut strukturiert , verständlich und nicht überflüssig lang?`,
    ``,
    `Antworte AUSSCHLIESSLICH in genau diesem Format , nichts davor , nichts danach:`,
    ``,
    `correctness: <0-10>`,
    `groundedness: <0-10>`,
    `helpfulness: <0-10>`,
    `reason: <ein satz , nenne welche Punkte fehlen falls coverage < 10>`,
    ``,
    `---`,
    `Frage: ${input.question}`,
    ``,
    `Erforderliche Punkte (alle sollten abgedeckt sein):`,
    requiredList,
    ``,
    `Chunks an den Antwort-LLM:`,
    chunkList,
    ``,
    `Generierte Antwort: ${truncate(input.generatedAnswer, 3000)}`,
    ``,
    `---`,
    `Bewertung:`,
  ].join('\n')
}

/**
 * Parsed das judge-output-format. Robuste regex-pro-zeile statt JSON.parse() ,
 * weil lokale LLMs gelegentlich extra-text vor/nach dem format ausspucken.
 * Gibt `parsed: false` zurück wenn nicht alle drei dimensionen extrahierbar sind.
 */
export function parseJudgeOutput(raw: string): JudgeScore {
  const correctness = extractScore(raw, 'correctness')
  const groundedness = extractScore(raw, 'groundedness')
  const helpfulness = extractScore(raw, 'helpfulness')
  const reasonMatch = raw.match(/reason\s*:\s*(.+)/i)
  const reason = reasonMatch?.[1]?.trim() ?? null
  if (correctness === null || groundedness === null || helpfulness === null) {
    return {
      score: 0,
      correctness: 0,
      groundedness: 0,
      helpfulness: 0,
      reason,
      parsed: false,
    }
  }
  // Normalisieren von 0-10 auf 0-1 damit der composite-score additiv mit recall
  // (auch 0-1) gerechnet werden kann.
  const c = correctness / 10
  const g = groundedness / 10
  const h = helpfulness / 10
  return {
    score: (c + g + h) / 3,
    correctness: c,
    groundedness: g,
    helpfulness: h,
    reason,
    parsed: true,
  }
}

function extractScore(raw: string, dimension: string): number | null {
  // matched zeilen wie "correctness: 7" oder "correctness : 7.5" , case-insensitive
  const re = new RegExp(`${dimension}\\s*:\\s*(\\d+(?:\\.\\d+)?)`, 'i')
  const m = raw.match(re)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  // clamp 0..10 — manchmal halluziniert das judge-modell "12" oder negative zahlen
  return Math.max(0, Math.min(10, n))
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max).trim()}…`
}

/**
 * Composite-score für ranking: gewichtet quality (judge + recall) gegen latency.
 * Default-gewichte sind bewusst opinionated:
 *   - judge.score   ×2  (qualität ist die hauptsache)
 *   - recall@5      ×1  (wenn der judge fehlt , fällt das auf recall zurück)
 *   - ttft-penalty  ×0.5 (linear in sekunden , maximal -1 bei 2s TTFT)
 *
 * Aufrufer kann gewichte überschreiben. Höhere zahl = besser. NaN-safe:
 * fehlende werte werden als 0 behandelt.
 */
export interface CompositeWeights {
  judge?: number
  recallAt5?: number
  ttftSecondPenalty?: number
}

export function compositeScore(args: {
  judgeScore: number | null
  recallAt5: number
  ttftMs: number | null
  weights?: CompositeWeights
}): number {
  const w = {
    judge: args.weights?.judge ?? 2,
    recallAt5: args.weights?.recallAt5 ?? 1,
    ttftSecondPenalty: args.weights?.ttftSecondPenalty ?? 0.5,
  }
  const judge = args.judgeScore ?? 0
  const ttftSec = args.ttftMs !== null ? args.ttftMs / 1000 : 0
  return w.judge * judge + w.recallAt5 * args.recallAt5 - w.ttftSecondPenalty * ttftSec
}
