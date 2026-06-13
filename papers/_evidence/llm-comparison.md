# Evidence: LLM Comparison (lokale Antwortgenerierung)

Domain: `llm-comparison`. Fokus: Auswahl des lokalen LLM für die RAG-Antwortgenerierung in LokLM.
Zwei unabhängige Eval-Läufe: (A) ein kuratierter 3-Modell-Vergleich mit Config-Grid und (B) ein
breiter 15-Modell-Answer-Sweep. Alle Zahlen sind wörtlich aus den Quelldateien übernommen; jede
Tabelle nennt ihre Quelle.

Quelldateien (read):

- `tests/evals/report/3-model-comparison-2026-05-20.md`
- `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/ranking.md`
- `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/summary.md`
- `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/summary.json`
- `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/env.json`
- `tests/evals/answer/model-pack.json`
- `tests/evals/answer/run-pack.ts` (nur Methodik-Kommentare oben)

---

## A. Kuratierter 3-Modell-Vergleich: Qwen3-8B vs Granite-3.3-8B vs Mistral-Nemo-12B

Quelle gesamter Abschnitt A: `tests/evals/report/3-model-comparison-2026-05-20.md`

### A.1 Methodik / Setup

- Lauf-Datum: 2026-05-20.
- Hardware: Intel Core i9-9900K CPU @ 3.60GHz + RTX 5090 (32 GB VRAM).
- Dataset: `tests/evals/data/datasets/agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json`,
  Dataset-Hash `43207410dc46debe`, 260 Fragen, 52 Chunks.
- Pro Modell: top-3 Configs, je 30 Fragen.
- Judge: Nemotron 3 Nano 30B-A3B, deterministisch fest gepinnt, in pass-2 geladen.
- Composite-Formel: `Composite = 2·judge + recall@5 − 0.5·TTFT_sec`. Höher = besser.
- Quantisierung aller Modelle: Q4_K_M.
- Embedder bge-m3 läuft auf CPU (spiegelt prod-default); Reranker bge-reranker-v2-m3 GPU (auto).

Setup-Tabelle (Quelle: 3-model-comparison-2026-05-20.md):

| Slot          | Modell                           | Backend                    | Footprint (Q4_K_M)         |
| ------------- | -------------------------------- | -------------------------- | -------------------------- |
| Under-test #1 | Qwen3-8B Instruct                | GPU (CUDA)                 | ~5 GB VRAM + ~6 GB RSS     |
| Under-test #2 | IBM Granite 3.3-8B Instruct      | GPU (CUDA)                 | ~5 GB VRAM + ~5.7 GB RSS   |
| Under-test #3 | Mistral-Nemo-Instruct-2407 (12B) | GPU (CUDA)                 | ~7.5 GB VRAM + ~8.2 GB RSS |
| Embedder      | bge-m3                           | CPU (mirrors prod default) | ~440 MB                    |
| Reranker      | bge-reranker-v2-m3               | GPU (auto)                 | ~440 MB VRAM               |
| Judge         | Nemotron 3 Nano 30B-A3B          | GPU (CUDA), pass-2 only    | ~18 GB VRAM                |

### A.2 Cross-Model Cell Comparison (judge-score / TTFT p50 ms)

Drei Configs × drei Modelle, gleicher Judge. Quelle: 3-model-comparison-2026-05-20.md.

| Config      | Qwen3-8B       | Granite-3.3-8B | Mistral-Nemo-12B |
| ----------- | -------------- | -------------- | ---------------- |
| grid_k3_rr0 | 0.923 / 606 ms | 0.909 / 635 ms | 0.916 / 632 ms   |
| grid_k5_rr0 | 0.923 / 640 ms | 0.913 / 693 ms | 0.912 / 674 ms   |
| grid_k2_rr5 | 0.922 / 648 ms | 0.911 / 634 ms | 0.889 / 657 ms   |

### A.3 Composite Score Ranking (alle Zellen kombiniert)

Quelle: 3-model-comparison-2026-05-20.md. Composite = 2·judge + recall@5 − 0.5·TTFT_sec.

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

### A.4 Per-Phase Latency (Mean ms)

Quelle: 3-model-comparison-2026-05-20.md.

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

### A.5 Kern-Befunde (wörtlich aus Report)

1. Qwen3-8B gewinnt über alle drei Configs. Judge-Margin über Granite: 0.010–0.014; über
   Mistral-Nemo: 0.007–0.033. Klein aber konsistent.
2. Größeres Modell ist nicht besser. Mistral-Nemo-12B ist 50 % größer als Qwen3-8B, liegt aber
   unter dem 8B-Incumbent; insbesondere k=2_rr5 bricht bei Mistral-Nemo auf 0.889 ein (vs Qwen 0.922).
3. Granite ist robuster: drei Configs in 0.005-Bandbreite (0.909 / 0.913 / 0.911).
4. TTFT-Spannen klein auf GPU: 606–693 ms quer durch alle Modelle + Configs.
5. RAM-Footprint sortiert wie Modellgröße: Granite 5.7 GB → Qwen 6.0 GB → Mistral-Nemo 8.2 GB.
   Mistral-Nemo ist der einzige, der auf 16 GB end-user RAM kritisch wird.
6. Reranker hilft inkonsistent: bei k=2 hilft rr=5 messbar (sonst recall-collapse), bei k=3+
   eher schädlich. Vermutlich Artefakt vom sauber-vorsortierten cosine-pool (Produktion hat
   BM25+dense fusion, noisiger).

### A.6 Production Recommendations (wörtlich aus Report)

| Setting                           | Aktuell                | Empfehlung                                | Begründung                                                                   |
| --------------------------------- | ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `QAService.DEFAULT_TOP_K`         | 8 → 3                  | gelandet                                  | k=3 maxt Qualität auf allen 3 Modellen, kleinerer Prompt = schneller TTFT    |
| Default LLM                       | auto-picks XL on 32 GB | bleibt Qwen3-8B (full)                    | XL bringt keine Qualitäts-Rendite, kostet 18 GB load + ~60 s production TTFT |
| `recommendedProfile()`            | XL für ≥32 GB RAM      | full standardmäßig, XL nur opt-in         | sweep zeigt 8B genügt für Corpus-Größe                                       |
| Rerank default                    | opt-in via UI          | bleibt opt-in (cpuOptimized schaltet aus) | Daten ambivalent; Produktion-Fusion-Pool noisiger                            |
| Mistral-Nemo / Granite als bundle | —                      | nicht hinzufügen                          | beide unter Qwen3-8B, kein Nutzen wert ~5 GB extra download                  |

### A.7 Caveats / Limitationen (Abschnitt A)

- n=30 Fragen pro Config. Margins (~0.01–0.03) liegen knapp über statistischem Rauschen; vor
  finalen Entscheidungen bei knappen Rangfolgen mit n=100 wiederholen.
- Eval umgeht die Produktions-RAG-Pipeline. Skipped: BM25+dense fusion, multi-query expansion,
  Heuristiken (title boost / short chunk penalty / recency), doc diversification, whole-doc
  fallback, neighbour expansion, DB I/O, worker IPC. Misst isoliert embedder + reranker + LLM auf
  vorgefertigten Chunks. Produktion-TTFT von ~60 s muss separat debugged werden (höchstwahrscheinlich
  auto-pick XL + cold-load + multi-query).
- Mehrheitlich-DE Dataset. Mistral-Nemos angeblich bessere DE-Stärke zeigt sich hier nicht —
  evtl. weil Nemotron als Judge DE-Nuancen nicht trennscharf bewertet, oder Dataset zu klein.
- Reranker nicht auf CPU getestet. Auf GPU rerank ~80–160 ms; auf CPU 1–2 s. CPU-only
  end-user-Pfad sollte rerank=off lassen.

### A.8 Source Runs (für Abschnitt A)

- Qwen3-8B (Q4_K_M, 5.0 GB) → `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/`
- Granite-3.3-8B (Q4_K_M, 4.9 GB) → `tests/evals/report/runs/2026-05-20T20-49-53_45bf322_dirty/`
- Mistral-Nemo-12B (Q4_K_M, 7.5 GB) → `tests/evals/report/runs/2026-05-20T21-04-46_45bf322_dirty/`

---

## B. Breiter 15-Modell-Answer-Sweep

Run-Dir: `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/`

### B.1 Methodik / Konfiguration

- Pack: `tests/evals/answer/model-pack.json` (Pack-Name `loklm-rag-eval-15`; Summary nennt Run-Tag
  `loklm-rag-eval-10`). Quelle: model-pack.json + summary.md.
- Modelle im Pack: 15, erfolgreich: 15, skipped: 15, failed: 0. Quelle: summary.md / summary.json.
- Dataset: `tests/evals/data/datasets/xquad-de-300q-2026-05-24T17-05-53.json` (XQuAD-DE). Quelle: summary.md.
- n = 25 Queries pro Modell (`numQueries: 25`). Quelle: summary.json.
- Composite-Formel: `Composite = judge*2 + recall@5 − ttft_sec*0.5`. Höher = besser. Quelle: ranking.md.
- Quantisierung: Q4_K_M, contextSize 8192 (ctx-cap, nicht native Grenze; Phi-4 ist real 16k), alle
  language `de`. Quelle: model-pack.json.
- Lauf-Metadaten (env.json): gestartet 2026-05-24T16:53:18Z; git `c7ef2e3`, branch
  `feat/tier-infrastructure`, dirty; Hardware win32 10.0.26200, x64, i9-9900K, 16 CPUs, 31.9 GB RAM;
  Node v22.15.1; `OLLAMA_HOST=0.0.0.0:11434`.
  (Hinweis: Run-Dir-Name trägt SHA `961e6d4`, env.json trägt `c7ef2e3` — siehe Caveats.)

Subprocess-per-Model-Isolation (Quelle: Methodik-Kommentare oben in `tests/evals/answer/run-pack.ts`):

- Nicht der in-process Pack-Modus von sweep.ts, weil erste in-process Pack-Runs nach Modell 4–5 mit
  ACCESS_VIOLATION (Windows `0xC0000005`) crashten. node-llama-cpp leakt offenbar State über
  load/unload-Zyklen (CUDA-Context, listener-registry o. ä.).
- Saubere Isolation per Kindprozess kostet 10× corpus-embed (~5 min/Modell auf CPU), ist aber
  crash-resistent: ein Modell killt nicht den gesamten ~3h-Lauf.
- Workflow: parent legt EINEN run-dir an + schreibt env.json/dataset.json; pro Modell wird ein
  temp single-model-pack.json geschrieben und `tsx tests/evals/sweep.ts --configs answer
--llm-models <temp> --run-dir <shared> --skip-summary --judge ...` gespawnt; jeder Kindprozess
  macht eigenen pass-1 + judge-pass und schreibt `configs/answer@<label>/result.json`. Resume-fähig:
  Modell mit existierendem result.json wird übersprungen. Am Ende werden alle result.json zu
  kombinierter summary.md + ranking.md eingesammelt.

### B.2 Modell-Liste (Pack-Reihenfolge = Lade-Reihenfolge)

Quelle: model-pack.json. Alle Q4_K_M, contextSize 8192, language `de`.

|   # | Label             | GGUF-Pfad (repo-relativ zu models/)       |
| --: | ----------------- | ----------------------------------------- |
|   1 | qwen3-4b-instruct | Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf   |
|   2 | llama-3.2-3b      | Llama-3.2-3B-Instruct-Q4_K_M.gguf         |
|   3 | phi-4-mini        | microsoft_Phi-4-mini-instruct-Q4_K_M.gguf |
|   4 | gemma-3-4b        | gemma-3-4b-it-Q4_K_M.gguf                 |
|   5 | smollm3-3b        | HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf      |
|   6 | qwen3-14b         | Qwen_Qwen3-14B-Q4_K_M.gguf                |
|   7 | phi-4-14b         | phi-4-Q4_K_M.gguf                         |
|   8 | granite-3.3-8b    | granite-3.3-8b-instruct-Q4_K_M.gguf       |
|   9 | mistral-nemo-12b  | Mistral-Nemo-Instruct-2407-Q4_K_M.gguf    |
|  10 | hermes-3-8b       | Hermes-3-Llama-3.1-8B.Q4_K_M.gguf         |
|  11 | qwen3-8b          | Qwen_Qwen3-8B-Q4_K_M.gguf                 |
|  12 | qwen3.5-2b        | Qwen3.5-2B-Q4_K_M.gguf                    |
|  13 | qwen3.5-4b        | Qwen3.5-4B-Q4_K_M.gguf                    |
|  14 | qwen3.5-9b        | Qwen3.5-9B-Q4_K_M.gguf                    |
|  15 | qwen3.5-27b       | Qwen3.5-27B-Q4_K_M.gguf                   |

### B.3 Ranking (composite, höher = besser)

Quelle: ranking.md / summary.md (identische Tabelle). n=25 je Modell. recall@5 ist konstant 0.520
über alle Modelle (retrieval-Pipeline ist modell-unabhängig).

| Rang | Modell                   | Composite | judge | recall@5 | TTFT p50 (ms) | FullResp p50 (ms) |   n |
| ---: | ------------------------ | --------: | ----: | -------: | ------------: | ----------------: | --: |
|    1 | answer@qwen3.5-4b        |     1.798 | 0.869 |    0.520 |           922 |              3254 |  25 |
|    2 | answer@qwen3-4b-instruct |     1.732 | 0.819 |    0.520 |           850 |              2698 |  25 |
|    3 | answer@qwen3.5-2b        |     1.724 | 0.809 |    0.520 |           829 |              1996 |  25 |
|    4 | answer@qwen3-8b          |     1.667 | 0.785 |    0.520 |           848 |              2318 |  25 |
|    5 | answer@qwen3.5-9b        |     1.657 | 0.819 |    0.520 |          1000 |              6194 |  25 |
|    6 | answer@phi-4-14b         |     1.632 | 0.781 |    0.520 |           902 |              2499 |  25 |
|    7 | answer@granite-3.3-8b    |     1.630 | 0.787 |    0.520 |           926 |              2580 |  25 |
|    8 | answer@phi-4-mini        |     1.620 | 0.776 |    0.520 |           904 |              1533 |  25 |
|    9 | answer@gemma-3-4b        |     1.598 | 0.771 |    0.520 |           927 |              2315 |  25 |
|   10 | answer@qwen3-14b         |     1.596 | 0.784 |    0.520 |           984 |              2831 |  25 |
|   11 | answer@mistral-nemo-12b  |     1.569 | 0.760 |    0.520 |           943 |              1504 |  25 |
|   12 | answer@hermes-3-8b       |     1.538 | 0.732 |    0.520 |           893 |              1378 |  25 |
|   13 | answer@smollm3-3b        |     1.521 | 0.732 |    0.520 |           925 |              2199 |  25 |
|   14 | answer@qwen3.5-27b       |     1.501 | 0.831 |    0.520 |          1361 |             11673 |  25 |
|   15 | answer@llama-3.2-3b      |     1.243 | 0.579 |    0.520 |           868 |              1243 |  25 |

### B.4 Judge-Subscores + Ressourcen (per Modell)

Quelle: summary.json (`judgeAvg` + `resourcePeak`). composite wörtlich (volle Präzision).
score = aggregierter Judge-Score; corr/ground/help = correctness/groundedness/helpfulness;
parsedFraction war für alle Modelle 1.0. recall@1=0.28, recall@5=recall@10=0.52, MRR=0.388,
nDCG@10=0.42166 — konstant über alle 15 Modelle.

| Modell            | judge score |  corr | ground |  help | RSS max (MiB) | RSS mean (MiB) | freeVRAM min (GB) | composite (full) |
| ----------------- | ----------: | ----: | -----: | ----: | ------------: | -------------: | ----------------: | ---------------: |
| qwen3.5-4b        |      0.8693 | 0.736 |  1.000 | 0.872 |          5387 |           4461 |             26.95 |         1.797627 |
| qwen3-4b-instruct |      0.8187 | 0.676 |  0.960 | 0.820 |          4505 |           3906 |             26.98 |         1.732134 |
| qwen3.5-2b        |      0.8093 | 0.660 |  0.956 | 0.812 |          3629 |           2917 |             28.38 |         1.724332 |
| qwen3-8b          |      0.7853 | 0.636 |  0.940 | 0.780 |          6767 |           6165 |             24.95 |         1.666879 |
| qwen3.5-9b        |      0.8187 | 0.684 |  0.952 | 0.820 |          7769 |           7077 |             24.71 |         1.657401 |
| phi-4-14b         |      0.7813 | 0.612 |  0.960 | 0.772 |         10345 |           9801 |             21.34 |         1.631758 |
| granite-3.3-8b    |      0.7867 | 0.648 |  0.940 | 0.772 |          6596 |           6064 |             24.81 |         1.630334 |
| phi-4-mini        |      0.7760 | 0.644 |  0.944 | 0.740 |          4713 |           4081 |             26.94 |         1.619853 |
| gemma-3-4b        |      0.7707 | 0.636 |  0.916 | 0.760 |          4935 |           4155 |             27.17 |         1.598007 |
| qwen3-14b         |      0.7840 | 0.632 |  0.940 | 0.780 |         10600 |          10008 |             21.27 |         1.595882 |
| mistral-nemo-12b  |      0.7600 | 0.608 |  0.932 | 0.740 |          9119 |           8516 |             22.64 |         1.568742 |
| hermes-3-8b       |      0.7320 | 0.568 |  0.916 | 0.712 |          6658 |           6039 |             25.10 |         1.537590 |
| smollm3-3b        |      0.7320 | 0.596 |  0.848 | 0.752 |          3839 |           3264 |             27.86 |         1.521490 |
| qwen3.5-27b       |      0.8307 | 0.700 |  0.952 | 0.840 |         15375 |          12431 |             14.21 |         1.500645 |
| llama-3.2-3b      |      0.5787 | 0.472 |  0.688 | 0.576 |          4122 |           3471 |             27.60 |         1.243399 |

### B.5 Kern-Befunde (Abschnitt B)

- Gewinner ist `qwen3.5-4b` (Composite 1.798, höchster judge 0.869), nicht das größte Modell.
- Die Qwen3.5-Reihe dominiert die Spitze: 4b > 2b > 9b nach Composite, alle vor qwen3-8b.
- Die zwei größten Modelle landen unten: qwen3.5-27b (Rang 14) hat zwar den 2.-besten judge (0.831),
  wird aber durch TTFT p50 1361 ms und FullResp p50 11673 ms (höchste Latenz) und ~14 GB freeVRAM-min
  in der Composite-Wertung nach unten gezogen. Mistral-Nemo-12B nur Rang 11 (judge 0.760).
- llama-3.2-3b ist klares Schlusslicht (Composite 1.243, judge 0.579, groundedness 0.688 — einziges
  Modell unter 0.84 groundedness).
- Latenz-Streuung ist groß bei FullResp p50: 1243 ms (llama-3.2-3b) bis 11673 ms (qwen3.5-27b);
  TTFT p50 enger: 829–1361 ms.
- RSS-Peak korreliert mit Größe: 3629 MiB (qwen3.5-2b) bis 15375 MiB (qwen3.5-27b).

### B.6 Caveats / Limitationen (Abschnitt B)

- Konsistent mit Abschnitt A: kleines Modell schlägt großes in der Composite-Wertung; Composite ist
  latenz-gewichtet, weshalb 27B trotz hohem judge unten landet — ein rein qualitäts-orientiertes
  Ranking sähe anders aus (27b hätte dann judge-Rang 2).
- recall@5 / recall@1 / MRR / nDCG@10 sind über alle 15 Modelle identisch (retrieval ist
  modell-unabhängig in diesem Sweep) — diese Metriken trennen die Modelle nicht; nur judge + Latenz tun es.
- n=25 Queries pro Modell — kleine Stichprobe; Composite-Abstände im Mittelfeld (Rang 6–13, ~1.54–1.63)
  liegen eng beieinander.
- SHA-Diskrepanz: Run-Dir-Name `...961e6d4_dirty`, aber env.json meldet git shortSha `c7ef2e3`
  (branch `feat/tier-infrastructure`, dirty). Quelle der Diskrepanz nicht aufgelöst.
- Pack-Name-Diskrepanz: model-pack.json heißt `loklm-rag-eval-15`, summary.md nennt `loklm-rag-eval-10`.
- contextSize 8192 ist ctx-cap, nicht native Grenze (Phi-4 ist real 16k) — Modelle mit größerer
  nativer Kapazität wurden in diesem Sweep gleich beschnitten.
- Per-question.jsonl wurde absichtlich NICHT gelesen (zu groß); alle Per-Modell-Aggregate stammen aus
  summary.json/result.json-Ebene.
