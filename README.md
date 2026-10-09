# LokLM

**Lokaler KI-Wissensassistent mit Quellenverweisen** — Desktop-Anwendung für
Windows, Linux und macOS, mit der Benutzer eigene Dokumente (PDF, DOCX,
Markdown, Text, HTML, Quellcode) lokal speichern, in Arbeitsbereiche
organisieren und über eine Chat-Oberfläche befragen können. Klickbare Quellenverweise
öffnen die Originalstelle (PDF-Seite bzw. Code-Zeile) zum Gegenprüfen. Sie garantieren
nicht, dass eine Aussage korrekt belegt ist; das Modell kann Fehler machen oder
Widersprüche übersehen.

Mit den mitgelieferten Modellen läuft die Verarbeitung nach dem Modell-Download
offline, ohne externe KI-APIs oder Telemetrie. Optional lässt sich Ollama für Chat,
Embeddings und Reranking auswählen. Ein Server auf einem anderen Rechner benötigt
die ausdrückliche Freigabe seiner Zieladresse; Inhalte für die dort ausgewählten
Funktionen werden an diesen Server gesendet. Übersetzung nutzt ebenfalls das
ausgewählte Sprachmodell.

Vault, Arbeitsbereichs-Datenbanken und erzeugte Texte sind verschlüsselt.
Vektorindizes sind standardmäßig verschlüsselt gespeichert und nutzen während
der Verarbeitung ein lokales Klartext-Arbeitsverzeichnis. Für nicht vertrauliche
Bestände ist ein dauerhaft unverschlüsselter Vektorindex wählbar. Importierte
Originaldateien bleiben an ihrem bisherigen Ort und werden nicht verändert oder
von LokLM verschlüsselt.

Architektur-Entscheidungen sind in [docs/adr/](docs/adr/) dokumentiert;
Feature-Specs in [docs/specs/](docs/specs/).

## Editionen

| Edition  | Modell     | Größe   | Zielhardware       |
| -------- | ---------- | ------- | ------------------ |
| Lite     | Qwen3.5 4B | ~3,6 GB | iGPU, ab 12 GB RAM |
| Standard | Qwen3.5 4B | ~4 GB   | Mittelklasse       |
| Pro      | Qwen3.5 9B | ~7 GB   | dedizierte GPU     |

Die Größen sind Downloadgrößen, keine VRAM-Anforderungen. Dazu optional:
Dokument-Übersetzung über das ausgewählte Chat-Sprachmodell, lokale Audio-Transkription
(Whisper) und Lern-/Produktivitäts-Tools. Mit den mitgelieferten Modellen bleiben
die Inhalte auf dem Gerät.

## Voraussetzungen

- Die mitgelieferten KI-Modelle benötigen eine unterstützte integrierte oder
  dedizierte GPU mit passendem Treiber; reine CPU-Inferenz ist deaktiviert.
  Das Sprachmodell kann teilweise auf GPU und CPU laufen. Auf 4-GB-GPUs werden
  Chat- und Embedding-Modelle bei Bedarf gewechselt; der automatische Reranker
  bleibt deaktiviert. Modell, Kontextlänge und freier Speicher bestimmen, ob
  die Konfiguration passt und wie schnell sie arbeitet.
- **Node.js** ≥ 24
- **pnpm** 10 (festgenagelt via `packageManager` in `package.json`)
- Entwicklung läuft auf Windows, Linux und macOS

Für die native Transkriptionsbibliothek werden unter macOS Xcode Command Line
Tools, CMake und Git benötigt. Unter Ubuntu vor `pnpm install` die Build-Werkzeuge
installieren:

```bash
sudo apt-get install build-essential cmake git python3 libvulkan-dev binutils
```

Auf Intel-Macs benötigt die Vektordatenbank zusätzlich Rust **1.94.0** und
Protobuf (`protoc`). Vor `pnpm install`:

```bash
rustup toolchain install 1.94.0 --profile minimal
brew install protobuf
```

Da LanceDB 0.30.0 keinen fertigen Intel-Mac-Build liefert, wird dessen native
Bibliothek aus dem zur JavaScript-Version gehörenden Commit gebaut. Dieser erste
Build kann längere Zeit dauern; geprüfte Ergebnisse werden unter
`out/native-lancedb` wiederverwendet. Fertige App-Downloads benötigen diese
Build-Werkzeuge nicht.

Der erste Build lädt festgelegte Quellversionen und kompiliert die Bibliothek
einschließlich der benötigten Shader-Werkzeuge. Weitere Aufrufe prüfen und
verwenden den vorhandenen Build. Fertige Linux-Downloads benötigen den
Vulkan-Loader (`libvulkan1`) und einen passenden GPU-Treiber; das Debian-Paket
fordert den Loader als Abhängigkeit an. Für den `.run`-Installer muss er bereits
installiert sein.

## Quickstart

```bash
pnpm install     # installiert deps + baut Native-Module für Electron neu
pnpm dev         # prüft/lädt Standard-Modelle und startet Electron mit HMR
pnpm test:unit   # alle Unit-Tests inklusive Renderer und Build-Scripts
pnpm test        # alle Vitest-Projekte inklusive DB- und Vault-Tests
pnpm build       # Production-Build → out/{main,preload,renderer}
```

Unter Windows PowerShell bei Bedarf `pnpm.cmd` verwenden. `pnpm dev` nutzt
Standard (unter 16 GiB RAM Lite); `pnpm dev --lite`, `--standard` oder `--pro`
wählt die Edition explizit. `pnpm models:standard` lädt die Modelle ohne App-Start.
Vorhandene Modelle einer lokalen Installation werden nach Prüfsummenprüfung
kopiert, unterbrochene Downloads fortgesetzt. Übersetzung nutzt das ausgewählte
Chat-Modell und benötigt keinen zusätzlichen Sidecar (siehe [ADR-0009](docs/adr/0009-shared-llm-translation.md)).

## Scripts (Auswahl)

| Script                                               | Zweck                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                                           | Electron + Vite Dev-Server mit HMR                          |
| `pnpm build`                                         | Production-Build (alle drei Bundles)                        |
| `pnpm start`                                         | Production-Build lokal vorschauen                           |
| `pnpm test` / `test:watch`                           | Alle Vitest-Projekte (passende native Laufzeit automatisch) |
| `pnpm test:unit`                                     | Unit-Tests, Renderer, Installer-Frontend und Scripts        |
| `pnpm test:integration` / `test:tx`                  | Integrations- bzw. Transaktions-Tests                       |
| `pnpm test:e2e`                                      | Playwright-E2E gegen die gebaute App                        |
| `pnpm evals:run` / `evals:sweep`                     | Qualitäts-Evals (Retrieval/Antwort, s. `tests/evals/`)      |
| `pnpm package:win` / `package:linux` / `package:mac` | Installer-Builds pro Plattform                              |
| `pnpm typecheck`                                     | `tsc -b` über die Project References                        |
| `pnpm lint` / `pnpm format`                          | ESLint flat-config / Prettier                               |
| `pnpm doc`                                           | TypeDoc-Doku → `docs/api/`                                  |

Vollständige Liste: `package.json`.

## Projektstruktur

| Pfad                | Inhalt                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `src/main/`         | Electron-Hauptprozess (Window-Lifecycle, IPC, Services)              |
| `src/preload/`      | contextBridge-Fassade (`window.api`)                                 |
| `src/renderer/`     | React-App (Vite-Root: `src/renderer/`, Sourcen: `src/renderer/src/`) |
| `src/shared/`       | Pure-Funktionen, die Main und Renderer teilen                        |
| `installer-wizard/` | Tauri-basierter Installer-Wizard                                     |
| `website/`          | Verteilungs-Homepage (Astro)                                         |
| `docs/adr/`         | Architecture Decision Records                                        |
| `docs/specs/`       | Feature-Specs und Designdokumente                                    |
| `tests/`            | Unit-, Integrations-, Transaktions-, E2E-Tests + Eval-Säule          |

## Pre-Commit-Hook

`husky` + `lint-staged` formatieren und linten staged Files automatisch
(Prettier + ESLint --fix), gefolgt von einem projektweiten `pnpm typecheck`.
Der Hook wird via `prepare`-Script bei `pnpm install` installiert.

## Tech-Stack (Kurzform)

Electron 42 · electron-vite 4 · React 18 · TypeScript 5 strict ·
Vitest 4 · ESLint 9 flat config · Prettier 3 · TypeDoc ·
SQLite mit SQLCipher (`better-sqlite3-multiple-ciphers`) · argon2id ·
node-llama-cpp (Qwen3.5 GGUF, BGE-M3-Embeddings, BGE-Reranker).

## Status

In aktiver Entwicklung; Version **v0.7.4** (Windows, Linux, macOS).
Änderungen: [Release Notes](docs/releases/v0.7.0.md).

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
