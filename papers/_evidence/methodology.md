# Evidence — Methodology (shared across all LokLM eval papers)

Diese datei ist die GEMEINSAME methodik-quelle für alle papers. Sie sammelt die
eval-philosophie, hardware, metrik-definitionen, judge-protokoll, chunking,
run-dir/provenienz-konvention und datensatz-übersicht — wörtlich aus dem code +
realen run-reports. Jede zahl trägt ihre quell-datei. Keine zahl ist erfunden.

---

## 1. Eval-als-Säule-Philosophie

Quelle: `tests/evals/README.md`.

- Evals sind eine **eigene Säule neben der Test-Pyramide** (`unit/`, `integration/`,
  `tx/`, `e2e/`). Sie testen NICHT Korrektheit (passiert vs. passiert nicht),
  sondern **Qualität einer probabilistischen Pipeline**: wie gut findet ein
  Embedder/Reranker/Chunking-Setup die richtige Stelle in einem Dokument für eine
  gegebene Frage (`README.md` Z. 3–6).
- Abgrenzung zur Pyramide: Tests in `unit/integration/tx/e2e` haben binäre
  Pass/Fail-Assertions. **Evals liefern Zahlen (recall@k, MRR, nDCG) und
  vergleichen Configs miteinander. Eine eval "schlägt nicht fehl" — sie schneidet
  besser oder schlechter ab** (`README.md` Z. 10–13).
- Warum getrennt: Dauer (Embedder-Vergleich auf 200 Fragen = Minuten, gehört nicht
  in `pnpm test`) und Reproduzierbarkeit (dataset einmal generiert + committed,
  damit Vergleiche über Wochen vergleichbar bleiben) (`README.md` Z. 14–17).
- Zwei Eval-Pfade: (a) Retrieval-/Quality-Sweep über Configs; (b) Skalierungs-Eval
  (`build-library --size` → Distractor-Docs → Degradationskurve) (`README.md` Z. 37–52).
- Owner: **Dominik ist Test-Owner**, betreibt die Säule eigenverantwortlich
  (Generator-Impl, Pipeline-Bridges, Dataset-Pflege, Vergleiche fahren vor Release)
  (`README.md` Z. 276–289).

---

## 2. Hardware (Dev-/Mess-Box)

Quelle: `tests/evals/runDir.ts` (`hardwareInfo()` erfasst CPU/RAM/OS/arch automatisch
in `env.json`) + reale `env.json` / report-header.

- **Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz × 16 , 31.9 GB RAM** — wörtlich aus
  `report/runs/2026-05-20T19-46-39_45bf322_dirty/env.json` (`cpuCount: 16`,
  `totalRamGB: 31.9`) und `summary.md` Z. 5.
- **RTX 5090 (32 GB VRAM)** — `report/3-model-comparison-2026-05-20.md` Z. 3 und
  `papers/_evidence/wikipedia-survival.md` Z. 4.
- OS: `win32`, release `10.0.26200`, arch `x64`, node `v22.15.1`
  (`env.json` Z. 9–14).
- VRAM/GPU-backend werden vom caller nachgereicht (`runDir.ts` Z. 60–65,
  `totalVramGB?` / `gpuBackend?`). `hardwareInfo()` selbst loggt nur CPU/RAM/OS.
- Placement-Konvention (mirrors prod default): **Embedder auf CPU**, Reranker/LLM
  auf GPU (`3-model-comparison` Z. 16 „bge-m3 … **CPU** (mirrors prod default)";
  `configs.ts` `EmbedderBridge({ placement: 'cpu' })`, `RerankerBridge({ placement:
'auto' })`). GPU-läufe sind explizit **Korrektheits-/Qualitäts-Check, NICHT der
  Produktions-CPU-Timing-Benchmark** (`wikipedia-survival.md` Z. 90–92).

---

## 3. Metrik-Definitionen (wörtlich aus `tests/evals/metrics.ts`)

Zwei Relevanz-Settings (`metrics.ts` Z. 1–18):

- **Single-Relevant** (`recallAtK`, `mrr`, `ndcgAtK`): jede Query hat genau einen
  ground-truth `chunkId`. Klassische Faktoid-Metriken.
- **Multi-Relevant** (`recallRequiredAtK`): jede Query hat ein Set von Chunks, die
  alle abgedeckt sein sollen. Für broad/summary-Fragen. **Reduziert sich exakt auf
  recall@K wenn |required|=1.**

Implementierungen (exakt):

| Metrik           | Definition (wörtlich `metrics.ts`)                                                                                                             | Formel im Code                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------- | --- | -------- | ----------------- |
| **recall@k**     | Anteil der queries bei denen die richtige Antwort in den ersten k Ergebnissen drin ist (single-relevant) (Z. 13–14)                            | `hits / results.length`, hit wenn `chunkIds.slice(0,k).includes(expected)` (Z. 30–37)       |
| **recall_req@k** | mittlerer Anteil der required-chunks, die in den ersten k landen (multi-relevant) (Z. 15–16); fehlt `required` → fallback `[expected]` (Z. 72) | `Σ (                                                                                        | required ∩ topK | /   | required | ) / N` (Z. 68–82) |
| **MRR**          | mean reciprocal rank, 1/rank über alle queries gemittelt (Z. 17)                                                                               | `Σ (1/rank) / N`, `rank = indexOf(expected)+1` (Z. 39–47)                                   |
| **nDCG@k**       | normalized discounted cumulative gain auf k (Z. 18)                                                                                            | `Σ (1/log2(rank+1)) / N`; single-relevant ideal-DCG ist konstant `1/log2(2) = 1` (Z. 49–58) |

Beispiel aus dem Code für recall_req@k (`metrics.ts` Z. 67):
`required=[A,B,C,D] , top-K=[A,X,C,Y,B] → |{A,C,B}|/4 = 0.75`.

Reporting-Schema (`EvalReport`, `metrics.ts` Z. 84–112): pro Config werden
berichtet — `recallAt1`, `recallAt5`, `recallAt10`, `recallRequiredAt5`,
`recallRequiredAt10`, `recallRequiredAt12`, `mrr`, `ndcgAt10`, `numQueries`.

---

## 4. LLM-as-Judge (3 Dimensionen + Composite)

Quelle: `tests/evals/judge/Judge.ts` + `tests/evals/README.md` Z. 189–221.

- **Pattern**: ein stärkeres modell (XL-profil lokal, oder Anthropic API) bekommt
  Frage + Gold-Chunk + generierte Antwort und gibt 0..1 zurück. Striktes Format
  (`correctness:`/`groundedness:`/`helpfulness:`/`reason:` als Zeilen), robustes
  regex-pro-zeile-parsing statt JSON (`Judge.ts` Z. 1–17, 178–207).
- **Default-Judge-Modell**: **Nemotron 3 Nano 30B-A3B** (XL-Profil, lokal),
  deterministisch fest gepinnt; geladen nur im 2. Pass (`README.md` Z. 189–191;
  `3-model-comparison` Z. 6, Z. 18 „~18 GB VRAM"). Der under-test-LLM ist bewusst
  vom Judge getrennt (Pin auf `'full'` = Qwen3-8B, sonst Self-Bias; `configs.ts`
  Z. 77–82, 144–146, 183–191).

Drei Dimensionen, Skala 0–10 im Prompt, normalisiert auf 0..1 (`Judge.ts` Z. 9–13,
194–198):

- **correctness** — beantwortet die Antwort die Frage _richtig_ gegen Gold? (bei
  broad/summary stattdessen **coverage**: wie viele required-Punkte erwischt,
  `Judge.ts` Z. 144–146).
- **groundedness** — basiert die Antwort auf den gelieferten Chunks oder
  halluziniert sie?
- **helpfulness** — verständlich / direkt / nicht zu lang?

`score = (c + g + h) / 3` (Mittelwert der drei, 0..1; `Judge.ts` Z. 199–206).
Parse-Fehler → `parsed: false`, Record wird geskippt, damit ein einzelner
Format-Aussetzer nicht den Mittelwert verzerrt (`Judge.ts` Z. 47–49, 184–193).
Score-Clamp auf 0..10 vor Normalisierung (`Judge.ts` Z. 216–217).

Zwei Prompt-Modi je `intent` (`Judge.ts` Z. 73–171): `focused` (Single-Ground-Truth)
vs. `broad`/`summary` (Coverage-Prompt). Ausgabeformat in beiden identisch, damit
Parser + Composite gleich weiterlaufen.

### Composite-Score

Wörtlich (`README.md` Z. 199–201, `Judge.ts` Z. 226–255):

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

Default-Gewichte (opinionated, `Judge.ts` Z. 226–254): judge ×2 (Qualität ist
Hauptsache), recall@5 ×1 (Fallback wenn Judge fehlt), TTFT-Penalty ×0.5 linear in
Sekunden (maximal −1 bei 2 s TTFT). Höher = besser, NaN-safe (fehlende Werte = 0).
`ranking.md` sortiert Configs danach — kürzeste TTFT bei akzeptabler Quality
gewinnt. Gewichte überschreibbar via `CompositeWeights` (`Judge.ts` Z. 235–239).

---

## 5. Chunker — fixed-512-64

Quelle: `tests/evals/pipeline/Chunker.ts` + `configs.ts`.

- `FixedSizeChunker` (`Chunker.ts` Z. 20–38): fixed-size + overlap, einfachste Impl.
  `step = size − overlap`; wirft wenn `size <= overlap`; leere/whitespace-Slices
  werden geskippt; Chunk-id-Format `${docId}::${i}`.
- **Kanonischer Default `fixed-512-64`** (512-Zeichen-Fenster, 64 overlap) — in
  `configs.ts` in JEDER produktiv genutzten Config: `sweepConfigs`, `gridConfigs`,
  `adaptiveTopKConfigs`, `answerConfigs`, `matrixConfigs` (Z. 73, 141, 193, 259, 308).
  Auch der Chunker aller realen Datensätze (`focused-260q`, `handcrafted-adaptive-topk`,
  `wikipedia-survival` tragen `"chunker": "fixed-512-64"`).
- Hinweis: `size` ist „approx tokens pro chunk (hier vereinfacht als
  Zeichenfenster)" (`Chunker.ts` Z. 9) — also 512 **Zeichen**, nicht Tokens.
- Weitere (auskommentierte) Chunk-Kandidaten in `configs.ts`: `fixed-256-32`,
  `fixed-1024-128` (Z. 234–236, 341–343), aktivierbar für Ablation.

---

## 6. Pipeline-Configs

Quelle: `tests/evals/pipeline/configs.ts`.

`PipelineConfig` = bundle aus chunker + embedder + reranker + `topKToRerank`
(default 20) + `topKToLLM` (default 5) + optional LLM-bridge (`null` = retrieval-only)
(`configs.ts` Z. 18–32). Vier+ config-quellen:

| Funktion                | Zweck                                          | Default-Werte (wörtlich)                                                                        |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `defaultConfigs()`      | fake-stubs, kein LLM-load, CI-smoke            | `fake-256-noop`, `fake-512-noop`, `FakeEmbedder(64)`, `NoopReranker` (Z. 38–53)                 |
| `sweepConfigs()`        | echte Bridges + end-to-end TTFT                | embedder CPU, reranker auto, LLM `profile:'full'`; 4 configs k5/k8 × rerank 0/10/20 (Z. 67–122) |
| `adaptiveTopKConfigs()` | misst Heuristik focused=3/broad=8/summary=12   | 3 Punkte k3/k8/k12, alle rr20 (Z. 135–162)                                                      |
| `gridConfigs()`         | cartesian rerank × k für `--iterations N`      | rerank {0,3,5,10} × k {2,3,5} = 12 Punkte (Z. 174–241)                                          |
| `answerConfigs()`       | answer-pack, retrieval fix, LLM-Achse isoliert | bge-m3 + bge-reranker, rr20→top5, `llm:null` (Z. 254–273)                                       |
| `matrixConfigs()`       | Embedder×Chunker×Reranker, LLM fix             | default 2 configs (skip vs bge-reranker), bge-m3, 512/64 (Z. 290–355)                           |

- **LLM-Pin auf `'full'` (Qwen3-8B), nie `'auto'`** — sonst würde `resolveLlmPath`
  das XL-Judge-Modell (Nemotron 30B-A3B) als under-test mounten → Self-Bias + VRAM-Last
  (`configs.ts` Z. 77–82, 144–146, 183–191, 286–288).
- **Cache-Falle**: label/name fließt in den embedding-cache-key
  `${embedder.name}::${chunker.name}::${corpus.length}` — zwei Embedder mit gleichem
  Label teilen still Embeddings (`configs.ts` Z. 301–305, 322–324).
- Bridges sind teuer (LLM ~10–60 s load); dieselbe `LlmBridge`-Instanz wird über
  Configs wiederverwendet, warm()-dedup über Instanz-Identität (`README.md` Z. 175–179).

### TTFT-Phasen (6, aus `PhasedTimer`/perf.ts, `README.md` Z. 144–157)

`ttftMs = sum(queryEmbed, retrieve, rerank, promptAssemble, prefill, firstDecode)`:
`queryEmbed` (CPU embedder ~50–100 ms), `retrieve` (BM25+dense+sort, <5 ms),
`rerank` (cross-encoder, 0 wenn `topKToRerank=0`; CPU 0.5–2 s), `promptAssemble`
(trivial), `prefill` (LLM-prompt-processing bis erstes onChunk — **TTFT-dominant,
CPU-killer**), `firstDecode` (reserviert, aktuell 0). `fullResponseMs` = Wandzeit
bis `ask()` resolved.

---

## 7. Run-Dir / Provenienz-Konvention

Quelle: `tests/evals/runDir.ts` + `README.md` Z. 127–142.

Layout pro Sweep-Run (`runDir.ts` Z. 10–22, `README.md` Z. 129–139):

```
report/runs/<stamp>_<git-sha>[_dirty]/
  env.json            CPU / RAM / OS / git / node / maskierte env-flags
  dataset.json        path + sha256-hash des verwendeten datasets
  summary.md / .json  vergleichstabelle aller configs (md + maschinen-lesbar)
  ranking.md          configs nach composite sortiert
  configs/<name>/
    result.json       aggregierte stats (recall, MRR, phased TTFT)
    per-question.jsonl eine zeile pro frage (NICHT gelesen — zu groß)
    resource-samples.jsonl  rss/vram/cpu/heap, alle 250 ms
```

- **Folders werden nie überschrieben.** git-sha + `_dirty`-flag im Namen verhindert,
  dass ein dirty-run heimlich als clean-baseline gilt (`README.md` Z. 141–142;
  `runDir.ts` Z. 22, 136–138).
- `gitInfo()` (`runDir.ts` Z. 32–52): shortSha, branch, dirty (via `git diff --quiet`
  - `--cached`); Fehler → `'unknown'` (detached-repo-safe).
- Stamp-Format `2026-05-20T15-30-12` (ISO ohne ms, `:`/`.`→`-`, `runDir.ts` Z. 130–133).
- `dataset.json` trägt **sha256** (erste 16 hex, `hashBytes` `runDir.ts` Z. 126–128)
  → Reports über Zeit komparabel. Plus generator, generatedAt, numQuestions, numChunks,
  optional library (`runDir.ts` Z. 114–124).
- env-flags maskiert: API-Keys/Tokens nur als 6-Zeichen-Prefix geloggt
  (`runDir.ts` Z. 88–104; relevante Keys: `LLAMA_GPU`, `LOKLM_LLM_CONTEXT_SIZE`,
  `LOKLM_EMBEDDER_PATH`, `LOKLM_RERANKER_PATH`, `OLLAMA_HOST`, `ANTHROPIC_API_KEY`).
- `aggregate-paper.ts` (`evals:paper`) sammelt alle run-dirs → flache Zeile je
  (Datensatz × Config) mit Provenienz (git-sha, dirty, CPU, RAM, dataset-sha256);
  `--clean-only` filtert dirty-runs (`README.md` Z. 253–262).

---

## 8. Datensatz-Übersicht + Lizenzen

Quelle: dataset-header (`tests/evals/data/datasets/*.json`) + counts (verifiziert via
JSON-parse) + `wikipedia-survival.md`.

| Dataset (Datei)                                        | Fragen | Chunks | Generator                                                              | Lizenz / Quelle                                                                                                                                                                                                          |
| ------------------------------------------------------ | -----: | -----: | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xquad-de-300q-2026-05-24T17-05-53.json`               |    300 |    240 | `xquad-de-subset` (chunker `xquad-passage`)                            | **CC BY-SA 4.0**; XQuAD DE-subset, `google-deepmind/xquad` raw; cite Artetxe et al. 2020, arXiv:1910.11856 (header Z. 2–9). Subsample limit 300, seed 42, von 1190 verfügbar (Z. 10–14)                                  |
| `focused-260q-2026-05-24T16-59-04.json`                |    260 |     52 | `salvage-focused:agent-batch:claude-opus-4-7` (chunker `fixed-512-64`) | salvage von `agent-batch-claude-opus-4-7-…`; alle 260 als `intent=focused` getaggt, `requiredChunkIds=[chunkId]`, Annahme 5 q/chunk = single-relevant (header Z. 2–6)                                                    |
| `agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json` |    260 |     52 | `agent-batch:claude-opus-4-7`                                          | Quell-batch für focused-260q; hash `43207410dc46debe` (`3-model-comparison` Z. 5, `summary.md` Z. 7)                                                                                                                     |
| `handcrafted-adaptive-topk-2026-05-21T18-46-35.json`   |     25 |    109 | `manual-handcrafted:adaptive-topk-eval` (chunker `fixed-512-64`)       | handgeschrieben; trägt intent + requiredChunkIds für broad/summary-Test (header Z. 2–4)                                                                                                                                  |
| `wikipedia-survival-1255q-2026-06-13T11-42-44.json`    |   1255 |   2939 | `wikipedia-survival:agent-verified` (chunker `fixed-512-64`)           | **CC BY-SA 4.0**; EN-Wikipedia `prop=extracts`, fetched 2026-06-13 (header Z. 2–11). 5 Themen je 10 Artikel; 1322 generiert → 1255 behalten (~5 % verworfen), adversarial verifiziert (`wikipedia-survival.md` Z. 13–35) |

Reproduzierbarkeits-Konvention: Datasets werden **einmal generiert und committed**;
nur regeneriert wenn Sample-Docs oder Generator-Prompts sich ändern (`README.md`
Z. 16–17, 285–286). Provider für synthetische Daten: Ollama (lokal, default) oder
Anthropic (`ANTHROPIC_API_KEY`, höherwertige Goldstandards) (`README.md` Z. 90–101).

---

## 9. Ergebnis-Tabellen (reale Zahlen)

> Alle Zahlen wörtlich aus committeten run-reports. per-question.jsonl wurde NICHT
> gelesen (zu groß) — nur summary.md / ranking.md / result.json / \*-comparison.md.

### Tabelle A — Grid-Sweep Qwen3-8B (focused-Dataset, n=30/config)

Quelle: `report/runs/2026-05-20T19-46-39_45bf322_dirty/summary.md` + `ranking.md` +
`env.json`. Git `45bf322` (dirty), i9-9900K ×16 / 31.9 GB. Dataset
`agent-batch-claude-opus-4-7-…`, hash `43207410dc46debe`, 260 Fragen / 52 Chunks.
Composite = 2·judge + recall@5 − 0.5·TTFT_sec.

| Config       |   n |   r@5 |  r@10 |   MRR | judge | TTFT p50 (ms) | TTFT p95 | FullResp p50 | composite |
| ------------ | --: | ----: | ----: | ----: | ----: | ------------: | -------: | -----------: | --------: |
| grid_k3_rr0  |  30 | 0.700 | 0.700 | 0.589 | 0.923 |           606 |     1489 |          809 | **2.243** |
| grid_k5_rr0  |  30 | 0.700 | 0.700 | 0.589 | 0.923 |           640 |      828 |          920 |     2.227 |
| grid_k2_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.922 |           648 |      759 |          786 |     2.221 |
| grid_k2_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.893 |           610 |      957 |          810 |     2.182 |
| grid_k3_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.906 |           743 |     1073 |          819 |     2.173 |
| grid_k5_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.912 |           722 |      860 |          906 |     2.163 |
| grid_k2_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.892 |           709 |      882 |          806 |     2.163 |
| grid_k3_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.888 |           628 |      785 |          777 |     2.162 |
| grid_k5_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.888 |           645 |      806 |          804 |     2.153 |
| grid_k5_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.887 |           787 |      970 |          866 |     2.113 |
| grid_k3_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.860 |           679 |      854 |          821 |     2.081 |
| grid_k2_rr0  |  30 | 0.633 | 0.633 | 0.567 | 0.831 |           581 |     2396 |          862 |     2.005 |

Befund: Sieger `grid_k3_rr0` (composite 2.243); k=3 maxt Qualität, rerank-off ist hier
meist besser als rerank-on (Quelle: report-findings).

### Tabelle B — 3-Modell-Vergleich (Qwen3-8B vs Granite-3.3-8B vs Mistral-Nemo-12B)

Quelle: `report/3-model-comparison-2026-05-20.md`. n=30 Fragen/config, top-3 configs/Modell,
Judge = Nemotron 3 Nano 30B-A3B (gepinnt). Composite-Ranking, alle Zellen kombiniert
(Z. 34–44):

| Rang | Modell       | Config      | Composite | recall@5 | judge | corr | ground | help | TTFT p50 |
| ---: | ------------ | ----------- | --------: | -------: | ----: | ---: | -----: | ---: | -------: |
|    1 | Qwen3-8B     | grid_k3_rr0 |     2.243 |    0.700 | 0.923 | 0.95 |   0.96 | 0.86 |   606 ms |
|    2 | Qwen3-8B     | grid_k5_rr0 |     2.227 |    0.700 | 0.923 | 0.95 |   0.97 | 0.85 |   640 ms |
|    3 | Qwen3-8B     | grid_k2_rr5 |     2.221 |    0.700 | 0.922 | 0.95 |   0.97 | 0.85 |   648 ms |
|    4 | Mistral-Nemo | grid_k3_rr0 |     2.215 |    0.700 | 0.916 | 0.94 |   0.96 | 0.84 |   632 ms |
|    5 | Granite      | grid_k2_rr5 |     2.205 |    0.700 | 0.911 | 0.92 |   0.97 | 0.85 |   634 ms |
|    6 | Granite      | grid_k3_rr0 |     2.200 |    0.700 | 0.909 | 0.93 |   0.94 | 0.85 |   635 ms |
|    7 | Mistral-Nemo | grid_k5_rr0 |     2.187 |    0.700 | 0.912 | 0.94 |   0.96 | 0.84 |   674 ms |
|    8 | Granite      | grid_k5_rr0 |     2.180 |    0.700 | 0.913 | 0.94 |   0.96 | 0.84 |   693 ms |
|    9 | Mistral-Nemo | grid_k2_rr5 |     2.149 |    0.700 | 0.889 | 0.91 |   0.93 | 0.82 |   657 ms |

Modell-Footprints (Q4_K_M, GPU/CUDA; `3-model-comparison` Z. 11–18): Qwen3-8B ~5 GB
VRAM + ~6 GB RSS; Granite 3.3-8B ~5 GB VRAM + ~5.7 GB RSS; Mistral-Nemo-12B ~7.5 GB
VRAM + ~8.2 GB RSS; Embedder bge-m3 CPU ~440 MB; Reranker bge-reranker-v2-m3 GPU
~440 MB VRAM; Judge Nemotron 30B-A3B ~18 GB VRAM (pass-2 only).

Befund (Z. 60–67): Qwen3-8B gewinnt über alle 3 configs (Judge-Margin 0.007–0.033,
klein aber konsistent); größeres Modell ist NICHT besser (Mistral-Nemo-12B unter dem
8B-incumbent); Granite ist am robustesten (0.909/0.913/0.911); GPU-TTFT-Spannen klein
(606–693 ms quer durch alle Modelle).

### Tabelle C — Wikipedia-Survival Retrieval (n=1255, voller 2939-Chunk-Haystack)

Quelle: `papers/_evidence/wikipedia-survival.md` Z. 59–69. GPU placement, embedder
bge-m3 (Q4_K_M), reranker bge-reranker-v2-m3 (pool=50 dense-Kandidaten),
single-relevant.

| Metrik    | dense (bge-m3, kein rerank) | dense + rerank (bge-reranker-v2-m3) |
| --------- | --------------------------: | ----------------------------------: |
| recall@1  |                       0.552 |                           **0.844** |
| recall@5  |                       0.714 |                           **0.894** |
| recall@10 |                       0.758 |                           **0.894** |
| MRR       |                       0.623 |                           **0.867** |
| nDCG@10   |                       0.656 |                           **0.874** |

Validierungs-Stichprobe (250 stride-gesampelte Fragen, dense, kein rerank):
recall@1 0.544, recall@5 0.688, recall@10 0.744, MRR 0.615, nDCG@10 0.646 —
konsistent mit vollem Lauf (`wikipedia-survival.md` Z. 67–69).

Timing (GPU; Z. 85–88): embedder warm 3.6 s; korpus-embed 2939 chunks **48.7 s**;
query+rerank-loop 1255 Fragen **1052 s (~17.5 min, seriell)**. CPU bge-m3 ≈ 1.5 s/chunk
→ 2939 chunks > 70 min (thermisch gedrosselt). `EmbedderBridge.embedBatch` embeddet
seriell (keine batch-API in node-llama-cpp).

---

## 10. Kern-Befunde (methodisch übergreifend)

1. **Qwen3-8B (full-Profil) ist der incumbent-Sieger** — über grid + 3-Modell-Vergleich,
   XL bringt keine Qualitäts-Rendite, kostet 18 GB load (`3-model-comparison` Findings +
   Production Recommendations Z. 60–77).
2. **k=3 maxt Qualität** auf allen 3 Modellen; `QAService.DEFAULT_TOP_K` von 8 → 3
   gelandet (`3-model-comparison` Z. 73).
3. **Reranker hilft inkonsistent** auf den sauber vor-sortierten Eval-Pools; bei k=2
   hilft rr=5 (sonst recall-collapse), bei k≥3 schadet er eher. Produktions-Fusion-Pool
   (BM25+dense) ist noisiger, dort hilft rerank wahrscheinlich — bleibt opt-in
   (`3-model-comparison` Finding 6 + Recommendations).
4. **Auf großem realem Haystack hebt der Reranker recall@1 von 0.552 → 0.844 (+0.292)**;
   recall@5 = recall@10 = 0.894 = Ceiling des dense-top-50-Pools (`wikipedia-survival.md`
   Z. 72–78).
5. **GPU-TTFT-Spannen sind klein** (606–693 ms); CPU würde Embedder + Prefill viel
   stärker streuen (`3-model-comparison` Finding 4).

---

## 11. Caveats / Limitationen

- **Kleine n bei Modell-/Grid-Vergleichen**: n=30 Fragen/config; Margins (~0.01–0.03)
  knapp über statistischem Rauschen → vor finalen Entscheidungen bei knappen Rangfolgen
  mit n=100 wiederholen (`3-model-comparison` Caveats Z. 81).
- **Eval umgeht die Produktions-RAG-Pipeline**: skipped BM25+dense-Fusion, multi-query
  expansion, Heuristiken (title boost / short-chunk penalty / recency), doc
  diversification, whole-doc fallback, neighbour expansion, DB-I/O, worker-IPC. Misst
  isoliert embedder + reranker + LLM auf vorgefertigten Chunks. Produktions-TTFT ~60 s
  muss separat debuggt werden (vermutl. auto-pick XL + cold-load + multi-query)
  (`3-model-comparison` Caveats Z. 82–83).
- **GPU-Läufe = Qualitäts-/Korrektheits-Check, NICHT Produktions-CPU-Timing**.
  Faithful-CPU-Timings sind separate `evals:sweep --no-llm`-Läufe
  (`wikipedia-survival.md` Z. 90–92).
- **Reranker nicht auf CPU getestet**; auf CPU würde rerank 1–2 s kosten →
  CPU-only-end-user-Pfad sollte rerank=off lassen (`3-model-comparison` Caveats Z. 85).
- **Self-Bias-Schutz**: under-test-LLM MUSS vom XL-Judge getrennt bleiben (Pin auf
  `'full'`), sonst Selbstbewertungs-Bias (`configs.ts` Z. 77–82, 183–191).
- **chunk-`size` = Zeichen, nicht Tokens** im Eval-Chunker (`Chunker.ts` Z. 9) —
  beim Übersetzen in Token-Aussagen beachten.
- **DE-lastige Datensätze**: Mistral-Nemos angebliche bessere DE-Stärke zeigt sich
  nicht — evtl. weil Nemotron-Judge DE-Nuancen nicht trennscharf bewertet oder
  Dataset zu klein (`3-model-comparison` Caveats Z. 84).
- **Status der Eval-Säule**: Scaffold + A/B/C-Automatisierung (matrix/datasets/paper)
  stehen und sind unit-getestet; weitere Embedder/Chunker-Achsen sind auskommentierte
  Kandidaten, erst nach Abstimmung mit dem RAG/Embedding-Owner aktivieren
  (`README.md` Z. 264–274, `configs.ts` Z. 329–344).
- **single-relevant-Artefakt**: ~11 % Misses im Wikipedia-Lauf sind genuin schwer —
  512-Zeichen-overlap heißt Nachbar-Chunks teilen den Antwort-Text, „gold"-Chunk
  konkurriert mit Nachbarn (`wikipedia-survival.md` Z. 79–81).

---

## Quell-Dateien (Referenz)

- `tests/evals/README.md` — Philosophie, Workflow, Scripts, TTFT-Phasen, Composite-Formel
- `tests/evals/metrics.ts` — recall@k / recall_req@k / MRR / nDCG@k Definitionen + Code
- `tests/evals/judge/Judge.ts` — 3-Dim-Judge, Prompts, parse, compositeScore
- `tests/evals/pipeline/configs.ts` — alle Config-Quellen, LLM-Pin, Cache-Falle
- `tests/evals/pipeline/Chunker.ts` — FixedSizeChunker (512/64)
- `tests/evals/runDir.ts` — run-dir-Layout, env/git/dataset-Provenienz, sha256
- `tests/evals/data/datasets/*.json` — dataset-header (Lizenz, generator, counts)
- `tests/evals/report/3-model-comparison-2026-05-20.md` — Tabelle B + Findings
- `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/{summary.md,ranking.md,env.json}` — Tabelle A
- `papers/_evidence/wikipedia-survival.md` — Tabelle C + GPU-Timings
