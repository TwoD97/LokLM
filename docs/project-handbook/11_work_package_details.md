# Arbeitspaket-Details

Dieses Kapitel beschreibt die wichtigsten Arbeitspakete im Detail (Ziel, technische
Umsetzung, relevante Dateien, Entscheidungen, Probleme/Lösungen, Stand, offene Punkte,
Nachweise). Die Kern-APs (AP-E.2, AP-T.2, AP-T.1, Auth/Krypto-Fundament, RAG-Core +
QA-Routing, Installer-Pivot) sind ausführlich; kleinere Pakete knapp mit Verweis auf die
AP-Landkarte (`10_work_package_landscape.md`). Belege: Abschluss-Dokus und Laborberichte
unter `docs/work/` (gitignored), ADRs unter `docs/adr/`, Commit-/PR-Historie.

---

## 11.1 AP-E.2 — Kartesische RAG-Matrix-Evaluation (Kern, Dominik)

**Status:** teilweise — Phase 1 lokal umgesetzt; **Phase 2 (GPU-Sweep) offen**.
**Branch:** `dom/ap-e2-matrix-eval`.

### Ziel

Eine kartesische Matrix-Evaluation der RAG-Pipeline über vier Achsen — **Embedder ×
Reranker × Chunker × LLM** — gegen einen echten, von der Schule bereitgestellten
**LAP-Korpus**, mit retrieval- **und** antwortbezogenen Metriken (Span-Recall, nDCG,
recall@k sowie LLM-Judge). AP-E.2 verbraucht das Dev-Set aus AP-E.1 und das Hold-out aus
AP-E1b und soll für den Abgabe-Laborbericht/das Paper belastbare, reproduzierbare
Vergleichszahlen liefern.

### Technische Umsetzung (Phase 1)

- **Span-Overlap-Retrieval-Metriken** — chunker-unabhängige Bewertung über
  „Gold-Spans" (Zeichen-Offsets im Quelltext) statt über Chunk-IDs. Dadurch sind
  Retrieval-Ergebnisse über unterschiedliche Chunk-Größen hinweg vergleichbar
  (Commits `6a5e27e`, `4316842`; Char-Offsets auf Source-Chunks `5229018`;
  `goldSpans` + Sprach-/Refusal-Felder auf den Fragen `7ea2083`). Die Metrik ist in
  den Sweep verdrahtet (`cd10138`); Span-r@10/nDCG werden pro Frage in `result.json`
  geschrieben (nicht in die Summary-Tabelle, `e95d441`).
- **LAP-Korpus → Dataset-Converter** — wandelt den echten Schul-Korpus + die
  generierten Fragen in ein `lap-dataset.json` um, inkl. Erhalt der Refusal-Fragen
  (`ba4ecc9`, `ba9193b`, robuster CLI-Entry-Guard `6a7cd2b`).
- **Matrix-Achsen aus Modell-Packs** — Embedder-/Reranker-/Chunker-Achsen werden aus
  Pack-Definitionen gebildet; die Bridges tragen Label-basierte Namen und dynamische
  Embedding-Dimensionen mit Query/Doc-Prefixes (`2d26fb4`, `fb90eaf`, `862ec05`).
  Ein Detail-Fix sanitisiert den Embed-Text **vor** dem Prefixen, um Content-Trunkierung
  zu vermeiden (`deb2d33`).
- **Chunker-Achse bewusst auf 1 reduziert** — der Sweep re-chunkt **nicht** pro Config,
  sondern nutzt das vorab gechunkte `dataset.chunks`; eine Mehr-Größen-Achse wäre
  wirkungslos (3× identische Ergebnisse). Der Chunk-Größen-Vergleich läuft korrekt als
  **separate Läufe** (pro Größe ein eigenes Dataset) und wird über die
  chunker-unabhängige Span-Recall-Metrik verglichen. Dies ist als Single-Source-of-Truth
  in `tests/evals/answer/matrix-manifest.ts` (`MATRIX_CHUNKER_SPECS`, derzeit
  `fixed-512-64`) kodifiziert (`832a90f`, `56fa70e`).
- **Pre-Run-Manifest + Multi-Pod-Sharding** — ein Pre-Run-Manifest-Builder fasst die
  geplanten Zellen + Laufzeitschätzung zusammen (`7aef087`); deterministische, disjunkte
  Round-Robin-Shards (`parseShard`/`selectShard`) erlauben das Aufteilen der Matrix über
  mehrere GPU-Pods (`239dad9`, `f1f829a`). Per-Modell-Done-Marker erlauben Resume nach
  Abbruch (`0bf771a`).
- **Lizenz-Gate (OSI-strict)** — ein Lizenz-Validator gated die Matrix-Skripte und den
  Download-Tier auf OSI-konforme, offene Modelle; das Pack umfasst OSI-only-Modelle
  (15 LLM / 8 Embedder / 2 Reranker) plus ein separates Open-Weights-Risiko-Pack
  (`f1418f6`, `7e817d9`, `5c89369`, `cd214a8`). Verifizierbar über `evals:licenses:check`.

**Relevante Dateien:** `tests/evals/answer/matrix-manifest.ts` (Shard-/Chunker-Achse +
Manifest), `tests/evals/answer/run-pack.ts` (Pack-Runner), `tests/evals/pipeline/configs.ts`
(`PipelineConfig` = chunker + embedder + reranker + sweep-Scalars + optional LLM-Bridge),
Span-Metrik + Bridges unter `tests/evals/`.

### Wichtige Entscheidungen

- **Span-Recall statt Chunk-ID-Recall** — macht Retrieval-Qualität über Chunk-Größen
  hinweg vergleichbar; Voraussetzung dafür, dass die Chunker-Achse als separate Läufe
  fair gemessen werden kann.
- **Genau ein geteiltes LLM in der Matrix** — ein Refactor stellt per Assertion sicher,
  dass die Matrix-Zellen ein einziges, geteiltes LLM nutzen (Top-Level-Node-Imports,
  `52cb90f`), um GPU-Speicher und Vergleichbarkeit zu wahren.
- **OSI-only-Download-Tier** — bewusst lizenzkonforme Modellauswahl, damit die
  Eval-Ergebnisse veröffentlichbar/reproduzierbar bleiben.

### Probleme und Lösungen

- **OCR-Artefakte + Meta-Fragen im LAP-Korpus** — bei der Q&A-Generierung am echten
  Schul-Korpus traten Meta-Fragen und OCR-Fehler zutage. Lösung: Korpus auf einen
  **UTF-8-Neuauszug** umgestellt (von 440 auf 8.865 korrekte Umlaute) **vor** den
  Matrix-Läufen (belegt in `projektstatusbericht-2026-06-14.md`).

### Aktueller Stand und offene Punkte

- **Erreicht (Phase 1):** LAP-Korpus auf **90 Dokumente** triagiert; **163 deutsche
  RAG-Fragen** (148 answerable + 15 refusal) generiert und verifiziert; `lap-dataset.json`
  mit **2.322 Chunks** und verifizierten Gold-Spans gebaut. Matrix-Verdrahtung
  (`matrix-manifest.ts`, `run-pack.ts`, `configs.ts`), Sharding, Lizenz-Gate und
  Span-Metrik sind committet.
- **Offen (Phase 2 — der eigentliche GPU-Sweep):** Der kartesische Sweep
  (Embedder × Reranker × Chunker × LLM) auf RunPod-GPU ist **noch nicht gefahren**;
  Span-Recall/nDCG-Auswertung und die Überführung ins Abgabe-Paper/den Laborbericht
  stehen aus. Der Abgabe-Scope (Anzahl Zellen/Modelle/Datensätze) ist als „notwendige
  Entscheidung" markiert (rechenintensiv, Multi-Pod-GPU).

> ⚠️ Status unklar: Zwischen dem Bericht vom 14.06. („Matrix-Verdrahtung noch
> uncommittet") und der aktuellen Branch-Spitze sind die Matrix-Skripte inzwischen
> committet (`f1f829a`, `5c89369` u. a.). Der Phase-2-Sweep selbst ist jedoch weiterhin
> **offen** — der genaue Lauf-/Auswertungsstand ist vor Abgabe durch das Team zu
> bestätigen.

**Nachweise:** Commits `6a5e27e`…`5c89369` auf `dom/ap-e2-matrix-eval`;
`projektstatusbericht-2026-06-14.md` (Phase 18). Spec/Plan sind gitignored.

---

## 11.2 AP-T.2 — Integrationstests (§8.2 E2E) (Kern, Dominik)

**Status:** fertig (Code), im Review — **PR #19**. **Branch:** `dom/ap-t2-integrationstests`.

### Ziel

Die drei End-to-End-Tests aus Pflichtenheft/Strukturplan §8.2 — DocumentService,
RetrievalService, Auth — gegen **reale Services und echte Datenbank** (PGlite), ohne
Mocks, plus den ersten echten vitest-CI-Job [11] im Repository.

### Technische Umsetzung

Alle drei Suiten booten eine echte In-Memory-**PGlite** [3] (inkl. pgvector [4] + Drizzle [5]- und
Raw-SQL-Migrationen) über `AuthService.register`; Muster der bestehenden Integrationstests
(`mkdtemp` + `AuthService` + `WorkspaceService`, `importFile` mit Fake-Sender, Polling auf
`IndexProgress`-Phase `done`). Tabelle 11.1 fasst die drei Suiten zusammen.

**Tabelle 11.1:** Integrationstest-Suiten (AP-T.2).

| Suite | Datei | Tests | CI | Laufzeit |
|---|---|---|---|---|
| DocumentService E2E | `tests/integration/document-pdf-e2e.test.ts` | 3 | läuft (modellfrei) | ~11 s |
| RetrievalService E2E | `tests/integration/retrieval-corpus-e2e.test.ts` | 3 | skippt (modell-gated) | ~51 s |
| Auth E2E §8.2 | `tests/integration/auth-e2e.test.ts` | 1 | läuft | ~8 s |

- **DocumentService E2E:** committetes `sample.pdf` importieren → `documents`-Zeile auf
  `ready`, Chunks vorhanden, `chunk_count` exakt; Volltextsuche über den Index
  `idx_chunks_fts`; `chunk_count` folgt auch dem DELETE-Pfad des Statement-Triggers.
- **RetrievalService E2E:** 60-Chunk-Korpus, jede der 10 Fragen muss ihre `##`-Sektion
  im Top-5 treffen; In-Prozess-Determinismus; alle nicht-deterministischen Stellschrauben
  (Rerank, Multi-Query, Recency-Boost, Whole-Doc-Fallback) fixiert. Läuft gegen das
  **echte BGE-M3-GGUF** [17] (in-process), per `describe.runIf(GGUF vorhanden)` gegated.
- **Auth E2E §8.2:** voller Round-Trip Register → Login → Verschlüsseln → Neustart →
  Entschlüsseln → Recovery-Reset → neuer Login, mit Datenpersistenz-Prüfung über den
  verschlüsselten Vault-Snapshot.
- **Reproduzierbares Korpus:** `tests/fixtures/retrieval/korpus.ts` (10 Dokumente /
  60 Chunks / 10 Fragen, DE+EN), gegen den echten BGE-M3 eindeutig auflösbar verifiziert.
- **Erster vitest-CI-Job:** `.github/workflows/checks.yml` um `pnpm test:integration` +
  `pnpm test:tx` ergänzt (Timeout 15 min) — der **erste** Test-Job im Repo (CI baute
  bisher nur die Website). Damit vitest auf Ubuntu ohne Electron-Runtime [1] lädt, wurde ein
  schlanker **Electron-Stub** ergänzt (`tests/helpers/electron-stub.ts` + Alias in
  `vitest.workspace.ts`).

### Wichtige Entscheidungen

- **Volltextsuche statt toter Spalte:** Die Spec nennt eine `text_search`-Spalte; Migration
  `0006` hat Spalte **und** Trigger durch den GIN-Expression-Index `idx_chunks_fts` ersetzt.
  Der Test prüft das **heutige Äquivalent** (Beleglage vor Spec-Wortlaut).
- **Echter Embedder statt Fakes:** Roundtrip gegen das echte BGE-M3, damit der Test real
  ist — konsistent mit den bestehenden modellgebundenen Suiten.

### Probleme/Lösungen und an die Logik-Domäne gemeldet

- **Electron-Runtime fehlt in CI:** mehrere Suiten importieren `electron` → Ladefehler auf
  Ubuntu. Gelöst über den Electron-Stub statt Deaktivierung der Suiten.
- **An Denys gemeldet (nur Hinweis):** (1) `searchChunks`/`searchChunksByVector` ohne
  Tie-Break im `ORDER BY` → Cross-Session-Determinismus nicht garantiert (Empfehlung:
  zweiter Sortierschlüssel); (2) `document-import.test.ts` mit fixem `setTimeout(2000)` →
  Flake-Risiko (Empfehlung: Polling-`waitFor`).

### Stand und offene Punkte

CI-Job (integration + tx) grün (~2:40 min), Gesamtlaufzeit lokal ~70 s. PR #19 mergebar,
alle Checks grün — nur durch Branch-Protection/Review gehalten. Offen: Review-Freigabe +
Merge; Entscheidung, ob die modell-gated RetrievalService-E2E zwingend in CI laufen soll
(Modell-Download-Step → Laufzeit/Kosten).

**Nachweise:** PR #19; `ap-t2-abschluss-doku.md`; `Laborbericht_LokLM_2026-06-12.md`;
Commits `3e0a4d2`, `9644d60`, `48255ab`.

---

## 11.3 AP-T.1 — Unit-Tests ≥70 % Branch-Coverage (Dominik)

**Status:** fertig (Code), im Review — **PR #24**. **Branch:** `dom/ap-t1-unit-tests`.

### Ziel

Vitest-Unit-Tests mit Branch-Coverage ≥70 % (und Statement-Coverage ≥80 %) in den
Kernmodulen `chunker`, `parser`, RetrievalService-RRF, Citation-Parser und den
Auth-Hashing-Wrappern. Nachweis lokal über `pnpm run test:cov:apt1` (96 Tests grün). Tabelle 11.2 zeigt die erreichte Coverage je Modul.

**Tabelle 11.2:** Unit-Test-Coverage je Kernmodul (AP-T.1).

| Modul | % Stmts (≥80) | % Branch (≥70) |
|---|---|---|
| `chunker.ts` | 95.4 | 93.8 |
| `parser.ts` | 88.7 | 78.4 |
| `rrf.ts` (RRF) | 100 | 100 |
| `citationMarkers.ts` | 96.3 | 88.9 |
| `AuthService.ts` (Hashing-Wrapper) | 83.1 | 74.2 |

### Technische Umsetzung und Entscheidungen

- **Neue Tests:** `auth-crypto.test.ts` (15 Tests, direkte Krypto-Wrapper: Argon2id
  `deriveKEK`, AES-256-GCM `wrapKey`/`unwrapKey`/`decryptBody` inkl. Tamper-/Wrong-Key-/
  Längen-Branches), `auth-service-guards.test.ts` (13 Tests, locked-state-Guards +
  Eingabevalidierung), `parser-ocr.test.ts` (3 Tests, OCR-/Scan-Pfade mit gemocktem
  OCR-Layer → hebt `parser.ts` von 79.5 % auf 88.7 % Statements), `parser.test.ts` (+2:
  UTF-8-BOM-Strip, unsupported Endung).
- **Schlüsselentscheidung — kein „PBKDF2-Wrapper":** Das Ticket nennt PBKDF2; implementiert
  ist Argon2id ([ADR-0001](../adr/0001-argon2id-password-kdf.md) verwirft PBKDF2 zugunsten
  memory-hard Argon2id, Bitwarden-Profil m=64 MiB/t=3/p=4). Getestet werden die real
  implementierten Wrapper — Ticket-Text insoweit veraltet.
- **Wrapper minimal exportiert** (nur Test-Sichtbarkeit der Fehler-Branches, keine
  Logikänderung); OCR-Pfade gemockt (kein tessdata/echte Engine, innerhalb des
  Unit-Kriteriums „keine externen Services").
- **Scoped DoD-Skript `test:cov:apt1`:** Der Branch zweigt von `main`; die volle Suite
  enthält die AP-T.2-Embedder-Tests, die den Electron-Stub aus PR #19 brauchen (noch nicht
  in `main`). Sobald #19 gemergt ist, wird der Voll-Suite-Lauf das natürliche Gate.

**Nachweise:** PR #24; `ap-t1-abschluss-doku.md`; Commits `0fcdef8`, `53441c1`; ADR-0001/0002.

---

## 11.4 Auth- und Krypto-Fundament (Kern, Partner / Denys)

**Status:** fertig (Fundament aus Phase 1, fortlaufend gehärtet).

### Ziel und Umsetzung

Lokaler, offline arbeitender Tresor (Vault) mit passwortabgeleiteter Verschlüsselung und
Recovery-Mechanismus — das Sicherheits-Fundament für die gesamte App.

- **Schlüsselableitung:** **Argon2id** [6] statt PBKDF2 ([ADR-0001](../adr/0001-argon2id-password-kdf.md)),
  memory-hard gegen GPU/ASIC-Angriffe.
- **Envelope-Encryption:** Passwort-KEK umschließt einen Daten-Schlüssel (DEK);
  Dokumente/Daten werden mit AES-256-GCM [7] verschlüsselt
  ([ADR-0002](../adr/0002-envelope-encryption-aes-gcm.md)). Recovery läuft über eine
  18-Wort-Passphrase, die den DEK separat umschließt — Passwort-Reset ohne Datenverlust.
- **Persistenz:** Drizzle-ORM über **PGlite** (Postgres-in-Process) mit pgvector; das
  Auth-/Vault-Fundament entstand in Phase 1 (`projektstatusbericht-2026-05-22.md`).

### Härtung (fortlaufend)

- **Argon2-Flake** unter parallelem Test-Load → Timeouts auf 45 s erhöht (Commit `16ffe4a`).
- **Vault-Writes serialisiert**, Login-/Auto-Lock-Fehlerpfade aufgeräumt (`c1f106b`).
- **Electron-Sicherheitshärtung:** mlock-geschützter Schlüsselspeicher zusätzlich zu CSP,
  Sandbox, Fuses (`04b318d`, siehe Abschnitt 11.6).

### Verifizierter Stand (Gate G2)

Der §8.2-Auth-E2E lief am 29.05. grün auf HW-1 (`1 passed (~4,8 s)`, Stand v0.3.1) — **Gate
G2 grün** (`Laborbericht_LokLM_2026-05-29.md`). Test eingeführt in `6610cef` (PR #6), später
als AP-T.2-Suite ausgebaut.

**Nachweise:** ADR-0001, ADR-0002; `ap-t1-abschluss-doku.md` (Wrapper-Tests);
`Laborbericht_LokLM_2026-05-29.md` (G2).

> ⚠️ zu verifizieren: Die Auth-/Krypto-Logik liegt in der Partner-Domäne; die obige
> Beschreibung stützt sich auf ADRs, Test-Dokus und Berichte. Implementierungsdetails über
> die ADRs hinaus sind durch den Partner zu bestätigen.

---

## 11.5 RAG-Core und QA-Routing (Kern, Partner / Denys)

**Status:** fertig (`main`), fortlaufend erweitert.

### Ziel und Pipeline

Retrieval-augmented Generation [26] über die Nutzer-Dokumente, vollständig offline, mit
klickbaren Quellenverweisen. Die Basis-Pipeline kombiniert **BM25 [24] + Dense-Retrieval + RRF**
(Reciprocal Rank Fusion) [8], optionalem Reranking, gefolgt von der LLM-Antwort mit
Citation-Markern (`[doc:X, chunk:Y]`). Die Provider-Abstraktion erlaubt Bundled-Modelle
oder externes Ollama [22] (Phase 4).

### QA-Routing (ADR-0003, Phase 17)

Vor ADR-0003 lief **jede** Frage durch dieselbe Chunk-Pipeline. Zwei Fragetypen waren so
strukturell nicht beantwortbar: „Fasse Dokument X zusammen" und „Wie viele/welche
Dokumente habe ich zu Y". ADR-0003 führt einen **regex-first Dispatcher** (kein LLM auf dem
Hot-Path) mit drei Routen ein, Präzedenz `corpus > doc_summary > retrieval`:

- **`corpus`** — Aggregations-/Zählfragen, beantwortet aus der `documents`-Tabelle
  (typisierte Drizzle-Query, kein LLM).
- **`doc_summary`** — „fasse X zusammen", gecachter Whole-Doc-Summary als unzitierter
  Context-Preamble.
- **`retrieval`** — Default; jeder Routing-Miss fällt **still** hierauf zurück
  (False-Negative ist die billigere Fehlentscheidung).

Ergänzend: **Multi-Question-Decomposition** (Zerlegung an `?`-Grenzen, separates Retrieval
je Teilfrage, RRF-Fusion) und ein **Per-Dokument-Summary-Embedding-Index** (Migration
0010, `vector(1024)`, sequenzieller Cosine-Scan statt HNSW [25]). Der ADR ist bemerkenswert
gründlich: Drei produktive OSS-Implementierungen (LlamaIndex, GraphRAG, RAGFlow) wurden im
Quelltext studiert und in einer Adopt/Reject-Tabelle gegen die LokLM-Constraints
(CPU-Preset, kein-LLM-vor-Retrieval, offline) abgewogen.

**Relevante Dateien (aus ADR-0003):** `src/main/services/qa/router.ts`,
`qa/QAService.ts`, `qa/corpusAnswer.ts`, `retrieval/RetrievalService.ts`,
`db/migrations/0010_document_summary_embedding.sql`.

### Weitere RAG-Bausteine

- **Embedder-Identity & Re-Index-Gate** — stale Chunks bei Embedder-Wechsel purgen,
  Dimension-Mismatch ablehnen (Phase 4).
- **OCR** [13] für gescannte PDFs/Bilder + dedizierter Documents-Worker + Orphan-Sweep
  (Phase 9, v0.3.1).
- **Robustheits-Fixes** (Embedder-Count, QA-Cancel, Download-Write-Errors; Phase 9).

**Nachweise:** ADR-0003; `projektstatusbericht-2026-06-07.md`/`-06-14.md` (Phasen 4/9/17).

---

## 11.6 Installer-Pivot (Kern, Partner / Denys; Wizard-UI: Dominik)

**Status:** fertig — zwei aufeinanderfolgende Pivots; Multi-OS-Härtung fortlaufend.

Der Installer durchlief zwei bewusste Kurswechsel — ein lehrreiches Beispiel für
pragmatische Architektur-Entscheidungen:

### Pivot 1 — Custom-NSIS → Electron-Bootstrapper (Phase 5)

Dominik baute zunächst einen aufwendigen **Custom-NSIS-Wizard** (17-Task-TDD-Plan,
dark-themed Design, SVG→BMP3-Exporter mit `sharp`, fünf Test-Tiers inkl. makensis-Lint und
Artifact-Smoke-Test). Trotz funktionierender Pipeline wurde der Stack **verworfen**: Der
Maintenance-Overhead (makensis-Toolchain, BMP3-Pflichtformat, NSIS-Sprache) stand in keinem
guten Verhältnis zum Mehrwert. Ersatz: **electron-builder Portable-Target** [27] (7zSD-Self-
Extractor) — übernimmt Splash, Self-Extract und UAC out-of-the-box. Dominik lieferte
parallel das moderne **Electron-Bootstrapper-UI** (`installer-ui/`, HTML/CSS-Splash, i18n
DE/EN, Retry-Button). Problem dabei: `cp()` versuchte `app.asar` als Verzeichnis zu
kopieren (Electron macht asar-Inhalte transparent) → in `process.noAsar`-Block gewrappt
(`adf5b7b`).

### Pivot 2 — Embedded-Payload → Download-Stub + Multi-OS-Wizard (Phase 8, v0.3.0)

Die eingebettete Modell-Payload (~500 MB) wurde gedroppt; der Installer schrumpfte auf
**~8 MB (lzma)**. Ein plattformübergreifender **Rust/Tauri-Wizard** [28] (Windows/Linux/macOS)
lädt die Modelle zur Laufzeit nach (Payload-Manifest-Reader mit per-Target-URL + optionaler
CUDA-Checkbox, tar.zst-Extract mit Traversal-Guard, Mac-LaunchAgent + Uninstaller). Viele
Plattform-Detail-Probleme wurden gelöst (Win11-IDT-Blockade → Umbenennung; `taskkill`
schloss den Wizard selbst → eigene PID ausgeschlossen; Bunny-401 → HEAD-Verify non-fatal).
Begleitend ein **Tier-System** (lite/standard/pro) mit Hardware-Check und Tier-Picker
(Phase 7).

> Konsequenz für die Entwicklung: Der Wizard ist eine Rust/Tauri-Anwendung — ein lokaler
> Installer-Build braucht die Rust-Toolchain (`cargo`). Auf Dominiks Rechner fehlt diese,
> weshalb offizielle Installer auf dem Partner-Rechner entstehen und lokal stattdessen ein
> robocopy-In-Place-Update genutzt wird (`Laborbericht_LokLM_2026-05-29.md`).

**Nachweise:** `projektstatusbericht-2026-05-22.md` (Phasen 4/5), `-06-07.md` (Phasen 7/8);
PR #10 (Linux `.deb`); Tags v0.2.7–v0.3.0.

---

## 11.7 Audio-Transkription (Partner / Denys, v0.4.0)

**Status:** fertig (Release v0.4.0).

Vollständiges Transkriptions-Subsystem: **Whisper** [18] (`@kutalia/whisper-node-addon`) für die
Transkription + **Sprecher-Diarisation** [19] (`sherpa-onnx-node`), als getrennte Worker
(Protokoll + Client + Vite-Entry), Service + IPC + Mikrofon-Permission, Renderer-View mit
Batch-/Ordner-Queue, Export-Menü, Modell-Picker und GPU-Toggle. Modell-Akquise über den
Installer (nicht in-App). Native Addons via `asarUnpack` + `electron-rebuild`. Problem:
Mic-Recorder-Robustheit → „Bulletproof-Recorder" mit exakter Fehlermeldung (`06d14d0`).

**Nachweise:** `projektstatusbericht-2026-06-14.md` (Phase 14); Tag v0.4.0.

---

## 11.8 Kleinere Arbeitspakete (knapp)

### AP-6 — Library-Suche & Filter (Dominik, PR #12 gemergt)

Volltextsuche + Filter/Sortierung in der Bibliothek: IPC `documents:searchLibrary`,
`searchLibrary`-Repo-Methode (`ts_headline`), shared Types + `docType`-Helper, Such-UI mit
SourceViewer-Click-through, Integrationstest als DoD. Manuelles DoD-Testszenario bestanden
(`071a5fe`). **Ergebnis/Status:** fertig, gemergt 10.06. Verweis:
`projektstatusbericht-2026-06-07.md`/`-06-14.md`.

### AP-9 — Settings (Dominik, PR #13 gemergt; Account-Teil PR #18 offen)

Vollständiges Settings-Modal: Theme (system/light/dark, sofort angewandt via
`dataset.theme`), UI-Sprache (default `de`), wiederverwendbare Slider für
Chunk-Size/Overlap/Top-K (ein DB-Write pro Drag), Auto-Lock, Conversation-Switch,
Account-Sektion (Passwort ändern, Recovery-Codes neu). Das Schema (`src/shared/settings.ts`)
hält alle Felder als typisierte Slots; der Main-Konsum (autoLock, conversationSwitch,
Chunk-Werte, Modell-Reload) ist verdrahtet. **Status:** Kern fertig/gemergt (10.06.);
Account-Recovery-Teil als PR #18 offen. Verweis: `ap-9-partner-fields.md`.

> Hinweis zur Auto-Lock-Falle (für den Partner dokumentiert): `setInactivityMs` macht
> `Math.max(60_000, ms)`, daher ergäbe `0` keine „nie"-Sperre, sondern 1 Minute — ein
> echter Disable-Pfad ist nötig (`ap-9-partner-fields.md`).

### AP-T.3b — Manuelle Test-Szenarien (Dominik, PR #14 gemergt)

Reproduzierbare manuelle QA-Szenarien M3/M4/M8–M11 + README. **Status:** fertig, gemergt
08.06.

### AP-E.1 / AP-E1b — Eval-Dev-Set + Hold-out (Dominik)

**AP-E.1:** `tests/evals/data/cases.jsonl` mit **80 Fällen** (24 DE / 56 EN; 48 answerable /
20 refusal / 12 partial), Validator/Loader `tests/unit/eval-cases.test.ts` (386 Tests) prüft
Schema, Verteilung und das **wörtliche** Vorkommen jedes Belegs im referenzierten Chunk.
Pfad/Format weichen bewusst vom Ticket-Wortlaut ab (JSONL statt `eval/cases.json`), um mit
dem Hold-out **einen** Loader zu teilen. **Status:** fertig (Code), PR #25 in Review.
**AP-E1b:** 15 versiegelte Hold-out-Fälle (`dominik-15.jsonl`, 9/4/2), als R5-Echo-Kammer-
Schutz separat und für den Partner während der Entwicklung nicht einsehbar; Dev-Fragen sind
davon disjunkt (Dedup-Guard). **Status:** fertig (Branch, lokal). Verweis:
`ap-e1-abschluss-doku.md`.

### Translation-Eval + GPU-Translator-Sidecar (Partner / Denys, v0.4.1)

Übersetzungs-Eval-Feature + plattformübergreifender GPU-Translator-Sidecar (Windows-GPU mit
Ninja + CUDA-Toolkit + nvJitLink), MADLAD-Modell [20] via Installer-Wizard. **Status:** fertig
(PRs #20–#23, #26; v0.4.1). Verweis: `projektstatusbericht-2026-06-14.md` (Phase 17).

---

## 11.9 Querschnitt: Was offen bleibt (Stand 14.06.2026)

Tabelle 11.3 listet die offenen Punkte mit Bereich und Verantwortlichkeit.

**Tabelle 11.3:** Offene Punkte (Stand 14.06.2026).

| Offener Punkt | Bereich | Verantwortlich |
|---|---|---|
| AP-E.2 Phase 2 — GPU-Matrix-Sweep + Auswertung ins Paper | Eval | Dominik |
| Merge der Test-/Eval-PRs #19, #24, #25 | Tests/Eval | Dominik + Review |
| AP-9 Account-Recovery (PR #18) | Auth/UI | Dominik |
| Auto-Update-Strategie (Velopack vs. electron-updater) | DevOps | beide / PAG |
| Multi-OS-Auslieferungs-Härtung (Mac/Linux produktiv) | Installer | Denys |
| E2E-Playwright-Suite in CI (kann Electron nicht starten) | Tests/CI | offen |
| Eval/Modell-Tests als CI-Gate (Schwellen/Budget) | CI | beide / PAG |

Diese offenen Punkte sind durchgängig in den drei Projektstatusberichten als „nächste
Schritte" bzw. „notwendige Entscheidungen" geführt und damit kein verdeckter Rückstand,
sondern dokumentierter Scope.
