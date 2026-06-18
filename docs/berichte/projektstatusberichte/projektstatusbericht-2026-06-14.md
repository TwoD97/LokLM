# Projektstatusbericht

## Projektdaten

| Feld                          | Angabe                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Projekttitel                  | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation |
| Projektnummer                 | Woche 6                                                     |
| Projekt-Owner                 | Denis Tudosa                                                |
| Dokumentations-Owner & Tester | Dominik Furlan                                              |
| Aktuelles Datum               | 2026-06-14                                                  |

## Berichtszeitraum

| Feld | Angabe     |
| ---- | ---------- |
| Von  | 2026-06-08 |
| Bis  | 2026-06-14 |

## Status der Tätigkeiten

- [ ] kritisch
- [ ] teilweise kritisch
- [x] planmäßig

## Kurzbeschreibung Status

Der Berichtszeitraum schließt lückenlos an den letzten Bericht (Stand **v0.3.1**, 07.06.2026) an und bringt die im Vorbericht als kritisch markierte Lage zurück auf Kurs: Es wurde diese Woche **wieder integriert und ausgeliefert**. Zwei Releases gingen live — **v0.4.0** (Audio-Transkriptions-Subsystem + Quiz-Rework) und **v0.4.1** (Windows-GPU-Translator-Sidecar + Multi-OS-Release-Härtung). Funktional kamen ein vollständiges **Transkriptions-Subsystem** (Whisper + Sprecher-Diarisation, Batch-Queue, Export, modellbasierte Installation), ein **neu aufgebauter Quiz-Generator** (chunk-getrieben, modell-bestimmte Fragenanzahl, CPU-taugliche Performance-Pfade), eine **Electron-Sicherheitshärtung** (echte CSP, Renderer-Sandbox, Navigations-Guards, Fuses, mlock-geschützter Schlüsselspeicher) sowie ein erstes **QA-Routing** (doc-summary-/Korpus-Route + Mehrfragen-Decomposition) hinzu. Auf Dominiks Seite wurden die beiden im Vorbericht offenen Pakete **AP-6 Library-Suche** (PR #12) und **AP-9 Settings** (PR #13) **fertiggestellt und gemerged**; zusätzlich wurden die im Vorbericht offenen Pakete **SEO-Cornerstone #5 (Taxonomie)**, **Eval-Automatisierung** und die **manuellen Test-Szenarien** (AP-T.3b) via PR #9/#11/#14 integriert. Danach wurde die **Test- & Eval-Säule** ausgebaut: Integrationstests inkl. erstem vitest-CI-Job (AP-T.2), Unit-Tests mit ≥70 % Branch-Coverage (AP-T.1), das 80-Fälle-Eval-Dev-Set (AP-E.1), 15 Hold-out-Fälle (AP-E1b) und der laufende Aufbau der **kartesischen RAG-Matrix-Evaluation** (AP-E.2, Span-Recall-Metrik + LAP-Korpus-Converter).

**Personeller Vermerk & Statusbegründung:** Projekt-Owner Denis Tudosa (Chunking/Auth/RAG/Installer) war nach dem partnerseitigen Ausfall (KW 23) **wieder voll eingebunden** und hat den Großteil der v0.4.x-Auslieferung getragen. Beidseitige Integration hat wieder eingesetzt (AP-6/AP-9 gemerged, zwei Releases auf `main`), weshalb der Gesamtstatus von _kritisch_ auf **planmäßig** zurückgestuft wird. Offene Restposten: Dominiks Test-/Eval-Pakete hängen teils noch als _PR offen_ (AP-T.2 #19, AP-E.1 #25) bzw. _in Arbeit_ (AP-E.2), und die GPU-Matrix-Auswertung für den Abgabe-Laborbericht steht noch aus.

## Status Inhalte / Qualität

_Was wurde wie durchgeführt, was funktioniert? Probleme & Lösungen mit grobem Aufwand pro Punkt._

### Phase 13 — AP-9 Settings (alle Felder) & AP-6 Library-Suche → gemerged (Dominik, 08.–10.06.)

- **AP-9 Settings vollständig verdrahtet (Dominik Furlan, ~7 h):** Behavior-Subtab (Conversation-Switch + Auto-Lock), Indexing-/Retrieval-Slider (Chunk-Size/Overlap/Top-K) auf wiederverwendbarem `Slider`-Control, ein DB-Write pro Drag (Commit erst beim Loslassen). Main-Konsum der Werte: `autoLockMinutes` + `conversationSwitch` (`ed34729`), Chunk-Size/Overlap/Top-K aus Settings (`085fac3`), Modell-Reload bei Profil-Wechsel mit Bestätigung (`dc088bd`), Vault-Passwort-Änderung (`357e508`) und Recovery-Code-Neugenerierung (`b09a7e6`) aus der Account-Sektion. Round-Trip-Tests über Retrieval/Runtime/Security-Werte.
  - **Problem:** Falsche Tab-Rückstellung bei Settings-Update; Modal schloss bei Text-Selektions-Drag auf den Backdrop.
  - **Lösung:** Aktiver Tab bleibt erhalten (Reset nur beim Öffnen); Modal bleibt offen, wenn der Drag auf dem Backdrop endet (`ddc9ae8`). Light-Mode-Lesbarkeit für Titlebar/Banner + Tokenisierung Library/Chat/Quiz (`494ce1a`). → **PR #13 gemerged** (`45b8133`, 10.06.).
- **AP-6 Library-Suche abgenommen + gemerged (Dominik Furlan, ~2 h):** Manuelles DoD-Testszenario durchgeführt und bestanden (`071a5fe`). → **PR #12 gemerged** (`d24ef59`, 10.06.).
- **Integration vorperiodischer Pakete (Dominik Furlan, ~1 h):** Im Vorbericht als „PR offen" geführte Arbeit am 08.06. gemerged — SEO-Cornerstone #5 „Taxonomy of Local AI" (**PR #9**), Eval-Automatisierung / Handover-Infra (**PR #11**), manuelle Test-Szenarien M3/M4/M8–M11 AP-T.3b (**PR #14**).
- _(AP-6 und AP-9 standen im Vorbericht noch als „PR offen / in Arbeit" — diese Woche integriert.)_

### Phase 14 — Audio-Transkriptions-Subsystem → Release v0.4.0 (Denis Tudosa, 10.06.)

- **Whisper- + Diarisations-Engine (Denis Tudosa, ~12 h):** Engine-Spikes (Whisper = `@kutalia/whisper-node-addon` `d972870`, Diarisation = `sherpa-onnx-node` `c1179c0`), Whisper-Worker (Protokoll + Client + Vite-Entry, `4368738`), Offline-Speaker-Diarisation-Worker (`8e9d1ae`), Service + IPC + Preload + Mikrofon-Permission (`1b138d0`), Renderer-View + Nav + i18n + Hook (`8f26a61`), Batch-/Ordner-Queue (`ddb483b`), Export-Menü + Modell-Picker + Diarisations-UI + GPU-Toggle (`f02c5ce`).
- **Modell-Akquise über Installer (Denis Tudosa, ~3 h):** Installer lädt Whisper- + Diarisations-Modelle (`9d38fe3`), App löst Modelle aus `models/` auf (`5eb2a5a`), Akquise via Installer statt In-App (`3d71f7c`). Build: `smart-whisper` + `sherpa-onnx`-Deps + `electron-rebuild` (`1105052`), `asarUnpack` der nativen Addons (`32e8597`).
- **LLM-Performance (Denis Tudosa, ~1 h):** Prefill-`batchSize` 512 → 1024 (`610f78a`), `maxThreads = cpus - 1` (`a810f41`).
  - **Problem:** Mic-Recorder-Robustheit + i18n-Parität fehlten.
  - **Lösung:** Bulletproof-Recorder mit exakter Fehlermeldung (`06d14d0`), DE/EN-Parität (`a6713c6`), Review-Fixes/Vereinfachung (`e98911e`). → **Release v0.4.0** Win/Linux/macOS (`f468477`, `53384c3`).

### Phase 15 — Quiz-Generierung neu aufgebaut: chunk-getrieben (Denis Tudosa, 08.–12.06.)

- **Chunk-getriebene Single-Stage-Pipeline (Denis Tudosa, ~8 h):** Kontext-bewusster Unit-Builder (Code-seitige Planung, `0ff2135`), Generierung pro Unit mit code-erzwungener Qualität (`6b13006`), Single-Stage-Pipeline mit abgeleiteter Fragenanzahl (`86b5649`), Modell entscheidet Fragenanzahl pro Sektion für volle Abdeckung (`c0b61f8`), Schätz-Preview statt Fragenanzahl-Picker (`2c2c74d`).
  - **Problem:** CPU-Läufe liefen in Context-Overflow/Stalls; lazy Empty-Options-Pfad im Schema.
  - **Lösung:** Aggressive CPU-Caps + Schema-`maxLength`, Salvage gültiger Präfixe aus abgeschnittenen Batches, Schema-Härtung gegen leere Options, Default 5 statt 10 Fragen auf CPU (`88b4647`), Benchmark-Pipeline (`8bcdc1a`), Review-Fixes (`8ce8849`). → **gemerged** (`1f327e0`, 12.06.).

### Phase 16 — Multi-OS-Release-Härtung & Mac-Installer-Fixes → v0.4.0/v0.4.1 (Denis Tudosa, 10.–13.06.)

- **Mac-Installer / DMG (Denis Tudosa, ~6 h):** LICENSE im Wizard-DMG (`dcb54e7`), per-Plattform-Workflow-Backport (`dcc83b1`, `4a510a4`), `chmod +x` der Binaries + saubere Archiv-Modi + Launch-Fehler sichtbar (`feca80d`), `chmod` aller Helper-Verzeichnisse + JIT-Entitlement-Signing (`6bdd5f8`), DMG bündelt LICENSE + korrektes v0.4.0-Manifest ohne versehentliche SLA (`d7e7afd`).
- **Release-Pipeline (Denis Tudosa, ~3 h):** Per-Plattform-Dispatch + Fehlertoleranz (`31f890f`), Manifest-Bump via Write-Deploy-Key (`8b3a120`, `1a57d5d`, `fc55a38`), Linux-Rust-Cache-Key pro Runner-Image (`326a605`). Modelle: Mac-Tier-Marker-Lookup + Sweep-Guard + Legacy-8B-Retire (`52b21f5`). → **v0.4.0 macOS** (`ce5c0df`), anschließend **v0.4.1** Win/Linux/macOS (`ea66671`, 13.06.).
- **Abhängigkeits-Upgrade-PRs (Dependabot, 10.06.):** astro 5 → 6, vite 5 → 6, vitest 2 → 3 — als PRs offen, Review/Merge ausstehend.

### Phase 17 — Electron-Härtung, QA-Routing & Translation-Eval → v0.4.1 (Denis Tudosa, 12.–13.06.)

- **Electron-Sicherheitshärtung (Denis Tudosa, ~4 h):** Echte CSP, Renderer-Sandbox + CJS-Preload, Navigations-Guards, Fuses, mlock-geschützter Schlüsselspeicher (`04b318d`).
- **QA-Routing Phasen 1–3 (Denis Tudosa, ~6 h):** Doc-Summary-Route (`fa19771`), Korpus-/Aggregations-Route (`83fc8e8`), per-Dokument-Summary-Embedding-Index (`0175e5a`), Mehrfragen-Decomposition (`d395a54`), ADR-0003 + README + Eval-Plan (`96161b6`).
- **Translation-Eval + Windows-GPU-Translator-Sidecar (Denis Tudosa, ~5 h):** Translation-Eval-Feature (#20, `cb9784f`), Sidecar grün auf allen Plattformen (#22, `a7cbf13`), Windows-GPU-Sidecar (Ninja + volles CUDA-Toolkit + nvJitLink, #23, `1d5af27`). → **Release v0.4.1** (Sidecar: Linux-GPU-Fix + per-Arch-Mac + Exec-Bit, #21, `34734fe`).

### Phase 18 — Test- & Eval-Säule: AP-T.1/T.2 + AP-E.1/E1b + AP-E.2 (Dominik, 11.–14.06.)

- **AP-E1b — 15 Hold-out-Testfälle (Dominik Furlan, ~3 h):** 15 separat gehaltene Fälle (9 answerable / 4 refusal / 2 partial, DE+EN) als Echo-Chamber-Schutz für die Eval (`701bef1`).
- **AP-T.2 — Integrationstests + erster CI-Test-Job (Dominik Furlan, ~8 h):** Drei E2E-Suiten gegen reale Services + echte PGlite (DocumentService, RetrievalService mit echtem BGE-M3, Auth §8.2) + reproduzierbares 60-Chunk-Korpus (`3e0a4d2`, `9644d60`). Erster vitest-Job im Repo (CI baute bisher nur die Website), grün via schlankem Electron-Stub (`48255ab`). → **PR #19** (mergebar, alle Checks grün).
- **AP-T.1 — Unit-Tests ≥70 % Branch-Coverage (Dominik Furlan, ~6 h):** Chunker/Parser/RRF/Citation/Auth-Wrapper (`0fcdef8`), Parser-OCR-/Scan-Pfade gemockt → Statements ≥80 % (`53441c1`).
- **AP-E.1 — Eval-Dev-Set (Dominik Furlan, ~4 h):** `cases.jsonl` mit 80 Fällen (30/70 DE/EN, 60/25/15-Split) + Validator (`27e159d`). → **PR #25**.
- **AP-E.2 — Kartesische RAG-Matrix-Evaluation, Phase 1 (Dominik Furlan, ~12 h, in Arbeit):** Span-Overlap-Retrieval-Metriken + Härtung (`6a5e27e`, `4316842`), Char-Offsets auf Source-Chunks (`5229018`), `goldSpans` + Sprach-/Refusal-Felder auf Fragen (`7ea2083`), LAP-Korpus→Dataset-Converter inkl. Refusal-Erhalt (`ba4ecc9`, `ba9193b`, `6a7cd2b`), Embedder-/Reranker-Bridges mit Label-Namen (`2d26fb4`, `fb90eaf`), Matrix-Achsen aus Packs + Pre-Run-Manifest + `models:matrix`-Download mit Dry-Run + Shard-Helfer für Multi-Pod-Split (`862ec05`, `7aef087`, `6f3a2c9`, `239dad9`), Span-Recall in den Sweep verdrahtet (`cd10138`).
  - **Erkenntnis:** Aus der Q&A-Generierung am LAP-Korpus traten Meta-Fragen + OCR-Artefakte zutage → Korpus auf UTF-8-Neuauszug umgestellt (440 → 8.865 korrekte Umlaute), bevor die Matrix-Läufe starten.
  - **Aktueller Stand (in Arbeit):** LAP-Korpus auf 90 Dokumente triagiert; **163 deutsche RAG-Fragen** (148 answerable + 15 refusal) generiert und verifiziert; `lap-dataset.json` mit **2.322 Chunks** und verifizierten Gold-Spans gebaut. **Phase 2** (GPU-Matrix-Sweep: Embedder × Reranker × Chunker × LLM) ist in aktiver Implementierung — die Matrix-Verdrahtung (`matrix-manifest.ts`, `run-pack.ts`, `configs.ts`) ist noch uncommittet.
- **Repo-Hygiene (Dominik Furlan, ~1 h):** `ANLEITUNG-DOMINIK` + Abgabe-Dokumente aus dem Tracking genommen und gitignored — bleiben lokal (`58c6822`).

## Status Termine

_Geplante vs. tatsächliche Zeit_

| Meilenstein                                                     | Geplant | Tatsächlich    | Status                       |
| --------------------------------------------------------------- | ------- | -------------- | ---------------------------- |
| AP-6 Library-Suche (Filter/Sortierung)                          | KW 23   | 10.06.2026     | **gemerged** (PR #12)        |
| AP-9 Settings-UI (Theme/Sprache/alle Felder)                    | KW 23   | 10.06.2026     | **gemerged** (PR #13)        |
| SEO-Cornerstone #5 / Eval-Automatisierung / Szenarien (AP-T.3b) | KW 23   | 08.06.2026     | **gemerged** (PR #9/#11/#14) |
| v0.4.0 (Audio-Transkription + Quiz-Rework)                      | KW 24   | 10.06.2026     | released                     |
| Quiz-Generierung-Rework (chunk-getrieben)                       | KW 24   | 12.06.2026     | gemerged                     |
| v0.4.1 (Translator-Sidecar + Multi-OS-Härtung)                  | KW 24   | 13.06.2026     | released                     |
| Electron-Sicherheitshärtung                                     | KW 24   | 12.06.2026     | gemerged (`main`)            |
| QA-Routing (doc-summary/Korpus + Decomposition)                 | KW 24   | 13.06.2026     | gemerged (`main`)            |
| AP-E1b — 15 Hold-out-Testfälle                                  | KW 24   | 11.06.2026     | Branch (lokal, R5-geschützt) |
| AP-T.2 — Integrationstests + erster CI-Test-Job                 | KW 24   | 12.–13.06.2026 | PR offen (#19)               |
| AP-T.1 — Unit-Tests ≥70 % Branch-Coverage                       | KW 24   | 13.–14.06.2026 | Branch (unpushed)            |
| AP-E.1 — Eval-Dev-Set (80 Fälle)                                | KW 24   | 14.06.2026     | PR offen (#25)               |
| AP-E.2 — RAG-Matrix-Eval Phase 1 (Metrik + LAP-Dataset)         | KW 24   | 14.06.2026     | umgesetzt (lokal)            |
| AP-E.2 — RAG-Matrix-Eval Phase 2 (GPU-Sweep)                    | KW 24   | —              | in Arbeit                    |

_Status-Lesart: „gemerged/released" = im Integrationsstand `main` bzw. als Release-Tag · „PR offen" = umgesetzt, Review/Merge ausstehend · „Branch" = lokal/auf Branch, noch nicht im Abgabestand · „in Arbeit" = noch in Entwicklung._

## Nächste Schritte / nächste Iteration

- **AP-E.2 Matrix-Eval durchziehen (Dominik):** LAP-Dataset (2.322 Chunks, 163 DE-Fragen) steht; Phase-2-Sweep auf RunPod-GPU starten (Embedder × Reranker × Chunker × LLM), Span-Recall/nDCG auswerten und ins Abgabe-Paper/den Laborbericht überführen.
- **Test-PRs mergen (Dominik):** AP-T.2 (#19) und AP-E.1 (#25) sind review-bereit; AP-T.1-Branch pushen + PR. Damit ist die §8.2-Testabdeckung im Integrationsstand verankert.
- **AP-E1b in den Eval-Workflow einbinden (Dominik):** Hold-out-Set als separaten Validierungslauf führen (Echo-Chamber-Schutz).
- **CI-Entscheidung umsetzen (beide):** Erster vitest-CI-Job läuft (integration + tx) — Ausbau auf modell-gated Retrieval-Tests + Eval-Gate klären (s. u.).
- **v0.4.x-Plattformhärtung fortführen (Denis):** Mac-/Linux-Auslieferung produktiv stabilisieren; Translator-Sidecar in den regulären Build-Pfad.
- **QA-Routing fertig integrieren (Denis):** Korpus-/Decomposition-Route gegen reale Workspaces validieren.

## Notwendige Entscheidungen

_PAG, Team, Änderungen, Anpassungen_

- **Eval-Suite / Modell-Tests als CI-Gate** — Der erste vitest-CI-Job ist grün; die RetrievalService-E2E skippt mangels Modell im Runner. Soll ein Modell-Download-Step in die Pipeline (Laufzeit-/GPU-Kosten), damit der Roundtrip auch in CI läuft? Schwellenwerte + Budget festlegen.
- **Abgabe-Scope Eval (AP-E.2)** — Die kartesische Matrix ist rechenintensiv (Multi-Pod-GPU). Endgültigen Umfang (Anzahl Zellen / Modelle / Datensätze) für die Abgabe bestätigen, damit Laufzeit und Aussagekraft zur Deadline passen.
- **Signing-Zertifikat / SmartScreen** — Windows-Code-Signing läuft; EV-Zertifikat zum sofortigen Abbau der SmartScreen-Warnung bleibt eine Budget-/Beschaffungsfrage.
- **Mac-/Linux-Builds in der regulären Auslieferung** — Priorisierung für die v0.4.x-Linie final bestätigen (Translator-Sidecar, Diarisations-Modelle).
- **Auto-Update-Strategie** — weiterhin offen (Velopack vs. electron-updater, Update-Server-Hosting, Rollback).

---

_Denis Tudosa (Projekt-Owner) · Dominik Furlan (Dokumentations-Owner & Tester) — 2026-06-14_
