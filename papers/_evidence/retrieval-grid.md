# Evidence — Retrieval-Grid

Domain: `retrieval-grid`. Jede Zahl unten ist wörtlich aus einem LokLM-eval-
artefakt kopiert; für jede tabelle/figur ist die quell-datei benannt. Keine werte
sind erfunden, geschätzt oder neu-berechnet — wo ein report einen gerundeten wert
druckt und das JSON volle präzision, sind beide gezeigt und beschriftet.

## Was getestet wurde

Retrieval-grid-sweep: fester embedder **BGE-M3** + reranker **bge-reranker-v2-m3**,
variiert über `topK` (an den LLM gereichte chunks) × `rerank-pool` (vor-dem-rerank
gezogene kandidaten). Frage: hilft cross-encoder-rerank auf einem sauberen
cosine-pool, und welcher `topK` maximiert qualität bei niedrigster TTFT.

Zwei läufe decken die domäne ab:

- **Lauf A** (`2026-05-20T18-31-49_9498853_dirty`): grid OHNE LLM/judge
  (`llmEnabled` aus, judge-spalte `-`). Misst reines retrieval (recall/MRR/nDCG)
  - phasen-latenz. n=10 fragen/config. Breiterer pool-fächer (rr0/10/20/40) und
    höhere k (k3/k5/k8).
- **Lauf B** (`2026-05-20T19-46-39_45bf322_dirty`): grid MIT LLM (Qwen3-8B) +
  judge (Nemotron 3 Nano 30B-A3B). n=30 fragen/config. Engerer pool-fächer
  (rr0/3/5/10) und niedrigere k (k2/k3/k5). Dies ist der Qwen3-8B-quell-lauf, der
  in der 3-modell-vergleichstabelle zitiert wird.

Quelle: `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/summary.md`
(Kopf + `judge`-spalte `-`);
`tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/summary.md` (Kopf);
`tests/evals/report/3-model-comparison-2026-05-20.md` (Setup, Source Runs).

## Methodik

- **Composite-score** (ranking-sortierung): `judge*2 + recall@5 - ttft_sec*0.5`,
  höher = besser. In Lauf A ist `judge` leer (`-`), der composite reduziert sich
  dort faktisch auf `recall@5 - ttft_sec*0.5`.
  Quelle: beide `ranking.md` (Kopfzeile);
  `3-model-comparison-2026-05-20.md` (Z.6, "Composite = 2·judge + recall@5 − 0.5·TTFT_sec").
- **Judge**: Nemotron 3 Nano 30B-A3B, GPU, deterministisch fest gepinnt, nur in
  pass-2 geladen (~18 GB VRAM). Sub-scores: correctness / groundedness /
  helpfulness.
  Quelle: `3-model-comparison-2026-05-20.md` (Setup-tabelle Z.18, Z.6).
- **Embedder**: BGE-M3 auf **CPU** (spiegelt prod-default), ~440 MB. **Reranker**:
  bge-reranker-v2-m3, GPU (auto), ~440 MB VRAM.
  Quelle: `3-model-comparison-2026-05-20.md` (Setup-tabelle Z.16-17).
- **Under-test-LLM in Lauf B**: Qwen3-8B Instruct, GPU (CUDA), Q4_K_M, ~5 GB VRAM.
  Quelle: `3-model-comparison-2026-05-20.md` (Setup-tabelle Z.13; Source Runs Z.89).
- **Hardware**: Intel Core i9-9900K @ 3.60GHz × 16, 31.9 GB RAM (+ RTX 5090, 32 GB
  VRAM lt. vergleichs-report). win32, release 10.0.26200, node v22.15.1.
  Quelle: beide `summary.md` (Z.5);
  `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/env.json`;
  `3-model-comparison-2026-05-20.md` (Z.3).
- **Config-namensschema**: `grid_k<topK>_rr<pool>` — `k` = an LLM gereichte chunks,
  `rr` = rerank-pool-tiefe (`rr0` = rerank aus). Configs unterscheiden sich nur in
  diesen zwei achsen, embedder/reranker-modelle sind fix.
  Quelle: config-verzeichnisnamen in `.../configs/` beider läufe; summary-tabellen.

## Datensatz / Provenienz

Beide läufe teilen sich denselben datensatz.

| Feld         | Wert                                                   | Quelle                                                    |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------- |
| path         | `agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json` | run `dataset.json` (path)                                 |
| sha256       | `43207410dc46debe`                                     | run `dataset.json` (sha256) / `summary.md` (Dataset-hash) |
| generator    | `agent-batch:claude-opus-4-7`                          | run `dataset.json` (generator)                            |
| generatedAt  | `2026-05-17T20:43:09.742Z`                             | run `dataset.json` (generatedAt)                          |
| numQuestions | 260                                                    | `dataset.json` / `summary.md` (Z.7)                       |
| numChunks    | 52                                                     | `dataset.json` / `summary.md` (Z.7)                       |
| library      | null                                                   | `dataset.json` (library)                                  |

Quelle: `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/dataset.json`;
beide `summary.md` (Z.6-7).

Hinweis: der datensatz hat 260 fragen, aber pro config wurden nur stichproben
gewertet — **n=10** in Lauf A, **n=30** in Lauf B (siehe `n`-spalte der summary-
tabellen bzw. `numQueries` in `result.json`).

---

## ERGEBNIS-TABELLE 1 — Lauf A: reines retrieval (kein LLM/judge), n=10

Wörtlich aus der "Quality + TTFT"-tabelle. `judge` = `-` (LLM aus). Latenzen in ms,
rerank/retr in ms, rss-max in MiB. Composite ohne judge = `recall@5 - ttft_sec*0.5`.

| Config       |   n |   r@5 |  r@10 |   MRR | TTFT p50 | TTFT p95 | FullResp p50 |  qEmb | retr | rerank | prefill | rss-max MiB | cpu% | free VRAM min GB | composite |
| ------------ | --: | ----: | ----: | ----: | -------: | -------: | -----------: | ----: | ---: | -----: | ------: | ----------: | ---: | ---------------: | --------: |
| grid_k3_rr0  |  10 | 0.800 | 0.800 | 0.633 |      667 |     7419 |          953 | 461.6 |  0.4 |    0.0 |     954 |        5952 |   99 |             21.6 |     0.467 |
| grid_k5_rr0  |  10 | 0.800 | 0.800 | 0.633 |      634 |      831 |          935 | 443.0 |  0.3 |    0.0 |     194 |        5872 |   88 |             21.6 |     0.483 |
| grid_k8_rr0  |  10 | 0.800 | 0.800 | 0.633 |      735 |      832 |          959 | 435.7 |  0.3 |    0.0 |     264 |        5881 |   86 |             21.6 |     0.432 |
| grid_k3_rr10 |  10 | 0.900 | 0.900 | 0.800 |      792 |     2313 |          837 | 434.1 |  0.2 |  211.9 |     253 |        6838 |   89 |             21.3 |     0.504 |
| grid_k5_rr10 |  10 | 0.900 | 0.900 | 0.800 |      790 |      956 |          896 | 437.7 |  0.3 |  158.0 |     179 |        6515 |   88 |             21.3 |     0.505 |
| grid_k8_rr10 |  10 | 0.900 | 0.900 | 0.800 |      869 |      996 |          961 | 434.5 |  0.2 |  156.8 |     252 |        6463 |   85 |             21.3 |     0.465 |
| grid_k3_rr20 |  10 | 0.800 | 0.800 | 0.700 |      963 |     1059 |          818 | 446.6 |  0.3 |  330.4 |     136 |        6864 |   88 |             21.3 |     0.318 |
| grid_k5_rr20 |  10 | 0.900 | 0.900 | 0.725 |      950 |     1079 |          895 | 430.1 |  0.2 |  311.8 |     183 |        6542 |   85 |             21.3 |     0.425 |
| grid_k8_rr20 |  10 | 0.900 | 0.900 | 0.725 |     1033 |     1174 |          977 | 431.1 |  0.2 |  312.9 |     263 |        6589 |   83 |             21.3 |     0.384 |
| grid_k3_rr40 |  10 | 0.800 | 0.800 | 0.700 |     1216 |     1363 |          817 | 441.2 |  0.2 |  628.1 |     139 |        6725 |   88 |             21.3 |     0.192 |

Quelle: `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/summary.md`
(Z.14-23, "Quality + TTFT").

### Tabelle 1b — Lauf A: zusätzliche retrieval-metriken aus summary.json (volle präzision)

r@1 und nDCG@10 stehen NICHT in der summary.md, nur im `summary.json`. Hier
verbatim ergänzt (MRR/nDCG auf 4 nachkommastellen aus dem JSON).

| Config       | r@1 | r@5 | r@10 |    MRR | nDCG@10 |
| ------------ | --: | --: | ---: | -----: | ------: |
| grid_k3_rr0  | 0.5 | 0.8 |  0.8 | 0.6333 |  0.6762 |
| grid_k5_rr0  | 0.5 | 0.8 |  0.8 | 0.6333 |  0.6762 |
| grid_k8_rr0  | 0.5 | 0.8 |  0.8 | 0.6333 |  0.6762 |
| grid_k3_rr10 | 0.7 | 0.9 |  0.9 | 0.8000 |  0.8262 |
| grid_k5_rr10 | 0.7 | 0.9 |  0.9 | 0.8000 |  0.8262 |
| grid_k8_rr10 | 0.7 | 0.9 |  0.9 | 0.8000 |  0.8262 |
| grid_k3_rr20 | 0.6 | 0.8 |  0.8 | 0.7000 |  0.7262 |
| grid_k5_rr20 | 0.6 | 0.9 |  0.9 | 0.7250 |  0.7693 |
| grid_k8_rr20 | 0.6 | 0.9 |  0.9 | 0.7250 |  0.7693 |
| grid_k3_rr40 | 0.6 | 0.8 |  0.8 | 0.7000 |  0.7262 |

Quelle: `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/summary.json`
(`results[].recallAt1/recallAt5/recallAt10/mrr/ndcgAt10`).

### Tabelle 1c — Lauf A: ranking nach composite

| Rang | Config       | Composite | recall@5 | judge | TTFT p50 (ms) | FullResp p50 (ms) |
| ---: | ------------ | --------: | -------: | ----: | ------------: | ----------------: |
|    1 | grid_k5_rr10 |     0.505 |    0.900 |     - |           790 |               896 |
|    2 | grid_k3_rr10 |     0.504 |    0.900 |     - |           792 |               837 |
|    3 | grid_k5_rr0  |     0.483 |    0.800 |     - |           634 |               935 |
|    4 | grid_k3_rr0  |     0.467 |    0.800 |     - |           667 |               953 |
|    5 | grid_k8_rr10 |     0.465 |    0.900 |     - |           869 |               961 |
|    6 | grid_k8_rr0  |     0.432 |    0.800 |     - |           735 |               959 |
|    7 | grid_k5_rr20 |     0.425 |    0.900 |     - |           950 |               895 |
|    8 | grid_k8_rr20 |     0.384 |    0.900 |     - |          1033 |               977 |
|    9 | grid_k3_rr20 |     0.318 |    0.800 |     - |           963 |               818 |
|   10 | grid_k3_rr40 |     0.192 |    0.800 |     - |          1216 |               817 |

Quelle: `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/ranking.md`
(Z.9-18).

---

## ERGEBNIS-TABELLE 2 — Lauf B: retrieval + LLM (Qwen3-8B) + judge, n=30

Wörtlich aus der "Quality + TTFT"-tabelle. Hier ist `judge` gefüllt. Latenzen in ms.

| Config       |   n |   r@5 |  r@10 |   MRR | judge | TTFT p50 | TTFT p95 | FullResp p50 |  qEmb | retr | rerank | prefill | rss-max MiB | cpu% | free VRAM min GB | composite |
| ------------ | --: | ----: | ----: | ----: | ----: | -------: | -------: | -----------: | ----: | ---: | -----: | ------: | ----------: | ---: | ---------------: | --------: |
| grid_k2_rr0  |  30 | 0.633 | 0.633 | 0.567 | 0.831 |      581 |     2396 |          862 | 506.5 |  0.3 |    0.0 |     690 |        5973 |   99 |             19.2 |     2.005 |
| grid_k3_rr0  |  30 | 0.700 | 0.700 | 0.589 | 0.923 |      606 |     1489 |          809 | 502.7 |  0.3 |    0.0 |     190 |        5849 |   91 |             25.2 |     2.243 |
| grid_k5_rr0  |  30 | 0.700 | 0.700 | 0.589 | 0.923 |      640 |      828 |          920 | 513.6 |  0.3 |    0.0 |     138 |        5865 |   90 |             25.2 |     2.227 |
| grid_k2_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.893 |      610 |      957 |          810 | 510.7 |  0.3 |  109.7 |      54 |        6745 |   93 |             25.0 |     2.182 |
| grid_k3_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.888 |      628 |      785 |          777 | 510.1 |  0.3 |   47.7 |      77 |        6454 |   90 |             25.0 |     2.162 |
| grid_k5_rr3  |  30 | 0.700 | 0.700 | 0.700 | 0.888 |      645 |      806 |          804 | 512.0 |  0.3 |   48.6 |      78 |        6473 |   90 |             25.0 |     2.153 |
| grid_k2_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.922 |      648 |      759 |          786 | 512.8 |  0.3 |   79.1 |      54 |        6644 |   90 |             25.0 |     2.221 |
| grid_k3_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.860 |      679 |      854 |          821 | 512.6 |  0.3 |   81.5 |      78 |        6516 |   90 |             25.0 |     2.081 |
| grid_k5_rr5  |  30 | 0.700 | 0.700 | 0.700 | 0.912 |      722 |      860 |          906 | 512.0 |  0.3 |   79.2 |     126 |        6519 |   88 |             25.0 |     2.163 |
| grid_k2_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.892 |      709 |      882 |          806 | 506.9 |  0.3 |  159.8 |      57 |        6722 |   90 |             25.0 |     2.163 |
| grid_k3_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.906 |      743 |     1073 |          819 | 515.0 |  0.3 |  158.9 |     123 |        6590 |   90 |             25.0 |     2.173 |
| grid_k5_rr10 |  30 | 0.733 | 0.733 | 0.683 | 0.887 |      787 |      970 |          866 | 518.1 |  0.3 |  157.9 |     132 |        6606 |   88 |             25.0 |     2.113 |

Quelle: `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/summary.md`
(Z.14-25, "Quality + TTFT").

### Tabelle 2b — Lauf B: r@1 / nDCG@10 / judge-sub-scores aus summary.json (volle präzision)

r@1, nDCG@10 und judge-sub-scores (correctness/groundedness/helpfulness) stehen
nicht in summary.md. Hier verbatim aus dem JSON ergänzt.

| Config       |    r@1 | nDCG@10 |  judge |  corr | ground |  help | composite |
| ------------ | -----: | ------: | -----: | ----: | -----: | ----: | --------: |
| grid_k2_rr0  |    0.5 |  0.5841 | 0.8311 | 0.860 |  0.867 | 0.767 |    2.0050 |
| grid_k3_rr0  |    0.5 |  0.6175 | 0.9233 | 0.950 |  0.963 | 0.857 |    2.2434 |
| grid_k5_rr0  |    0.5 |  0.6175 | 0.9233 | 0.953 |  0.967 | 0.850 |    2.2267 |
| grid_k2_rr3  |    0.7 |  0.7000 | 0.8933 | 0.923 |  0.933 | 0.823 |    2.1819 |
| grid_k3_rr3  |    0.7 |  0.7000 | 0.8878 | 0.913 |  0.930 | 0.820 |    2.1616 |
| grid_k5_rr3  |    0.7 |  0.7000 | 0.8878 | 0.913 |  0.930 | 0.820 |    2.1532 |
| grid_k2_rr5  |    0.7 |  0.7000 | 0.9222 | 0.950 |  0.967 | 0.850 |    2.2205 |
| grid_k3_rr5  |    0.7 |  0.7000 | 0.8600 | 0.887 |  0.900 | 0.793 |    2.0806 |
| grid_k5_rr5  |    0.7 |  0.7000 | 0.9122 | 0.937 |  0.957 | 0.843 |    2.1635 |
| grid_k2_rr10 | 0.6333 |  0.6964 | 0.8922 | 0.920 |  0.933 | 0.823 |    2.1631 |
| grid_k3_rr10 | 0.6333 |  0.6964 | 0.9056 | 0.937 |  0.940 | 0.840 |    2.1729 |
| grid_k5_rr10 | 0.6333 |  0.6964 | 0.8867 | 0.917 |  0.933 | 0.810 |    2.1132 |

Quelle: `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/summary.json`
(`results[].recallAt1/ndcgAt10/judgeAvg.{score,correctness,groundedness,helpfulness}/composite`);
einzelwerte gegen `.../configs/grid_k3_rr0/result.json` verifiziert.

### Tabelle 2c — Lauf B: ranking nach composite

| Rang | Config       | Composite | recall@5 | judge | TTFT p50 (ms) | FullResp p50 (ms) |
| ---: | ------------ | --------: | -------: | ----: | ------------: | ----------------: |
|    1 | grid_k3_rr0  |     2.243 |    0.700 | 0.923 |           606 |               809 |
|    2 | grid_k5_rr0  |     2.227 |    0.700 | 0.923 |           640 |               920 |
|    3 | grid_k2_rr5  |     2.221 |    0.700 | 0.922 |           648 |               786 |
|    4 | grid_k2_rr3  |     2.182 |    0.700 | 0.893 |           610 |               810 |
|    5 | grid_k3_rr10 |     2.173 |    0.733 | 0.906 |           743 |               819 |
|    6 | grid_k5_rr5  |     2.163 |    0.700 | 0.912 |           722 |               906 |
|    7 | grid_k2_rr10 |     2.163 |    0.733 | 0.892 |           709 |               806 |
|    8 | grid_k3_rr3  |     2.162 |    0.700 | 0.888 |           628 |               777 |
|    9 | grid_k5_rr3  |     2.153 |    0.700 | 0.888 |           645 |               804 |
|   10 | grid_k5_rr10 |     2.113 |    0.733 | 0.887 |           787 |               866 |
|   11 | grid_k3_rr5  |     2.081 |    0.700 | 0.860 |           679 |               821 |
|   12 | grid_k2_rr0  |     2.005 |    0.633 | 0.831 |           581 |               862 |

Quelle: `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/ranking.md`
(Z.9-20).

---

## ERGEBNIS-TABELLE 3 — Retrieval/Rerank/Latenz aus dem 3-modell-vergleich

Der vergleichs-report zitiert dieselben Lauf-B-zahlen (Qwen3-8B) plus die per-phase-
latenz quer über die drei modelle. Hier nur die retrieval/rerank/latenz-relevanten
teile, wörtlich.

### Tabelle 3a — Per-Phase-Latenz, Mean ms (alle 3 modelle, top-3 configs)

| Modell       | Config      | qEmb (CPU) | retrieve | rerank (GPU) | promptAssemble | prefill (GPU) | fullResp p50 |
| ------------ | ----------- | ---------: | -------: | -----------: | -------------: | ------------: | -----------: |
| Qwen3-8B     | grid_k3_rr0 |        503 |      0.3 |            0 |           0.01 |           190 |          809 |
| Qwen3-8B     | grid_k5_rr0 |        514 |      0.3 |            0 |           0.00 |           138 |          920 |
| Qwen3-8B     | grid_k2_rr5 |        513 |      0.3 |           79 |           0.00 |            54 |          786 |
| Granite      | grid_k3_rr0 |        505 |      0.3 |            0 |           0.02 |           123 |          800 |
| Granite      | grid_k5_rr0 |        512 |      0.3 |            0 |           0.01 |           171 |          879 |
| Granite      | grid_k2_rr5 |        511 |      0.3 |           84 |           0.01 |            61 |          691 |
| Mistral-Nemo | grid_k3_rr0 |        518 |      0.4 |            0 |           0.02 |           112 |          613 |
| Mistral-Nemo | grid_k5_rr0 |        521 |      0.3 |            0 |           0.01 |           159 |          795 |
| Mistral-Nemo | grid_k2_rr5 |        523 |      0.3 |           84 |           0.01 |            64 |          578 |

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md`
(Z.48-58, "Per-Phase Latency , Mean ms").

### Tabelle 3b — Composite-ranking, alle zellen kombiniert (top-3 configs × 3 modelle)

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

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md`
(Z.36-44, "Composite Score Ranking , Alle Zellen Kombiniert").

### Tabelle 3c — Cross-model-zelle (judge / TTFT p50 ms)

| Config      | Qwen3-8B       | Granite-3.3-8B | Mistral-Nemo-12B |
| ----------- | -------------- | -------------- | ---------------- |
| grid_k3_rr0 | 0.923 / 606 ms | 0.909 / 635 ms | 0.916 / 632 ms   |
| grid_k5_rr0 | 0.923 / 640 ms | 0.913 / 693 ms | 0.912 / 674 ms   |
| grid_k2_rr5 | 0.922 / 648 ms | 0.911 / 634 ms | 0.889 / 657 ms   |

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md`
(Z.24-28, "Cross-Model Cell Comparison").

---

## Kern-Befunde

1. **Rerank hilft inkonsistent auf dem sauberen cosine-pool** (der haupt-befund).
   Wörtlich aus dem report: "Im Qwen-12-config sweep waren rerank-configs
   überwiegend SCHLECHTER als rerank-off. Bei k=2 hilft rr=5 messbar (sonst
   recall-collapse). Bei k=3+ hurts es eher. Vermutlich artefakt vom sauber-vor-
   sortierten cosine-pool (produktion hat BM25+dense fusion , noisiger)."
   Quelle: `3-model-comparison-2026-05-20.md` (Findings #6, Z.67).

2. **Lauf B (mit LLM/judge) — rerank-off gewinnt nach composite**: die top-2
   plätze sind `grid_k3_rr0` (2.243) und `grid_k5_rr0` (2.227), beide mit
   judge 0.923. Erst auf platz 3 kommt eine rerank-config (`grid_k2_rr5`, 2.221,
   judge 0.922). `grid_k2_rr0` (kein rerank, k=2) ist mit composite 2.005 und
   r@5 0.633 schlusslicht — bei k=2 hilft ein rerank-pool also messbar (rr5 hebt
   judge auf 0.922, r@5 auf 0.700). Quelle: Tabelle 2c, 2b.

3. **Judge-effekt von rerank ist achsen-abhängig**: bei k=2 hebt rr5 den judge
   von 0.831 (rr0) auf 0.922; bei k=3 senkt rr5 ihn von 0.923 (rr0) auf 0.860;
   bei k=5 senkt rr5 ihn von 0.923 auf 0.912. Quelle: Tabelle 2b.

4. **Lauf A (reines retrieval, kein LLM) — rerank hebt recall/MRR moderat**:
   bei rr10 steigt r@5/r@10 von 0.800 auf 0.900 und MRR von 0.633 auf 0.800
   (nDCG@10 0.6762 → 0.8262). Aber rr20/rr40 verschlechtern wieder (MRR fällt auf
   0.700-0.725, rr40 sogar r@5 zurück auf 0.800). Optimum liegt bei rr10, nicht
   am tiefsten pool. Quelle: Tabelle 1, 1b.

   Achtung — der retrieval-only-befund (Lauf A: "rr10 hilft") steht in spannung
   zum LLM-judge-befund (Lauf B: "rr0 gewinnt"). Reines recall/MRR zeigt rerank-
   nutzen, aber die judge-bewertete antwort-qualität nicht. Beide läufe nutzen
   andere k/rr-fächer (A: k3/5/8 × rr0/10/20/40 @ n=10; B: k2/3/5 × rr0/3/5/10
   @ n=30), sind also nicht 1:1 vergleichbar.

5. **TTFT steigt monoton mit pool-tiefe** (rerank-kosten): Lauf A, k=3 — rr0 667 ms
   → rr10 792 ms → rr20 963 ms → rr40 1216 ms; die rerank-phase selbst wächst
   0.0 → 211.9 → 330.4 → 628.1 ms (mean). Quelle: Tabelle 1.

6. **k=3 ist der lande-default**: report-empfehlung "`QAService.DEFAULT_TOP_K`
   ~~8~~ → 3 — gelandet", begründung "k=3 maxt qualität auf allen 3 modellen,
   kleinerer prompt = schneller TTFT". Quelle: `3-model-comparison-2026-05-20.md`
   (Production Recommendations, Z.73).

7. **Rerank bleibt produktions-default opt-in**: empfehlung "bleibt opt-in
   (cpuOptimized schaltet aus) — data ist ambivalent ; produktion-fusion-pool ist
   noisiger , dort hilft rerank wahrscheinlich". Quelle: ebd. Z.76.

## Caveats / Limitationen

- **Kleine stichprobe**: Lauf A n=10/config, Lauf B n=30/config (nicht alle 260
  fragen). Report: "n=30 Fragen pro config. Margins (~0.01-0.03) liegen knapp über
  statistischem rauschen. Vor finalen entscheidungen bei knappen rangfolgen mit
  n=100 wiederholen." Quelle: `3-model-comparison-2026-05-20.md` (Caveats Z.81).

- **Eval umgeht die produktions-RAG-pipeline**. Skipped lt. report: "BM25+dense
  fusion , multi-query expansion , heuristics (title boost / short chunk penalty /
  recency) , doc diversification , whole-doc fallback , neighbour expansion ,
  database I/O , worker IPC." Dieser report misst isoliertes embedder + reranker +
  LLM auf vorgefertigten chunks. Genau hier kommt der rerank-befund her: der
  cosine-pool ist sauber vor-sortiert, deshalb hilft rerank kaum/inkonsistent;
  der noisigere produktions-fusion-pool ist nicht gemessen.
  Quelle: `3-model-comparison-2026-05-20.md` (Caveats Z.82-83).

- **Reranker nicht auf CPU getestet**. Report: "Auf zielhardware mit GPU ist rerank
  ~80-160 ms ; auf CPU würde es 1-2 s kosten und die qualität noch weniger
  rechtfertigen. CPU-only end-user-pfad sollte rerank=off lassen."
  Quelle: `3-model-comparison-2026-05-20.md` (Caveats Z.85). Konsistent mit den
  rerank-mean-zeiten 47-159 ms (Lauf B) bzw. 156-628 ms (Lauf A, tiefere pools).

- **Mehrheitlich-DE datensatz**, judge ist Nemotron 3 Nano 30B-A3B. Report
  vermerkt, DE-nuancen seien evtl. nicht trennscharf bewertbar.
  Quelle: `3-model-comparison-2026-05-20.md` (Caveats Z.84).

- **Beide läufe sind `dirty`** (uncommitted working tree): Lauf A git
  `9498853` (branch `feat/settings-ollama-connector`, dirty), Lauf B git
  `45bf322` (selber branch, dirty). Quelle: beide `summary.md` (Z.4) / `env.json`.

- **Free-VRAM-werte unterscheiden sich zwischen den läufen** (Lauf A ~21.3-21.6 GB,
  Lauf B ~19.2-25.2 GB) — gemessen während laufender judge/LLM-belegung, nicht
  als reiner retrieval-footprint interpretierbar. Quelle: Tabellen 1, 2.

- **judge-spalte in Lauf A ist leer** (`-`, `llmEnabled` aus). Der composite in
  Lauf A ist deshalb NICHT mit dem von Lauf B vergleichbar (A: ~0.19-0.51 ohne
  judge-term; B: ~2.0-2.24 mit `2·judge`). Quelle: Lauf A `summary.md` (judge `-`)
  / `ranking.md`.

## Quell-Läufe (komplett)

- Lauf A (retrieval-only, n=10): `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/`
  (`summary.md`, `ranking.md`, `summary.json`, `dataset.json`, `env.json`,
  `configs/<name>/result.json`).
- Lauf B (Qwen3-8B + judge, n=30): `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/`
  (`summary.md`, `ranking.md`, `summary.json`, `dataset.json`, `env.json`,
  `configs/<name>/result.json`).
- Synthese-report: `tests/evals/report/3-model-comparison-2026-05-20.md`
  (retrieval/rerank/latenz-teile: Setup, Cross-Model Cell Comparison, Composite
  Ranking, Per-Phase Latency, Findings #6, Production Recommendations, Caveats).
- Schwester-läufe (nur in Tabellen 3a-3c zitiert, nicht selbst gelesen):
  Granite-3.3-8B `tests/evals/report/runs/2026-05-20T20-49-53_45bf322_dirty/`;
  Mistral-Nemo-12B `tests/evals/report/runs/2026-05-20T21-04-46_45bf322_dirty/`.
