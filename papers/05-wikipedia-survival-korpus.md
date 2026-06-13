# Agent-generierte, verifizierte RAG-Evaluierungsdaten: der Wikipedia-Survival-Korpus

**Kurzfassung.** Dieses Paper beschreibt eine Methode zur Konstruktion eines geerdeten , verifizierten RAG-Evaluierungs-Datensatzes aus Wikipedia-Plaintext-extracts. Aus 50 EN-Wikipedia-Artikeln über 5 Survival-/Referenz-Themen entsteht via `fixed-512-64`-chunking ein Haystack aus **2939 chunks** ; ein multi-agent-Verfahren (generator-agent + unabhängiger adversarial-verifier) erzeugt **1255 focused-factoid-Fragen** (aus 1322 Kandidaten , ~5 % verworfen). Der entstandene Datensatz hält das Schema der bereits committeten `xquad-de`- und `focused-260q`-Datensätze ein und ist damit drop-in-kompatibel zur bestehenden Eval-Säule. Reale Retrieval-Läufe (bge-m3 dense + bge-reranker-v2-m3 , GPU) zeigen recall@1 = 0.552 (dense) bzw. 0.844 (dense + rerank) über den vollen 2939-chunk-Haystack — gegen eine random-baseline von ≈ 0.0003 ein Beleg , dass die Fragen präzise , diskriminierende retrieval-targets sind. Der Beitrag ist die Daten-Konstruktions-Methode ; die recall-Zahlen dienen ausschließlich als Validierung , dass der Korpus diskriminiert , nicht als Modell-Benchmark.

## 1 Einleitung / Motivation

Die LokLM-Eval-Säule misst nicht Korrektheit (passiert vs. passiert nicht) , sondern die Qualität einer probabilistischen Retrieval-Pipeline: wie gut findet ein Embedder-/Reranker-/Chunking-Setup die richtige Stelle in einem Dokument für eine gegebene Frage (`tests/evals/README.md` Z. 3–6). Solche Evals brauchen geerdete Datensätze: jede Frage muss einen ground-truth-`chunkId` tragen , gegen den recall@k , MRR und nDCG@k berechenbar sind.

Die bisher committeten Datensätze decken zwei Konventionen ab: `xquad-de` (300 Fragen / 240 chunks , CC BY-SA 4.0 , aus der XQuAD-DE-subset) und `focused-260q` (260 Fragen / 52 chunks , salvaged aus einem agent-batch , alle als `intent=focused` mit `requiredChunkIds=[chunkId]`). Beide sind klein: 52 bzw. 240 chunks bilden keinen realistisch großen Haystack ab , in dem das gold-target gegen viele distractors konkurriert.

Motivation für den Wikipedia-Survival-Korpus (`papers/_evidence/wikipedia-survival.md` Z. 10–12): er spiegelt den #1-Tier-1-Datensatz der LokLM-Zielgruppe (Kiwix-Wikipedia-ZIM) als kleinen Plaintext-slice statt als 110-GB-ZIM , bleibt license-konsistent mit dem schon committeten `xquad-de` (beide CC BY-SA 4.0) und liefert mit 2939 chunks erstmals einen Haystack , der groß genug ist , um Retrieval-Diskriminierung sichtbar zu machen. Der Beitrag dieses Papers ist die Konstruktions-Methode (Extract → chunking → multi-agent generate + adversarial verify) ; die Retrieval-Zahlen in Abschnitt 4 validieren , dass der so erzeugte Korpus tatsächlich diskriminiert.

## 2 Aufbau & Methodik

### 2.1 Hardware (Dev-/Mess-Box)

Alle Läufe liefen auf einer einzelnen Box (`tests/evals/runDir.ts` `hardwareInfo()` erfasst CPU/RAM/OS/arch automatisch in `env.json`):

- **Intel(R) Core(TM) i9-9900K CPU @ 3.60 GHz × 16 , 31.9 GB RAM** (`report/runs/2026-05-20T19-46-39_45bf322_dirty/env.json`: `cpuCount: 16` , `totalRamGB: 31.9`).
- **RTX 5090 (32 GB VRAM)** (`papers/_evidence/wikipedia-survival.md` Z. 4).
- OS `win32` , release `10.0.26200` , arch `x64` , node `v22.15.1` (`env.json` Z. 9–14).

Placement-Konvention (mirror des prod-defaults): Embedder auf CPU , Reranker/LLM auf GPU. Die Wikipedia-Retrieval-Läufe in Abschnitt 4 sind aber explizit **GPU-placement** und damit ein Korrektheits-/Qualitäts-Check , NICHT der Produktions-CPU-Timing-Benchmark (`wikipedia-survival.md` Z. 90–92). Siehe Abschnitt 6.

### 2.2 Harness

Datensätze werden **einmal generiert und committed** und nur regeneriert , wenn Sample-Docs oder Generator-Prompts sich ändern (`README.md` Z. 16–17 , 285–286). Jeder Sweep-Run schreibt einen unveränderlichen run-dir mit Provenienz (`runDir.ts` Z. 10–22):

```
report/runs/<stamp>_<git-sha>[_dirty]/
  env.json            CPU / RAM / OS / git / node / maskierte env-flags
  dataset.json        path + sha256 (erste 16 hex) des verwendeten datasets
  summary.md / .json  vergleichstabelle aller configs
  ranking.md          configs nach composite sortiert
  configs/<name>/result.json , per-question.jsonl , resource-samples.jsonl
```

Folders werden nie überschrieben ; git-sha + `_dirty`-flag im Namen verhindern , dass ein dirty-run heimlich als clean-baseline gilt (`README.md` Z. 141–142 ; `runDir.ts` Z. 22 , 136–138). `dataset.json` trägt einen sha256-hash , damit Reports über Zeit komparabel bleiben.

### 2.3 Chunker — `fixed-512-64`

`FixedSizeChunker` (`tests/evals/pipeline/Chunker.ts` Z. 20–38): fixed-size + overlap , `step = size − overlap` , wirft wenn `size <= overlap` , leere/whitespace-Slices werden geskippt , chunk-id-Format `${docId}::${i}`. Der kanonische Default ist **`fixed-512-64`** (512-Zeichen-Fenster , 64 overlap) und in jeder produktiv genutzten Config gesetzt (`configs.ts` Z. 73 , 141 , 193 , 259 , 308). Wichtig: `size` ist „approx tokens pro chunk (hier vereinfacht als Zeichenfenster)" (`Chunker.ts` Z. 9) — also 512 **Zeichen** , nicht Tokens. Der Wikipedia-Korpus verwendet denselben `fixed-512-64`-Chunker wie `focused-260q` und `handcrafted-adaptive-topk` (`methodology.md` Z. 143–144).

### 2.4 Metrik-Definitionen

Wörtlich aus `tests/evals/metrics.ts` (zwei Relevanz-Settings , Z. 1–18):

| Metrik           | Definition (wörtlich `metrics.ts`)                                                                                          | Formel im Code                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| **recall@k**     | Anteil der queries , bei denen die richtige Antwort in den ersten k Ergebnissen drin ist (single-relevant , Z. 13–14)       | `hits / results.length` , hit wenn `chunkIds.slice(0,k).includes(expected)` (Z. 30–37)       |
| **recall_req@k** | mittlerer Anteil der required-chunks in den ersten k (multi-relevant , Z. 15–16) ; reduziert sich exakt auf recall@k wenn ` | required                                                                                     | =1` (Z. 72) | `Σ (\|required ∩ topK\| / \|required\|) / N` (Z. 68–82) |
| **MRR**          | mean reciprocal rank , 1/rank über alle queries gemittelt (Z. 17)                                                           | `Σ (1/rank) / N` , `rank = indexOf(expected)+1` (Z. 39–47)                                   |
| **nDCG@k**       | normalized discounted cumulative gain auf k (Z. 18)                                                                         | `Σ (1/log2(rank+1)) / N` ; single-relevant ideal-DCG ist konstant `1/log2(2) = 1` (Z. 49–58) |

Der Wikipedia-Korpus ist **single-relevant** (`requiredChunkIds=[chunkId]`) , daher fallen recall_req@k und recall@k zusammen ; die in Abschnitt 4 berichteten Zahlen sind single-relevant recall@k / MRR / nDCG@10 (`wikipedia-survival.md` Z. 57).

### 2.5 LLM-as-Judge (nur für end-to-end-Läufe)

Das Judge-Protokoll (`tests/evals/judge/Judge.ts`) ist für die hier berichteten Retrieval-Läufe **nicht** aktiv — diese messen reines retrieval (recall/MRR/nDCG) , keine Antwort-Qualität. Der Vollständigkeit halber: ein stärkeres Modell (Default **Nemotron 3 Nano 30B-A3B** , XL-Profil , ~18 GB VRAM , gepinnt) scored Frage + Gold-Chunk + Antwort auf drei Dimensionen (correctness , groundedness , helpfulness , je 0..1) , `score = (c + g + h) / 3` (`Judge.ts` Z. 199–206 ; `README.md` Z. 189–201). Composite-Score (`README.md` Z. 199–201):

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

Der under-test-LLM wird vom Judge getrennt (Pin auf `'full'` = Qwen3-8B) , um Self-Bias zu vermeiden (`configs.ts` Z. 77–82 , 183–191).

## 3 Datensatz

### 3.1 Korpus-Konstruktion

Quelle (`wikipedia-survival.md` Z. 6–20):

- **Extraction.** EN-Wikipedia über `prop=extracts&explaintext=1` (MediaWiki-action-API) — sauberer Plaintext , kein OCR , kein PDF/HTML-parsing. Lizenz CC BY-SA 4.0.
- **Auswahl.** 50 Artikel , 5 Survival-/Referenz-Themen mit je 10 Artikeln: `first-aid` , `water-food` , `disease-sanitation` , `wilderness-navigation` , `rebuild-tech`.
- **Säuberung.** End-Sektionen (References / External links / See also / …) abgeschnitten , whitespace normalisiert.
- **Chunking.** `fixed-512-64` → **2939 chunks** (Haystack).
- **Skripte.** `tests/evals/synth/fetch-wikipedia-corpus.ts` , `prep-gen-batches.ts` , `assemble-wiki-dataset.ts` , `inspect-dataset.ts`. Provenienz in `tests/evals/data/corpora/wikipedia-survival/manifest.json`.

### 3.2 Fragen-Generierung (multi-agent)

Quelle (`wikipedia-survival.md` Z. 22–36):

- **Pipeline.** Pro chunk-batch (≈ 15 chunks) schreibt 1 generator-agent (Opus) Kandidaten-Fragen mit exaktem `answerSpan` → 1 **unabhängiger** adversarial-verifier prüft jede Frage gegen ihren Quell-chunk (grounded? self-contained? eindeutig? nicht reine Titel-Trivia?) und verwirft Zweifelhaftes.
- **Yield.** 1322 Kandidaten generiert → **1255 behalten** (~5 % verworfen). 112 verifier-/generator-agenten gesamt über alle Themen.
- **Pro-Thema (behalten).** first-aid 192 , water-food 258 , disease-sanitation 267 , wilderness-navigation 251 , rebuild-tech 287. (Summe = 1255.)
- **Schema.** Identisch zu `xquad-de` / `focused-260q`: `{chunkId, question, intent:'focused', requiredChunkIds:[chunkId], meta:{theme}}`. Kein gold-Antwort-String nötig — der Judge scored gegen den chunk-Text selbst.
- **Datei.** `tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json` (Generator `wikipedia-survival:agent-verified` , chunker `fixed-512-64` , `methodology.md` Z. 236).

### 3.3 Korpus-Statistik & Integrität

Quelle (`wikipedia-survival.md` Z. 38–43):

- 2939 chunks gesamt , davon **869 referenziert** (tragen eine Frage) + **2070 distractors** (bleiben im Haystack , wie bei `xquad-de`).
- Assemble-Validierung: 0 bad lines , **0 unknown-id** , 0 dupes.
- Integritäts-Check: 0 dangling required-refs , 0 missing chunkId.

### 3.4 Einordnung in die Datensatz-Familie

| Dataset (Datei)                      |   Fragen |   Chunks | Generator                                                      | Lizenz / Quelle                                                                                               |
| ------------------------------------ | -------: | -------: | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `xquad-de-300q-…json`                |      300 |      240 | `xquad-de-subset` (chunker `xquad-passage`)                    | CC BY-SA 4.0 ; XQuAD-DE-subset , subsample-limit 300 , seed 42 , von 1190 verfügbar (`methodology.md` Z. 232) |
| `focused-260q-…json`                 |      260 |       52 | `salvage-focused:agent-batch:claude-opus-4-7` (`fixed-512-64`) | salvage ; alle 260 `intent=focused` , `requiredChunkIds=[chunkId]` (`methodology.md` Z. 233)                  |
| `agent-batch-claude-opus-4-7-…json`  |      260 |       52 | `agent-batch:claude-opus-4-7`                                  | Quell-batch für focused-260q ; hash `43207410dc46debe` (`methodology.md` Z. 234)                              |
| `handcrafted-adaptive-topk-…json`    |       25 |      109 | `manual-handcrafted:adaptive-topk-eval` (`fixed-512-64`)       | handgeschrieben ; intent + requiredChunkIds für broad/summary (`methodology.md` Z. 235)                       |
| **`wikipedia-survival-1255q-…json`** | **1255** | **2939** | `wikipedia-survival:agent-verified` (`fixed-512-64`)           | **CC BY-SA 4.0** ; EN-Wikipedia `prop=extracts` , fetched 2026-06-13 (`methodology.md` Z. 236)                |

Der Wikipedia-Korpus ist mit 1255 Fragen / 2939 chunks der mit Abstand größte der Familie (≈ 4.8× so viele Fragen wie `focused-260q` , ≈ 56× so großer Haystack: 2939 vs. 52 chunks) und folgt der `focused-260q`-Konvention (alle `intent=focused` , `requiredChunkIds=[chunkId]`).

## 4 Ergebnisse

> Alle Zahlen wörtlich aus den Evidence-Dateien. `per-question.jsonl` wurde nicht gelesen (zu groß).

### 4.1 Diskriminierungs-Validierung — fake-stub-baseline

Quell-Datei: `tests/evals/report/2026-06-13T11-43-42.md` (Generator `wikipedia-survival:agent-verified` , Dataset-stamp `2026-06-13T11:42:44.742Z` , chunker `fixed-512-64` , n=1255 , Library keine).

| Config        |    n | recall@1 | recall@5 | recall@10 |   MRR | nDCG@10 | query p50 ms | query p95 ms | build ms | mem MiB |
| ------------- | ---: | -------: | -------: | --------: | ----: | ------: | -----------: | -----------: | -------: | ------: |
| fake-256-noop | 1255 |    0.049 |    0.127 |     0.180 | 0.084 |   0.107 |          0.8 |          1.2 |       21 |     108 |
| fake-512-noop | 1255 |    0.049 |    0.127 |     0.180 | 0.084 |   0.107 |          0.8 |          1.1 |        7 |     110 |

Die fake-stub-Embedder (`FakeEmbedder(64)` + `NoopReranker` , CI-smoke , kein LLM-load) erreichen recall@1 = 0.049 über denselben 2939-chunk-Haystack. Sie validieren , dass der Datensatz fehlerfrei durch den echten `evalRunner` lädt und scored — und liefern den unteren Anker für die Diskriminierung (siehe Abschnitt 4.3).

### 4.2 Wikipedia-Survival Retrieval (real , GPU placement)

Quell-Datei: `papers/_evidence/wikipedia-survival.md` Z. 59–69. Voller Lauf: ALLE 1255 Fragen über den vollen 2939-chunk-Haystack. Embedder bge-m3 (Q4_K_M) , Reranker bge-reranker-v2-m3 (Q4_K_M , pool=50 dense-Kandidaten) , single-relevant (gold = 1 chunk). GPU placement.

| Metrik    | dense (bge-m3 , kein rerank) | dense + rerank (bge-reranker-v2-m3) |
| --------- | ---------------------------: | ----------------------------------: |
| recall@1  |                        0.552 |                           **0.844** |
| recall@5  |                        0.714 |                           **0.894** |
| recall@10 |                        0.758 |                           **0.894** |
| MRR       |                        0.623 |                           **0.867** |
| nDCG@10   |                        0.656 |                           **0.874** |

Validierungs-Stichprobe vorab (250 stride-gesampelte Fragen , dense , kein rerank , `wikipedia-survival.md` Z. 67–69): recall@1 0.544 , recall@5 0.688 , recall@10 0.744 , MRR 0.615 , nDCG@10 0.646 — konsistent mit dem vollen Lauf.

### 4.3 Timing (GPU)

Quell-Datei: `wikipedia-survival.md` Z. 85–88.

| Phase                             |                         Zeit |
| --------------------------------- | ---------------------------: |
| embedder warm                     |                        3.6 s |
| korpus-embed (2939 chunks)        |                       48.7 s |
| query + rerank-loop (1255 Fragen) | 1052 s (~17.5 min , seriell) |

`EmbedderBridge.embedBatch` embeddet seriell (keine batch-API in node-llama-cpp). CPU bge-m3 ≈ 1.5 s/chunk → 2939 chunks > 70 min , unter Dauerlast thermisch gedrosselt (i9-9900K). Das ist ein relevanter Datenpunkt für end-user mit großen Libraries auf CPU.

## 5 Diskussion / Befunde

1. **Der Korpus diskriminiert sauber.** Random-baseline recall@1 ≈ 1/2939 ≈ 0.0003 ; die fake-stub-Embedder erreichen 0.049 (4.1) ; dense-bge-m3 erreicht 0.552 (4.2). Der Sprung von 0.0003 → 0.049 → 0.552 zeigt , dass die Fragen präzise , geerdete retrieval-targets sind und ein reales Embedding-Signal belohnen (`wikipedia-survival.md` Z. 73).

2. **Der Reranker hebt recall@1 von 0.552 → 0.844 (+0.292)** auf dem großen realen Haystack (`wikipedia-survival.md` Z. 75). Das ist ein deutlich größerer Reranker-Gewinn als auf den kleinen , sauber vor-sortierten Eval-Pools (`focused-260q` , 52 chunks) , wo der Reranker bei k≥3 eher schadet (`methodology.md` Kern-Befund 3). Der große Haystack macht den Reranker-Nutzen erst sichtbar.

3. **recall@5 = recall@10 = 0.894 ist das ceiling des dense-top-50-Pools.** Der Reranker reordnet nur , was dense in die top-50 hebt ; dense bringt das gold in 89.4 % der Fälle in die top-50 , der Reranker promotet 84.4 % aller Fragen auf Rang 1 (`wikipedia-survival.md` Z. 76–78). Ein größerer pool (> 50) würde dieses ceiling weiter heben (`wikipedia-survival.md` Z. 98).

4. **Die ~11 % Misses sind überwiegend genuin schwer.** 512-Zeichen-chunk-overlap heißt , benachbarte chunks teilen den Antwort-Text ; der „gold"-chunk konkurriert mit seinen Nachbarn. Das ist ein Artefakt des single-relevant-scorings , kein Qualitäts-Defekt des Korpus (`wikipedia-survival.md` Z. 79–81).

5. **Cross-theme-Stichprobe (manuell):** alle gesampelten Fragen grounded , spezifisch , self-contained (z.B. typhoid-Impfstamm Ty21a , severe-sepsis-Definition , net-metering , triple bowline , CO₂-leavening) (`wikipedia-survival.md` Z. 49–51). Das stützt qualitativ , dass der adversarial-verifier Titel-Trivia und nicht-self-contained-Fragen tatsächlich aussortiert hat.

## 6 Limitationen & Threats to Validity

- **GPU- statt CPU-Timing.** Die Retrieval-Läufe (4.2) liefen mit GPU-placement und sind explizit ein Korrektheits-/Qualitäts-Check , NICHT der Produktions-CPU-Timing-Benchmark. Der Produktions-default ist Embedder auf CPU ; faithful-CPU-Timings sind ein separater `evals:sweep --no-llm`-Lauf (`wikipedia-survival.md` Z. 90–92). **TODO: Lauf nötig** für CPU-faithful-Timings des Wikipedia-Korpus.

- **Recall-ceiling durch pool=50.** recall@5/@10 sind durch den dense-top-50-Pool gedeckelt (0.894) ; ein größerer pool würde das ceiling heben (`wikipedia-survival.md` Z. 76 , 98). Die berichteten Reranker-Zahlen sind also pool-konditioniert.

- **single-relevant-Artefakt.** Durch 512-Zeichen-overlap teilen Nachbar-chunks den Antwort-Text → ein Teil der ~11 % Misses ist scoring-Artefakt , nicht Retrieval-Versagen (`wikipedia-survival.md` Z. 79–81 ; `methodology.md` Caveat Z. 374–376). Eine multi-relevant-Variante (`requiredChunkIds` mit Nachbarn) würde das mildern , ist aber nicht gebaut.

- **Nur `intent=focused`.** Der Korpus enthält ausschließlich focused-factoid-Fragen. broad/summary-intents werden von Schema und Judge bereits unterstützt (vgl. `handcrafted-adaptive-topk`) , sind hier aber nicht generiert (`wikipedia-survival.md` Z. 97). Aussagen über broad/summary-retrieval lassen sich aus diesem Korpus nicht ableiten. **TODO: Lauf nötig** für broad/summary-Fragen.

- **Eval umgeht die Produktions-RAG-Pipeline.** Die Eval misst isoliert embedder + reranker auf vorgefertigten chunks und skipped BM25+dense-Fusion , multi-query-expansion , Heuristiken (title boost / short-chunk penalty / recency) , doc-diversification , whole-doc-fallback , neighbour-expansion , DB-I/O , worker-IPC (`methodology.md` Caveat Z. 354–357). Produktions-recall kann höher (Fusion , neighbour-expansion) oder niedriger (noisier pool) ausfallen.

- **Generator = Anthropic Opus.** Fragen und Verifikation stammen von einem einzigen Modell-Anbieter (Opus als generator + verifier-agent). Ein systematischer generator-bias (bevorzugte Frage-Formen) ist nicht ausgeschlossen ; der unabhängige adversarial-verifier mindert ihn , eliminiert ihn aber nicht. Der ~5 %-Verwurf (1322 → 1255) ist die einzige quantifizierte Verifikations-Härte.

- **Nur die single-relevant-Validierungs-Stichprobe ist quer-geprüft.** Die 250-Fragen-Stichprobe (4.2) ist konsistent mit dem vollen Lauf , aber beide laufen über dieselbe Pipeline ; eine externe ground-truth (menschliche Relevanz-Annotation) existiert nicht.

- **git-state der Vergleichs-Läufe (Kontext).** Die in `methodology.md` referenzierten grid-/3-Modell-Läufe stammen aus dirty git-states (z.B. `45bf322_dirty`) und sind n=30/config — knappe Margins (~0.01–0.03) liegen nur knapp über statistischem Rauschen (`methodology.md` Caveat Z. 349–351). Diese betreffen `focused-260q` , nicht den Wikipedia-Lauf direkt , sind aber für jeden Cross-Datensatz-Vergleich relevant.

## 7 Reproduzierbarkeit

Die Skripte sind als `tsx`-Entrypoints in `package.json` registriert. Korpus + Datensatz sind committed (`tests/evals/data/corpora/wikipedia-survival/` , `tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json`) und werden nur regeneriert , wenn Sample-Docs oder Generator-Prompts sich ändern (`README.md` Z. 16–17).

Korpus-Konstruktion (regenerieren nur bei Bedarf , `wikipedia-survival.md` Z. 18–20):

```bash
# 1. Extracts holen (MediaWiki prop=extracts) → corpora/wikipedia-survival/*.txt + chunks.json
pnpm tsx tests/evals/synth/fetch-wikipedia-corpus.ts

# 2. Gen-batches vorbereiten (≈15 chunks/batch)
pnpm tsx tests/evals/synth/prep-gen-batches.ts

# 3. Verifizierte Kandidaten zum Datensatz zusammensetzen (Schema-/Integritäts-Check)
pnpm tsx tests/evals/synth/assemble-wiki-dataset.ts

# 4. Datensatz inspizieren (counts, theme-split, dangling-refs)
pnpm tsx tests/evals/synth/inspect-dataset.ts
```

Retrieval-Eval über den committeten Datensatz reproduzieren:

```bash
# fake-stub smoke (Tabelle 4.1) — n=1255, kein LLM-load
pnpm evals:run        # tsx tests/evals/run.ts

# voller Sweep / matrix (reale bridges, GPU placement → Tabelle 4.2)
pnpm evals:sweep      # tsx tests/evals/sweep.ts
pnpm evals:matrix     # tsx tests/evals/sweep.ts --configs matrix

# Run-dirs zu einer Paper-Tabelle aggregieren (Provenienz: git-sha, dirty, CPU, RAM, dataset-sha256)
pnpm evals:paper      # tsx tests/evals/aggregate-paper.ts   (--clean-only filtert dirty-runs)
```

Jeder Sweep schreibt einen unveränderlichen run-dir `report/runs/<stamp>_<git-sha>[_dirty]/` mit `env.json` (Hardware) und `dataset.json` (sha256) , womit Läufe nachträglich auf Hardware + exakten Datensatz zurückführbar sind (`runDir.ts` Z. 10–22).

## Referenzen

**Interne Quell-Dateien (Evidence + Code).**

- `papers/_evidence/methodology.md` — geteilte Methodik , Metrik-Definitionen , Datensatz-Übersicht , Caveats.
- `papers/_evidence/wikipedia-survival.md` — Korpus-Konstruktion , multi-agent-Generierung , Retrieval-Tabelle , GPU-Timings.
- `tests/evals/report/2026-06-13T11-43-42.md` — fake-stub-baseline (Tabelle 4.1).
- `tests/evals/README.md` — Eval-Philosophie , Workflow , Composite-Formel , TTFT-Phasen.
- `tests/evals/metrics.ts` — recall@k / recall_req@k / MRR / nDCG@k Definitionen + Code.
- `tests/evals/judge/Judge.ts` — 3-Dim-Judge , Prompts , parse , compositeScore.
- `tests/evals/pipeline/configs.ts` — Config-Quellen , LLM-Pin , Cache-Falle.
- `tests/evals/pipeline/Chunker.ts` — `FixedSizeChunker` (512/64).
- `tests/evals/runDir.ts` — run-dir-Layout , env/git/dataset-Provenienz , sha256.
- `tests/evals/synth/{fetch-wikipedia-corpus,prep-gen-batches,assemble-wiki-dataset,inspect-dataset}.ts` — Korpus-/Datensatz-Pipeline.
- `tests/evals/data/corpora/wikipedia-survival/manifest.json` — Korpus-Provenienz.
- `tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json` — Datensatz.

**Externe Datensätze , Modelle & Lizenzen.**

- EN-Wikipedia (`prop=extracts&explaintext=1`) , fetched 2026-06-13 — Lizenz **CC BY-SA 4.0**.
- XQuAD (Vergleichs-Datensatz , `google-deepmind/xquad`) — **CC BY-SA 4.0** ; cite Artetxe et al. 2020 , arXiv:1910.11856.
- Embedder **bge-m3** (Q4_K_M) — Korpus-/Query-Embeddings.
- Reranker **bge-reranker-v2-m3** (Q4_K_M) — cross-encoder rerank , pool=50.
- under-test-LLM **Qwen3-8B** (`'full'`-Profil) — gepinnt für end-to-end-Läufe (hier nicht aktiv).
- Judge **Nemotron 3 Nano 30B-A3B** (XL-Profil , ~18 GB VRAM) — gepinnt , nur pass-2 (hier nicht aktiv).
- Frage-Generator / adversarial-verifier: **Anthropic Opus** (agent-basiert).
