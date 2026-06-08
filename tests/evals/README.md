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

| Befehl                                                  | Was er tut                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm evals:generate`                                   | Sample-docs → synthetisches dataset.json. Idempotent.      |
| `pnpm evals:run`                                        | Retrieval-only run mit `defaultConfigs()` (fake-stubs).    |
| `pnpm evals:run -- --config bge`                        | Nur eine bestimmte Config.                                 |
| `pnpm evals:run -- --library data/libraries/small.json` | Eval mit einer geladenen Distractor-Library.               |
| `pnpm evals:sweep`                                      | Sweep-Run mit echten Bridges + TTFT + Resource-Samples.    |
| `pnpm evals:sweep -- --no-llm`                          | Sweep ohne LLM-load (retrieval-quality only).              |
| `pnpm evals:sweep -- --limit 10`                        | Schneller smoke-run mit nur 10 Fragen pro Config.          |
| `pnpm evals:sweep -- --iterations 12`                   | Grid-search , läuft die ersten N punkte aus gridConfigs(). |
| `pnpm evals:sweep -- --iterations 12 --judge`           | Grid-search + LLM-as-judge scoring (XL-profil lokal).      |
| `pnpm evals:build-library -- --size tiny`               | Distractor-Library bauen , siehe `scale/README.md`.        |
| `pnpm evals:scale`                                      | Scaling-Report über alle vorhandenen Library-Stufen.       |

## Sweep , Fine-Tuning-Workflow

Der `evals:sweep`-runner ist für RAG-Fine-Tuning gebaut. Anders als
`evals:run` (das nur Retrieval-Quality misst) zerlegt sweep den TTFT in
sechs Phasen und sammelt nebenher Resource-Time-Series (RSS / VRAM / CPU).

### Output-Layout

Pro Sweep-Run entsteht ein versioniertes Folder unter `report/runs/`:

```
report/runs/<stamp>_<git-sha>[_dirty]/
  env.json                        # CPU / RAM / OS / git / env vars
  dataset.json                    # path + sha256-hash des verwendeten datasets
  summary.md                      # vergleichstabelle aller configs
  summary.json                    # maschinen-lesbare variante
  configs/<config-name>/
    result.json                   # aggregierte stats (recall, MRR, phased TTFT)
    per-question.jsonl            # eine zeile pro frage , phasen + LLM-output
    resource-samples.jsonl        # rss / vram / cpu / heap , alle 250ms
```

Folders werden nie überschrieben. Der git-sha + dirty-flag im namen
verhindert dass ein dirty-run heimlich als clean-baseline gilt.

### TTFT-Phasen

Die 6 Phasen die der `PhasedTimer` (perf.ts) misst:

| Phase            | Was es ist                                                       | Wo's wirklich weh tut  |
| ---------------- | ---------------------------------------------------------------- | ---------------------- |
| `queryEmbed`     | Embedder forward pass auf der frage                              | CPU embedder ~50-100ms |
| `retrieve`       | BM25 + dense cosine + sort + slice                               | trivial , <5ms         |
| `rerank`         | Cross-encoder über top-K kandidaten , 0 wenn `topKToRerank=0`    | CPU 0.5-2s pro pass    |
| `promptAssemble` | `evalChunksToHits` + LLM-side `buildPrompt`                      | trivial                |
| `prefill`        | LLM-side prompt-processing bis erstes onChunk (= TTFT-dominante) | **CPU killer**         |
| `firstDecode`    | reserviert , aktuell 0 (s. LlmBridge.ts kommentar)               | —                      |

`ttftMs = sum(queryEmbed, retrieve, rerank, promptAssemble, prefill, firstDecode)`.
`fullResponseMs` ist die wandzeit bis `ask()` resolved.

### Configs editieren

`pipeline/configs.ts` enthält vier config-quellen:

- `defaultConfigs()` → fake-stubs , kein LLM-load , für quick CI-tauglichen smoke.
- `sweepConfigs()` → echte Bridges (Embedder/Reranker/LLM) , das ist die
  liste die `pnpm evals:sweep` standardmäßig läuft.
- `gridConfigs()` → cartesian product über (rerank-topK × chunks-to-LLM × …).
  `pnpm evals:sweep --iterations N` schneidet die ersten N punkte ab.
- `matrixConfigs()` → cartesian product über (embedder × chunker × reranker) bei
  festem antwort-LLM (auf 'full' gepinnt). `pnpm evals:sweep --configs matrix`
  (= `evals:matrix`). default = 2 configs (skip vs bge-reranker) ohne extra-
  downloads ; weitere embedder/chunker als auskommentierte kandidaten mit
  eindeutigen labels (cache-falle: label ist teil des embedding-cache-keys).

Hinzufügen einer config: einfach unten anhängen. Für ganze achsen-vergleiche
gibt's den `cartesian()`-helper unten in der datei. Wichtig: bridges sind
teuer zu laden (LLM ~10-60s) , daher dieselbe `LlmBridge`-instanz über
mehrere configs hinweg wiederverwenden — der sweep-runner dedupliziert
warm()-calls über instanz-identität.

### Grid-search + LLM-as-judge , Iterations-Workflow

`gridConfigs()` definiert ein cartesian product über die billigen-zu-ändernden
achsen (rerank-topK , chunks-to-LLM , optional chunk-size). Teure achsen
(LLM-profil , embedder-placement) liegen außerhalb der grid-schleife — die
sollen über separate sweep-runs verglichen werden , sonst frisst load-time
die laufzeit.

Mit `--judge` lädt der runner zusätzlich ein XL-profil-modell (Nemotron 3
Nano 30B-A3B per default LLM_PROFILES) als bewerter und scored jede
generierte antwort entlang dreier achsen:

- **correctness** , vs. ground-truth chunk
- **groundedness** , basiert die antwort auf den gelieferten chunks
- **helpfulness** , verständlich + direkt + nicht zu lang

Der mittelwert (0..1) fließt in den composite-score:

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

Höher = besser. `ranking.md` im run-dir sortiert configs danach , kürzeste
TTFT bei akzeptabler quality gewinnt also bei standard-gewichten. Gewichte
sind in [judge/Judge.ts](./judge/Judge.ts) (`compositeScore`) überschreibbar.

Praktischer workflow:

```bash
# baseline mit allen 12 grid-punkten + judge
pnpm evals:sweep -- --iterations 12 --judge --limit 30

# winner identifizieren: ranking.md anschauen , top-3 namen merken
# fokus-sweep auf die nähe des winners (manuell configs.ts anpassen)
pnpm evals:sweep -- --configs sweep --judge
```

**Achtung CPU-only**: XL-judge auf CPU ist langsam (~5-30s pro frage). Bei
100 fragen × 12 grid-punkten = ~3-12 stunden judge-zeit. Für quick-iterationen
mit `--limit 10` runter , oder ohne `--judge` laufen lassen und composite-
score fällt auf recall+TTFT zurück.

## Matrix-Sweep , Multi-Datensatz , Paper-Tabelle

Drei bausteine automatisieren den weg von "eine config" zur papierfertigen
tabelle über mehrere datensätze:

| Script           | Datei                 | Was er tut                                                            |
| ---------------- | --------------------- | --------------------------------------------------------------------- |
| `evals:matrix`   | `pipeline/configs.ts` | `matrixConfigs()` als `--configs matrix` (Embedder×Chunker×Reranker). |
| `evals:datasets` | `run-datasets.ts`     | äußere schleife: matrix-sweep über MEHRERE datensätze.                |
| `evals:paper`    | `aggregate-paper.ts`  | alle sweep-run-dirs → `report/paper-table.csv` + `.tex`.              |

**A — `evals:matrix`**: Embedder × Chunker × Reranker als cartesian product ,
antwort-LLM fix auf 'full' (nicht 'auto' , sonst self-bias gegen den judge).
default = 2 configs (mit/ohne reranker) , ohne downloads. Weitere achsen-einträge
in `pipeline/configs.ts` sind auskommentierte kandidaten — jedem embedder/chunker
einen eindeutigen label geben (cache-falle , s.o.).

**B — `evals:datasets`** ([`run-datasets.ts`](./run-datasets.ts)): pro datensatz
ein isolierter `evals:sweep --configs matrix`-aufruf (eigenes run-dir) ; ein
fehlgeschlagener datensatz stoppt die anderen nicht (vorlage: `answer/run-pack.ts`).
default retrieval-only (`--no-llm`) ; `--judge --judge-path <gguf>` schaltet den
LLM+judge-pass an.

```bash
# alle committeten datensätze , retrieval-only (schnell , deterministisch)
pnpm evals:datasets
# gezielt , mit judge (langsam)
pnpm evals:datasets -- --datasets a.json,b.json --judge --judge-path models/<judge>.gguf
```

**C — `evals:paper`** ([`aggregate-paper.ts`](./aggregate-paper.ts)): sammelt alle
sweep-run-dirs (`summary.json` + `env.json`) , überspringt pack-aggregate (kein
`dataset`-feld) , schreibt eine flache zeile je (datensatz × config) mit provenienz
(git-sha , dirty , CPU , RAM , dataset-sha256). Spaltenreihenfolge an EINER stelle
(`COLUMNS`) — CSV und LaTeX können nicht auseinanderlaufen. `--clean-only` filtert
dirty-runs raus.

Reihenfolge fürs paper (Paper-Regeln beachten): erst committen (sonst `_dirty`) ,
dann `evals:datasets` über alle datensätze , top-configs mit `--judge` nachfahren ,
zum schluss `evals:paper`.

## Status

Scaffold steht, Implementierungen sind Stubs. Was als Nächstes konkret wird,
hängt davon ab, welcher Embedder/Reranker zuerst in die App kommt — dann diese
Eval-Stelle gleich mit echtem Code füllen, sonst veraltet die Struktur bevor
sie genutzt wurde.

**Update (eval-automatisierung):** Die A/B/C-schicht — matrix-config
(`matrixConfigs`) , multi-datensatz-loop (`run-datasets.ts`) , paper-aggregator
(`aggregate-paper.ts`) — ist implementiert , unit-getestet und über `evals:matrix`
/ `evals:datasets` / `evals:paper` nutzbar (siehe „Matrix-Sweep" oben).

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
