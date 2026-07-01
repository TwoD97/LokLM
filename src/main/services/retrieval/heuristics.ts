import type { SearchHit } from '@main/db/types'
import type { ResponseLanguage } from '../llm/prompt'
import { fileTrack } from '../codebase/ignore'
import { fileRole, isSecondaryCodeRole } from '../codebase/fileRole'

// small-but-deliberate DE+EN stopword set. Domain-relevant nouns like
// "Wochenbuch" intentionally NOT in the list — they should pass through
// to match title boosts. Tweak with care: each addition reduces recall.
const TITLE_STOPWORDS = new Set([
  // English
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'by',
  'at',
  'as',
  'it',
  // German
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'eines',
  'und',
  'oder',
  'von',
  'zu',
  'im',
  'auf',
  'für',
  'mit',
  'ist',
  'sind',
  // German question + function words (non-topical), so a German query like
  // "wie funktioniert die authentifizierungs-klasse" tokenizes to its nouns.
  // Domain nouns (datenbank, einstellung, …) deliberately stay OUT.
  'wie',
  'was',
  'wo',
  'wann',
  'warum',
  'wer',
  'welche',
  'welcher',
  'welchem',
  'welchen',
  'welches',
  'es',
  'dass',
  'bei',
  'am',
  'zur',
  'zum',
  'nach',
  'auch',
  'nicht',
  'sich',
  'kann',
  'soll',
  'funktioniert',
  'funktionieren',
  'gibt',
])

/** Shared query/title tokenizer. Exported for the qa router's target-document
 *  resolution so "summarize my Wochenbuch" matches titles by exactly the same
 *  rules as applyTitleBoost. */
export function nonStopwordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Z0-9äöüß]+/)
    .filter((t) => t.length > 0 && !TITLE_STOPWORDS.has(t))
}

// Decomposition bounds (ADR-0003 multi-question handling). Beyond MAX it's
// likely pasted content, not a genuine multi-question chat turn — decomposing
// would just multiply retrieval passes, so we treat it as one query. MIN_CHARS
// filters '?'-noise ("ok?", "Thanks!") so they don't count as a sub-question.
const MAX_SUBQUESTIONS = 5
const MIN_SUBQUESTION_CHARS = 10

/**
 * Split a chat message into distinct sub-questions for separate retrieval
 * (ADR-0003). Pure + hot-path safe — NO LLM. Conservative by design: splits
 * ONLY on '?' boundaries, so an "and"/"oder" INSIDE one question ("difference
 * between X and Y?", "how does X work and why?") stays together. A false merge
 * (the status quo) is cheaper than a false split, so anything not clearly
 * compound returns the original `[query]`. Language-agnostic ('?' is universal).
 *
 * Used by RetrievalService to retrieve each sub-question separately and RRF-fuse
 * the pools (coverage across topics instead of one diluted centroid vector), and
 * by the qa router to keep compound messages off the single-intent routes.
 */
export function splitQuestions(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed.includes('?')) return [trimmed]
  // Split AFTER each '?' (lookbehind keeps the mark with its segment), then
  // drop fragments too short or stopword-only to be a real question.
  const segments = trimmed
    .split(/(?<=\?)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SUBQUESTION_CHARS && nonStopwordTokens(s).length >= 1)
  if (segments.length < 2 || segments.length > MAX_SUBQUESTIONS) return [trimmed]
  return segments
}

export function applyTitleBoost(hits: SearchHit[], query: string, factor: number): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  const qTokens = new Set(nonStopwordTokens(query))
  if (qTokens.size === 0) return hits
  return hits.map((h) => {
    const titleTokens = nonStopwordTokens(h.document_title)
    const overlap = titleTokens.some((t) => qTokens.has(t))
    return overlap ? { ...h, score: h.score * factor } : h
  })
}

export function applyShortChunkPenalty(
  hits: SearchHit[],
  factor: number,
  minChars: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0) return hits
  return hits.map((h) => (h.text.length < minChars ? { ...h, score: h.score * factor } : h))
}

export function applyRecencyBoost(
  hits: SearchHit[],
  factor: number,
  windowMs: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0 || windowMs <= 0) return hits
  const nowSec = Math.floor(Date.now() / 1000)
  const windowSec = Math.floor(windowMs / 1000)
  return hits.map((h) => {
    const added = h.added_at ?? null
    if (added == null) return h
    return nowSec - added <= windowSec ? { ...h, score: h.score * factor } : h
  })
}

/**
 * Mild multiplicative boost (default ~1.10) for chunks whose detected language
 * matches the configured response language. Backed by the research summarised
 * in src/main/services/llm/prompt.ts: language-matched material is easier for
 * the model to quote-cite without translation drift, and downstream answer
 * quality drops measurably (~5–10 %) when the model is forced to translate
 * source text mid-response.
 *
 * No-ops in three cases — each chosen to avoid hurting recall:
 *   - factor ≤ 1.0           : caller explicitly disabled the heuristic
 *   - responseLang missing   : caller didn't tell us what language to favour
 *   - chunk.language ∈ {null, 'other'} : we can't be sure of a mismatch, so
 *     leave the chunk untouched rather than down-weight it relative to
 *     known-matching chunks (which would happen implicitly if we boosted only
 *     the matches).
 *
 * Mirrors applyTitleBoost's shape: returns a new array, mutates nothing.
 */
export function applyLanguageMatchBoost(
  hits: SearchHit[],
  responseLang: ResponseLanguage | undefined,
  factor: number,
): SearchHit[] {
  if (factor === 1.0 || factor <= 0 || !responseLang) return hits
  return hits.map((h) =>
    h.language && h.language !== 'other' && h.language === responseLang
      ? { ...h, score: h.score * factor }
      : h,
  )
}

// ---------------------------------------------------------------------------
// Code-aware heuristics (ADR-0006). Only meaningful in codebase workspaces:
// code chunks carry a `[file, symbol]` heading_path (codeChunker), code + docs
// share one vector space, and natural-language questions + the prose-trained
// reranker otherwise bury code under documentation. All are pure SearchHit[] →
// SearchHit[] boosts, same shape as applyTitleBoost.
// ---------------------------------------------------------------------------

/** A chunk is "code" when its breadcrumb's first segment (the source file, set
 *  by codeChunker's relPath) routes to the code track. Prose/PDF chunks carry
 *  markdown/section headings instead, which route to 'doc'/'skip'. */
export function isCodeHit(hit: SearchHit): boolean {
  const hp = hit.heading_path
  return hp != null && hp.length > 0 && fileTrack(hp[0]!) === 'code'
}

/** True when `t` looks like a code identifier rather than a plain word — i.e.
 *  snake_case, a dotted path, or a camelCase / multi-word-PascalCase boundary.
 *  A bare lowercase word ("authentication") is intentionally NOT an identifier:
 *  boosting on it would fire on ordinary prose queries. */
function looksLikeIdentifier(t: string): boolean {
  if (t.length < 3) return false
  if (t.includes('_') || t.includes('.')) return true
  if (/[a-z][A-Z]/.test(t)) return true // camelCase boundary
  if (/^[A-Z][a-z].*[A-Z]/.test(t)) return true // multi-word PascalCase
  return false
}

/** Pull code-identifier candidates from a query (lowercased): camelCase,
 *  PascalCase, snake_case, and dotted paths (the whole path plus each part). */
export function extractCodeIdentifiers(query: string): string[] {
  const out = new Set<string>()
  for (const m of query.matchAll(/[A-Za-z_][A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
    const tok = m[0]
    if (!looksLikeIdentifier(tok)) continue
    out.add(tok.toLowerCase())
    if (tok.includes('.')) {
      for (const part of tok.split('.')) if (part.length >= 3) out.add(part.toLowerCase())
    }
  }
  return [...out]
}

/** Identifier tokens in their ORIGINAL casing ("RetrievalService.search"), for
 *  callers that must preserve them verbatim (the multi-query expansion guard —
 *  a paraphrase that rewrites an identifier loses the strongest BM25 anchor). */
export function extractRawIdentifiers(query: string): string[] {
  const out: string[] = []
  for (const m of query.matchAll(/[A-Za-z_][A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
    if (looksLikeIdentifier(m[0])) out.push(m[0])
  }
  return out
}

/** Subtokens of the query's code identifiers ("RetrievalService.search" →
 *  retrieval, service, search). The FTS index tokenizes "AuthService" as ONE
 *  token, so the reverse direction (query names the identifier, text carries the
 *  words) needs the split on the QUERY side to match prose/comments/log lines. */
export function identifierSubtokens(query: string): string[] {
  const out = new Set<string>()
  for (const m of query.matchAll(/[A-Za-z_][A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
    if (!looksLikeIdentifier(m[0])) continue
    for (const part of m[0].split(/[._]/)) {
      for (const w of part.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
        if (w.length >= 3) out.add(w.toLowerCase())
      }
    }
  }
  return [...out]
}

/**
 * Lexical query expansion for the BM25 arm in codebase workspaces (R3/R4). The
 * raw query reaches FTS5 untranslated, and unicode61 tokenizes "AuthService" as
 * one token — so a German lay query ("was macht die auth klasse") shares no
 * token with english code, and an identifier query can't match its own words in
 * prose. Append the German→english bridge terms and identifier subtokens to the
 * search string. Purely additive: toMatchQuery ORs the terms and bm25's IDF
 * ranks, so extra terms can only add candidates, never remove them.
 */
export function expandBm25Query(query: string): string {
  const extra = new Set<string>([...expandGermanCodeTerms(query), ...identifierSubtokens(query)])
  if (extra.size === 0) return query
  const present = new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  const add = [...extra].filter((t) => !present.has(t))
  return add.length > 0 ? `${query} ${add.join(' ')}` : query
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const DEF_KEYWORDS = 'function|class|def|interface|enum|type|namespace|struct|impl|trait|fn|func'

/** True when `text` DEFINES `id` — a keyword declaration (`function foo`,
 *  `class Foo`, `def foo`) or a method definition (`async foo(args): T {`), as
 *  opposed to merely referencing it. Catches the case the breadcrumb misses:
 *  a class method whose enclosing symbol is the class, not the method. */
function definesIdentifier(text: string, id: string): boolean {
  if (id.includes('.')) return false // only simple identifiers can be "defined"
  const e = escapeRegex(id)
  const re = new RegExp(
    `(?:\\b(?:${DEF_KEYWORDS})\\s+${e}\\b)` +
      `|(?:(?:^|\\n)[ \\t]*(?:(?:public|private|protected|static|async|readonly|export|abstract|override|get|set)[ \\t]+)*${e}[ \\t]*\\([^)]*\\)[ \\t]*[:{])`,
    'i',
  )
  return re.test(text)
}

/** Boost a code chunk whose enclosing symbol matches a query identifier
 *  (`symbolFactor`); when the breadcrumb symbol does NOT match, fall back to an
 *  in-text definition match (`defineFactor`) to catch class methods. Code
 *  chunks only — never boosts prose that merely mentions a symbol.
 *
 *  `laySymbolFactor` (R4): a natural-language query carries no identifier
 *  ("was macht die auth klasse" → extractCodeIdentifiers = []), so the exact
 *  symbol comparison never sees it. The lay branch matches non-stopword query
 *  tokens ≥4 chars (plus their German→english bridge) as SUBSTRINGS of the
 *  breadcrumb symbol, so "auth" lifts `AuthService`. Deliberately weaker than
 *  the exact match and off (1.0) outside codebase workspaces. */
// Generic function words ≥4 chars that survive nonStopwordTokens but must not
// lay-match symbols ("from" would boost every *From*/*from* symbol on any
// English question). Separate from TITLE_STOPWORDS on purpose — that set also
// drives title boost + router recall and is tuned not to eat topical nouns.
const LAY_TERM_STOPWORDS = new Set([
  'from',
  'does',
  'come',
  'where',
  'what',
  'when',
  'which',
  'this',
  'that',
  'into',
  'onto',
  'have',
  'been',
  'will',
  'then',
  'than',
  'they',
  'them',
  'your',
  'here',
  'there',
  'about',
  'work',
  'works',
  'wird',
  'werden',
  'haben',
  'macht',
  'machen',
  'über',
  'ohne',
  'beim',
  'eine',
  'einen',
  'diese',
  'dieser',
  'dieses',
])

export function applyCodeSymbolBoost(
  hits: SearchHit[],
  query: string,
  symbolFactor: number,
  defineFactor: number,
  laySymbolFactor = 1.0,
): SearchHit[] {
  if (symbolFactor <= 1.0 && defineFactor <= 1.0 && laySymbolFactor <= 1.0) return hits
  const ids = extractCodeIdentifiers(query)
  const layTerms =
    laySymbolFactor > 1.0
      ? [...new Set([...nonStopwordTokens(query), ...expandGermanCodeTerms(query)])].filter(
          (t) => t.length >= 4 && !LAY_TERM_STOPWORDS.has(t),
        )
      : []
  if (ids.length === 0 && layTerms.length === 0) return hits
  return hits.map((h) => {
    if (!isCodeHit(h)) return h
    const hp = h.heading_path!
    const symbol = hp.length > 1 ? hp[hp.length - 1]!.toLowerCase() : null
    const symbolMatch = symbol != null && symbolFactor > 1.0 && ids.some((id) => id === symbol)
    const layMatch =
      !symbolMatch && symbol != null && layTerms.some((t) => symbol.includes(t))
    const definesMatch =
      !symbolMatch && defineFactor > 1.0 && ids.some((id) => definesIdentifier(h.text, id))
    // Exclusive branches keep the intended hierarchy: exact breadcrumb match
    // (1.8) > in-text definition (1.4) > lay substring (1.3). Stacking define ×
    // lay would exceed the exact-match factor and invert the ordering.
    let f = 1.0
    if (symbolMatch) f *= symbolFactor
    else if (definesMatch) f *= defineFactor
    else if (layMatch) f *= laySymbolFactor
    return f !== 1.0 ? { ...h, score: h.score * f } : h
  })
}

/** Boost code chunks from a file the query names by its stem (e.g. asking about
 *  "RetrievalService" boosts chunks from `RetrievalService.ts`). `mode`:
 *   - 'exact'     (default): a query token must EQUAL the stem.
 *   - 'substring' (ADR-0006 fix #2): a query token is a substring of the stem (or
 *     vice-versa), so a lay word like "auth" boosts `AuthService.ts`. Guarded to
 *     tokens ≥4 chars to avoid firing on generic fragments. */
export function applyCodeFilenameBoost(
  hits: SearchHit[],
  query: string,
  factor: number,
  mode: 'exact' | 'substring' = 'exact',
): SearchHit[] {
  if (factor <= 1.0) return hits
  // German bridge: a query noun like "authentifizierung"/"einstellungen" expands
  // to the english code term ("auth"/"settings") so it can match an english stem.
  const terms = new Set<string>([
    ...nonStopwordTokens(query),
    ...extractCodeIdentifiers(query),
    ...expandGermanCodeTerms(query),
  ])
  if (terms.size === 0) return hits
  const subTerms = mode === 'substring' ? [...terms].filter((t) => t.length >= 4) : []
  return hits.map((h) => {
    if (!isCodeHit(h)) return h
    const stem =
      h
        .heading_path![0]!.toLowerCase()
        .replace(/\.[^.]+$/, '')
        .split('/')
        .pop() ?? ''
    if (!stem) return h
    const match =
      terms.has(stem) ||
      (mode === 'substring' && subTerms.some((t) => stem.includes(t) || t.includes(stem)))
    return match ? { ...h, score: h.score * factor } : h
  })
}

// ---------------------------------------------------------------------------
// File-role + intent heuristics (ADR-0006). Differentiate source code from its
// tests / evals / examples so "how does X work" ranks the IMPLEMENTATION, and
// route a "show me the test for X" question to the test instead. German-aware.
// ---------------------------------------------------------------------------

/** German code-concept noun → english code term(s), for lexical bridging when a
 *  German query has to match english symbols/filenames. The multilingual
 *  embedder covers semantics; this only helps the BM25 / filename / symbol
 *  boosts, which are lexical. Tight + high-precision on purpose. */
const GERMAN_CODE_TERMS: Record<string, string[]> = {
  // structure
  klasse: ['class'],
  funktion: ['function'],
  methode: ['method'],
  dienst: ['service'],
  schnittstelle: ['interface'],
  modul: ['module'],
  komponente: ['component'],
  baustein: ['component', 'module'],
  bibliothek: ['library'],
  paket: ['package'],
  abhängigkeit: ['dependency'],
  konstante: ['constant', 'const'],
  variable: ['variable'],
  typ: ['type'],
  // data + storage
  datenbank: ['database', 'db'],
  tabelle: ['table'],
  spalte: ['column'],
  zeile: ['row', 'line'],
  feld: ['field'],
  schlüssel: ['key'],
  fremdschlüssel: ['foreign', 'key'],
  primärschlüssel: ['primary', 'key'],
  wert: ['value'],
  datensatz: ['record', 'row'],
  datensätze: ['records', 'rows'],
  schema: ['schema'],
  migration: ['migration'],
  index: ['index'],
  indizes: ['indexes', 'index'],
  indexierung: ['indexing', 'index'],
  trigger: ['trigger'],
  transaktion: ['transaction'],
  prozedur: ['procedure'],
  entität: ['entity'],
  beziehung: ['relation', 'relationship'],
  verknüpfung: ['join', 'link'],
  sortierung: ['sort', 'order'],
  reihenfolge: ['order'],
  gruppierung: ['group'],
  anzahl: ['count'],
  zähler: ['counter', 'count'],
  summe: ['sum'],
  durchschnitt: ['average', 'avg'],
  zeitstempel: ['timestamp'],
  volltextsuche: ['fulltext', 'fts', 'search'],
  volltext: ['fulltext', 'fts'],
  sicherung: ['backup'],
  wiederherstellung: ['restore', 'recovery'],
  wiederherstellen: ['restore', 'recovery'],
  speicher: ['store', 'storage'],
  speicherung: ['storage'],
  zwischenspeicher: ['cache'],
  warteschlange: ['queue'],
  verzeichnis: ['directory', 'folder'],
  ordner: ['folder', 'directory'],
  pfad: ['path'],
  datei: ['file'],
  dokument: ['document', 'doc'],
  // security + auth
  verschlüsselung: ['encryption', 'crypto'],
  entschlüsselung: ['decryption', 'decrypt'],
  sitzung: ['session'],
  anmeldung: ['login', 'auth'],
  abmeldung: ['logout'],
  passwort: ['password'],
  passphrase: ['passphrase'],
  authentifizierung: ['auth', 'authentication'],
  authentifizierungs: ['auth', 'authentication'],
  autorisierung: ['authorization', 'auth'],
  berechtigung: ['permission'],
  rolle: ['role'],
  sperre: ['lock'],
  entsperren: ['unlock'],
  tresor: ['vault'],
  sicherheit: ['security'],
  anmeldedaten: ['credentials'],
  benutzer: ['user'],
  nutzer: ['user'],
  konto: ['account'],
  // pipeline / RAG domain
  abfrage: ['query'],
  anfrage: ['request', 'query'],
  antwort: ['response', 'answer'],
  suche: ['search'],
  übersetzung: ['translation'],
  übersetzer: ['translator'],
  einbettung: ['embedding'],
  abruf: ['retrieval'],
  zusammenfassung: ['summary', 'summarization'],
  transkription: ['transcription'],
  spracherkennung: ['transcription', 'speech'],
  modell: ['model'],
  sprachmodell: ['llm', 'model'],
  gewichtung: ['weight'],
  schwellwert: ['threshold'],
  schwelle: ['threshold'],
  bewertung: ['score', 'ranking'],
  rangfolge: ['ranking', 'rank'],
  ähnlichkeit: ['similarity'],
  vektor: ['vector'],
  arbeitsbereich: ['workspace'],
  // common operations (verbs users actually type)
  einfügen: ['insert', 'add'],
  löschen: ['delete', 'remove'],
  entfernen: ['remove', 'delete'],
  hinzufügen: ['add', 'insert'],
  erstellen: ['create'],
  speichern: ['save', 'store'],
  laden: ['load'],
  lesen: ['read'],
  schreiben: ['write'],
  senden: ['send'],
  empfangen: ['receive'],
  prüfsumme: ['checksum', 'hash'],
  hashwert: ['hash'],
  kennung: ['id', 'identifier'],
  bezeichner: ['identifier', 'symbol'],
  nebenläufigkeit: ['concurrency'],
  zustand: ['state'],
  muster: ['pattern'],
  vorlage: ['template'],
  // runtime + IO
  fehler: ['error'],
  ausnahme: ['exception'],
  protokoll: ['log', 'protocol'],
  protokollierung: ['logging'],
  ereignis: ['event'],
  nachricht: ['message'],
  unterhaltung: ['conversation', 'chat'],
  verlauf: ['history'],
  verbindung: ['connection'],
  netzwerk: ['network'],
  eingabe: ['input'],
  ausgabe: ['output'],
  konfiguration: ['config', 'configuration'],
  einstellung: ['settings'],
  einstellungen: ['settings'],
  umgebung: ['environment', 'env'],
  aktualisierung: ['update'],
  veröffentlichung: ['release'],
  bereitstellung: ['deploy', 'deployment'],
  herunterladen: ['download'],
  hochladen: ['upload'],
  // UI
  oberfläche: ['ui', 'interface'],
  ansicht: ['view'],
  schaltfläche: ['button'],
  fenster: ['window'],
  menü: ['menu'],
  seite: ['page'],
}

// Compound decomposition keys: map keys long enough that a prefix/suffix match
// inside a longer German compound ("datenbankschema", "konfigurationsdatei",
// "authentifizierungsdienst") is almost certainly a real morpheme boundary.
// Short keys are excluded (≥5 chars), plus known false-positive stems whose
// edges occur in unrelated everyday words: "kontrolle" is not about 'rolle',
// "versuche"/"anmeldeversuche" not about 'suche', "wiederherstellen" not about
// 'erstellen', "beziehungsweise" not about 'beziehung'.
const COMPOUND_EXCLUDED = new Set([
  'rolle',
  'seite',
  'laden',
  'lesen',
  'suche',
  'erstellen',
  'beziehung',
])
let compoundKeys: string[] | null = null
function getCompoundKeys(): string[] {
  compoundKeys ??= Object.keys(GERMAN_CODE_TERMS).filter(
    (k) => k.length >= 5 && !COMPOUND_EXCLUDED.has(k),
  )
  return compoundKeys
}

/** English code terms implied by any German code-noun in the query. Inflected
 *  forms ("klassen", "dienste", "abfragen") resolve via light suffix stripping,
 *  and unmapped compounds fall back to their leading/trailing morpheme so the
 *  map doesn't have to enumerate every composition. */
export function expandGermanCodeTerms(query: string): string[] {
  const out = new Set<string>()
  for (const tok of query.toLowerCase().split(/[^a-zäöüß]+/)) {
    const mapped = lookupGermanCodeTerm(tok)
    if (mapped) for (const e of mapped) out.add(e)
  }
  return [...out]
}

function lookupGermanCodeTerm(tok: string): string[] | undefined {
  const direct = GERMAN_CODE_TERMS[tok]
  if (direct) return direct
  for (const suffix of ['es', 'en', 'e', 'n', 's']) {
    if (tok.length - suffix.length >= 4 && tok.endsWith(suffix)) {
      const base = GERMAN_CODE_TERMS[tok.slice(0, -suffix.length)]
      if (base) return base
    }
  }
  // Compound fallback: "datenbankschema" → database/db (starts with) + schema
  // (ends with). Only edge morphemes — a mid-word hit is too false-positive-
  // prone. Both edges can contribute ("datenbanktabelle" → database + table).
  if (tok.length >= 8) {
    const out = new Set<string>()
    for (const key of getCompoundKeys()) {
      if (tok.length - key.length >= 3 && (tok.startsWith(key) || tok.endsWith(key))) {
        for (const e of GERMAN_CODE_TERMS[key]!) out.add(e)
      }
    }
    if (out.size > 0) return [...out]
  }
  return undefined
}

// Test-intent: the user is asking ABOUT tests, not the implementation. EN + DE.
// `\btest` (no trailing boundary) catches test/tests/testfall/testen/testing.
const TEST_INTENT_PATTERNS: RegExp[] = [
  /\btest/i,
  /\bspecs?\b/i,
  /\bcoverage\b/i,
  /\babdeckung\b/i,
  /\bgetestet\b/i,
  /\bgepr[üu]f/i,
  /\bpr[üu]fung\b/i,
  /\bvalidier/i,
  /\be2e\b/i,
]

/** True when the query is about TESTS (so role-boost prefers test files). */
export function detectTestIntent(query: string): boolean {
  return TEST_INTENT_PATTERNS.some((re) => re.test(query))
}

/**
 * Role-aware boost (ADR-0006). "Code is logic, test is test" — the two are kept
 * apart SYMMETRICALLY by query intent:
 *   - logic-intent (default "how does X work"): push tests / evals / examples /
 *     config / generated BELOW the implementation (×nonSourcePenalty).
 *   - test-intent ("the test for X", "wie wird X getestet"): lift test/eval
 *     (×testBoost) AND demote the implementation (source ×nonSourcePenalty), so
 *     the TEST dominates instead of its subject.
 * Code chunks only — role derives from the same heading_path[0] isCodeHit routes
 * on, so it's a pure retrieval-time signal with no re-ingest. No-op in document
 * workspaces (no source-vs-test distinction).
 */
export function applyRoleBoost(
  hits: SearchHit[],
  query: string,
  opts: { nonSourcePenalty: number; testBoost: number },
): SearchHit[] {
  const testIntent = detectTestIntent(query)
  return hits.map((h) => {
    if (!isCodeHit(h)) return h
    const role = fileRole(h.heading_path![0]!)
    if (testIntent) {
      if (role === 'test' || role === 'eval') return { ...h, score: h.score * opts.testBoost }
      // Demote the implementation so the test isn't out-ranked by its subject.
      if (role === 'source' && opts.nonSourcePenalty !== 1.0) {
        return { ...h, score: h.score * opts.nonSourcePenalty }
      }
      return h
    }
    return isSecondaryCodeRole(role) && opts.nonSourcePenalty !== 1.0
      ? { ...h, score: h.score * opts.nonSourcePenalty }
      : h
  })
}

// Explicit DOCS/concept request — the user wants the prose, not the code. Narrow
// on purpose (generic "how does X work" is NOT here; it's code-intent). EN + DE.
const DOCS_INTENT_PATTERNS: RegExp[] = [
  /\bdocs?\b/i,
  /\bdocumentation\b/i,
  /\breadme\b/i,
  /\bconcept(s|ual)?\b/i,
  /\boverview\b/i,
  /\bguide\b/i,
  /\barchitecture\b/i,
  /\bdokumentation\b/i,
  /\bhandbuch\b/i,
  /\bkonzept(e|ion)?\b/i,
  // JS \b is ASCII-only — it does NOT match before a leading 'ü', so these
  // umlaut-leading stems drop \b and rely on stem uniqueness (cf. router.ts).
  /[üu]berblick/i,
  /[üu]bersicht/i,
  /\banleitung\b/i,
  /\bleitfaden\b/i,
  /\berkl[äa]r/i,
  /\bbeschreib/i,
]

/** True when the user explicitly asks about docs/concepts (so code-over-docs
 *  preference backs off and prose competes normally). */
export function detectDocsIntent(query: string): boolean {
  return DOCS_INTENT_PATTERNS.some((re) => re.test(query))
}

// Code-intent: the user names a code construct (class/function/…), a literal
// identifier, or asks how something is implemented/works. EN + DE. Structural
// nouns only — domain nouns (auth, settings) stay neutral so a conceptual
// question isn't force-routed to code.
const CODE_INTENT_PATTERNS: RegExp[] = [
  /\b(class(es)?|function(s)?|func|methods?|services?|interfaces?|modules?|components?|hooks?|endpoints?|handlers?|implement(s|ation|ed)?)\b/i,
  /\b(klasse(n)?|funktion(en)?|methode(n)?|dienst(e)?|schnittstelle(n)?|modul(e)?|komponente(n)?|implementier)\b/i,
  /\bhow (does|is|do|are)\b/i, // "how does X work", "how is X implemented"
  /\bwhere (is|are)\b/i,
  /\bwie funktioniert\b/i,
  /\bwie wird\b/i,
  /\bwo (wird|ist|werden|sind)\b/i,
  // 0.6.4: broaden prose→code coverage. High-precision phrasings that clearly
  // ask about code without naming a structural noun or literal identifier, so a
  // codebase workspace routes them to code (applyTrackPreference). Kept tight:
  // detectDocsIntent still backs off explicit docs/concept requests, and a false
  // positive only demotes doc chunks by docPenalty (they still surface via
  // ensureCodeShare) — cheaper than a false negative leaving code/prose flat.
  /\bwhat (calls|invokes|triggers|handles|instantiates|imports|extends|returns)\b/i,
  /\bwhich (file|function|class|method|module|component|service|handler|route|endpoint|variable|constant)\b/i,
  /\bwelche(s|r|n)? (datei|funktion|klasse|methode|komponente|route|variable|konstante)\b/i,
  /\bwo (befindet|liegt)\b/i, // "wo befindet sich X" / "wo liegt X" — code location
  /\bwas ruft\b/i, // "was ruft X auf" — what calls X
]

/** True when the query is about CODE/implementation rather than concepts. */
export function detectCodeIntent(query: string): boolean {
  if (extractCodeIdentifiers(query).length > 0) return true
  return CODE_INTENT_PATTERNS.some((re) => re.test(query))
}

/**
 * Code-over-docs preference for codebase workspaces (ADR-0006). The user's rule:
 * a code question ("how does the auth class work", "the Login funktion") should
 * return CODE; a generic/conceptual one may go to docs. So when the query is
 * code-intent AND not an explicit docs request, push doc-track chunks below code
 * by `docPenalty`. Generic queries and explicit doc/concept requests are left
 * untouched (prose competes normally). Caller gates this to codebase workspaces.
 */
export function applyTrackPreference(
  hits: SearchHit[],
  query: string,
  opts: { docPenalty: number },
): SearchHit[] {
  if (opts.docPenalty >= 1.0) return hits
  if (detectDocsIntent(query) || !detectCodeIntent(query)) return hits
  return hits.map((h) => (isCodeHit(h) ? h : { ...h, score: h.score * opts.docPenalty }))
}

/**
 * Score-gap dynamic-K (ADR-0006 fix #3). Returns how many of the score-sorted
 * `sorted` hits to keep: walk down from `minK`, stop at the first big relative
 * drop (a hit whose sigmoid-normalised score falls below `tau` of the previous),
 * clamped to [minK, maxK]. Sigmoid-normalising makes the ratio well-defined for
 * cross-encoder logits (which can be negative). A precision knob, not a recall
 * one — opt-in, so it can be A/B-ed against fixed-K on the answer-quality eval.
 */
export function dynamicScoreCutCount(
  sorted: SearchHit[],
  minK: number,
  maxK: number,
  tau = 0.6,
): number {
  const n = Math.min(maxK, sorted.length)
  if (n <= minK) return n
  const norm = (s: number): number => 1 / (1 + Math.exp(-s))
  let k = minK
  for (let i = minK; i < n; i++) {
    const prev = norm(sorted[i - 1]!.score)
    const cur = norm(sorted[i]!.score)
    if (prev > 0 && cur < prev * tau) break
    k = i + 1
  }
  return Math.max(minK, Math.min(k, n))
}

/**
 * Guarantee code chunks at least `minCode` of the final top-K. When the chosen
 * `topK` is code-starved, inject the best code hits from `pool` that aren't
 * already present, evicting the lowest-scoring DOC hits to keep length == k.
 * No-op when the top-K already has enough code or the pool has no more.
 * (The per-*track* analogue of diversifyByDocument; pool assumed best-first.)
 */
export function ensureCodeShare(
  topK: SearchHit[],
  pool: SearchHit[],
  k: number,
  minCode: number,
): SearchHit[] {
  if (minCode <= 0) return topK
  const codeInTop = topK.filter(isCodeHit).length
  if (codeInTop >= minCode) return topK
  const inTop = new Set(topK.map((h) => h.chunk_id))
  const candidates = pool.filter((h) => isCodeHit(h) && !inTop.has(h.chunk_id))
  const need = Math.min(minCode - codeInTop, candidates.length, k)
  if (need === 0) return topK
  const inject = candidates.slice(0, need)
  const lowestDocs = topK
    .filter((h) => !isCodeHit(h))
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, need)
  const remove = new Set(lowestDocs.map((h) => h.chunk_id))
  const kept = topK.filter((h) => !remove.has(h.chunk_id))
  return [...kept, ...inject].sort((a, b) => b.score - a.score)
}
