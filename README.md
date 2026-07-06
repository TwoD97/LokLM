# LokLM

**Lokaler KI-Wissensassistent mit Quellenverifikation** — Desktop-Anwendung für
Windows, Linux und macOS, mit der Benutzer eigene Dokumente (PDF, DOCX,
Markdown, Text, HTML, Quellcode) lokal speichern, in Arbeitsbereiche
organisieren und über eine Chat-Oberfläche befragen können. Antworten enthalten
klickbare Quellenverweise auf die Originalstelle (PDF-Seite bzw. Code-Zeile).
Die Anwendung läuft vollständig offline; keine externen KI-APIs, keine
Telemetrie.

Architektur-Entscheidungen sind in [docs/adr/](docs/adr/) dokumentiert;
Feature-Specs in [docs/specs/](docs/specs/).

## Editionen

| Edition  | Modell     | Größe   | Zielhardware       |
| -------- | ---------- | ------- | ------------------ |
| Lite     | Qwen3.5 4B | ~3,6 GB | iGPU, ab 12 GB RAM |
| Standard | Qwen3.5 4B | ~4 GB   | Mittelklasse       |
| Pro      | Qwen3.5 9B | ~7 GB   | dedizierte GPU     |

Dazu optional: lokale Dokument-Übersetzung (MADLAD-400), Audio-Transkription
(Whisper) und Lern-/Produktivitäts-Tools — alles on-device.

## Voraussetzungen

- **Node.js** ≥ 24
- **pnpm** 10 (festgenagelt via `packageManager` in `package.json`)
- Entwicklung läuft auf Windows, Linux und macOS

## Quickstart

```bash
pnpm install     # installiert deps + baut Native-Module für Electron neu
pnpm dev         # startet das Electron-Fenster mit HMR
pnpm test        # Vitest-Lauf (Unit + jsdom)
pnpm build       # Production-Build → out/{main,preload,renderer}
```

## Scripts (Auswahl)

| Script                              | Zweck                                            |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm dev`                          | Electron + Vite Dev-Server mit HMR               |
| `pnpm build`                        | Production-Build (alle drei Bundles)             |
| `pnpm start`                        | Production-Build lokal vorschauen                |
| `pnpm test` / `test:watch`          | Vitest (Unit + jsdom)                            |
| `pnpm test:integration` / `test:tx` | Integrations- bzw. Transaktions-Tests            |
| `pnpm test:e2e`                     | Playwright-E2E gegen die gebaute App             |
| `pnpm evals:run` / `evals:sweep`    | Qualitäts-Evals (Retrieval/Antwort, s. `tests/evals/`) |
| `pnpm package:win` / `package:linux` / `package:mac` | Installer-Builds pro Plattform |
| `pnpm typecheck`                    | `tsc -b` über die Project References             |
| `pnpm lint` / `pnpm format`         | ESLint flat-config / Prettier                    |
| `pnpm doc`                          | TypeDoc-Doku → `docs/api/`                       |

Vollständige Liste: `package.json`.

## Projektstruktur

| Pfad                | Inhalt                                                                |
| ------------------- | --------------------------------------------------------------------- |
| `src/main/`         | Electron-Hauptprozess (Window-Lifecycle, IPC, Services)               |
| `src/preload/`      | contextBridge-Fassade (`window.api`)                                  |
| `src/renderer/`     | React-App (Vite-Root: `src/renderer/`, Sourcen: `src/renderer/src/`)  |
| `src/shared/`       | Pure-Funktionen, die Main und Renderer teilen                         |
| `installer-wizard/` | Tauri-basierter Installer-Wizard                                      |
| `website/`          | Verteilungs-Homepage (Astro)                                          |
| `docs/adr/`         | Architecture Decision Records                                         |
| `docs/specs/`       | Feature-Specs und Designdokumente                                     |
| `tests/`            | Unit-, Integrations-, Transaktions-, E2E-Tests + Eval-Säule           |

## Pre-Commit-Hook

`husky` + `lint-staged` formatieren und linten staged Files automatisch
(Prettier + ESLint --fix), gefolgt von einem projektweiten `pnpm typecheck`.
Der Hook wird via `prepare`-Script bei `pnpm install` installiert.

## Tech-Stack (Kurzform)

Electron 42 · electron-vite 4 · React 18 · TypeScript 5 strict ·
Vitest 3 · ESLint 9 flat config · Prettier 3 · TypeDoc ·
SQLite mit SQLCipher (`better-sqlite3-multiple-ciphers`) · argon2id ·
node-llama-cpp (Qwen3.5 GGUF, BGE-M3-Embeddings, BGE-Reranker).

## Status

In aktiver Entwicklung; aktueller Release **v0.6.6** (Windows, Linux, macOS).

**Query-Routing (ADR-0003):** Chat-Anfragen werden regex-first auf drei Routen
verteilt, statt jede Frage durch Chunk-Retrieval zu zwingen:

- `doc_summary` — „fasse Dokument X zusammen" → gecachter Whole-Doc-Summary als
  Kontext (statt topK-Fragmente).
- `corpus` — „wie viele / welche Dokumente zu Y" → Antwort aus der
  `documents`-Tabelle, ohne LLM.
- `retrieval` — der Default ; jeder Routing-Miss fällt still hierher zurück.

Details: [ADR-0003](docs/adr/0003-query-routing-und-summary-index.md).

## Lizenz

[MIT](LICENSE)
