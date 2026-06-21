# Projektstatusbericht

## Projektdaten

| Feld                          | Angabe                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Projekttitel                  | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation |
| Projektnummer                 | Woche 7                                                     |
| Projekt-Owner                 | Denis Tudosa                                                |
| Dokumentations-Owner & Tester | Dominik Furlan                                              |
| Aktuelles Datum               | 2026-06-21                                                  |

## Berichtszeitraum

| Feld | Angabe     |
| ---- | ---------- |
| Von  | 2026-06-15 |
| Bis  | 2026-06-21 |

## Status der Tätigkeiten

- [ ] kritisch
- [ ] teilweise kritisch
- [x] planmäßig

## Kurzbeschreibung Status

Der Berichtszeitraum schließt lückenlos an den letzten Bericht (Stand **v0.4.1**, 14.06.2026) an. Die Woche stand im Zeichen von **Konsolidierung statt Neufunktion**: Es gingen **neun Releases** live (**v0.4.3 → v0.5.3**), getragen von zwei größeren Umbauten und durchgehender Auslieferungshärtung. Erstens wurde die **Speicherschicht neu architektiert** (ADR-0005): Die alte PGlite-/Drizzle-Schicht wurde vollständig stillgelegt zugunsten eines **pro-Workspace verschlüsselten SQLite-Stores (SQLCipher) plus LanceDB-Vektorspeicher** (Vault-Format v6), inklusive Härtung gegen Stromausfall/Korruption. Zweitens kam ein **neuer Workspace-Typ „Codebase"** hinzu (ADR-0006): strukturbewusste Code-Chunker, `.gitignore`-Respektierung, Verzeichnis-Auswahl und ein dedizierter **jina-code-Embedder**. Auf der Test-/Eval-Säule wurden die im Vorbericht noch offenen Pakete **AP-T.1/T.2/E.1 sowie AP-9-Recovery in `main` gemerged** (#18/#19/#24/#25), und der zentrale Ergebnis-Meilenstein wurde erreicht: die im Vorbericht als „in Arbeit" geführte **kartesische RAG-Matrix-Evaluation (AP-E.2) wurde auf RunPod-GPU vollständig durchgerechnet** (315 Konfigurationen, 163 deutsche Q&A), ergänzt um eine **Code-Retrieval-Evaluation** gegen den eigenen Quellcode. Parallel wurde das **Projekthandbuch** von der ersten Gerüstfassung zur **gegenlesefertigen Korrekturfassung v0.9** gebracht (Zitierapparat, 15 Diagramme als SVG, 8-Agenten-Konsistenz-Audit, Beleg-Einpflege der Eval-Ergebnisse). Schließlich wurde die ausgelieferte App erstmals systematisch **am Entwicklungsstand getestet** (Korpus-Import verifiziert) und um einen **Batch-Fortschrittsbalken beim Indexieren** erweitert.

**Personeller Vermerk & Statusbegründung:** Beide Beteiligten waren voll eingebunden. Projekt-Owner Denis Tudosa trug die Speicher-Neuarchitektur, den Codebase-Workspace und die gesamte Release-/Plattformhärtung; Dokumentations-Owner & Tester Dominik Furlan trug die Integration der Test-/Eval-Pakete, die Durchführung und Auswertung der RAG-Matrix-Eval, das Handbuch sowie das GUI-Testing. Beidseitige Integration ist stabil (mehrere PRs gemerged, durchgehende Releases auf `main`), der Gesamtstatus bleibt **planmäßig**. Offene Restposten betreffen die Überführung der Eval-Ergebnisse in den Abgabe-Laborbericht, die Feldvalidierung des Speicher-Migrationspfads sowie den Endausbau des Handbuchs auf die bindefähige v1.0.

## Status Inhalte / Qualität

_Was wurde wie durchgeführt, was funktioniert? Probleme & Lösungen mit grobem Aufwand pro Punkt._

### Phase 19 — Test- & Eval-Pakete in `main` integriert: AP-T.1/T.2/E.1 + AP-9-Recovery (Dominik, 15.–16.06.)

- **Im Vorbericht offene Pakete gemerged (Dominik Furlan, ~2 h):** Die dort als „PR offen / Branch" geführte Arbeit wurde diese Woche integriert — **AP-9 Recovery-Code-Neugenerierung** aus der Account-Sektion (`7a4bf31`, #18), **AP-T.2** Integrationstests DocumentService/RetrievalService/Auth-E2E (§8.2) (`6e04b24`, #19), **AP-T.1** Unit-Tests mit ≥70 % Branch-Coverage (`6d030ce`, #24), **AP-E.1** Eval-Dev-Set `cases.jsonl` mit 80 Fällen (`464a6aa`, #25). Damit ist die §8.2-Testabdeckung im Integrationsstand `main` verankert.
- **CI-Stabilisierung (Denis Tudosa, ~2 h):** `better-sqlite3` wird für die Node-ABI im Tests-Job neu gebaut (`f022361`); `tsconfig` prüft jetzt auch `tests/unit` und behebt die dadurch sichtbaren Fehler (`03ca0ad`, `619c9b3`).
- _(Die Implementierung dieser Pakete wurde bereits im Vorbericht beschrieben — hier zählt der Übergang in den Integrationsstand.)_

### Phase 20 — AP-E.2 RAG-Matrix-Sweep durchgeführt + Code-Retrieval-Eval (Dominik, 15.–18.06.)

- **Matrix-Achsen auf lauffähigen Umfang bereinigt (Dominik Furlan, ~2 h):** `e5-base` entfernt (GGUF-Architektur `xlmr` von node-llama-cpp nicht unterstützt) → 7 Embedder (`030577a`); zusätzlich `e5-large` (schwächster Embedder) und `qwen3.5-27b` (SIGSEGV) aus den Packs gestrichen (`3ff1e3a`). Embedder-Platzierung „auto" auf GPU für das große LAP-Korpus (`05e1fc6`).
- **Sweep auf RunPod-GPU durchgerechnet (Dominik Furlan, ~14 h):** Die im Vorbericht als „in Arbeit" geführte Phase 2 wurde vollständig ausgeführt — **315 Konfigurationen** (Embedder × Reranker × Chunker × LLM) gegen das LAP-Dataset (2.322 Chunks, 163 deutsche Fragen). **Ergebnis:** Sieger-Konfiguration **arctic-l-v2 × kein Reranker × qwen3-4b-instruct** mit **Recall@5 = 0,828**. (Hinweis: Sieger der Retrieval-Eval ≠ aktuell ausgelieferter Default BGE-M3; die Shipping-Entscheidung ist davon getrennt.)
  - **Problem:** Refusal- und Citation-/Groundedness-Bewertung lassen sich nicht aus dem reinen Retrieval-Sweep ableiten.
  - **Lösung:** Diese Dimensionen werden bewusst außerhalb der Matrix geführt; die belegten Matrix-Zahlen wurden aus dem RunPod-S3 gezogen und ins Handbuch eingepflegt (`4d1a878`, `90a38b1`).
- **Code-Retrieval-Evaluation gegen den eigenen Quellcode (Dominik Furlan, ~6 h):** Dataset-Builder Docstring→Funktion aus `src/` (`ad7abf1`), Code-Packs (LLM/Embedder/Reranker) + `matrixConfigs`-Parametrisierung (`041f1d2`), `run-pack --summary` honoriert `LOKLM_*_PACK`-Env für das korrekte Code-Manifest (`d56fbbc`). **Ergebnis:** `nomic-embed-code` am stärksten (0,908) vor `qwen3-emb-0.6b` ≈ `jina-v2-code` (0,875); BGE-M3 fällt auf Code ab (0,456). Lauf creditbedingt bei 68/80 terminiert, Embedder-Rangfolge dennoch final, Backup lokal gesichert.

### Phase 21 — Speicher-Neuarchitektur: PGlite/Drizzle → pro-Workspace SQLCipher + LanceDB (ADR-0005) (Denis, 16.06.)

- **Relationaler Store pro Workspace (Denis Tudosa, ~14 h):** Verschlüsselter pro-Workspace-Store mit FTS5 in Stufen migriert (`8ec149b`, `9844db9`, `b66edd0`), Dokument-/Retrieval-/Quiz-APIs portiert (`51877bd`, `4e6c699`), Umstellung von libSQL auf **better-sqlite3 + SQLCipher** (`97a3601`, `53606be`), `WorkspaceDbFacade` als `Database`-förmiger Adapter (`0da9d47`), `searchLibrary` auf FTS5 portiert (`f9808a4`). **PGlite/Drizzle/pgvector vollständig stillgelegt**, Legacy-Repo-Schicht entfernt, App auf den per-Workspace-Pfad umgestellt (Vault v6) (`1cfcd6c`, `2ef6892`).
- **Vektorspeicher (Denis Tudosa, ~6 h):** Vektoren von pgvector entkoppelt → **LanceDB-only** ohne Dual-Write (`144e6af`), verschlüsselter pro-Workspace-LanceDB-Store (`7d0994d`), in Retrieval/Ingestion/Default-Workspace verdrahtet (`7db8ae0`), `VaultManifest` + `WorkspaceStore` in den AuthService (v5-Vault) eingebunden (`d244fea`), Härtung gegen Stromausfall/Korruption (`095e934`).
  - **Problem:** Der node-llama-cpp-Binär-Selbsttest verhinderte das Laden des GPU-Backends im gepackten Build.
  - **Lösung:** Selbsttest auf den Worker beschränkt bzw. übersprungen (`280110b`, `432ae29`); Architektur-Diagramme zu Speicher & Verschlüsselung dokumentiert (`c606d49`). → ausgeliefert mit **v0.4.6/v0.4.7**.

### Phase 22 — Codebase-Workspace-Typ: Code-Indexierung + jina-code-Embedder (ADR-0006) (Denis, 17.–18.06.)

- **Fundament & Klassifikation (Denis Tudosa, ~6 h):** Neuer Workspace-Typ „Codebase" — Typmodell, Klassifikation, Ignore-/Track-Regeln (`1e291d3`), Auto-Klassifikation synchronisierter Ordner (`991117a`), strukturbewusster Code-Chunker + Codebase-Sync-Indexierung (`0243674`).
- **Indexierungs-Scoping & Embedder (Denis Tudosa, ~5 h):** `.gitignore`-Respektierung + Verzeichnis-Picker (`55655b6`), verschachtelte `.gitignore` + Bearbeiten indizierter Ordner (`5dcabd5`), Lance-Tabelle bei Embedder-Dimensionswechsel neu aufbauen (`34cee95`), **jina-code-Embedder** fallback-sicher (`2d1e8c3`), in allen Tiers gebündelt (`e18582d`), Titelleiste zeigt „Code embedder" bei resident geladenem Modell (`6bb0d6b`).
  - **Erkenntnis:** Die Code-Retrieval-Eval (Phase 20) bestätigte die Embedder-Auswahl — `nomic-embed-code` ist am stärksten, das ausgelieferte `jina-code` liegt im stabilen Mittelfeld bei deutlich geringerer Modellgröße.

### Phase 23 — Release-Härtung & Fehlerbehebungen: v0.4.3 → v0.5.3 (Denis, 15.–18.06.)

- **Auslieferung & GPU (Denis Tudosa, ~5 h):** node-llama-cpp-Binaries entpacken, damit das GPU-Backend im Paket lädt (`01f15d6`), Reranker bei fehlendem Modell **neutral statt rot** anzeigen (`7368729`), QA antwortet bei kurzen Prompts in der Nutzersprache (`ed10a8c`), Sicherheits-/Abhängigkeits-Bumps (vite/vitest, `tmp ≥0.2.6`) (`8d31f2a`, `277696b`).
- **Installer-Wizard & Robustheit (Denis Tudosa, ~4 h):** Auto-Retry für CUDA-Download+Entpacken gegen transiente Decode-Fehler (`46fc9d9`), Wizard mit resizbarem Fenster + scrollbaren Seiten + fensterfüllendem Layout (`1c02c12`), doppeltes Logo auf Login/Register entfernt + Karte zentriert (`27868aa`), gescannte-PDF-OCR via `@napi-rs/canvas` im Worker (`0bb1ddb`), `better-sqlite3-multiple-ciphers` für Electron 42 / V8 14 gepatcht (`f582281`), Infinite-Scroll-Fenster über Refreshes hinweg (`dd225c2`), `apache-arrow` mitgebündelt, damit die installierte App startet (`dd4c58d`).
- **Website-/GEO-Konsolidierung (~3 h):** Website-Aussagen zu Storage/Datenfluss/Verschlüsselung gegen den App-Quellcode korrigiert (`32978f5`, `37f1038`), LLM-/KI-Auffindbarkeit (GEO) + vollständiger JSON-LD-Graph (`a27d73a`), Blog finalisiert + Navigation/SEO (`29c8eec`).
  - **Ergebnis:** **Neun Releases** Win/Linux/macOS — v0.4.3/4.4/4.5/4.6/4.7 (15.–16.06.), **v0.5.0** (17.06.), **v0.5.1/5.2/5.3** (18.06., `09ff691`).

### Phase 24 — Projekthandbuch: bindefähige Buchfassung v0.1 → Korrekturfassung v0.9 (Dominik, 14.–21.06.)

- **Buch-Gerüst & Zitierapparat (Dominik Furlan, ~10 h):** Regelwerk + Buch-Gerüst für die bindefähige v1.0 (`8672332`), IEEE-`[n]`-Zitate in drei Batches + Literaturverzeichnis [9]–[28] (`35c60ad`, `e7a6383`, `abdbca6`), Tabellen-/Abbildungsbeschriftungen über alle 29 Kapitel, **15 Mermaid-Diagramme als SVG** gerendert (`3ca155f`), Standard-PHB-Struktur mit 8 Teilen + PM-Planungskapiteln (`7708aa6`).
- **Stand-Sync & Belege (Dominik Furlan, ~8 h):** main-Delta auf v0.4.7 fortgeschrieben (Installer-Bundle statt In-App-Download, IPC-Handler 103→105), ADR-0005-Speicherarchitektur eingearbeitet, Secret-Sweep inkl. Domain-Maskierung (`958f188`), **B1-Matrix-Eval belegt eingepflegt** (Recall@5 0,828) (`4d1a878`, `90a38b1`).
- **Version & Audit (Dominik Furlan, ~6 h):** Versions-Bump 0.1→0.9 + Reviewer-Leitfaden (`85ab9f6`, `5014352`), **8-Agenten-Konsistenz-Audit** mit 22 behobenen Drift-/Sauberkeits-Issues (`886538a`, `2e74253`, `b07ae76`), abschließendes Buchfassungs-Audit am 21.06. (LAP-Abkürzung, §15.4-Refusal, 24→21 Retrieval-Configs) (`b6e0bcb`).
  - **Stand:** Handbuch ist als **gegenlesefertige Korrekturfassung v0.9** vermerkt; offene Punkte (D1/D3-Reste, Creator-Rückfragen) sind dem v1.0-Audit zugeordnet.

### Phase 25 — GUI-Testing am Entwicklungsstand + Indexier-Fortschrittsbalken (Dominik, 21.06.)

- **Dev-App lauffähig gemacht & Korpus-Import verifiziert (Dominik Furlan, ~3 h):** Electron-42-Binary aufgelöst, **SQLCipher nativ neu gebaut** (C++-Build-Tools + electron-rebuild für Electron 42), App-Start und Korpus-Import (Ordner/Datei) verifiziert. Ursache des anfänglichen Import-Fehlers war das nicht kompilierte `better-sqlite3-multiple-ciphers` unter Electron 42 — nach dem Rebuild behoben.
- **Batch-Fortschrittsbalken beim Indexieren (Dominik Furlan, ~3 h):** Fortschrittsanzeige „X von N indexiert" inkl. Prozent und visuellem Balken, TDD umgesetzt (5/5 Tests gegen die reine `deriveIndexBatchProgress`), Library-View + i18n (DE/EN) + CSS verdrahtet, typecheck 0 (`d7df3e0`).
  - **Hinweis:** Diese Arbeit liegt auf dem Branch `dom/gui-test` und ist noch nicht im Integrationsstand `main`.

## Status Termine

_Geplante vs. tatsächliche Zeit_

| Meilenstein                                              | Geplant | Tatsächlich    | Status                         |
| -------------------------------------------------------- | ------- | -------------- | ------------------------------ |
| AP-9 Recovery-Code-Neugenerierung                        | KW 25   | 15.06.2026     | **gemerged** (PR #18)          |
| AP-T.2 — Integrationstests + CI-Test-Job                 | KW 25   | 15.06.2026     | **gemerged** (PR #19)          |
| AP-T.1 — Unit-Tests ≥70 % Branch-Coverage                | KW 25   | 15.06.2026     | **gemerged** (PR #24)          |
| AP-E.1 — Eval-Dev-Set (80 Fälle)                         | KW 25   | 15.06.2026     | **gemerged** (PR #25)          |
| ADR-0005 — Speicher-Neuarchitektur (SQLCipher + LanceDB) | KW 25   | 16.06.2026     | gemerged (`main`)              |
| v0.4.6 / v0.4.7 (GPU-Pack-Fix + Speicher-Umstellung)     | KW 25   | 15.–16.06.2026 | released                       |
| ADR-0006 — Codebase-Workspace + jina-code-Embedder       | KW 25   | 17.–18.06.2026 | gemerged (`main`)              |
| v0.5.0 (Codebase-Track)                                  | KW 25   | 17.06.2026     | released                       |
| v0.5.1 / v0.5.2 / v0.5.3 (Auslieferungshärtung)          | KW 25   | 18.06.2026     | released                       |
| AP-E.2 — RAG-Matrix-Sweep durchgeführt (315 Zellen)      | KW 25   | 18.06.2026     | **umgesetzt** (Recall@5 0,828) |
| Code-Retrieval-Eval (Docstring→Funktion)                 | KW 25   | 18.06.2026     | **umgesetzt** (nomic 0,908)    |
| Projekthandbuch — Korrekturfassung v0.9                  | KW 25   | 19.–21.06.2026 | gegenlesefertig (`dom/doku`)   |
| Indexier-Fortschrittsbalken (AP Library)                 | KW 25   | 21.06.2026     | Branch (`dom/gui-test`)        |

_Status-Lesart: „gemerged/released" = im Integrationsstand `main` bzw. als Release-Tag · „umgesetzt" = durchgeführt/ausgewertet, Überführung in Abgabe-Artefakte folgt · „gegenlesefertig" = inhaltlich vollständig, Review/v1.0-Audit ausstehend · „Branch" = lokal/auf Branch, noch nicht im Integrationsstand._

## Nächste Schritte / nächste Iteration

- **Eval-Ergebnisse in den Abgabe-Laborbericht überführen (Dominik):** Die belegten Matrix-Zahlen (Recall@5 0,828) und die Code-Embedder-Rangfolge aus dem RunPod-Lauf in das Abgabe-Paper/den Laborbericht und das Handbuch (B1) finalisieren.
- **Handbuch v0.9 → v1.0 (Dominik):** Gegenlesen einarbeiten, D1/D3-Restpunkte und Creator-Rückfragen im v1.0-Audit abarbeiten, danach Bindung/Export vorbereiten.
- **GUI-Test-Branch integrieren (Dominik):** Indexier-Fortschrittsbalken (`dom/gui-test`) nach Review in den Integrationsstand übernehmen; weitere Dev-App-Testszenarien gegen die neue Speicherschicht durchführen.
- **Speicher-Migration validieren (Denis):** Migrationspfad bestehender v0.4.x-Vaults auf das pro-Workspace-Format v6 (SQLCipher + LanceDB) im Feld prüfen; Daten-Integrität und Performance bei großen Korpora absichern.
- **Codebase-Workspace abrunden (Denis):** Code-Indexierung gegen reale Repositories validieren, Embedder-Wahl (jina-code) gegen die Eval-Ergebnisse final bestätigen.

## Notwendige Entscheidungen

_PAG, Team, Änderungen, Anpassungen_

- **Handbuch-Bindung & Abgabe-Termin** — Zeitpunkt festlegen, zu dem das Handbuch auf v1.0 eingefroren und gebunden wird (Schul-Abgabe); danach gilt der gebundene Snapshot als unveränderlich. Abhängigkeit zur Fertigstellung des Abgabe-Laborberichts beachten.
- **Migrationspfad bestehender Vaults (ADR-0005)** — Die Speicherschicht ist grundlegend neu (PGlite entfällt). Entscheiden, ob für Bestands-Installationen ein automatischer Migrations-/Re-Index-Pfad nötig ist oder eine Neuanlage akzeptiert wird.
- **Default-Embedder vs. Eval-Sieger** — Die Eval weist `arctic-l-v2` (Text) bzw. `nomic-embed-code` (Code) als stärkste aus, ausgeliefert sind BGE-M3 bzw. jina-code. Bestätigen, ob der ausgelieferte Default angepasst wird (Größe/Lizenz/Performance gegen Recall abwägen).
- **Signing-Zertifikat / SmartScreen & Auto-Update** — weiterhin offen: EV-Zertifikat zum Abbau der SmartScreen-Warnung (Budget-/Beschaffungsfrage) sowie die Auto-Update-Strategie (Velopack vs. electron-updater, Update-Server-Hosting, Rollback).

---

_Denis Tudosa (Projekt-Owner) · Dominik Furlan (Dokumentations-Owner & Tester) — 2026-06-21_
