# Projektstatusbericht

## Projektdaten

| Feld                          | Angabe                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Projekttitel                  | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation |
| Projektnummer                 | Woche 4-5                                                   |
| Projekt-Owner                 | Denis Tudosa                                                |
| Dokumentations-Owner & Tester | Dominik Furlan                                              |
| Aktuelles Datum               | 2026-06-07                                                  |

## Berichtszeitraum

| Feld | Angabe     |
| ---- | ---------- |
| Von  | 2026-05-23 |
| Bis  | 2026-06-07 |

## Status der Tätigkeiten

- [x] kritisch
- [ ] teilweise kritisch
- [ ] planmäßig

## Kurzbeschreibung Status

Der Berichtszeitraum schließt lückenlos an den letzten Bericht (Release **v0.2.4**, 22.05.2026) an und umfasst sieben weitere Releases (**v0.2.5 → v0.3.1**). Funktional sind in diesen gut zwei Wochen ein **tier-bewusster Installer** (lite/standard/pro mit Hardware-Check + Tier-Picker), die **vollständige App-Internationalisierung** (EN/DE, English-first), der **Pivot des Installers von eingebetteter ~500-MB-Payload auf einen ~8-MB-Download-Stub** (plattformübergreifender Rust/Tauri-Wizard für Windows/Linux/macOS mit optionaler CUDA-Option), **OCR für gescannte PDFs/Bilder**, mehrere **RAG-Robustheits-Fixes**, **Windows-Code-Signing** sowie ein **Linux-`.deb`-Artefakt** live gegangen. Parallel hat Dominik den kompletten **SEO-Content-Cluster** (14 Cluster-Routen + 5 Cornerstone-Artikel + zweisprachiger Blog mit JSON-LD/RSS/`llms.txt`), die **Eval-Säule** (Matrix-Config + Multi-Dataset-Loop + Paper-Aggregator, validiert über ein 15-Modell-Turnier auf RunPod-GPU mit LLM-Judge), die **Settings-Theme-Funktion** (AP-9: light/dark/system + UI-Sprache) und die **Library-Suche** (AP-6) aufgebaut.

**Personeller Vermerk & Statusbegründung:** Projektpartner Denis Tudosa (Chunking/Auth/RAG/Installer) war diese Woche (KW 23) **partnerseitig ausgefallen**; trotz vereinzelter Commits war er **nicht aktiv in die Entwicklung eingebunden**, weshalb die partnerseitigen Arbeitspakete als _in Arbeit / nicht gemerged_ geführt werden. Auch auf Dominiks Seite ist **noch nichts final integriert/gemerged** — die fertigen Pakete (AP-6, AP-9, Eval-Automatisierung, Taxonomie) hängen als _PR offen_ bzw. _in Arbeit_ in lokalen/offenen Branches. Da somit weder partner- noch projektseitig Ergebnisse abgenommen/integriert sind, ist der Gesamtstatus **kritisch**.

## Status Inhalte / Qualität

_Was wurde wie durchgeführt, was funktioniert? Probleme & Lösungen mit grobem Aufwand pro Punkt._

### Phase 7 — Tier-bewusster Installer & Releases v0.2.7–v0.2.9 (24.–25.05.)

- **Tier-Infrastruktur im Installer-Wizard (Denis Tudosa, \~6 h):** lite/standard/pro-Tiers (`b8da7f8` T1.1–T1.5), Model-Downloader (`7069820` Phase 2), Hardware-Check-Page + Tier-Picker + per-File-Progress (`9b16e53` Phase 3), finalisierte Tier-Namen/Schwellen für die v0.3.0-Picks (`333471e`). → Release **v0.2.7** (`5c84046`).
- **App konsumiert Wizard-Installation (Denis Tudosa, \~3 h):** Main-App liest die vom Wizard installierten Modelle und überspringt den First-Launch-Downloader bei gesetztem Marker (`9482ebf` Phase 5), Qwen3.5-Tier-Modelle + tier-driven Profile (`f8018c3`).
- **Vollständige App-i18n EN/DE, English-first (Denis Tudosa, \~5 h):** Renderer-weite Internationalisierung (`ab7b7a6`), Response-Language-Setting wird respektiert + English-first-Defaults (`33e54e8`). → Release **v0.2.9** (`be8ca81`).
  - **Problem:** Pro-Tier lud die MTP-Variante von Qwen3.5-9B, die im Setup nicht trug.
  - **Lösung:** Auf NON-MTP Qwen3.5-9B umgestellt (`44360eb` v0.2.7-Hotfix), als **v0.2.8** released (`e19bad4`).
  - **Problem:** FTS-Migration löste beim Login einen Crash aus, pdf-parse-Worker fehlkonfiguriert.
  - **Lösung:** Migration + Worker-Config gefixt (`a619a0e`), Install-Härtung aus manueller Testrunde (`88e58d0`).
- **README-Modernisierung auf v0.2.9 (Dominik Furlan, \~2 h):** 3-teilige Repo-Übersicht + i18n-Sektion, English-first-Note, erweiterte Struktur/Tech-Stack/Status, Lastenheft-Link gefixt (`a38fca1`); Shell-Design-Tokens + locale-agnostische Tests (`1c1796f`).

### Phase 8 — Installer-Pivot: Embedded-Payload → Download-Stub & Multi-OS-Wizard → v0.3.0 (27.05.)

- **Download-Stub statt eingebetteter Payload (Denis Tudosa, \~5 h):** Embedded-Payload gedroppt, Installer von \~500 MB auf **\~8 MB (lzma)** geschrumpft (`4609f33`); CUDA-Varianten aus der Payload gestrippt (−625 MB raw, `9aabe8e`); Node-24-Bump für Engines + CI (`169089d`).
- **Plattformübergreifender Rust/Tauri-Wizard (Denis Tudosa, \~10 h):** Payload-Manifest-Reader mit per-Target-URL + CUDA-Option (`649c856`), `installer/archive.rs` mit tar.zst-Extract + Traversal-Guard (`dbaf4d9`), CUDA-Checkbox (default an bei NVIDIA, versteckt auf Mac, `205e884`), Windows-Wizard-Phasen (`e4c699f`), Mac-Backend (ditto + LaunchAgent + Uninstaller, `76cba88`), Linux-Phasen + slim makeself-Stub (`c6f032b`), shared Download-Primitive extrahiert (`c43f927`), Mac-Target (`658db8a`).
- **Build-/Release-Skripte (Denis Tudosa, \~5 h):** `build-payload-archive` (tar.zst + sha256-Sidecar, `e35d2b5`), `build-cuda-archive` mit getesteter Bit-Identitäts-Invariante (`8033cc8`), `upload-release` (Bunny PUT + HEAD-Verify + `--dry-run`, `4484f5b`), `build-installer-dmg` (`62c22cf`), `write-payload-manifest` aus den `.sha256`-Sidecars (`41f267c`).
- **Release-Pipeline (Denis Tudosa, \~3 h):** Bunny Edge-Purge + dispatchbare purge-cdn-Action + conditional Authenticode-Signing (`955f7d2`), URL-Konvention vereinheitlicht.
  - **Problem:** electron-builder schreibt Mac-Builds in per-Arch-Verzeichnisse (`release/mac-{arm64,x64}`), Pfade kollidierten.
  - **Lösung:** Per-Arch-Output via `build-mac-payloads.mjs` normalisiert (`63e1056`, `f92c006`, `c008155`, `5d61b2a`).
  - **Problem:** `create-dmg` schlug auf dem macOS-Runner fehl (keine Developer ID, tauri-dmg-Step).
  - **Lösung:** `--bundles app` überspringt den fehlerhaften dmg-Step, `--no-code-sign`, spawn + stdio inherit (`11f4339`, `48e20c0`, `8b3bc8a`).
  - **Problem:** Win11 Installer-Detection-Technology (IDT) blockierte den Stub.
  - **Lösung:** Umbenennung auf `LokLM-x64.exe` + `loklm.exe` (`40d772a`).
  - **Problem:** `taskkill` im `stop_running_app` schloss den Wizard selbst.
  - **Lösung:** Eigene PID ausgeschlossen (`68b289c`).
  - **Problem:** `RequestExecutionLevel admin` startete nicht zuverlässig.
  - **Lösung:** Zurück auf `asInvoker` (`af472f0`, Revert `b7ac0aa`).
  - **Problem:** Bunny-Storage lieferte 401 bei HEAD-Verify.
  - **Lösung:** HEAD-Verifikation non-fatal gemacht (`7a00355`). → Release **v0.3.0** (`f1c9ac0`).

### Phase 9 — RAG-Robustheit, OCR, Quiz-Perf & Code-Signing → v0.3.1 (28.–29.05. + 05.06.)

- **OCR für gescannte Dokumente (Denis Tudosa, \~5 h):** OCR für gescannte PDFs/Bilder + dedizierter Documents-Worker + Orphan-Sweep (`a0a8a2e`).
- **Reranker optional (Denis Tudosa, \~2 h):** Reranker abschaltbar, default aus auf dem Lite-Tier (`2f05f8d`).
- **RAG-Core-Robustheit (Denis Tudosa, \~4 h):** Drei Robustheits-Bugs gefixt (Embedder-Count, QA-Cancel, Download-Write-Errors, `9d8f547`), QA-Stream-Abort-Registrierung + Composer-stuck-busy (`730675e`), In-Flight-Ops-Logging bei Models-Worker-Native-Crash (`e1d5096`).
- **Auth-Härtung (Denis Tudosa, \~2 h):** Vault-Writes serialisiert, Login-/Auto-Lock-Fehlerpfade aufgeräumt (`c1f106b`).
- **Windows-Code-Signing (Denis Tudosa, \~3 h):** Code-Signing + Installer-/Payload-Updates (`efb8552`); v0.3.1 bettet die Payload wieder in Win+Linux-Installer ein, um Defender-Reputation aufzubauen (`6c05116`).
- **Quiz-Generierung Performance (Denis Tudosa, \~4 h):** Windowed + grammar-constrained Batch-Generation gegen Context-Overflow (`0e879d3`), später Parallel-Decode-Pool + No-Think + 2-per-Call-Batching (`bd27e7a`), Perf-Telemetrie hinter `LOKLM_QUIZ_DEBUG` gegated (`a844536`). → Release **v0.3.1** Win/Linux/macOS (`004896e`).
  - **Problem:** Bunny CDN abgelaufen.
  - **Lösung:** Release-Pipeline temporär auf MinIO-only zurückgesetzt (`1430729`).
- **pnpm-Workspace-Hygiene (Dominik Furlan, \~1 h):** `onlyBuiltDependencies` + Overrides nach `pnpm-workspace.yaml` migriert (`c453fb4`).

### Phase 10 — SEO-Content-Cluster, Blog & Auth-E2E §8.2 (27.–28.05., Dominik)

- **Pillar/Persona-Cluster (Dominik Furlan, \~8 h):** Cluster-Topologie-Datenmodul (Persona-/Pillar-Slug-Map + URL-Helpers, `6f77277`), 4 Persona-Seiten DE/EN via `PersonaPage`-Komponente (`e1f10dd`), 3 Pillar-Hubs DE/EN mit vollem Internal-Link-Mesh (`48cbc0e`), per-Page-hreflang via `resolveAlternates` (`12e779f`), finaler Copy in „honest framing" (`05efeb5`), dist-smoke über 14 Cluster-Routen (`f2dec7f`), klickbare Use-Case-Cards + Architektur-CTA (`9f5173c`).
- **5 Cornerstone-Artikel DE/EN (Dominik Furlan, \~10 h):** #1 „what 'private' means" (`16ce355`), #2 „On-Device AI under the EU AI Act" (`d61e35d`), #3 „DSGVO / GDPR Datenexport" (`1c76398`), #4 „Citations as a Privacy Property" (`e8ec706`), #5 „Taxonomy of Local AI" (Erstentwurf, `152b278`).
- **Zweisprachiger Blog (Dominik Furlan, \~6 h):** Bilinguale Content-Collection + `@astrojs/rss` (`bfc0957`), Index DE/EN (`4832321`), Post-Routes mit Article-JSON-LD + hreflang (`b9de659`), Tag-Pages (`90953cf`), pure + getestete List-/Sort-/Tag-/Translation-Helpers (`e25a28d`), RSS-Feeds + `.md`-Mirrors (`b6ec8ea`).
- **JSON-LD- & Discovery-Suite (Dominik Furlan, \~4 h):** Builders WebPage + BreadcrumbList + FAQPage (`608854f`), `Base` akzeptiert per-Page-Schemas (`2293215`), Article-Builder (`5030c99`), auf Pillar-Hubs (`0719acb`) und Persona-Seiten + sichtbare FAQ (`6c3e01c`), `/llms.txt`-Discovery-Index aus der Cluster-Topologie generiert (`f512040`), robots.txt AI-Crawler-Allow-Blocks + dist-smoke für JSON-LD/llms.txt (`7e67133`), dist-smoke für Blog-Routen (`dfb7ef9`).
- **Auth-E2E §8.2 & Test-Drift (Dominik Furlan, \~4 h):** Auth-E2E-Kette §8.2 für M3/G2 (`6610cef`), Download-E2E-Drift gefixt (Linux `.run`, macOS `.dmg` verfügbar statt „coming soon", `dba45fb`), `releases.test`-Drift gefixt (Version steht in der Download-URL, nicht im Dateinamen, `a27122b`).
- Eingespielt über die Pull-Requests **#2–#8** (Denis, Merges am 28.05./02.06.).

### Phase 11 — Eval-Säule: Automatisierung + 15-Modell-Turnier (05.–06.06., Dominik)

- **Eval-Automatisierung A/B/C (Dominik Furlan, \~8 h):** Kartesische Matrix-Config über Embedder/Chunker/Reranker (`--configs matrix`, `f6bdc00`), Multi-Dataset-Loop (`evals:datasets`, `3b7541d`), Paper-Aggregator: Run-Dirs → CSV + LaTeX paper-table (`evals:paper`, `bb207b5`), README zu den drei Skripten + interne Referenz entfernt (`9462bb7`), Model-Pack auf 15 Modelle geradegezogen (`af20084`). 539 Unit-/Integration-Tests grün.
- **15-Modell-Turnier auf RunPod-GPU (Dominik Furlan, \~10 h):** 15 Modelle × 2 Datensätze (xquad-de-300q + focused-260q) auf Blackwell RTX-PRO-4500 (llama.cpp-CUDA) mit LLM-Judge. Sieger **qwen3-4b-instruct** (Composite 2.739 / 2.515). recall@5 0,70–0,97, Judge 0,75–0,81. Bericht + volle Provenienz (git-sha, Hardware, Dataset-Hash) erstellt (`3960525`).
  - **Erkenntnis:** Retrieval-Qualität bleibt über die Modellgrößen konstant — **Modellgröße ≠ Antwortqualität, sofern das RAG-Setup gut ist.**
- Begleitend vom Partner: Anleitung zur Eval-Säulen-Erweiterung/Automatisierung (`9e3a454`).

### Phase 12 — Taxonomie-Final, Settings-Theme (AP-9) & Library-Suche (AP-6) (04.–07.06., Dominik)

- **Cornerstone #5 Taxonomie finalisiert (Dominik Furlan, \~3 h):** Variante B als Subfall von A geframed, Draft-Note entfernt, DE/EN konsolidiert (`cf15c5a`).
- **AP-9 Settings-Theme (Dominik Furlan, \~6 h):** Theme-Preference + AP-9-Schema-Slots (`c7e7636`), Light-Theme-Token-Palette (Entwurf, `d3c92ff`), Theme-Control + i18n-Strings (`530e115`), Theme-Controller (resolve + apply auf `dataset.theme`, `ae01123`), app-weite Anwendung beim Mount (`0686885`), UI-Sprache default `de` (`969d7c9`).
  - **Problem:** Falsches deutsches Schlusszeichen in `themeSub`.
  - **Lösung:** Korrigiert (`9f13ea8`). E2E: Theme-Toggle persistiert + wird angewandt (`7534f38`), system+light abgedeckt + matchMedia-Stub restauriert (`6dec869`).
- **AP-6 Library-Suche (Dominik Furlan, \~8 h):** Design-Spec + manuelles Testszenario (`ca9333e`), IPC-Channel `documents:searchLibrary` (`1348af5`), `searchLibrary`-Repo-Methode (`8353029`), Shared-Types + `docType`-Helper (`002373f`), Library-Search-UI + SourceViewer-Click-through (`4647988`), Integrationstest über importierten Korpus als DoD (`bde9d14`). _(Branch lokal, noch nicht gemerged.)_
- **Manuelle Test-Szenarien (Dominik Furlan, \~3 h):** M3/M4/M8–M11 Szenario-Gerüste + README angelegt (AP-T.3b, `1869fe4`).
- **Linux-`.deb`-Artefakt (Denis Tudosa, \~2 h):** `.deb`-Bau + Ubuntu-22.04-glibc-Baseline (`1b466ff`).

## Status Termine

_Geplante vs. tatsächliche Zeit_

| Meilenstein                                          | Geplant | Tatsächlich    | Status         |
| ---------------------------------------------------- | ------- | -------------- | -------------- |
| v0.2.5 / v0.2.6 (Folge-Releases)                     | KW 21   | 22.05.2026     | nicht gemerged |
| v0.2.7 (tier-aware Installer: lite/standard/pro)     | KW 22   | 24.05.2026     | nicht gemerged |
| v0.2.8 (Pro-Tier-Modell-Fix)                         | KW 22   | 25.05.2026     | nicht gemerged |
| v0.2.9 (English-first + volle App-i18n)              | KW 22   | 25.05.2026     | nicht gemerged |
| v0.3.0 (Download-Stub + Multi-OS-Wizard + CUDA)      | KW 22   | 27.05.2026     | nicht gemerged |
| v0.3.1 (OCR + RAG-Robustheit + Code-Signing)         | KW 22   | 29.05.2026     | nicht gemerged |
| SEO-Content-Cluster + Blog + JSON-LD                 | KW 22   | 28.05.2026     | PR offen       |
| Auth-E2E §8.2 (M3/G2)                                | KW 22   | 28.05.2026     | PR offen       |
| Taxonomie-Cornerstone #5 finalisiert                 | KW 23   | 04.06.2026     | PR offen       |
| v0.3.1-Refresh (Multi-OS + Quiz-Perf + Linux `.deb`) | KW 23   | 05.–06.06.2026 | nicht gemerged |
| Eval-Automatisierung + 15-Modell-Turnier             | KW 23   | 06.06.2026     | PR offen       |
| AP-9 Settings-Theme                                  | KW 23   | 07.06.2026     | PR offen       |
| AP-6 Library-Suche                                   | KW 23   | 07.06.2026     | in Arbeit      |

_Status-Lesart: „PR offen" = umgesetzt, Pull-Request/Review ausstehend · „in Arbeit" = noch in Entwicklung · „nicht gemerged" = noch nicht in den finalen Abgabe-/Integrationsstand übernommen. Die v0.x-Releases existieren technisch als Git-Tags, sind projektseitig aber noch nicht abgenommen/integriert; Denis war diese Woche ausfallbedingt nicht aktiv eingebunden._

## Nächste Schritte / nächste Iteration

- **AP-6 Library-Suche abschließen + PR** — Branch `dom/ap6-search-filter` ist lokal fertig (DoD-Integrationstest grün), Review + Merge ausstehend (Dominik).
- **AP-9 Settings** — PR offen; Partner-Felder (Chunk-Size/Overlap/topK/Vault-Lock/Account) + Modell-Profil-Reload sind über Schema-Slots vorbereitet und noch umzusetzen (Denis/Partner) — **ausfallbedingt diese Woche verzögert, verschiebt sich in die nächste Iteration.**
- **`dom/evals-automation` mergen** — PR offen, GPU-validiert; paper-table für die Abgabe einbauen (Dominik).
- **Eval-Suite gegen aktuelles RAG-Setup auswerten + im Paper/Laborbericht verankern** (beide).
- **Mac-/Linux-Auslieferung produktiv ausbauen** — `.deb` steht, Multi-OS-Wizard live; verbleibende Plattform-Härtung (beide).
- **Auto-Update** — durch den Download-Stub teils adressiert; finale Update-Strategie (Velopack vs. electron-updater) weiterhin offen.

## Notwendige Entscheidungen

_PAG, Team, Änderungen, Anpassungen_

- **Eval-Suite als CI-Gate** — Soll die adaptive Eval-Suite ab v0.3.x als blockierender CI-Check laufen? Schwellenwerte + Laufzeit-/Kosten-Budget (GPU) müssen vorher festgelegt werden.
- **Signing-Zertifikat / SmartScreen** — Windows-Code-Signing ist eingeführt; Frage nach EV-Zertifikat zum sofortigen Abbau der SmartScreen-Warnung (Budget/Beschaffung) bleibt offen.
- **Mac-/Linux-Builds in der regulären Auslieferung** — Priorisierung für v0.3.x final bestätigen.
- **Auto-Update-Strategie** — PAG-Klärung (Update-Server-Hosting, Rollback, Signing-Kosten).
- **Ressourcen / Termine — kritisch** — partnerseitiger Ausfall diese Woche (KW 23, Denis) bei gleichzeitig beidseitig noch nicht integrierten/gemergten Paketen; **zeitnahe** Termin-/Scope-Anpassung und Priorisierung mit der PAG erforderlich, sonst Verzug in die Folgeiteration.

---

_Denis Tudosa (Projekt-Owner) · Dominik Furlan (Dokumentations-Owner & Tester) — 2026-06-07_
