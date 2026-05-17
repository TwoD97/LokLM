# Quality-Evals

Eigene Säule neben der Pyramide. Hier wird _nicht_ Korrektheit getestet
(passiert vs. passiert nicht), sondern _Qualität_ einer probabilistischen
Pipeline: wie gut findet ein Embedder/Reranker/Chunking-Setup die richtige
Stelle in einem Dokument für eine gegebene Frage.

## Warum getrennt

- Tests in `unit/`, `integration/`, `tx/`, `e2e/` haben binäre Pass/Fail-
  Assertions. Evals liefern Zahlen (recall@k, MRR, nDCG) und vergleichen
  Configs miteinander. Eine eval "schlägt nicht fehl" — sie schneidet besser
  oder schlechter ab.
- Dauer: ein Embedder-Vergleich auf 200 Fragen kann Minuten dauern. Gehört
  nicht in `pnpm test`.
- Reproduzierbarkeit: dataset wird einmal generiert und committed (oder
  versioniert abgelegt), damit Vergleiche über Wochen vergleichbar bleiben.

## Workflow

```
sample-docs/                Reale oder Platzhalter-Dokumente
       │
       ▼
  generate-dataset           Synthetische Frage→Chunk-Pairs via LLM
       │
       ▼
  dataset.json               Eingefrorenes Ground-Truth
       │
       ▼
        run                  Pro Config: retrieve top-k, scoren
       │
       ▼
  report/                    JSON + Markdown-Tabelle pro Lauf
```

Daneben gibt es einen zweiten Pfad für Skalierungs-Evals:

```
build-library --size <stufe>     Distractor-Docs generieren (tiny → large)
       │
       ▼
  libraries/<stufe>.json
       │
       ▼
  run-scale                       Eval an jeder Stufe + Baseline
       │
       ▼
  report/scale-<stamp>.md         Degradationskurve quality + perf
```

Details in [`scale/README.md`](./scale/README.md).

## Ordner

```
tests/evals/
  README.md
  data/
    sample-docs/             Sample-Dokumente (committed)
    datasets/                Generierte Frage-Sets (committed, klein)
  synth/
    QuestionGenerator.ts     Provider-Interface
    OllamaGenerator.ts       Lokaler Ollama-HTTP-Provider
    AnthropicGenerator.ts    Claude-API-Provider
    generate-dataset.ts      CLI: docs → dataset.json
  pipeline/
    Embedder.ts              Interface
    Reranker.ts              Interface
    Chunker.ts               Interface
    configs.ts               Vergleichs-Configs als Bundle
  run.ts                     CLI: dataset + configs → report
  metrics.ts                 recall@k, MRR, nDCG
  report/                    Output (gitignored)
```

## Was verglichen wird

Vier Achsen, einzeln oder gebündelt:

- **Embedder**: `all-MiniLM-L6`, `bge-small-en`, `nomic-embed-text`, ...
- **Reranker**: `bge-reranker-base`, `ms-marco-MiniLM`, oder gar keiner
- **Chunking**: Token-size 256/512/1024, Overlap 0/64/128, semantic vs. fixed
- **Pipeline-Bundle**: alle drei zusammen als ein benannter Eintrag im Report

Eine Config ist ein Eintrag in [`pipeline/configs.ts`](./pipeline/configs.ts).
Der Eval-Runner iteriert über alle aktivierten Configs und schreibt eine
Vergleichstabelle.

## Provider für synthetische Daten

Pluggable über das [`QuestionGenerator`](./synth/QuestionGenerator.ts)-Interface:

- **Ollama** ([`OllamaGenerator.ts`](./synth/OllamaGenerator.ts)) — lokal,
  reproduzierbar, kein API-Key, CI-tauglich. Default.
- **Anthropic** ([`AnthropicGenerator.ts`](./synth/AnthropicGenerator.ts)) —
  bessere Qualität, braucht `ANTHROPIC_API_KEY` in env. Für höherwertige
  Goldstandards.

Welcher Provider greift, steuert eine env oder ein CLI-Flag — siehe
`generate-dataset.ts`.

## Scripts

| Befehl                                                  | Was er tut                                            |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm evals:generate`                                   | Sample-docs → synthetisches dataset.json. Idempotent. |
| `pnpm evals:run`                                        | Alle aktivierten Configs gegen das aktuelle dataset.  |
| `pnpm evals:run -- --config bge`                        | Nur eine bestimmte Config.                            |
| `pnpm evals:run -- --library data/libraries/small.json` | Eval mit einer geladenen Distractor-Library.          |
| `pnpm evals:build-library -- --size tiny`               | Distractor-Library bauen , siehe `scale/README.md`.   |
| `pnpm evals:scale`                                      | Scaling-Report über alle vorhandenen Library-Stufen.  |

## Status

Scaffold steht, Implementierungen sind Stubs. Was als Nächstes konkret wird,
hängt davon ab, welcher Embedder/Reranker zuerst in die App kommt — dann diese
Eval-Stelle gleich mit echtem Code füllen, sonst veraltet die Struktur bevor
sie genutzt wurde.

## Zuständigkeit

Dominik ist Test-Owner und betreibt diese Säule eigenverantwortlich:

- **Generator-Implementierungen**: Anpassungen an Ollama-/Anthropic-Provider,
  neue Provider falls nötig.
- **Pipeline-Bridges**: sobald in `src/main/services/` ein echter Embedder
  oder Reranker landet, baut Dominik die Eval-Bridge dafür und ergänzt eine
  Config in [`pipeline/configs.ts`](./pipeline/configs.ts).
- **Dataset-Pflege**: generieren, committen, nur regenerieren wenn Sample-Docs
  oder Generator-Prompts sich ändern.
- **Vergleiche fahren**: vor jedem Release oder bei Modell-Wechsel die
  aktivierten Configs durchlaufen und den Markdown-Report in den PR/das ADR
  legen.
