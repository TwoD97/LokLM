# Evidence — Adaptive-TopK

Domain: `adaptive-topk`. Every number below is copied verbatim from a LokLM
eval artifact; the source file is named for each table/figure. No values are
inferred or recomputed — where a report prints a rounded value and the JSON
prints full precision, both are shown and labelled.

## What was tested

The eval measures whether the `classifyQueryBreadth` heuristic in
`src/main/services/qa/QAService.ts` — which maps query intent to retrieval
depth (`focused → topK=3`, `broad → topK=8`, `summary → topK=12`) — actually
surfaces more of the relevant chunks on a broad/summary-heavy dataset than the
previous fixed `topK=3`.

Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (intro paragraph).

## Methodik

- **Metrik**: `recall_req@K = mean_q( |required(q) ∩ retrieved_top-K(q)| / |required(q)| )`
  — Multi-Relevant-Recall. Reduziert sich auf klassisches `recall@K` wenn
  `|required| = 1`.
  Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup, "Metrik").
- **Multi-Relevant-Ground-Truth**: pro Frage ein `requiredChunkIds`-Set, das
  alle für eine vollständige Antwort nötigen Chunks nennt; hand-kuratiert.
  Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup).
- 3 Konfigurationen, identisch außer `topKToLLM`: `adaptive_k3_rr20` (Baseline,
  heutiges Default), `adaptive_k8_rr20` (broad-target), `adaptive_k12_rr20`
  (summary-target). `topKToRerank = 20` für alle drei.
  Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup, "Konfigurationen").
- Embedder: BGE-M3 CPU. Reranker: bge-reranker-v2-m3 GPU.
  Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup, "Konfigurationen").
- **Ranking-Composite** (Sortierung im ranking.md): `judge*2 + recall@5 - ttft_sec*0.5`,
  höher = besser. Hinweis: `judge` ist in diesem Lauf leer (`llmEnabled:false`,
  `judgeAvg:null`), der Composite reduziert sich also faktisch auf
  `recall@5 - ttft_sec*0.5`.
  Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/ranking.md`
  (Kopfzeile) + `.../summary.json` (`llmEnabled`, `judgeAvg`).

## Datensatz / Provenienz

| Feld         | Wert                                                 | Quelle                                    |
| ------------ | ---------------------------------------------------- | ----------------------------------------- |
| generator    | `manual-handcrafted:adaptive-topk-eval`              | dataset JSON header (Z.2) / dataset.json  |
| generatedAt  | `2026-05-21T18:46:35.814Z`                           | dataset JSON header (Z.3) / dataset.json  |
| chunker      | `fixed-512-64`                                       | dataset JSON header (Z.4)                 |
| numQuestions | 25                                                   | run dataset.json / summary.json `dataset` |
| numChunks    | 109                                                  | run dataset.json / summary.json `dataset` |
| sha256       | `7309d51bec624f6d`                                   | run dataset.json / summary.json `dataset` |
| library      | null                                                 | run dataset.json                          |
| dataset-file | `handcrafted-adaptive-topk-2026-05-21T18-46-35.json` | report md (Run-Dir-Zeile)                 |

Source: `tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json`
(header, Zeilen 1-4); `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/dataset.json`;
`.../summary.json` (`dataset` block).

### Korpus + Fragen-Verteilung

- **Korpus**: 5 Sample-Dokumente, 109 Chunks gesamt (fixed-512-64).
  - 2 neu für diesen Eval: `chunking-strategien.txt` (29 Chunks, ~1600 Wörter)
    und `llm-inferenz-optimierung.txt` (27 Chunks, ~1590 Wörter).
  - 3 existierende Docs (eval-metriken, loklm-architektur, rag-grundlagen)
    bleiben als Distraktoren im Korpus.
- **Fragen**: 25 hand-kuratierte Fragen über die 2 neuen Docs. Intent-Verteilung:
  - **6 focused** — Single-Chunk-Faktoide (Kontroll-Gruppe).
  - **13 broad** — Listen/Vergleiche.
  - **6 summary** — Whole-Doc-Zusammenfassungen.

Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup, "Korpus" + "Fragen").

## Lauf-Umgebung

| Feld               | Wert                                                         | Quelle                |
| ------------------ | ------------------------------------------------------------ | --------------------- |
| startedAt          | `2026-05-21T18:47:06.005Z`                                   | env.json              |
| git shortSha       | `2208911`                                                    | env.json / summary.md |
| git branch         | `feat/settings-ollama-connector`                             | env.json / summary.md |
| git dirty          | true                                                         | env.json / summary.md |
| platform / release | win32 / 10.0.26200                                           | env.json              |
| CPU                | Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz × 16                | env.json / summary.md |
| totalRamGB         | 31.9                                                         | env.json / summary.md |
| node               | v22.15.1                                                     | env.json              |
| envFlags           | `OLLAMA_HOST=0.0.0.0:11434`                                  | env.json              |
| Run-Dir            | `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/` | summary.md            |

Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/env.json`;
`.../summary.md` (Kopf).

## ERGEBNIS-TABELLEN

### Tabelle 1 — Headline (exakt aus Report md)

| Config            |   n |   r@5 | r_req@5 |  r_req@12 |
| ----------------- | --: | ----: | ------: | --------: |
| adaptive_k3_rr20  |  25 | 0.480 |   0.427 |     0.427 |
| adaptive_k8_rr20  |  25 | 0.520 |   0.507 |     0.527 |
| adaptive_k12_rr20 |  25 | 0.520 |   0.507 | **0.592** |

Aggregierter Befund (Report-Wortlaut): "Bump von topK=3 → topK=12 hebt
Multi-Relevant-Coverage von 0.427 auf 0.592 (+39%)."

Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (## Headline).

### Tabelle 2 — Per-Intent-Breakdown (das eigentliche Signal, exakt aus Report md)

| Intent  |   n | k=3 r_req@12 | k=8 r_req@12 | k=12 r_req@12 | Δ (k=3→k=12) |
| ------- | --: | -----------: | -----------: | ------------: | -----------: |
| focused |   6 |        0.500 |        0.667 |         0.667 |         +33% |
| broad   |  13 |        0.481 |        0.558 |         0.615 |         +28% |
| summary |   6 |        0.236 |        0.319 |     **0.468** |     **+98%** |

Source: `tests/evals/report/adaptive-topk-2026-05-21.md` (## Per-Intent-Breakdown).

### Tabelle 3 — Quality + TTFT (exakt aus summary.md)

| Config            |   n |   r@5 |  r@10 | r_req@5 | r_req@12 |   MRR | judge | TTFT p50 | TTFT p95 | FullResp p50 |  qEmb | retr | rerank | prefill | rss-max MiB | cpu% | free VRAM min GB | composite |
| ----------------- | --: | ----: | ----: | ------: | -------: | ----: | ----: | -------: | -------: | -----------: | ----: | ---: | -----: | ------: | ----------: | ---: | ---------------: | --------: |
| adaptive_k3_rr20  |  25 | 0.480 | 0.480 |   0.427 |    0.427 | 0.380 |     - |        - |        - |            - | 406.5 |  0.7 |  342.0 |       0 |        1625 |  100 |                - |     0.114 |
| adaptive_k8_rr20  |  25 | 0.520 | 0.520 |   0.507 |    0.527 | 0.388 |     - |        - |        - |            - | 408.0 |  0.5 |  323.8 |       0 |        1352 |   95 |                - |     0.156 |
| adaptive_k12_rr20 |  25 | 0.520 | 0.600 |   0.507 |    0.592 | 0.400 |     - |        - |        - |            - | 405.0 |  0.5 |  323.4 |       0 |        1479 |   96 |                - |     0.159 |

Note: `judge`, TTFT and FullResp columns are `-` because the LLM/judge pass did
not run (`llmEnabled:false`). qEmb/retr/rerank are phase means in ms.

Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.md`
(## Quality + TTFT).

### Tabelle 4 — Ranking by composite (exakt aus ranking.md)

| Rang | Config            | Composite | recall@5 | judge | TTFT p50 (ms) | FullResp p50 (ms) |
| ---: | ----------------- | --------: | -------: | ----: | ------------: | ----------------: |
|    1 | adaptive_k12_rr20 |     0.159 |    0.520 |     - |             - |                 - |
|    2 | adaptive_k8_rr20  |     0.156 |    0.520 |     - |             - |                 - |
|    3 | adaptive_k3_rr20  |     0.114 |    0.480 |     - |             - |                 - |

Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/ranking.md`.

### Tabelle 5 — Full-precision per-config metrics (exakt aus summary.json)

Diese Werte sind die ungerundeten Quellen hinter Tabellen 1, 3 und 4.

| Config            | numQueries | recall@1 | recall@5 | recall@10 |             r_req@5 |            r_req@10 |            r_req@12 |                 MRR |             nDCG@10 |           composite | llmEnabled | judgeAvg |
| ----------------- | ---------: | -------: | -------: | --------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ---------- | -------- |
| adaptive_k3_rr20  |         25 |     0.28 |     0.48 |      0.48 | 0.42666666666666664 | 0.42666666666666664 | 0.42666666666666664 |                0.38 | 0.40618595071429153 | 0.11394560000003545 | false      | null     |
| adaptive_k8_rr20  |         25 |     0.28 |     0.52 |      0.52 |  0.5066666666666666 |  0.5266666666666666 |  0.5266666666666666 | 0.38799999999999996 |  0.4216600630036732 | 0.15636754999999541 | false      | null     |
| adaptive_k12_rr20 |         25 |     0.28 |     0.52 |       0.6 |  0.5066666666666666 |                0.56 |  0.5923809523809525 | 0.39977777777777773 |  0.4452638558829479 |   0.158799399999989 | false      | null     |

Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json`
(`results[]`).

### Tabelle 6 — Phase-Timings + Ressourcen (exakt aus summary.json, ms / MiB)

| Config            |         qEmbed p50 |        qEmbed p95 |        qEmbed mean |        retrieve p50 |       retrieve mean |         rerank p50 |         rerank p95 |        rerank mean |          ttft p50 |           ttft p95 | rssMiBMax | rssMiBMean | cpuLoadMean | freeVramGBMin |               buildMs |
| ----------------- | -----------------: | ----------------: | -----------------: | ------------------: | ------------------: | -----------------: | -----------------: | -----------------: | ----------------: | -----------------: | --------: | ---------: | ----------: | ------------: | --------------------: |
| adaptive_k3_rr20  |  392.8892999999807 | 681.3841999999713 | 406.48267999999456 |  0.5587999999988824 |  0.6578800000017508 | 328.37960000004387 | 435.78229999996256 |   342.000783999993 |  732.108799999929 | 1026.5270000000019 |      1625 |       1043 |       0.997 |          null |           271597.5674 |
| adaptive_k8_rr20  | 406.06930000003194 | 673.1146999999764 | 407.99056400000586 | 0.46740000002318993 |  0.4969319999963045 | 323.51149999996414 |   333.070699999982 | 323.75883599999594 | 727.2649000000092 | 1005.4194000000134 |      1352 |       1299 |       0.953 |          null |  0.004100000020116568 |
| adaptive_k12_rr20 |  401.2017999999807 | 689.6375999999582 |  405.0309319999977 | 0.45929999998770654 | 0.48687200000276787 |  323.1190999999526 |  337.6195000000298 | 323.39230399999536 | 722.4012000000221 |  1018.731599999941 |      1479 |       1329 |       0.963 |          null | 0.0027000000118277967 |

Note: `freeVramGBMin = null` (kein VRAM-Sampling in diesem Lauf). `promptAssemble`,
`prefill`, `firstDecode`, `fullResponse`-Phasen sind durchgehend 0 (LLM-Pass
deaktiviert). TTFT-Werte existieren trotz `llmEnabled:false` als Mess-Stubs;
die Headline/summary.md zeigen sie als `-`.

Source: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json`
(`results[].phased`, `results[].resourcePeak`, `results[].buildMs`).

## Kern-Befunde

1. **Summary-Coverage verdoppelt sich nahezu**: von topK=3 (0.236) auf topK=12
   (0.468), Δ +98%. Bei nur 3 Chunks sieht das Modell im Schnitt nicht mal ein
   Viertel der required Chunks (24%); bei 12 Chunks knapp die Hälfte (47%).
   Source: report md (## Per-Intent-Breakdown + ### Interpretation + ## Fazit).
2. **Broad gewinnt klar im Bereich k=8 → k=12** (+10%); Sweetspot für
   Vergleichs-/Listen-Fragen bei k=8 oder höher (0.481 → 0.558 → 0.615).
   Source: report md (### Interpretation).
3. **Focused plateaut bei k=8** (0.500 → 0.667 → 0.667): k=12 schadet nicht,
   bringt aber nichts — gewünschte Form, extra-Chunks landen dort, wo sie wirken.
   Source: report md (### Interpretation).
4. **Aggregat**: r_req von 0.427 (k3) auf 0.592 (k12), +39%.
   Source: report md (## Headline).
5. **Ranking**: adaptive_k12_rr20 führt mit composite 0.159, vor k8 (0.156) und
   k3 (0.114).
   Source: ranking.md / summary.json.

## Caveats / Limitationen

- **Coverage ≠ Antwort-Qualität.** Diese Eval misst nur Retrieval-Recall. Der
  Judge-Pass (Nemotron 30B-A3B XL) sollte parallel laufen, scheiterte aber an
  VRAM: 32 GB total auf RTX 5090, aber nur ~19 GB frei zur Laufzeit; Nemotron Q4
  - KV-Cache braucht ~20-22 GB. Die 75 generierten Antworten liegen unter
    `2026-05-21T18-55-39_2208911_dirty/configs/*/per-question.jsonl` und können
    nach VRAM-Freigabe nachträglich gejudged werden.
    Source: report md (## Fazit, Anschluss-Frage 1) — bestätigt durch
    `llmEnabled:false`/`judgeAvg:null` in summary.json.
- **Ceiling auf summary.** Auch bei topK=12 nur ~47% der required Chunks für
  summary-Anfragen; obere Grenze reiner Top-K-Skalierung. Weiter nur via
  Map-Reduce.
  Source: report md (## Fazit, Anschluss-Frage 2).
- **FOCUSED_TOP_K=3 evtl. zu konservativ.** focused-Gewinn k=3 → k=8 (+33%) ist
  überraschend (vermutlich landen einige focused-Faktoide bei Rerank-Rang 4-7
  statt 1-3); eine breitere Default-Baseline (k=5) könnte allen drei Intents
  helfen. Eigene focused-Eval nötig zur Bestätigung.
  Source: report md (### Interpretation, letzter Punkt + ## Fazit, Anschluss-Frage 3).
- **Lauf ist `dirty`** (uncommitted working tree, git 2208911,
  branch feat/settings-ollama-connector) und auf CPU-Embedder gemessen.
  Source: env.json / summary.md.
- **Kleine n pro Intent** (focused 6, broad 13, summary 6) — die +98% auf
  summary beruhen auf 6 Fragen.
  Source: report md (Setup, "Fragen").
- **VRAM nicht gesampelt** in diesem Lauf (`freeVramGBMin = null` für alle
  Configs).
  Source: summary.json (`resourcePeak.freeVramGBMin`).

## Verwendete Quell-Dateien (alle workspace-relativ)

- `tests/evals/report/adaptive-topk-2026-05-21.md` (narrativer Report: Headline
  - Per-Intent-Breakdown + Interpretation + Fazit)
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.md`
  (Quality + TTFT Tabelle)
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json`
  (full-precision Metriken + Phasen + Ressourcen)
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/ranking.md`
  (composite-Ranking)
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/dataset.json`
  (Dataset-Provenienz)
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/env.json`
  (Lauf-Umgebung)
- `tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json`
  (nur Header, Zeilen 1-4: generator/generatedAt/chunker)

per-question.jsonl-Dateien wurden bewusst NICHT gelesen (zu groß).
