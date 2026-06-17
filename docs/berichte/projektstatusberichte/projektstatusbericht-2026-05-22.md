# Projektstatusbericht

## Projektdaten

| Feld                          | Angabe                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| Projekttitel                  | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation |
| Projektnummer                 | Woche 1-3                                                   |
| Projekt-Owner                 | Denis Tudosa                                                |
| Dokumentations-Owner & Tester | Dominik Furlan                                              |
| Aktuelles Datum               | 2026-05-22                                                  |

## Berichtszeitraum

| Feld | Angabe     |
| ---- | ---------- |
| Von  | 2026-05-08 |
| Bis  | 2026-05-22 |

## Status der Tätigkeiten

- [ ] kritisch
- [ ] teilweise kritisch
- [x] planmäßig

## Kurzbeschreibung Status

Der Berichtszeitraum umfasst die gesamte bisherige Projektlaufzeit von der Initialisierung (08.05.2026) bis zum aktuellen Release **v0.2.4** (getaggt am 22.05.2026). In diesen zwei Wochen sind acht Releases (v0.1.0 → v0.2.4) ausgeliefert worden. Funktional sind das Auth-/Crypto-Fundament, der Drizzle-Datenbank-Layer, die Landingpage unter loklm.com, die komplette Release-Pipeline (GitHub Actions → Bunny CDN + MinIO Backup-Mirror), die Provider-Abstraktion (Bundled + Ollama für LLM/Embedder/Reranker), das Settings-Modal-Refactor, die Features Folder-Sync, Quiz und DOCX-Import sowie der Wechsel des Windows-Installers von Custom-NSIS auf einen Electron-basierten Bootstrapper mit electron-builder Portable-Target live gegangen. Parallel wurde die Website-Test-Pipeline (Vitest + Playwright + axe-core + Lighthouse) aufgebaut und eine Mobile-Spec ergänzt, die zwei reale UX-Bugs aufgedeckt hat. Der Gesamtstatus ist planmäßig.

## Status Inhalte / Qualität

_Was wurde wie durchgeführt, was funktioniert? Probleme & Lösungen mit grobem Aufwand pro Punkt._

### Phase 1 — Projekt-Skelett & Krypto-Fundament (08.–15.05.)

- **Projekt-Init & Electron-Skeleton (Denis Tudosa, \~2 h):** pnpm-Workspace, Electron-Dependency, Standard-`.gitignore`, Repo-Struktur. Grundlage für alles Folgende.
- **Design-Specs AP-1.1 (Denis Tudosa, \~3 h):** Drei Iterationen Design-Spec für Projekt-Skelett. Sicherte die Architektur vor der ersten Code-Zeile ab.
- **Drizzle-Switch (Denis Tudosa, \~4 h):** Drei Iterationen Design-Spec + Implementierung des Drizzle-ORM-Stacks samt Migrations-Setup.
- **Multi-Crypto-Layer + Auth-Pipeline (Denis Tudosa, \~12 h):** Argon2-basierte Schlüsselableitung, Vault-DEK-Konzept (später als Vault-Header refaktoriert), Auth-Handler-Skeleton, UI-Flow-Design für Login/Onboarding.
  - **Problem:** Argon2-Derivation-Tests flakey unter parallelem Test-Load.
  - **Lösung:** Argon2-Timeouts auf 45 s erhöht (Commit `16ffe4a`), entfernt pre-existing Flake unter schwerem Parallellauf.
- **AuthService & UI Smoke-Tests (Dominik Furlan, \~4 h):** Erste Test-Suite für den AuthService, Recovery-Key-Test, manuelle Test-Szenario-Templates für reproduzierbare QA-Pässe.
- **Code-Style-Refactor (Denis Tudosa, \~1 h):** Standardisierung von Kommentaren und Lesbarkeit über mehrere Dateien hinweg.

### Phase 2 — Landingpage, Release-Pipeline & Branding (17.–18.05.)

- **Landingpage loklm.com (Denis Tudosa, \~10 h):** Astro 5 + Tailwind 4, DE-Default + EN unter `/en`, 13 Sektionen (Hero, Social Proof, OSS-Marquee, Why, How-it-works, Feature-Deepdives, Feature-Grid, Architecture, Use-Cases, Download, FAQ, Final-CTA, Footer). Honest-Positioning ohne Cloud-Vergleich, Midnight-Glow-Design, ProductWindow-Shell und Screenshot-Pipeline mit Demo-Vault.
  - **Problem:** Trust-Ribbon-Wording „audited code" implizierte eine formale Prüfung, die nicht stattgefunden hat.
  - **Lösung:** Ersetzt durch „code on github" (Commit `b27484c`), Honest-Positioning konsistent gehalten.
  - **Problem:** simpleicons hatte keinen Eintrag für ElectricSQL/PGlite, CDN lieferte 403.
  - **Lösung:** Inline-SVG mit DB-Zylinder + Lightning-Bolt analog zu llama.cpp + Argon2 (Commit `31a2545`).
- **Release-Pipeline & Hetzner-Deploy (Denis Tudosa, \~6 h):** GitHub-Action baut die Landingpage und rsync't sie bei Push auf `main`. electron-builder NSIS-Target, Release-Installer-Workflow, MinIO-Upload, `releases.ts`-Patching nach Asset-Upload.
  - **Problem:** `mc` Binary auf Windows-Runner nicht ausführbar (Exit 126, Linux-Binary).
  - **Lösung:** `mc.exe` statt `mc` (Commit `e0a48f6`).
  - **Problem:** Lokales `release/`-Output-Dir kollidierte mit `mc`-Alias `release` → mc interpretierte Quelldatei als Remote-Pfad.
  - **Lösung:** mc-Alias auf `s3target` umbenannt (Commit `bdc23a4`).
  - **Problem:** `pnpm-action-setup` Version-Key kollidierte mit `packageManager:pnpm@10.33.4` in der root `package.json`.
  - **Lösung:** Version-Key entfernt, Action liest direkt aus `package.json` (Commit `0cd8c92`).
  - **Problem:** electron-builder versuchte aufgrund `CI=true` automatisch nach GitHub-Releases zu publizieren — wir uploaden aber selbst nach MinIO.
  - **Lösung:** `publish:null` in der Build-Config (Commit `fc2c3b1`).
- **Rebranding & Icon-Pass (Denis Tudosa, \~2 h):** v0.1.1 Resource-Folder-Refactor, `buildResources` auf `resources/`, neuer App-Icon im NSIS-Installer.
- **SEO-Suite (Denis Tudosa, \~3 h):** Vollständige Meta-/OG-/Twitter-/JSON-LD-Suite, `@astrojs/sitemap` mit i18n-`alternateRefs` (de-de, en-us), `sitemap-index.xml` + `sitemap-0.xml` beim Build, `robots.txt` mit Sitemap-Verweis, Canonical + `hreflang` (de, en, x-default), JSON-LD-Scripts für Organization und SoftwareApplication.
- **Inter-Font-Self-Hosting (Denis Tudosa, \~1 h):** `@fontsource-variable/inter` (eine Variable-Font-WOFF2 statt vier statische Weights), Preload-Tag, `inlineStylesheets:'always'`. Spart \~390 KiB auf dem Critical-Path und entfernt den Drittanbieter-Origin `rsms.me`.
- **Why-Section & Open-Source-Marquee (Denis Tudosa, \~4 h):** Why-Section mit Problem/Solution-Split und 3-Step-Counter, OSS-Marquee mit 13 Projekten (HuggingFace, llama.cpp, Argon2, Drizzle, PGlite, Electron, Astro, Vite, Tailwind, TypeScript, Node, pnpm, Vitest), CSS-only Infinite-Scroll mit Pause-on-Hover und `prefers-reduced-motion`-Fallback, i18n DE/EN.
- **Domain-Umzug auf loklm.com (Denis Tudosa, \~1 h):** Astro `site:`-Config gebumpt damit Canonical- und Sitemap-URLs passen, Traefik routet apex/www/alte Subdomain (301 auf Apex).

### Phase 3 — Erste echte Releases v0.2.0 → v0.2.3 (19.05.)

- **v0.2.0 mit bundled Models + Linux-CI-Build (Denis Tudosa, \~3 h):** GGUF-Modelle im Installer gebündelt, Linux-CI-Pipeline.
  - **Problem:** makensis 32-Bit-mmap-Limit konnte die \~6 GB Bundled-Payload nicht packen.
  - **Lösung (kurzfristig):** Windows-Target temporär auf ZIP statt NSIS (Commit `ce49257`).
- **v0.2.1 — UX/UI + Chunking + RAG-Verbesserungen (Denis Tudosa, \~6 h):** UX/UI-Politur, Chunking- und RAG-Iteration.
- **v0.2.2 — NSIS-Installer + Runtime-Model-Download (Denis Tudosa, \~4 h):** Zurück auf NSIS-Installer, GGUF-Modelle werden zur Laufzeit nachgeladen (nicht mehr in CI). Löst die mmap-Limit-Problematik dauerhaft.
- **Bunny-CDN + MinIO-Backup-Mirror (Denis Tudosa, \~2 h):** Dual-Upload auf Bunny Storage (primary, CDN) + MinIO (Backup-Mirror), Run-Summary mit Backup-URLs.
- **Source-Viewer & Chunk-Preview (Denis Tudosa, \~3 h):** CSS für Source-Viewer, Titlebar-Status, PDF.js Test-Mock.
- **Reale Screenshots auf der Landingpage (Denis Tudosa, \~1 h):** Placeholder durch echte Produkt-Screenshots ersetzt.

### Phase 4 — Provider-Abstraktion, Settings-Refactor & Custom-NSIS-Versuch (20.05.)

- **Provider-Interfaces & ProviderRegistry (Denis Tudosa, \~4 h):** `LlmProvider`, `EmbedderProvider`, `RerankerProvider` als Interfaces; `BundledLlmProvider` wrappt `LlamaService`, `BundledEmbedderProvider` + Identity-Constant, `BundledRerankerProvider`. ProviderRegistry mit LLM-/Reranker-Fallback-Wrappern. QA/Retrieval/Documents/Backfill durch die Registry geroutet, silent Fallback-Logging.
- **Ollama-Provider-Trias (Denis Tudosa, \~6 h):** `OllamaClient` mit Bearer-Auth + NDJSON-Streaming + Error-Mapping, `OllamaLlmProvider` mit NDJSON-Chat-Streaming, `OllamaEmbedderProvider` mit Dimension-Auto-Detect, Chat-Model-basierter Reranker-Provider.
  - **Problem:** Request-Timeout wurde bei Streams nicht freigegeben, auch nicht nach Header-Empfang.
  - **Lösung:** Timeout nach Header-Eingang clearen, auch für Streams (Commit `9d36923`).
- **Embedder-Identity & Re-Index-Gate (Denis Tudosa, \~3 h):** Spalte `embedder_identity` auf `chunks`, Tagging beim Embedding, automatischer Purge stale Chunks bei Quellen-Wechsel. IPC `embedder:trySwitchSource` mit Probe-before-Commit lehnt Dimension-Mismatch ab, bevor in die DB geschrieben wird.
- **Settings-Modal-Refactor — Profile / Basic / Advanced (Denis Tudosa, \~6 h):** `SettingsService` mit KV-backed `UserSettings` + Avatar-Storage, `UserSettings`-Type + `DEFAULT_SETTINGS`, `useSettings`-Hook mit debounced Update + Saved-Flash-Flag. Profile-Tab (Avatar-Upload + DisplayName-Edit), Basic-Tab (Sprache, Modell-Größe, System-Info), Advanced-Tab-Shell mit Warning-Banner + Reset-Confirm. Segmentierte Controls + Cards + Danger-Reset (Commits `c4795a3`–`d5821a4`).
- **Advanced-Sub-Tabs (Denis Tudosa, \~4 h):** Split in vier Sub-Tabs — LLM-Source + Context-Choice, Embedder-Section mit Re-Index-Gate-Modal, Reranker-Section mit Chat-Model-Warning, Diagnostics-Key/Value-Table, Ollama-Section mit Probe + Modell-Dropdowns + Timeout. Verbleibende Dropdowns durch segmentierte Controls ersetzt.
- **Performance-Pass — kein paralleler Model-Load (Denis Tudosa, \~3 h):** Login-Stages, Idle-Eviction, Ollama-Modelle in Worker-Services, Concurrency-Break beim Modell-Loading, kleinere Bugfixes.
- **Eval-Suite-Aufbau (Denis Tudosa, \~5 h):** Staging-Korpus mit 40 Distraktoren + 6 Question-Batches + Chunk-Sample, adaptives Eval-Dataset (handcrafted Top-K + zwei Sample-Dokumente), Judge-Prompt + queryBreadth + Eval-Metrics Unit-Tests.
- **Custom-NSIS-Installer Versuch (Dominik Furlan, \~14 h):** 17-Task-TDD-Plan, dark-themed Wizard-Design-Spec, drei SVG-Assets (Header 150×57, Sidebar 164×314, Uninstaller-Sidebar 164×314 calm variant), SVG-to-BMP3-Exporter mit `sharp` + handgeschriebenem BMP-Header (BMP3 ist NSIS-Pflicht). Fünf Test-Tiers: Tier-1 Exporter-Tests + Vitest-Project, Tier-2 makensis-Lint-Script, Tier-3 Artifact-Smoke-Test (PE-Header + embedded BMP), Tier-4 Visual-Regression-Procedure + Handoff-Doc für Denis, Tier-5 E2E-Install/Uninstall-Test (Windows-only). NSH-Include mit Dark-Colors + Dir-Page-Checkboxes + Autostart.
  - **Problem:** Custom-Header-Defines leakten in den Uninstaller-Pass und brachen den Build.
  - **Lösung:** Var-Defaults von `customheader` nach `custominit` verschoben, Installer-only-Vars gegen Uninstaller-Pass geguarded (Commits `daf6b44`, `fd41da2`, `5c67b96`).
  - **Problem:** `enumchildwindows`-Scheme für Custom-Controls funktionierte nicht zuverlässig.
  - **Lösung:** Schema gedroppt, `mui_page_customfunction_show` über die Pages gekettet (Commits `94069c5`, `9be2049`).
  - **Problem:** Tier-3 Size-Bound zu strikt + `.exe`-Substring-Match nicht robust.
  - **Lösung:** Size-Bound relaxed + Substring-Match durch robustere Variante ersetzt (Commit `fa3255f`).
  - **Hinweis:** Trotz funktionierender Wizard-Pipeline wurde dieser Stack in Phase 5 zu Gunsten des Electron-Bootstrappers verworfen — Begründung siehe dort.

### Phase 5 — Features Quiz/DOCX/Folder-Sync, Installer-Pivot (21.05.)

- **DOCX-Import (Denis Tudosa, \~3 h):** Spec + mammoth-basierter Parser, Routing durch den bestehenden Markdown-Chunker. Source-Viewer rendert über den Markdown-Branch, kein neuer Chunker, keine HTML-Pipeline. Zitate erhalten Heading-Breadcrumbs.
- **Quiz-Feature (Denis Tudosa, \~6 h):** Theme-aware MCQ-Decks aus ausgewählten Workspace-Dokumenten, Attempt-History mit Stopwatch, source-cited Explanations via Source-Viewer-Modal. Per-Attempt Option- + Question-Shuffle, `scoreAnswers` für Testbarkeit extrahiert, `listDecks`/`listAttempts` deterministisch geordnet. +50 neue Tests.
- **Folder-Sync (Denis Tudosa, \~8 h):** Neuer Service + Panel + Missing-Docs-Banner. Drizzle-Migrationen 0003 (`chunks counter_statement`), 0004 (`sync_metadata`), 0005 (`documents unique path`). Begleitend: `useAuthForm` aus den Auth-Forms extrahiert + `lockedError` geteilt, Ollama-Connector verschärft, Settings-Polish, Chat-/Quiz-/Library-UI-Pass.
- **Backend-Test-Refresh (Dominik Furlan, \~3 h):** Folder-Sync-Integration-Tests, In-Process-Models-Client-Helper, `bridges/common` Shared-Helpers, Refresh bestehender Integration-/Unit-/Eval-Tests.
- **First-Run-License-Flow (Dominik Furlan, \~2 h):** Lokalisierter First-Run-License-Flow im Installer-Wizard (DE/EN).
- **Installer-Pivot: NSIS → electron-builder Portable Target (Denis Tudosa, \~3 h):** Drop des Custom-NSIS-Stubs zu Gunsten des electron-builder Portable-Targets (7zSD-Self-Extractor) mit nativem `splashImage`. `build-installer-splash` bleibt — die generierte BMP wird jetzt vom 7zSD-Self-Extractor statt von makensis konsumiert.
  - **Problem:** Maintenance-Overhead des Custom-NSIS-Stubs (makensis-Toolchain, BMP3-Format, NSIS-Sprache) stand in keinem guten Verhältnis zum Mehrwert.
  - **Lösung:** 7zSD übernimmt Splash, Self-Extract und UAC out-of-the-box — weniger Code, modernere UX, keine makensis-Toolchain mehr notwendig.
- **Installer-Bootstrapper-UI (Dominik Furlan, \~8 h):** Modernes Electron-basiertes Bootstrapper-UI unter `installer-ui/` mit eigener `electron-builder`-Config, HTML/CSS-Splash, i18n DE/EN, `lib` + `main` + `preload` + `renderer` in CommonJS. Version-Pill, Retry-Button, Helper-Extraction. Tests für Progress-Event-Handler, Locale-Resync, Renderer-DOM, HTML-Structure und Uninstaller-Script.
  - **Problem:** `cp()` versuchte `app.asar` als Verzeichnis zu kopieren, weil Electron asar-Inhalte als Dir transparent macht.
  - **Lösung:** `cp()`-Aufruf in `process.noAsar`-Block gewrappt, sodass `app.asar` als Binär-Datei kopiert wird (Commit `adf5b7b`).
- **CI-Fixes für Portable-Target (Denis Tudosa, \~2 h):** Portable-Target schreibt nach `release/installer/` statt `release/` → Artifact-Path-Fix. `artifactName` wird vom Portable-Target nicht immer honoriert → Glob + Rename des Portable-EXE, diagnostische Dumps bei fehlenden Artefakten (Commits `d76d86d`, `961e6d4`).
- **Ollama-Polish & Titlebar-Status (Denis Tudosa, \~3 h):** Response-Language in `OllamaLlmProvider` verdrahtet, Titlebar-LLM-Dot wird violett bei externem Ollama, Fallback-Toast + Provider-Source-Label im Chat-Header, Lazy-Load-Wording (lokales Modell spinnt nur bei Ollama-Failure), Modell-Größe als Fallback-Config umgeframed wenn Ollama aktiv ist. Bundled-Engine wird via `ensureLoaded()` lazy geladen.
- **E2E Settings-Modal (Denis Tudosa, \~1 h):** E2E-Test für Settings-Modal-Open + Language-Toggle-Persistence.

### Phase 6 — Website-Test-Pipeline & Mobile-Härtung (22.05.)

- **Website-Tooling-Setup (Dominik Furlan, \~2 h):** Vitest + `@vitest/coverage-v8` (Coverage-Schwellen 80 % Statements / 70 % Branches, `*.astro` excluded), `@playwright/test` + `@axe-core/playwright` + Lighthouse, npm-Scripts `test:coverage` / `test:e2e` / `lighthouse` / `ci`, `.gitignore` für Coverage + `.lighthouse` + `test-results`.
- **Website Unit + Smoke-Tests (Dominik Furlan, \~5 h):** Unit-Suite + `dist/`/`public/`-Smokes. Releases (`downloadUrl` / `checksumUrl` / `formatSize` / `getAsset` + SHA256- und Plattform-Integrity), i18n-Parity DE/EN + Interpolations-Guard, GitHub-Cache-Branch-Coverage, `schema.ts` aus `Base.astro` extrahiert für testbare JSON-LD-Builders, Dist-Smoke (6 Pages + Canonical + JSON-LD + Sitemap-hreflang), Public-Assets (Brand + Screenshots + Robots). Stand: **131 Tests, 100/98 Coverage**.
- **Website E2E Desktop (Dominik Furlan, \~5 h):** Playwright (Chromium) + axe-core, **38 Specs** (Home / Lang-Switch / Download / Anchors / A11y / Visual). `webServer` baut + previewed automatisch auf `127.0.0.1:4321`, axe excludet `[aria-hidden=true]`-Dekoratives, visuelle Baselines für Hero DE/EN + Download-Card + Footer.
  - **Problem:** Footer-/Social-Proof-Labels Contrast unter WCAG AA (4.11 : 1 statt 4.5 : 1) — von axe aufgedeckt.
  - **Lösung:** `--color-fg-3` von `#6e7681` auf `#7d858f` angehoben → 4.5 : 1 (Commit `164995d`).
- **Website-Docs (Dominik Furlan, \~2 h):** README Test-/Coverage-/E2E-/Lighthouse-Workflow, Scripts-Tabelle, Test-Layer-Map (Unit + Public + Dist + E2E), Visual-Baseline-Update-Note, Lighthouse-Desktop-Baseline **100 / 93 / 100 / 100** dokumentiert, bekannte A11y-Items (dekoratives `aria-hidden`, Touch-Target-Size) als bewusste Design-Choices notiert.
- **Website Mobile-E2E auf Pixel 7 (Dominik Furlan, \~4 h):** Mobile-Project + `mobile.spec.ts` mit **10 Tests**: pinnt Design-Contract „Nav-Links unter `sm:` sind hidden, kein Hamburger", Touch-Target WCAG 2.5.5 Guard auf enabled Download-Links, kein horizontaler Overflow, Lang-Switch funktioniert auf Mobile. Visual-Baseline-Regen für Download-Card nach Padding-Bump. Die Mobile-Spec hat zwei reale Bugs aufgedeckt:
  - **Problem 1:** Lighthouse `target-size` war 0.00 — Download-Button-Höhe 42 px statt der von WCAG 2.5.5 geforderten 44 px.
  - **Lösung 1:** `Download.astro` `py-2.5` → `py-3` hebt die Button-Höhe auf 46 px.
  - **Problem 2:** `LangSwitch` und Nav-Logo verlinkten auf `/en/`, was wegen `trailingSlash:never` auf Mobile zu 404 führte. Auf Desktop „funktionierte" es nur, weil Chromium-Desktop hier Redirects nachsichtiger handhabt.
  - **Lösung 2:** Links auf `/en` korrigiert (Commit `b5e9f08`).

## Status Termine

_Geplante vs. tatsächliche Zeit_

| Meilenstein                                       | Geplant | Tatsächlich | Status    |
| ------------------------------------------------- | ------- | ----------- | --------- |
| Projekt-Init                                      | KW 19   | 08.05.2026  | planmäßig |
| v0.1.0 (Landingpage + Branding)                   | KW 20   | 17.05.2026  | planmäßig |
| v0.1.2 (Auth-Rework)                              | KW 20   | 18.05.2026  | planmäßig |
| v0.2.0 (Bundled Models + Linux-CI)                | KW 20   | 19.05.2026  | planmäßig |
| v0.2.1 (UX/UI + Chunking + RAG)                   | KW 20   | 19.05.2026  | planmäßig |
| v0.2.2 (NSIS + Runtime-Download)                  | KW 20   | 19.05.2026  | planmäßig |
| v0.2.3                                            | KW 20   | 19.05.2026  | planmäßig |
| v0.2.4 (Electron-Installer + Features)            | KW 21   | 22.05.2026  | planmäßig |
| Website-Hardening (Tests + Lighthouse + Mobile)   | KW 21   | 22.05.2026  | planmäßig |
| Installer-Umstellung NSIS → Electron-Bootstrapper | KW 21   | 21.05.2026  | planmäßig |

## Nächste Schritte / nächste Iteration

- **v0.2.5: Auto-Update-MVP** — Velopack-Spec liegt vor, 11 TDD-Tasks geplant (Denis).
- **Code-Signing für den neuen Electron-Installer-Bootstrapper evaluieren** — Beschaffung Zertifikat oder Alternative (Denis).
- **Folder-Sync UX-Politur + Edge-Case-Tests für den Migrations-Pfad** — Behandlung von Datei-Renaming, Move-Operationen, gleichzeitigem Indexieren (Dominik).
- **Eval-Suite-Auswertung** — adaptiven Datensatz gegen das aktuelle RAG-Setup fahren, Ergebnisse dokumentieren (beide).
- **README & Pflichtenheft auf v0.2.4 + neuen Installer-Stack aktualisieren** (Dominik).
- **Mac-/Linux-Build-Pipeline** — Entscheidung zur Priorisierung für v0.3.x (offen).

## Notwendige Entscheidungen

_PAG, Team, Änderungen, Anpassungen_

- **Auto-Update-Strategie: Velopack vs. electron-updater** — PAG-Klärung nötig (Code-Signing-Kosten, Update-Server-Hosting, Rollback-Strategie).
- **Signing-Zertifikat für Windows-EXE** — Beschaffung/Budget abklären, sonst bleibt die SmartScreen-Warnung beim Erstinstall bestehen.
- **Mac-/Linux-Builds in der Auslieferung** — derzeit sekundär; Entscheidung, ob in v0.3.x produktiv mitgeliefert werden.
- **Eval-Suite als CI-Gate** — Soll die adaptive Eval-Suite ab v0.3 als blocking CI-Check laufen? Schwellenwerte und Laufzeit-Budget müssen vorher festgelegt werden.

---

_Denis Tudosa (Projekt-Owner) · Dominik Furlan (Dokumentations-Owner & Tester) — 2026-05-22_
