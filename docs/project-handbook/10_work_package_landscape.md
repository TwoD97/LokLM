# Arbeitspaket-Landkarte

Diese Datei gibt einen vollständigen Überblick über alle erkennbaren Arbeitspakete (APs)
des Projekts LokLM — sowohl die formal als AP-IDs geführten (vor allem Dominiks Test-,
Eval- und UI-Pakete) als auch die aus Commits/PRs/Releases ableitbaren Partner-Pakete
von Denys Tudosa (Chunking/Auth/RAG/Installer). APs mit eindeutigem Ticket-/DoD-Beleg
sind als solche markiert; aus Commits/Releases **abgeleitete** Pakete tragen einen
Verifikations-Marker, weil ihre exakte Ticket-Abgrenzung extern (Vikunja/Outline) liegt.

> ⚠️ durch Team zu ergaenzen: Die Vikunja-Karten und Outline-Specs sind extern und
> nicht im Repo. Für die formal geführten Dominik-APs liegen DoD/Akzeptanzkriterien als
> Abschluss-Dokus vor; für die Partner-Pakete ist die AP-Benennung hier aus dem
> Projektstatusbericht und der Commit-/PR-Historie **rekonstruiert** und durch das Team
> zu bestätigen.

## Legende

- **Status:** fertig = gemergt/released bzw. DoD nachweislich erfüllt · teilweise =
  Kern fertig, Restposten offen · offen = in Arbeit/nicht abgeschlossen · verworfen =
  bewusst aufgegeben · unklar = Beleglage unzureichend.
- **Rolle:** D = Dominik Furlan (Doku/Tests/UI/Eval) · P = Denys Tudosa (Partner;
  Chunking/Auth/RAG/Installer).
- **Priorität:** abgeleitet aus Meilenstein-/Gate-Bezug; ohne formale Skala (siehe
  `08_project_management_kanban_outline.md`).

## 10.1 Formal geführte Arbeitspakete (mit AP-ID)

Tabelle 10.1 listet die formal als AP-ID geführten Arbeitspakete.

**Tabelle 10.1:** Formal geführte Arbeitspakete (mit AP-ID).

| AP-ID | Titel | Bereich | Rolle | Ziel | Ergebnis/Deliverable | Status | Prio | Nachweis | Abhängigkeiten |
|---|---|---|---|---|---|---|---|---|---|
| AP-6 | Library-Suche & Filter | UI/Retrieval | D | Volltextsuche + Filter/Sortierung in der Bibliothek | `documents:searchLibrary`-IPC, `ts_headline`, Such-UI, SourceViewer-Click-through, Integrationstest | **fertig** (PR #12 gemergt 10.06.) | hoch | PR #12; Commits `1348af5`,`8353029`,`4647988`,`bde9d14`,`071a5fe` | Retrieval-Repo |
| AP-9 | Settings (Theme/Sprache/alle Felder) | UI | D | vollständiges Settings-Modal inkl. Retrieval-/Runtime-/Security-Felder | Theme (system/light/dark), UI-Sprache (default de), Slider für Chunk-Size/Overlap/Top-K, Auto-Lock, Conversation-Switch, Account-Sektion | **fertig** (PR #13 gemergt 10.06.) | hoch | PR #13; `ap-9-partner-fields.md`; Commits `c7e7636`…`494ce1a` | Auth, Retrieval (Konsum) |
| AP-9 (Account) | Account: neue Recovery-Codes | Auth/UI | D | Recovery-Code-Neugenerierung aus den Settings | abgespaltener PR für die Account-Sektion | **offen** (PR #18) | mittel | PR #18; Commit `b09a7e6` | Auth-Krypto |
| AP-T.1 | Vitest Unit-Tests ≥70 % Branch | Tests | D | Branch-Coverage ≥70 % (Stmts ≥80 %) in chunker/parser/RRF/Citation/Auth | 96 Tests grün; alle 5 Module über Schwelle; `test:cov:apt1`-Skript | **fertig (Code), im Review** (PR #24) | hoch | PR #24; `ap-t1-abschluss-doku.md`; Commits `0fcdef8`,`53441c1` | — |
| AP-T.2 | Integrationstests (§8.2 E2E) | Tests | D | drei E2E-Suiten gegen reale Services + echte PGlite + erster CI-Job | DocumentService-/RetrievalService-/Auth-E2E; 60-Chunk-Korpus; vitest-CI-Job + Electron-Stub | **fertig (Code), im Review** (PR #19) | hoch | PR #19; `ap-t2-abschluss-doku.md`; `Laborbericht…2026-06-12.md`; Commits `3e0a4d2`,`9644d60`,`48255ab` | DocumentService, RetrievalService, Auth |
| AP-T.3b | Manuelle Test-Szenarien | Tests/QA | D | reproduzierbare manuelle QA-Szenarien M3/M4/M8–M11 | Szenario-Gerüste + README | **fertig** (PR #14 gemergt 08.06.) | mittel | PR #14; Commit `1869fe4` | — |
| AP-E.1 | Eval-Dev-Set (50–80 Fälle) | Eval | D | domänenspezifisches Dev-Set DE/EN mit Verteilung 30/70 + 60/25/15 | `cases.jsonl` mit 80 Fällen + Validator (386 Tests) | **fertig (Code), im Review** (PR #25) | hoch | PR #25; `ap-e1-abschluss-doku.md`; Commit `27e159d` | Sample-Doc-Korpus, Chunker |
| AP-E1b | 15 Hold-out-Fälle (R5-Schutz) | Eval | D | versiegeltes Hold-out gegen Echo-Kammer-Effekt | `dominik-15.jsonl` (9 ans / 4 ref / 2 partial) | **fertig** (Branch, lokal/R5-geschützt) | mittel | Commit `701bef1`; `ap-e1-abschluss-doku.md` (Abgrenzung) | AP-E.1-Korpus |
| AP-E.2 | Kartesische RAG-Matrix-Eval | Eval | D | Embedder×Reranker×Chunker×LLM-Sweep über LAP-Korpus, Span-Recall/nDCG | Phase 1: Span-Metrik, LAP→Dataset-Converter, Matrix-Bridges, Pre-Run-Manifest, OSI-Lizenz-Gate; LAP-Dataset (2.322 Chunks, 163 DE-Fragen) | **teilweise** (Phase 1 lokal umgesetzt; **Phase 2 GPU-Sweep offen**) | hoch | Branch `dom/ap-e2-matrix-eval`; Commits `6a5e27e`…`5c89369`; `projektstatusbericht-2026-06-14.md` | AP-E.1/E1b, GPU (RunPod) |

## 10.2 Partner-/Projekt-Pakete (Denys Tudosa, aus Commits/PRs/Releases abgeleitet)

> ⚠️ zu verifizieren: Die folgenden Pakete sind aus Commit-Bereichen, PR-Titeln,
> Release-Tags und den Projektstatusberichten **abgeleitet**; sie tragen im Repo nicht
> immer eine formale AP-ID. Benennung und Abgrenzung sind durch das Team (Vikunja/
> Outline) zu bestätigen.

**Tabelle 10.2:** Aus Commits/PRs/Releases abgeleitete Partner-Pakete.

| Paket | Bereich | Rolle | Ziel | Ergebnis/Deliverable | Status | Prio | Nachweis |
|---|---|---|---|---|---|---|---|
| Projekt-Skelett & Krypto-Fundament (AP-1.1) | Architektur/Auth | P | Electron-/pnpm-Skeleton, Drizzle-ORM, Argon2-Auth-Pipeline, Vault-DEK | lauffähiges Skelett, Auth-Service, Migrations-Setup | **fertig** | hoch | `projektstatusbericht-2026-05-22.md` (Phase 1) |
| Landingpage + Release-Pipeline + Branding | Website/DevOps | P | loklm.com (Astro/Tailwind), GitHub-Actions-Release, CDN-Upload | Landingpage, NSIS→Electron-Pipeline, Bunny+MinIO-Upload, SEO-Suite | **fertig** | hoch | `…05-22.md` (Phase 2); PR #1 |
| Provider-Abstraktion (LLM/Embedder/Reranker) | RAG | P | Interface-Schicht + Bundled- + Ollama-Provider | `LlmProvider`/`EmbedderProvider`/`RerankerProvider`, ProviderRegistry, Ollama-Trias | **fertig** | hoch | `…05-22.md` (Phase 4) |
| Embedder-Identity & Re-Index-Gate | RAG | P | stale Chunks bei Embedder-Wechsel purgen, Dimension-Mismatch ablehnen | `embedder_identity`-Spalte, `embedder:trySwitchSource` | **fertig** | mittel | `…05-22.md` (Phase 4) |
| Settings-Modal-Refactor (Profile/Basic/Advanced) | UI | P | `SettingsService` + getabbtes Modal | KV-backed UserSettings, vier Advanced-Sub-Tabs | **fertig** | mittel | `…05-22.md` (Phase 4) |
| Eval-Suite-Aufbau (Basis) | Eval | P | Staging-Korpus + Judge-Prompt + Eval-Metriken | adaptives Eval-Dataset, Judge-Prompt, Metrics-Unit-Tests | **fertig** (Basis; durch AP-E.1/E.2 erweitert) | mittel | `…05-22.md` (Phase 4) |
| Features: Quiz / DOCX-Import / Folder-Sync | App | P | drei Nutzer-Features | MCQ-Quiz, mammoth-DOCX-Parser, Folder-Sync-Service + Migrationen 0003–0005 | **fertig** | mittel | `…05-22.md` (Phase 5) |
| Installer-Pivot 1: Custom-NSIS → Electron-Bootstrapper | Installer | P (Wizard-UI: D) | Wartungsarme Installer-UX | electron-builder Portable-Target (7zSD); Custom-NSIS verworfen | **fertig** (NSIS-Stack **verworfen**) | hoch | `…05-22.md` (Phase 5) |
| Tier-System (lite/standard/pro) | Installer | P | Hardware-bewusste Modell-Tiers | Hardware-Check-Page, Tier-Picker, per-File-Progress, tier-driven Profile | **fertig** | hoch | `…06-07.md` (Phase 7); v0.2.7–v0.2.9 |
| Volle App-i18n (EN/DE, English-first) | App/UI | P | renderer-weite Internationalisierung | i18n-Strings, Response-Language-Setting | **fertig** | mittel | `…06-07.md` (Phase 7); v0.2.9 |
| Installer-Pivot 2: Embedded-Payload → Download-Stub + Multi-OS-Wizard | Installer | P | ~500 MB → ~8 MB Stub, Win/Linux/macOS, CUDA-Option | Rust/Tauri-Wizard, tar.zst-Payload, Manifest-Reader, Mac/Linux-Backends | **fertig** | hoch | `…06-07.md` (Phase 8); v0.3.0; PR #10 |
| OCR für gescannte PDFs/Bilder | RAG/Parser | P | Scan-/Bild-Dokumente indexierbar | OCR-Pfad + Documents-Worker + Orphan-Sweep | **fertig** | mittel | `…06-07.md` (Phase 9); v0.3.1 |
| RAG-Core-Robustheit + Auth-Härtung | RAG/Auth | P | Robustheits-Bugs, Vault-Write-Serialisierung | Embedder-Count-/QA-Cancel-/Download-Fixes; serialisierte Vault-Writes | **fertig** | mittel | `…06-07.md` (Phase 9) |
| Windows-Code-Signing | DevOps | P | Authenticode-Signing für den Installer | conditional Signing in der Pipeline | **fertig** | mittel | `…06-07.md` (Phase 9); v0.3.1 |
| Audio-Transkription (Whisper + Diarisation) | App | P | Transkriptions-Subsystem mit Sprecher-Trennung | Whisper-Worker, Diarisation-Worker, Batch-Queue, Export, Modell-Install | **fertig** | hoch | `…06-14.md` (Phase 14); v0.4.0 |
| Quiz-Generierung Neuaufbau (chunk-getrieben) | App | P | CPU-taugliche, chunk-getriebene Quiz-Pipeline | Single-Stage-Pipeline, modell-bestimmte Fragenanzahl, CPU-Caps | **fertig** (gemergt 12.06.) | mittel | `…06-14.md` (Phase 15) |
| Electron-Sicherheitshärtung | Security | P | reale CSP, Sandbox, Fuses, mlock-Key-Memory | CSP, Renderer-Sandbox + CJS-Preload, Nav-Guards, Fuses, mlock | **fertig** (`main`) | hoch | `…06-14.md` (Phase 17); Commit `04b318d` |
| QA-Routing (doc-summary/Korpus + Decomposition) | RAG | P | Routing der Anfrage je nach Frage-Typ | doc-summary-Route, Korpus-/Aggregations-Route, Summary-Embedding-Index, Mehrfragen-Decomposition, ADR-0003 | **fertig** (`main`) | hoch | `…06-14.md` (Phase 17); ADR-0003 |
| Translation-Eval + GPU-Translator-Sidecar | RAG/Translation | P | Übersetzungs-Sidecar (Win/Linux/macOS GPU) + Eval | Translation-Eval, Cross-Platform-Sidecar, MADLAD-Modell via Installer | **fertig** | mittel | `…06-14.md` (Phase 17); PRs #20–#23, #26; v0.4.1 |
| Multi-OS-Release-Härtung (Mac-Installer/DMG) | Installer/DevOps | P | stabile Mac-/Linux-Auslieferung | DMG-LICENSE, chmod/Signing-Fixes, per-Plattform-Dispatch | **teilweise** (Härtung fortlaufend) | mittel | `…06-14.md` (Phase 16); Hotfix-Branches |
| Auto-Update-Strategie | DevOps | P/beide | finale Update-Strategie festlegen | Velopack-Spec lag vor; durch Download-Stub teils adressiert | **offen** (Entscheidung ausstehend) | mittel | „Notwendige Entscheidungen" in allen drei Berichten |

## 10.3 Verworfene / abgelöste Pakete

**Tabelle 10.3:** Verworfene oder abgelöste Pakete.

| Paket | Warum verworfen | Nachweis |
|---|---|---|
| Custom-NSIS-Installer-Wizard | Maintenance-Overhead (makensis-Toolchain, BMP3, NSIS-Sprache) im Missverhältnis zum Mehrwert; durch electron-builder Portable-Target ersetzt | `…05-22.md` (Phase 4/5) |
| Embedded-Modell-Payload im Installer (~500 MB) | auf ~8 MB Download-Stub umgestellt (Bandbreite/Größe); v0.3.1 bettet sie teilweise wieder ein (Defender-Reputation) | `…06-07.md` (Phase 8/9) |
| „PBKDF2-Wrapper" (Pflichtenheft-Wortlaut) | zugunsten von memory-hard Argon2id verworfen (GPU/ASIC-Resistenz) | ADR-0001; `ap-t1-abschluss-doku.md` |

## 10.4 Querschnittsbeobachtungen

- **Dominiks APs** konzentrieren sich auf die **Test-/Eval-/UI-Säule** (AP-6, AP-9,
  AP-T.1/T.2/T.3b, AP-E.1/E1b/E.2) plus die Website-/SEO-Inhalte und die
  Eval-Automatisierung. Sie sind durchgängig mit Abschluss-Dokus + DoD-Tabellen belegt.
- **Denys' Pakete** tragen die **App-/RAG-/Installer-/Release-Substanz** und sind über
  Releases (v0.1.x–v0.4.x) und die wöchentlichen Berichte belegt, aber seltener mit
  formaler AP-ID versehen.
- **Offene/teilweise Pakete** (Stand 14.06.): AP-E.2 Phase 2 (GPU-Sweep), die Test-PRs
  #19/#24/#25 in Review, PR #18 (Account-Recovery), Auto-Update-Strategie und die
  fortlaufende Multi-OS-Härtung.

Eine vertiefte Darstellung der wichtigsten Pakete (Ziel, Umsetzung, Probleme,
Entscheidungen, Stand) folgt in `11_work_package_details.md`.
