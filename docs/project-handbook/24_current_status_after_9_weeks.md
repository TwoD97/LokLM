# Aktueller Status nach 9 Wochen

Stand: **2026-06-14** (Projektstatusbericht-Berichtszeitraum 2026-06-08 bis 2026-06-14).
Gesamtstatus laut Projektstatusbericht: **planmäßig** (zuvor *kritisch*, nach Wiedereinstieg des Projekt-Owners zurückgestuft).

Quellen für dieses Kapitel: `docs/work/projektstatusbericht-2026-06-14.md`, `docs/work/laborberichte/*`, `docs/work/ap-*-abschluss-doku.md`, `package.json`.

> WARN Die Abschluss-Dokus und der Projektstatusbericht liegen unter `docs/work/` (gitignored) und sind interne Arbeitsstände; sie sind nicht Teil des öffentlichen Repos.

---

## 1. Statusbilanz nach Kategorien

### 1.1 Fertig (im Integrationsstand `main` bzw. als Release-Tag)

| Paket / Ergebnis | Beleg | Verantwortlich |
|---|---|---|
| **v0.4.0** — Audio-Transkriptions-Subsystem (Whisper + Sprecher-Diarisation, Batch-Queue, Export) + Quiz-Rework | Release `f468477`/`53384c3`; macOS `ce5c0df` | Denis Tudosa |
| **v0.4.1** — Windows-GPU-Translator-Sidecar + Multi-OS-Release-Härtung | Release `ea66671` (13.06.) | Denis Tudosa |
| **Quiz-Generierung neu aufgebaut** (chunk-getrieben, modell-bestimmte Fragenanzahl, CPU-Pfade) | gemerged `1f327e0` (12.06.) | Denis Tudosa |
| **Electron-Sicherheitshärtung** (echte CSP, Renderer-Sandbox, Navigations-Guards, Fuses, mlock-Schlüsselspeicher) | gemerged `04b318d` (`main`) | Denis Tudosa |
| **QA-Routing Phasen 1–3** (Doc-Summary-Route, Korpus-/Aggregations-Route, Mehrfragen-Decomposition, ADR-0003) | gemerged (`main`); `fa19771`, `83fc8e8`, `d395a54`, `96161b6` | Denis Tudosa |
| **AP-6 Library-Suche** (Filter/Sortierung, manuelles DoD-Szenario bestanden) | **PR #12 gemerged** `d24ef59` (10.06.) | Dominik Furlan |
| **AP-9 Settings** (alle Felder: Behavior, Indexing-/Retrieval-Slider, Account-Sektion, Light-Mode) | **PR #13 gemerged** `45b8133` (10.06.) | Dominik Furlan |
| **SEO-Cornerstone #5 / Eval-Automatisierung / Test-Szenarien (AP-T.3b)** | **PR #9/#11/#14 gemerged** (08.06.) | Dominik Furlan |

### 1.2 Teilweise fertig (Code umgesetzt, in PR-Review oder lokal auf Branch)

| Paket | Stand | Beleg |
|---|---|---|
| **AP-T.2 — Integrationstests + erster CI-Test-Job** | Code fertig, **PR #19 offen**, alle Checks grün, mergebar | `3e0a4d2`, `9644d60`, `48255ab` |
| **AP-E.1 — Eval-Dev-Set (80 Fälle)** | Code fertig, **PR #25 offen**, Website-CI grün | `27e159d` |
| **AP-T.1 — Unit-Tests ≥70 % Branch-Coverage** | Code fertig + gepusht, **PR #24 offen**, Website-CI grün | `0fcdef8`, `53441c1` |
| **AP-E1b — 15 Hold-out-Testfälle** | Code fertig, lokal/Branch (R5-versiegelt, bewusst nicht gepusht) | `701bef1` |
| **AP-E.2 — Kartesische RAG-Matrix-Eval, Phase 1** (Span-Recall-Metrik, LAP-Dataset) | Phase-1-Code fertig; Matrix-Verdrahtung teils noch uncommittet | `6a5e27e`, `cd10138`, `862ec05` u. a. |

### 1.3 Offen / in aktiver Entwicklung

| Punkt | Begründung |
|---|---|
| **AP-E.2 Phase 2 — GPU-Matrix-Sweep** (Embedder × Reranker × Chunker × LLM) | rechenintensiv (Multi-Pod-GPU); Dataset steht (2.322 Chunks, 163 DE-Fragen), Sweep auf RunPod noch zu fahren |
| **Auswertung Span-Recall / nDCG für den Abgabe-Laborbericht** | hängt am Phase-2-Sweep |
| **AP-E1b in den Eval-Workflow einbinden** | Hold-out als separater Validierungslauf (Echo-Chamber-Schutz) noch zu fahren |

### 1.4 Blockiert / eingeschränkt

| Punkt | Art der Blockade |
|---|---|
| **E2E-Playwright-Suite (`tests/e2e/`)** | läuft **nicht** lokal/CI — Playwright kann Electron nicht starten (`--remote-debugging-port=0`); ganze Suite unrunnable. Im `package.json` zwar verdrahtet (`test:e2e`), aber nicht ausführbar. |
| **Lokaler Installer-Build (Wizard)** | Rust-/Tauri-Toolchain (`cargo`) nicht auf dem Arbeitsrechner; offizielle Installer entstehen auf dem Rechner des Projekt-Owners (Laborbericht 2026-05-29). |
| **RetrievalService-E2E in CI** | modell-gated, **skippt in CI** (BGE-M3-GGUF nicht im Runner); läuft lokal mit Modell grün. Team-Entscheidung über Modell-Download-Step offen. |

### 1.5 Verworfen / bewusst abweichend umgesetzt

| Punkt | Entscheidung |
|---|---|
| **PBKDF2-Passwort-KDF** | verworfen zugunsten **Argon2id** (memory-hard) — ADR-0001; Ticket-Wortlaut AP-T.1 insoweit veraltet. |
| **`text_search`-Spalte (Spec §8.2)** | durch GIN-Expression-Index `idx_chunks_fts` ersetzt (Migration 0006); Test prüft das heutige Äquivalent. |
| **`eval/cases.json` (Ticket-Pfad)** | umgesetzt als `tests/evals/data/cases.jsonl` (JSONL, etablierte Repo-Konvention). |
| **Mehr-Größen-Chunker-Achse in der Matrix** | wirkungslos, da der Sweep nicht pro Config re-chunkt; Chunk-Größen-Vergleich läuft als separate Dataset-Läufe über die chunker-unabhängige Span-Recall-Metrik. |

### 1.6 Nur geplant (Future Work, kein Code)

| Punkt | Quelle |
|---|---|
| **Echter LAP-Korpus-Eval als eigenes Folgeticket** (Ingestion/OCR/Chunking/Lizenz/eigenes Dev+Hold-out/Baseline-Vergleich) | AP-E.1 Abschluss-Doku, „Future Work" |
| **Dauerhaftes Coverage-Threshold-Gate** (`vitest coverage.thresholds`) | AP-T.1 Abschluss-Doku, greift erst nach Merge von PR #19 |
| **Eval-Suite als CI-Gate** (Schwellenwerte + Budget) | Projektstatusbericht, „Notwendige Entscheidungen" |

> WARN Status unklar: Die Dependabot-Upgrade-PRs (astro 5→6, vite 5→6, vitest 2→3) sind laut Projektstatusbericht offen; Review/Merge ausstehend.

---

## 2. Reifegrade

### 2.1 Technische Reife

Der funktionale Kern ist ausgeliefert: zwei Releases (v0.4.0/v0.4.1) auf allen drei Plattformen (Win/Linux/macOS), RAG-Pipeline produktiv, Audio-Transkription, Quiz, Übersetzung und QA-Routing integriert. Sicherheitshärtung (CSP, Sandbox, Fuses, mlock, Argon2id-Vault) ist auf `main`. **Reif** in der Windows-Linie; **in Härtung** für Mac/Linux-Auslieferung (Translator-Sidecar, Diarisations-Modelle noch zu stabilisieren). Auto-Update-Strategie noch offen.

### 2.2 Dokumentationsreife

ADR-0001 bis ADR-0004 vorhanden (`docs/adr/`), Pflichtenheft + Lastenheft im Repo, Laborberichte und Projektstatusbericht geführt. Pro Test-/Eval-Paket existiert eine Abschluss-Doku (Outline/Vikunja-Vorlage, gitignored). **Mittel bis hoch**; das Projekt-Handbuch selbst ist in Erstellung. Lücke: Abgabe-Laborbericht zur Matrix-Eval steht noch aus (hängt am GPU-Sweep).

### 2.3 Testreife

Vier-Säulen-Aufbau weitgehend fertig: Unit (AP-T.1, ≥70 % Branch in 5 Kernmodulen), Integration/E2E (AP-T.2, drei §8.2-Suiten), Eval-Dev-Set (AP-E.1, 80 Fälle) und Hold-out (AP-E1b, 15 Fälle). Erster vitest-CI-Job läuft grün (integration + tx). **Einschränkungen:** RetrievalService-E2E skippt in CI (modell-gated); Playwright-E2E unrunnable; Coverage-Nachweis AP-T.1 noch lokal-scoped (`test:cov:apt1`), bis PR #19 in `main` ist. **Mittel bis hoch**, der CI-Gate-Ausbau ist die offene Stellschraube.

### 2.4 Betriebsreife

App ist installierbar und beim Anwender lauffähig (Windows). **Offene Betriebsfragen:** EV-Zertifikat gegen SmartScreen-Warnung (Budget-/Beschaffungsfrage), Auto-Update-Strategie (Velopack vs. electron-updater, Update-Server, Rollback), produktive Mac-/Linux-Auslieferung. **Mittel** — kernfunktional einsatzbereit, betriebliche Härtung (Signing, Update-Pfad) noch offen.

---

## 3. Kurzfazit

Nach 9 Wochen ist LokLM **funktional ausgeliefert** (v0.4.1, drei Plattformen) und die **Test-/Eval-Säule weitgehend aufgebaut**. Der wesentliche offene Block ist die **AP-E.2-GPU-Matrix-Auswertung** für den Abgabe-Laborbericht (Phase 2). Drei Test-/Eval-PRs (#19, #24, #25) sind review-bereit und warten nur auf Merge-Freigabe; die betriebliche Härtung (Signing, Auto-Update, Mac/Linux) bleibt als Roadmap-Thema.
