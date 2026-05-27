# LokLM

**Lokaler KI-Wissensassistent mit Quellenverifikation** — Windows-Desktop-Anwendung,
mit der Benutzer eigene Dokumente (PDF, Markdown, Text, Quellcode) lokal
speichern, in Arbeitsbereiche organisieren und über eine Chat-Oberfläche
befragen können. Antworten enthalten klickbare Quellenverweise. Die Anwendung
läuft vollständig offline; keine externen KI-APIs.

LokLM ist **English-first**: die Oberfläche ist in Englisch und Deutsch (EN/DE)
verfügbar, Standardsprache ist Englisch.

Siehe [Lastenheft](docs/Lastenheft.md) und [Pflichtenheft](Pflichtenheft_LokLM.md)
für Kontext und Anforderungen.

## Komponenten

Das Repository umfasst drei Teile:

| Teil                | Stack                                                 |
| ------------------- | ----------------------------------------------------- |
| `src/`              | Electron-Desktop-App (React 18) — die eigentliche App |
| `installer-wizard/` | Tauri-Installer (Rust + WebView2 + HTML/CSS-Frontend) |
| `website/`          | Astro-5-Landingpage                                   |

Alle drei teilen die EN/DE-Internationalisierung (English-first) — siehe
[Internationalisierung (i18n)](#internationalisierung-i18n).

## Voraussetzungen

- **Node.js** ≥ 20 (LTS empfohlen)
- **pnpm** 10 (festgenagelt via `packageManager` in `package.json`)
- **Windows 10/11** für die Ziel-Plattform; Entwicklung läuft auch auf macOS/Linux
- **Rust-Toolchain** (nur für den Installer-Wizard / Tauri)

## Quickstart

```bash
pnpm install     # installiert deps + baut Native-Module für Electron neu
pnpm dev         # startet das Electron-Fenster mit HMR
pnpm test        # Vitest-Workspaces (node + jsdom)
pnpm build       # Production-Build → out/{main,preload,renderer}
```

## Scripts

| Script                                        | Zweck                                    |
| --------------------------------------------- | ---------------------------------------- |
| `pnpm dev`                                    | Electron + Vite Dev-Server mit HMR       |
| `pnpm build`                                  | Production-Build (alle drei Bundles)     |
| `pnpm start`                                  | Production-Build lokal vorschauen        |
| `pnpm test`                                   | Vitest-Lauf (node + jsdom Workspaces)    |
| `pnpm test:watch`                             | Vitest im Watch-Modus                    |
| `pnpm test:cov`                               | Vitest mit Coverage-Report (`coverage/`) |
| `pnpm typecheck`                              | `tsc -b` über beide Project References   |
| `pnpm lint` / `pnpm lint:fix`                 | ESLint flat-config (`eslint.config.js`)  |
| `pnpm format` / `pnpm format:check`           | Prettier                                 |
| `pnpm doc`                                    | TypeDoc-Doku → `docs/api/`               |
| `pnpm db:generate` / `db:studio` / `db:check` | Drizzle-Kit                              |

## Projektstruktur

| Pfad                     | Inhalt                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| `src/main/`              | Electron-Hauptprozess (Window-Lifecycle, später IPC, Services)       |
| `src/preload/`           | contextBridge-Fassade (`window.api`)                                 |
| `src/renderer/`          | React-App (Vite-Root: `src/renderer/`, Sourcen: `src/renderer/src/`) |
| `src/renderer/src/i18n/` | EN/DE-Übersetzungen (domänen-gesplittete Dicts + `index.ts`)         |
| `src/shared/`            | Pure-Funktionen die Main und Renderer teilen                         |
| `installer-wizard/`      | Tauri-Installer (Rust `src-tauri/` + WebView2-Frontend)              |
| `website/`               | Astro-5-Landingpage                                                  |
| `drizzle/`               | Generierte SQL-Migrationen (von `drizzle-kit generate`)              |
| `docs/specs/`            | Feature-Specs und Designdokumente                                    |
| `docs/adr/`              | Architecture Decision Records                                        |
| `tests/manual/`          | Manuelle Test-Szenarien (Pflichtenheft §8.3)                         |

Vollständiges Layout: siehe Pflichtenheft Anhang A.

## Pre-Commit-Hook

`husky` + `lint-staged` formatieren und linten staged Files automatisch
(Prettier + ESLint --fix), gefolgt von einem projektweiten `pnpm typecheck`.
Der Hook wird via `prepare`-Script bei `pnpm install` installiert.

## Internationalisierung (i18n)

LokLM ist **English-first**: Standardsprache ist Englisch, Deutsch (DE) ist
vollständig verfügbar. Die gewählte Antwortsprache (Response-Language-Einstellung)
wird durchgereicht.

Die Übersetzungen liegen pro Komponente getrennt:

| Komponente       | Ort                                 | Format                                                                   |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Desktop-App      | `src/renderer/src/i18n/`            | domänen-gesplittete Dicts (`dict_chat`, `dict_settings`, …) + `index.ts` |
| Installer-Wizard | `installer-wizard/frontend/i18n.js` | UMD-Skript (auch als CJS für Tests require-bar)                          |
| Website          | `website/` (Astro)                  | DE/EN-Parität                                                            |

Neue Strings ergänzt man, indem man den Schlüssel in **beiden** Sprachen (EN + DE)
im jeweiligen Dict bzw. i18n-File hinzufügt.

## Tech-Stack (Kurzform)

Electron 42 · Vite via electron-vite 2 · React 18 · TypeScript 5 strict ·
Vitest 2 + Workspaces (node + jsdom) · ESLint 9 flat config · Prettier 3 ·
TypeDoc · PGlite + Drizzle ORM · argon2id.

Installer-Wizard: Tauri (Rust + WebView2). Website: Astro 5.

Vollständige Versionsmatrix: Pflichtenheft Anhang B + `package.json`.

## Status

In Entwicklung (aktuell v0.2.9). Desktop-App, Tauri-Installer-Wizard und
Astro-Website sind vorhanden, inkl. EN/DE-Oberfläche (English-first) und Chat
mit klickbaren Quellenverweisen. Folge-APs siehe Pflichtenheft §9.2.

## Lizenz

[MIT](LICENSE)
