# Deployment, Betrieb und Laufzeit

Dieses Kapitel beschreibt, wie LokLM gebaut, lokal betrieben und ausgeliefert wird, welche Modelle zur Laufzeit benötigt werden, wie der Installer aufgebaut ist und welche Infrastruktur für die GPU-Evaluierungen genutzt wird.

## 20.1 Benötigte Umgebung

Tabelle 20.1 fasst die benötigte Umgebung zusammen.

**Tabelle 20.1:** Benötigte Build- und Laufzeitumgebung.

| Voraussetzung    | Wert                                                                                                                                                                                                                                                                                                                                   | Quelle                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Node.js          | ≥ 24                                                                                                                                                                                                                                                                                                                                   | `engines` in [package.json](../../package.json)                |
| Package-Manager  | pnpm 10.x                                                                                                                                                                                                                                                                                                                              | `packageManager` in [package.json](../../package.json)         |
| Build-Werkzeug   | electron-vite 4.x, Electron 42                                                                                                                                                                                                                                                                                                         | devDependencies                                                |
| Native Toolchain | wird per `electron-rebuild`/`pnpm.onlyBuiltDependencies` für Electron gebaut (`argon2`, `node-llama-cpp`, `sodium-native`, `@mongodb-js/zstd`); `node-llama-cpp` ist zusätzlich per pnpm-Patch (`patches/node-llama-cpp.patch`) angepasst, der den binären Selbsttest überspringt, damit die GPU im gepackten Build lädt (seit v0.4.7) | `postinstall`-Script                                           |
| Installer-Build  | Rust-Toolchain (msvc/gnu) + Tauri-CLI ^2.0                                                                                                                                                                                                                                                                                             | [installer-wizard/README.md](../../installer-wizard/README.md) |

Hinweis aus dem Projektbetrieb: Der Installer-Build benötigt Rust/Tauri und ist nicht auf jeder Entwicklungsmaschine vorhanden; ein In-Place-Update der bereits installierten App (per Datei-Copy der `out/`-Artefakte) ist die genutzte Behelfslösung, wenn der volle Installer-Build nicht verfügbar ist.

## 20.2 Lokaler Start (Entwicklung)

Tabelle 20.2 listet die Befehle für den lokalen Entwicklungsstart.

**Tabelle 20.2:** Befehle für Entwicklung und Build.

| Befehl                                         | Wirkung                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                                     | `electron-vite dev` — Dev-Server mit HMR, gelockerte CSP nur im Dev |
| `pnpm build`                                   | `electron-vite build` — Produktions-Build nach `out/`               |
| `pnpm start`                                   | `electron-vite preview` — Vorschau des Builds                       |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TypeScript-Check, ESLint, Prettier                                  |

Betriebshinweis zum Dev-Start: Damit `pnpm dev` nicht beim `BrowserWindow`-Import abstürzt, muss die Umgebung `ELECTRON_RUN_AS_NODE` ungesetzt sein und die Sandbox beim Start deaktiviert werden — andernfalls scheitert der Start. Dies ist eine lokale Entwicklungs-Eigenheit, nicht das Verhalten der gepackten App.

## 20.3 Tests

Tabelle 20.3 nennt die verfügbaren Test-Befehle.

**Tabelle 20.3:** Test-Befehle und ihre Bereiche.

| Befehl                              | Bereich                                   |
| ----------------------------------- | ----------------------------------------- |
| `pnpm test` / `test:cov`            | Vitest (Unit + Integration), mit Coverage |
| `pnpm test:unit`                    | Node- + Web-Projekte                      |
| `pnpm test:integration` / `test:tx` | Integrations- bzw. DB-Transaktionstests   |
| `pnpm test:e2e`                     | Playwright-E2E (Electron)                 |

> WARN Status unklar

Die Playwright-E2E-Suite für die Electron-App läuft in der lokalen/CI-Umgebung nicht zuverlässig — Playwright kann Electron mit `--remote-debugging-port=0` nicht starten; die gesamte `tests/e2e`-Suite ist davon betroffen. Die Website-E2E-Tests sind hiervon nicht berührt. Dieser Punkt ist in der Test-Säule dokumentiert und durch das Team bei Behebung zu aktualisieren.

## 20.4 Datenbank-Skripte

Tabelle 20.4 gibt die Datenbank-Skripte wieder.

**Tabelle 20.4:** Datenbank-Skripte für Migration und Inspektion.

| Befehl             | Wirkung                                                     |
| ------------------ | ----------------------------------------------------------- |
| `pnpm db:generate` | `drizzle-kit generate` — neue Migration aus Schema ableiten |
| `pnpm db:check`    | Migrations-Konsistenzprüfung                                |
| `pnpm db:studio`   | Drizzle-Studio (DB-Inspektion)                              |

Zur Laufzeit werden beim Entsperren der Datenbank zuerst die generierten Drizzle-Migrationen [5] aus `drizzle/` und danach die rohen SQL-Migrationen `0001`–`0010` aus [src/main/db/migrations/](../../src/main/db/migrations/) ausgeführt ([src/main/db/migrate.ts](../../src/main/db/migrate.ts)). In gepackten Builds liegen beide Ordner über `build.extraResources` unter `process.resourcesPath`.

## 20.5 Modelle: Download und Tiers

LokLM nutzt lokale GGUF-Gewichte. Für die Entwicklung lädt das Skript [scripts/download-models.mjs](../../scripts/download-models.mjs) die Modelle nach Tier (Re-Run überspringt vorhandene Dateien); Tabelle 20.5 zeigt die Download-Befehle:

**Tabelle 20.5:** Befehle für den Modell-Download nach Tier.

| Befehl                    | Inhalt                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm models:embedder`    | Embedder (BGE-M3) + Reranker (BGE-v2-M3)                                                                          |
| `pnpm models:lite`        | Lite-LLM (Qwen3.5-2B) + Embedder                                                                                  |
| `pnpm models:medium`      | Qwen3.5-2B + 4B + Embedder                                                                                        |
| `pnpm models:pro`         | Qwen3.5-2B + 4B + 9B + Embedder                                                                                   |
| `pnpm models:all`         | gesamtes Ship-Bundle                                                                                              |
| `pnpm models:evals`       | Eval-Modellpool + Judge-Modell                                                                                    |
| `pnpm models:translation` | Übersetzungs-Eval-Pool (Gemma Q4/Q6 + Qwen3.5 2B/4B/9B); das Produktiv-MADLAD-400-3B liefert der Installer-Wizard |
| `pnpm tessdata`           | OCR-Traineddata (Tesseract)                                                                                       |

**Required-Modelle** im Laufzeit-Manifest sind ausschließlich **Embedder + Reranker** ([src/main/services/models/manifest.ts](../../src/main/services/models/manifest.ts)) — beide werden mit SHA-256 verifiziert und über `models:status`/`allRequiredReady` auf Bereitschaft geprüft; seit v0.4.7 ohne In-App-Erststart-Downloader (ein fehlendes Required-Modell erscheint als _not-ready_-Dienst, kein Download-Prompt). Das **LLM ist nicht mehr Teil des Laufzeit-Manifests**: Seit v0.3.0 besitzt der Installer-Wizard die LLM-Akquise per Tier-Bundle; LLM-Erkennung erfolgt zur Laufzeit über Dateinamen-Pattern (`LlamaService.discoverProfiles`).

**Tier-↔-Profil-Zuordnung** (Installer-Wahl bestimmt das LLM-Profil, [src/main/services/llm/LlamaService.ts](../../src/main/services/llm/LlamaService.ts)); Tabelle 20.6 stellt die Zuordnung dar:

**Tabelle 20.6:** Zuordnung von Tier zu LLM-Profil.

| Tier (Installer) | LLM-Profil | Modell (ungefähr) | Hardware-Ziel        |
| ---------------- | ---------- | ----------------- | -------------------- |
| lite             | lite       | Qwen3.5-2B        | 8 GB                 |
| standard         | full       | Qwen3.5-4B        | 16 GB+               |
| pro              | xl         | Qwen3.5-9B        | High-End-GPU, 32 GB+ |

Die Modelle werden von HuggingFace (`resolve/main/<file>`-URLs) gezogen. Der Embedder ist `bge-m3-Q4_K_M.gguf` (~0,4 GB), der Reranker `bge-reranker-v2-m3-Q4_K_M.gguf` (~0,4 GB).

## 20.6 Paketierung und Installer

Die App wird je Plattform gepackt (Befehle aus [package.json](../../package.json)):

- `pnpm package:win` → vierstufige Pipeline: `:payload` (electron-vite + electron-builder, CUDA gestrippt) → `:archive` (Payload-/CUDA-Archive `.tar.zst` + SHA-256 + Manifest) → `:wizard` (Tauri-Wizard `loklm.exe`) → `:stub` (NSIS bündelt Wizard + win-unpacked).
- `pnpm package:linux` → analog, plus `.deb` (makeself-`.run` + Debian-Paket).
- `pnpm package:mac` → Payload + Wizard + DMG (Mac bleibt beim Download-Modell).

**Installer-Wizard (Tauri).** Der vom Nutzer gesehene Installer ist ein **Tauri-Wizard** [28] (~2,8 MB Stub, ~200 ms Start), der die geteilte HTML/CSS/JS-Oberfläche aus `installer-wizard/frontend/` in einem WebView2-Fenster rendert; die Install-Logik (Datei-Copy, Verknüpfungen, Registry, Uninstaller) ist nativer Rust ([installer-wizard/README.md](../../installer-wizard/README.md), [installer-wizard/src-tauri/](../../installer-wizard/src-tauri/)). Der Wizard probt beim Install die Hardware, der Nutzer wählt die Edition (lite/standard/pro), und ein Phase-2-Downloader holt das passende Modell-Bundle. Der Wizard schreibt den **Tier-Marker** `loklm-tier.json`, den die App über [TierMarker.ts](../../src/main/services/tier/TierMarker.ts) liest.

**Payload-Modell (v0.3.1+).** Win + Linux **betten den Electron-Payload [1] in den Installer ein** (NSIS/makeself), weil ein schlanker Download-Stub Defenders ML-Heuristik (`Wacatac.B!ml`) auslöste — ein fetter, signierter Installer hat eine bessere Reputation. Mac bleibt beim Download-Modell (Gatekeeper). Ungefähre Artefakt-Größen: Win ~375 MB, Linux ~375 MB, Mac ~10 MB (Wizard-only, Payload aus dem Objektspeicher nachgeladen). Optionales CUDA-Addon + GGUF-Modelle werden auf jeder Plattform zur Install-Zeit nachgeladen (lite ~1,6 GB, standard ~3,4 GB, pro ~6,3 GB).

**Release-Pipeline.** Der GitHub-Actions-Workflow [.github/workflows/release-installer.yml](../../.github/workflows/release-installer.yml) baut bei einem `v*`-Tag-Push alle drei Plattformen, lädt Installer + Payload + CUDA-Archive in den internen Objektspeicher (`<PRIVATE_DOMAIN>`), patcht das Website-Release-Manifest und re-deployed die Website. Zugangsdaten (`MINIO_*`, `WIN_CSC_*`, `HETZNER_*`, `MANIFEST_DEPLOY_KEY`) liegen als GitHub-Secrets; im Handbuch sind sie als `<API_KEY>`/`<S3_KEY>`/`<TOKEN>` zu lesen, interne Domains als `<PRIVATE_DOMAIN>`. Partial-Releases (einzelne Plattform) müssen die Live-Version wiederverwenden (globaler `/v<version>/`-URL-Pfad).

## 20.7 Laufzeit-Footprint und Modell-Residenz

Zur Laufzeit hostet LokLM mehrere Runtimes mit unterschiedlichem Geräteprofil ([docs/adr/0004-adaptive-model-residency.md](../../docs/adr/0004-adaptive-model-residency.md)); Tabelle 20.7 fasst die Runtimes zusammen:

**Tabelle 20.7:** Laufzeit-Runtimes und ihre Gerätewahl.

| Modell                     | Runtime                          | Gerätewahl heute                                                    |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| LLM (Qwen3.5)              | node-llama-cpp, geteilter Worker | Nutzer-Wahl **auto/cpu/gpu**; bei `auto` GPU-first mit CPU-Fallback |
| Embedder (BGE-M3)          | node-llama-cpp, geteilter Worker | Placement zur Ladezeit (`planAux`)                                  |
| Reranker (BGE-v2-M3)       | node-llama-cpp, geteilter Worker | Placement zur Ladezeit                                              |
| Translator (MADLAD-400-3B) | CTranslate2-Sidecar              | Binärwahl `-cuda` vs. CPU beim Spawn                                |
| Transcription (Whisper)    | eigener utilityProcess           | Binär/Build                                                         |

Das Placement ist **zur Ladezeit fixiert** und wird nicht adaptiv revidiert (ADR-0004 unten); für das LLM ist die Gerätewahl seit `eba08e3` jedoch **nutzergesteuert**: die Einstellung `advanced.llm.placement` (auto/cpu/gpu, analog zu Embedder/Reranker) lädt das Modell bei Änderung neu, damit das Gerät vor der nächsten Antwort greift, und die Status-Bar zeigt über `resolvedPlacement` das tatsächlich aktive Gerät (CUDA-/CPU-Chip). Embedder/Reranker bleiben nach dem ersten Load warm (GGUF-Reload kostet Sekunden); nur das LLM hat eine Idle-Eviction (Default 30 min, `LOKLM_LLM_IDLE_MS`). Die in ADR-0004 „Adaptive Model Residency" vorgeschlagene adaptive Residenz-Policy ist ein **Design-Vorschlag (ADR-0004, Status PROPOSED) — im aktuellen Stand NICHT implementiert** (kein `src/main/.../placement/`-Code vorhanden).

## 20.8 Bekannte Laufzeitprobleme

- **Keine parallele Inferenz** auf dem geteilten `modelsWorker`: Zwei gleichzeitige native Forward-Pässe crashen auf knappen Maschinen (Windows-Access-Violation `0xC0000005`). Inferenz ist daher serialisiert; die Residenz mehrerer Modelle erhöht nie die Parallelität. Beleg: [workers/ModelsWorkerClient.ts](../../src/main/services/workers/ModelsWorkerClient.ts).
- **Dev-Start-Eigenheit** (siehe 20.2): `ELECTRON_RUN_AS_NODE` muss ungesetzt sein, Sandbox deaktiviert.
- **Installer-Build erfordert Rust/Tauri** (siehe 20.1) — nicht auf jeder Maschine vorhanden; In-Place-Robocopy-Update als Behelf.
- **Playwright-E2E** läuft nicht in CI (siehe 20.3).
- **Single-Instance-Lock:** Nur ein Prozess darf den Tresor anfassen; ein zweiter Start fokussiert nur das bestehende Fenster.

## 20.9 GPU-Evaluierungen (RunPod)

Die GPU-gestützten Modell-Evaluierungen (u. a. der Judge-Eval und der AP-E.2-Matrix-Sweep) laufen auf einem externen GPU-Pod (RunPod), gesteuert über das Skript [tests/evals/runpod/pod.ts](../../tests/evals/runpod/pod.ts) mit den Befehlen `pnpm pod:start` / `pnpm pod:stop` / `pnpm pod:status`. Die Eval-Pipelines selbst werden über die `evals:*`-Skripte angestoßen (`evals:run`, `evals:sweep`, `evals:matrix`, `evals:pack`, `evals:paper` u. a.).

> WARN durch Team zu ergaenzen

Zugangsdaten für RunPod (API-Key, Pod-/Endpoint-IDs) sind im Handbuch als `<API_KEY>` bzw. `<TOKEN>` zu lesen und gehören **nicht** in dieses Dokument. Betriebliche Erfahrungswerte zum Pod (passende Modell-Pools statt großem Storage-Pool, MooseFS-Quota-Verhalten `EDQUOT`, öffentliches Repo, Neustart-Verhalten) sind dem internen Betriebsleitfaden zu entnehmen; sie werden hier bewusst nicht im Detail zitiert.

> WARN Status unklar

Der AP-E.2-Phase-2-GPU-Sweep (Embedder × Reranker × Chunker × LLM) ist zum Handbuchstand **offen** — das Dataset steht, der eigentliche Sweep auf GPU und dessen Auswertung stehen noch aus (siehe auch das Test-/Eval-Kapitel). Der konkrete Lauf-Stand ist durch das Team zu ergänzen.
