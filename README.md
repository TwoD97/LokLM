# LokLM

**Lokaler KI-Wissensassistent mit Quellenverifikation** — Windows-Desktop-Anwendung,
mit der Benutzer eigene Dokumente (PDF, Markdown, Text, Quellcode) lokal
speichern, in Arbeitsbereiche organisieren und über eine Chat-Oberfläche
befragen können. Antworten enthalten klickbare Quellenverweise. Die Anwendung
läuft vollständig offline; keine externen KI-APIs.

Siehe [Lastenheft](docs/work/%23%20Lastenheft.md) und [Pflichtenheft](Pflichtenheft_LokLM.md)
für Kontext und Anforderungen.

## Voraussetzungen

- **Node.js** ≥ 20 (LTS empfohlen)
- **pnpm** 10 (festgenagelt via `packageManager` in `package.json`)
- **Windows 10/11** für die Ziel-Plattform; Entwicklung läuft auch auf macOS/Linux

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

| Pfad            | Inhalt                                                               |
| --------------- | -------------------------------------------------------------------- |
| `src/main/`     | Electron-Hauptprozess (Window-Lifecycle, später IPC, Services)       |
| `src/preload/`  | contextBridge-Fassade (`window.api`)                                 |
| `src/renderer/` | React-App (Vite-Root: `src/renderer/`, Sourcen: `src/renderer/src/`) |
| `src/shared/`   | Pure-Funktionen die Main und Renderer teilen                         |
| `drizzle/`      | Generierte SQL-Migrationen (von `drizzle-kit generate`)              |
| `docs/specs/`   | Feature-Specs und Designdokumente                                    |
| `docs/adr/`     | Architecture Decision Records                                        |
| `tests/manual/` | Manuelle Test-Szenarien (Pflichtenheft §8.3)                         |

Vollständiges Layout: siehe Pflichtenheft Anhang A.

## Pre-Commit-Hook

`husky` + `lint-staged` formatieren und linten staged Files automatisch
(Prettier + ESLint --fix), gefolgt von einem projektweiten `pnpm typecheck`.
Der Hook wird via `prepare`-Script bei `pnpm install` installiert.

## Tech-Stack (Kurzform)

Electron 42 · Vite via electron-vite 2 · React 18 · TypeScript 5 strict ·
Vitest 2 + Workspaces (node + jsdom) · ESLint 9 flat config · Prettier 3 ·
TypeDoc · PGlite + Drizzle ORM · argon2id.

Vollständige Versionsmatrix: Pflichtenheft Anhang B + `package.json`.

## Status

In Entwicklung. AP-1.1 (Projekt-Skelett + Build-Pipeline) abgeschlossen.
Folge-APs siehe Pflichtenheft §9.2.

**Query-Routing (ADR-0003):** Chat-Anfragen werden regex-first auf drei Routen
verteilt, statt jede Frage durch Chunk-Retrieval zu zwingen:

- `doc_summary` — „fasse Dokument X zusammen" → gecachter Whole-Doc-Summary als
  Kontext (statt topK-Fragmente).
- `corpus` — „wie viele / welche Dokumente zu Y" → Antwort aus der
  `documents`-Tabelle, ohne LLM.
- `retrieval` — der Default ; jeder Routing-Miss fällt still hierher zurück.

Dazu ein lazy per-Dokument-Summary-Embedding-Index (Mig 0010) für semantische
Aboutness in der Corpus-Route und einen optionalen hierarchischen Doc-Prefilter
(`RetrievalOptions.docPrefilter`, default off). Entwurf, Adopt/Reject gegenüber
LlamaIndex / GraphRAG / RAGFlow und offene Punkte:
[ADR-0003](docs/adr/0003-query-routing-und-summary-index.md).

## Lizenz

[MIT](LICENSE)
