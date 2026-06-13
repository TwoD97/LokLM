# Lokale Antwortgenerierung: Modellvergleich mit LLM-as-Judge

**Kurzfassung.** Dieses paper wählt das lokale LLM für die RAG-Antwortgenerierung in LokLM auf basis zweier unabhängiger eval-läufe aus: ein kuratierter 3-Modell-Vergleich (Qwen3-8B vs Granite-3.3-8B vs Mistral-Nemo-12B , top-3 configs , n=30 Fragen/config) und ein breiter 15-Modell-Answer-Sweep (n=25 Fragen/Modell). Jedes Modell wird von einem gepinnten LLM-as-Judge (Nemotron 3 Nano 30B-A3B) auf correctness , groundedness und helpfulness bewertet ; das ranking erfolgt über einen latenz-gewichteten composite-score `2·judge + recall@5 − 0.5·TTFT_sec`. Kern-befund über beide läufe: das größere Modell ist nicht das bessere — im 3-Modell-Vergleich gewinnt der 8B-incumbent Qwen3-8B (composite 2.243) über das 50 % größere Mistral-Nemo-12B , im breiten sweep gewinnt qwen3.5-4b (composite 1.798) vor allen größeren modellen , während qwen3.5-27b trotz zweitbestem judge wegen latenz auf rang 14 fällt. Die per-phase-latenz zeigt den embedder (qEmb ~500 ms CPU) als TTFT-treiber , nicht den prefill (54–190 ms GPU). Daraus folgen die produktions-defaults `QAService.DEFAULT_TOP_K = 3` und „Qwen3-8B (full) bleibt default , XL nur opt-in". Alle margins sind klein (~0.01–0.03 judge) und liegen knapp über statistischem rauschen bei n=25/30 ; die läufe umgehen bewusst die volle produktions-RAG-pipeline und messen GPU-timing , nicht den CPU-end-user-pfad.

---

## 1. Einleitung / Motivation

LokLM beantwortet fragen lokal über eine RAG-pipeline: retrieval (embedder + reranker) liefert chunks , ein lokales LLM generiert daraus die antwort. Die wahl dieses LLM ist ein produktions-default-entscheid mit harten randbedingungen — das Modell muss auf end-user-hardware laufen (download-größe , VRAM/RAM-footprint) , akzeptable antwort-qualität liefern und eine erträgliche time-to-first-token (TTFT) haben. Diese drei achsen stehen im konflikt: ein größeres Modell kann besser antworten , kostet aber mehr speicher und latenz.

Das ziel dieses papers ist , diesen entscheid empirisch zu fundieren statt auf intuition oder marketing-claims der Modell-anbieter zu stützen. Zwei fragen stehen im zentrum:

1. **Lohnt sich ein größeres Modell?** Bringt der schritt von 8B auf 12B (oder von 4B auf 27B im breiten sweep) eine qualitäts-rendite , die seinen footprint rechtfertigt?
2. **Welche config-knöpfe (k , rerank) maximieren qualität bei vertretbarer latenz?** insbesondere der retrieval-top-k , der direkt in die prompt-länge und damit in die TTFT eingeht.

Die antwort wird über einen **LLM-as-Judge** quantifiziert (abschnitt 2.3) und über einen **latenz-gewichteten composite-score** in ein ranking übersetzt. Bewusst getrennt gehalten sind dabei der under-test-LLM und der Judge-LLM , um self-bias zu vermeiden.

## 2. Aufbau & Methodik

Methodik-quelle dieses abschnitts: `papers/_evidence/methodology.md` + `papers/_evidence/llm-comparison.md`.

### 2.1 Hardware (Dev-/Mess-Box)

Beide läufe liefen auf derselben mess-box (erfasst automatisch via `tests/evals/runDir.ts` `hardwareInfo()` in `env.json`):

| Komponente | Wert                                      | Quelle                                  |
| ---------- | ----------------------------------------- | --------------------------------------- |
| CPU        | Intel(R) Core(TM) i9-9900K @ 3.60GHz × 16 | `env.json` (`cpuCount: 16`)             |
| RAM        | 31.9 GB                                   | `env.json` (`totalRamGB: 31.9`)         |
| GPU        | RTX 5090 , 32 GB VRAM                     | `3-model-comparison-2026-05-20.md` Z. 3 |
| OS / arch  | win32 , release 10.0.26200 , x64          | `env.json`                              |
| Node       | v22.15.1                                  | `env.json`                              |

Placement-konvention (spiegelt prod-default): **embedder bge-m3 auf CPU** , **reranker + LLM auf GPU**. Die GPU-läufe sind explizit ein **korrektheits-/qualitäts-check , NICHT der produktions-CPU-timing-benchmark** ; faithful-CPU-timings sind separate `evals:sweep --no-llm`-läufe.

### 2.2 Harness

Der eval-harness ist eine eigene säule neben der test-pyramide (`tests/evals/`). Evals „schlagen nicht fehl" — sie liefern zahlen und vergleichen configs miteinander. Eine `PipelineConfig` bündelt chunker + embedder + reranker + `topKToRerank` (default 20) + `topKToLLM` (default 5) + optionale LLM-bridge.

- **Chunker**: kanonischer default `fixed-512-64` (512-zeichen-fenster , 64 overlap ; `size` ist zeichen , nicht tokens). Gilt für alle drei in diesem paper verwendeten datensätze.
- **LLM-Pin auf `'full'` (Qwen3-8B) im config-default**, nie `'auto'` — sonst würde `resolveLlmPath` das XL-Judge-Modell als under-test mounten (self-bias + VRAM-last). Im 3-Modell-Vergleich und im 15-Modell-sweep wird der under-test-LLM explizit pro Modell überschrieben.
- **Run-Dir-Provenienz**: jeder lauf landet in `report/runs/<stamp>_<git-sha>[_dirty]/` mit `env.json` (hardware/git/node) , `dataset.json` (path + sha256) , `summary.md`/`.json` , `ranking.md` , `configs/<name>/result.json`. Folders werden nie überschrieben ; der `_dirty`-flag im namen verhindert , dass ein dirty-run als clean-baseline gilt. Beide hier verwendeten läufe sind `_dirty` (siehe abschnitt 6).

Der 15-Modell-sweep nutzt zusätzlich eine **subprocess-per-Modell-isolation** (`tests/evals/answer/run-pack.ts`): nicht der in-process pack-modus , weil erste in-process pack-runs nach Modell 4–5 mit ACCESS_VIOLATION (Windows `0xC0000005`) crashten — node-llama-cpp leakt offenbar state über load/unload-zyklen (CUDA-context , listener-registry o. ä.). Saubere isolation per kindprozess kostet 10× corpus-embed (~5 min/Modell auf CPU) , ist aber crash-resistent und resume-fähig (Modell mit existierendem `result.json` wird übersprungen).

### 2.3 Metrik-Definitionen

**Retrieval-Metriken** (wörtlich aus `tests/evals/metrics.ts`):

| Metrik   | Definition                                                                                        | Formel im Code                                                              |
| -------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| recall@k | anteil queries , bei denen die richtige antwort in den ersten k ergebnissen ist (single-relevant) | `hits / results.length` , hit wenn `chunkIds.slice(0,k).includes(expected)` |
| MRR      | mean reciprocal rank , 1/rank über alle queries gemittelt                                         | `Σ (1/rank) / N` , `rank = indexOf(expected)+1`                             |
| nDCG@k   | normalized discounted cumulative gain auf k                                                       | `Σ (1/log2(rank+1)) / N`                                                    |

**LLM-as-Judge** (`tests/evals/judge/Judge.ts`): ein stärkeres Modell bekommt frage + gold-chunk + generierte antwort und gibt drei dimensionen auf skala 0–10 zurück (normalisiert auf 0..1):

- **correctness** — beantwortet die antwort die frage richtig gegen gold? (bei broad/summary stattdessen coverage)
- **groundedness** — basiert die antwort auf den gelieferten chunks oder halluziniert sie?
- **helpfulness** — verständlich / direkt / nicht zu lang?

`score = (correctness + groundedness + helpfulness) / 3`. Parse-fehler → record wird geskippt (`parsed: false`) , damit ein einzelner format-aussetzer den mittelwert nicht verzerrt. Robustes regex-pro-zeile-parsing statt JSON. **Default-Judge-Modell: Nemotron 3 Nano 30B-A3B** (XL-profil , lokal , ~18 GB VRAM , deterministisch fest gepinnt , nur im 2. pass geladen). Der under-test-LLM ist bewusst vom Judge getrennt.

**Composite-Score** (`tests/evals/judge/Judge.ts` , `tests/evals/README.md`):

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

Gewichte (opinionated): judge ×2 (qualität ist hauptsache) , recall@5 ×1 (fallback wenn Judge fehlt) , TTFT-penalty ×0.5 linear in sekunden (maximal −1 bei 2 s TTFT). Höher = besser , NaN-safe. `ranking.md` sortiert danach — kürzeste TTFT bei akzeptabler qualität gewinnt. **Konsequenz für die interpretation**: das ranking ist latenz-gewichtet ; ein rein qualitäts-orientiertes ranking (nur judge) sähe anders aus.

**TTFT-Phasen** (6 , aus `PhasedTimer`/`perf.ts`): `ttftMs = sum(queryEmbed , retrieve , rerank , promptAssemble , prefill , firstDecode)`. `fullResponseMs` ist die wandzeit bis `ask()` resolved.

## 3. Datensatz

Drei datensätze sind relevant. Provenienz aus den dataset-headern (`tests/evals/data/datasets/*.json`):

| Dataset (Datei)                                        | Fragen | Chunks | Generator                                                    | Lizenz / Quelle                                                                                                                                           | Verwendet in                       |
| ------------------------------------------------------ | -----: | -----: | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json` |    260 |     52 | `agent-batch:claude-opus-4-7`                                | synthetisch , agent-generiert ; hash `43207410dc46debe`                                                                                                   | 3-Modell-Vergleich (abschnitt 4.1) |
| `xquad-de-300q-2026-05-24T17-05-53.json`               |    300 |    240 | `xquad-de-subset` (chunker `xquad-passage`)                  | **CC BY-SA 4.0** ; XQuAD DE-subset , `google-deepmind/xquad` raw ; cite Artetxe et al. 2020 , arXiv:1910.11856 ; subsample limit 300 , seed 42 , von 1190 | 15-Modell-Sweep (abschnitt 4.4)    |
| `wikipedia-survival-1255q-2026-06-13T11-42-44.json`    |   1255 |   2939 | `wikipedia-survival:agent-verified` (chunker `fixed-512-64`) | **CC BY-SA 4.0** ; EN-Wikipedia `prop=extracts` , fetched 2026-06-13 ; 1322 generiert → 1255 behalten                                                     | retrieval-kontext (abschnitt 4.6)  |

Im 3-Modell-Vergleich werden je config **30 der 260 fragen** verwendet ; im 15-Modell-Sweep **25 der 300 XQuAD-DE-fragen** je Modell. Datensätze werden einmal generiert und committed , nur regeneriert wenn sample-docs oder generator-prompts sich ändern.

## 4. Ergebnisse

> Alle zahlen wörtlich aus den committeten run-reports. `per-question.jsonl` wurde nicht gelesen (zu groß) — nur `summary.md` / `ranking.md` / `summary.json` / `*-comparison.md`.

### 4.1 3-Modell-Vergleich — Setup

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md`. Lauf-datum 2026-05-20. Alle Modelle Q4_K_M.

| Slot          | Modell                           | Backend                    | Footprint (Q4_K_M)         |
| ------------- | -------------------------------- | -------------------------- | -------------------------- |
| Under-test #1 | Qwen3-8B Instruct                | GPU (CUDA)                 | ~5 GB VRAM + ~6 GB RSS     |
| Under-test #2 | IBM Granite 3.3-8B Instruct      | GPU (CUDA)                 | ~5 GB VRAM + ~5.7 GB RSS   |
| Under-test #3 | Mistral-Nemo-Instruct-2407 (12B) | GPU (CUDA)                 | ~7.5 GB VRAM + ~8.2 GB RSS |
| Embedder      | bge-m3                           | CPU (mirrors prod default) | ~440 MB                    |
| Reranker      | bge-reranker-v2-m3               | GPU (auto)                 | ~440 MB VRAM               |
| Judge         | Nemotron 3 Nano 30B-A3B          | GPU (CUDA) , pass-2 only   | ~18 GB VRAM                |

### 4.2 3-Modell-Vergleich — Composite-Ranking

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md` Z. 34–44 (source-runs: Qwen3-8B `report/runs/2026-05-20T19-46-39_45bf322_dirty/` , Granite `report/runs/2026-05-20T20-49-53_45bf322_dirty/` , Mistral-Nemo `report/runs/2026-05-20T21-04-46_45bf322_dirty/`). n=30 Fragen/config , alle zellen kombiniert , composite = 2·judge + recall@5 − 0.5·TTFT_sec.

| Rang | Modell       | Config      | Composite | recall@5 | judge | corr | ground | help | TTFT p50 |
| ---: | ------------ | ----------- | --------: | -------: | ----: | ---: | -----: | ---: | -------: |
|    1 | Qwen3-8B     | grid_k3_rr0 | **2.243** |    0.700 | 0.923 | 0.95 |   0.96 | 0.86 |   606 ms |
|    2 | Qwen3-8B     | grid_k5_rr0 |     2.227 |    0.700 | 0.923 | 0.95 |   0.97 | 0.85 |   640 ms |
|    3 | Qwen3-8B     | grid_k2_rr5 |     2.221 |    0.700 | 0.922 | 0.95 |   0.97 | 0.85 |   648 ms |
|    4 | Mistral-Nemo | grid_k3_rr0 |     2.215 |    0.700 | 0.916 | 0.94 |   0.96 | 0.84 |   632 ms |
|    5 | Granite      | grid_k2_rr5 |     2.205 |    0.700 | 0.911 | 0.92 |   0.97 | 0.85 |   634 ms |
|    6 | Granite      | grid_k3_rr0 |     2.200 |    0.700 | 0.909 | 0.93 |   0.94 | 0.85 |   635 ms |
|    7 | Mistral-Nemo | grid_k5_rr0 |     2.187 |    0.700 | 0.912 | 0.94 |   0.96 | 0.84 |   674 ms |
|    8 | Granite      | grid_k5_rr0 |     2.180 |    0.700 | 0.913 | 0.94 |   0.96 | 0.84 |   693 ms |
|    9 | Mistral-Nemo | grid_k2_rr5 |     2.149 |    0.700 | 0.889 | 0.91 |   0.93 | 0.82 |   657 ms |

Cross-model-zelle (judge-score / TTFT p50 , gleicher Judge ; selbe quelle):

| Config      | Qwen3-8B       | Granite-3.3-8B | Mistral-Nemo-12B |
| ----------- | -------------- | -------------- | ---------------- |
| grid_k3_rr0 | 0.923 / 606 ms | 0.909 / 635 ms | 0.916 / 632 ms   |
| grid_k5_rr0 | 0.923 / 640 ms | 0.913 / 693 ms | 0.912 / 674 ms   |
| grid_k2_rr5 | 0.922 / 648 ms | 0.911 / 634 ms | 0.889 / 657 ms   |

### 4.3 3-Modell-Vergleich — Per-Phase-Latenz

Quelle: `tests/evals/report/3-model-comparison-2026-05-20.md` Z. 76–86 (mean ms).

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

Befund: der embedder (qEmb ~503–523 ms auf CPU) dominiert die TTFT-summe , nicht der LLM-prefill (54–190 ms auf GPU). `retrieve` und `promptAssemble` sind vernachlässigbar (< 0.5 ms). `rerank` ist 0 wenn `topKToRerank=0` , sonst 79–84 ms auf GPU.

### 4.4 15-Modell-Sweep — Ranking

Quelle: `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/ranking.md` + `summary.md` (identische tabelle). Dataset XQuAD-DE , n=25 Queries/Modell , composite = judge·2 + recall@5 − ttft_sec·0.5. recall@5 ist konstant **0.520** über alle Modelle (retrieval ist modell-unabhängig in diesem sweep).

| Rang | Modell                   | Composite | judge | recall@5 | TTFT p50 (ms) | FullResp p50 (ms) |   n |
| ---: | ------------------------ | --------: | ----: | -------: | ------------: | ----------------: | --: |
|    1 | answer@qwen3.5-4b        | **1.798** | 0.869 |    0.520 |           922 |              3254 |  25 |
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

Pack: `tests/evals/answer/model-pack.json` (`loklm-rag-eval-15` ; summary nennt run-tag `loklm-rag-eval-10` , siehe abschnitt 6). 15 Modelle , erfolgreich 15 , failed 0. Alle Q4_K_M , contextSize 8192 (ctx-cap , nicht native grenze) , language `de`.

### 4.5 15-Modell-Sweep — Judge-Subscores + Ressourcen

Quelle: `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/summary.json` (`judgeAvg` + `resourcePeak` ; composite in voller präzision). `parsedFraction` war für alle Modelle 1.0. recall@1=0.28 , recall@5=recall@10=0.52 , MRR=0.388 , nDCG@10=0.42166 — konstant über alle 15 Modelle.

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

### 4.6 Retrieval-Kontext (Wikipedia-Survival , n=1255)

Quelle: `papers/_evidence/wikipedia-survival.md` Z. 59–69. GPU placement , embedder bge-m3 (Q4_K_M) , reranker bge-reranker-v2-m3 (pool=50 dense-kandidaten) , single-relevant. Dieser lauf isoliert die retrieval-stufe (kein LLM) und zeigt , dass recall@5 in den modell-vergleichen nicht der bottleneck ist:

| Metrik    | dense (bge-m3 , kein rerank) | dense + rerank (bge-reranker-v2-m3) |
| --------- | ---------------------------: | ----------------------------------: |
| recall@1  |                        0.552 |                           **0.844** |
| recall@5  |                        0.714 |                           **0.894** |
| recall@10 |                        0.758 |                           **0.894** |
| MRR       |                        0.623 |                           **0.867** |
| nDCG@10   |                        0.656 |                           **0.874** |

GPU-timing (selbe quelle , Z. 85–88): embedder warm 3.6 s ; korpus-embed 2939 chunks **48.7 s** ; query+rerank-loop 1255 Fragen **1052 s (~17.5 min , seriell)**. CPU bge-m3 ≈ 1.5 s/chunk → 2939 chunks > 70 min (thermisch gedrosselt).

## 5. Diskussion / Befunde

1. **Größeres Modell ist nicht besser — über beide läufe konsistent.** Im 3-Modell-Vergleich gewinnt Qwen3-8B über alle drei configs (judge-margin über Granite 0.010–0.014 , über Mistral-Nemo 0.007–0.033) ; das 50 % größere Mistral-Nemo-12B liegt unter dem 8B-incumbent , insbesondere bricht `grid_k2_rr5` bei Mistral-Nemo auf judge 0.889 ein (vs Qwen 0.922). Im 15-Modell-Sweep gewinnt `qwen3.5-4b` (composite 1.798 , judge 0.869) , und die beiden größten Modelle landen unten: `qwen3.5-27b` hat zwar den zweitbesten judge (0.831) , wird aber durch TTFT p50 1361 ms , FullResp p50 11673 ms und ~14.21 GB freeVRAM-min auf rang 14 gezogen.

2. **k=3 maxt qualität.** Im 3-Modell-Vergleich ist `grid_k3_rr0` auf allen drei Modellen die stärkste oder zweitstärkste config ; der produktions-default `QAService.DEFAULT_TOP_K` ist von 8 auf 3 gelandet. Ein kleinerer prompt heißt auch kürzere TTFT.

3. **Der embedder , nicht der LLM , dominiert die TTFT.** Die per-phase-tabelle (4.3) zeigt qEmb ~500 ms (CPU) gegen prefill 54–190 ms (GPU). Damit ist die TTFT-streuung zwischen den drei Modellen klein (606–693 ms quer durch alle Modelle + configs) — die Modell-wahl entscheidet die qualität , nicht die latenz , solange GPU verfügbar ist.

4. **Composite ist latenz-gewichtet — bewusst.** Der 27B-fall illustriert die folge: ein rein qualitäts-orientiertes ranking sähe `qwen3.5-27b` auf judge-rang 2 ; im composite fällt es wegen FullResp p50 11673 ms (höchste latenz im sweep) auf rang 14. Das ist der gewollte effekt der ×0.5-TTFT-penalty — für ein lokales tool zählt antwortzeit.

5. **Reranker hilft inkonsistent auf vor-sortierten eval-pools , aber stark auf großem realem haystack.** Im 3-Modell-Vergleich hilft bei k=2 rr=5 messbar (sonst recall-collapse) , bei k≥3 schadet er eher — vermutlich artefakt vom sauber vor-sortierten cosine-pool. Auf dem vollen 2939-chunk-haystack (4.6) hebt der reranker recall@1 von 0.552 → 0.844 (+0.292) ; recall@5 = recall@10 = 0.894 ist das ceiling des dense-top-50-pools. Produktions-fusion-pool (BM25+dense) ist noisiger , dort hilft rerank wahrscheinlich — bleibt opt-in.

6. **RAM-footprint sortiert wie Modellgröße.** Im 3-Modell-Vergleich Granite 5.7 GB → Qwen 6.0 GB → Mistral-Nemo 8.2 GB RSS ; Mistral-Nemo ist der einzige , der auf 16 GB end-user-RAM kritisch wird. Im 15-Modell-Sweep skaliert RSS-peak von 3629 MiB (qwen3.5-2b) bis 15375 MiB (qwen3.5-27b).

**Produktions-empfehlungen** (wörtlich aus `3-model-comparison-2026-05-20.md` Z. 71–77):

| Setting                           | Aktuell                | Empfehlung                                | Begründung                                                                    |
| --------------------------------- | ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `QAService.DEFAULT_TOP_K`         | 8 → 3                  | gelandet                                  | k=3 maxt qualität auf allen 3 Modellen , kleinerer prompt = schneller TTFT    |
| Default LLM                       | auto-picks XL on 32 GB | bleibt Qwen3-8B (full)                    | XL bringt keine qualitäts-rendite , kostet 18 GB load + ~60 s production TTFT |
| `recommendedProfile()`            | XL für ≥32 GB RAM      | full standardmäßig , XL nur opt-in        | sweep zeigt 8B genügt für die corpus-größe                                    |
| Rerank default                    | opt-in via UI          | bleibt opt-in (cpuOptimized schaltet aus) | daten ambivalent ; produktions-fusion-pool noisiger                           |
| Mistral-Nemo / Granite als bundle | —                      | nicht hinzufügen                          | beide unter Qwen3-8B , kein nutzen wert ~5 GB extra download                  |

## 6. Limitationen & Threats to Validity

- **Kleine n.** 3-Modell-Vergleich: n=30 Fragen/config ; 15-Modell-Sweep: n=25 Fragen/Modell. Die judge-margins (~0.01–0.03) liegen knapp über statistischem rauschen. Bei knappen rangfolgen vor finalen entscheidungen mit n=100 wiederholen. Im sweep liegen die composite-abstände im mittelfeld (rang 6–13 , ~1.54–1.63) eng beieinander.

- **Eval umgeht die produktions-RAG-pipeline.** Skipped: BM25+dense fusion , multi-query expansion , heuristiken (title boost / short chunk penalty / recency) , doc diversification , whole-doc fallback , neighbour expansion , DB-I/O , worker-IPC. Gemessen wird isoliert embedder + reranker + LLM auf vorgefertigten chunks. Das erklärt , warum recall@5 im 15-Modell-Sweep konstant 0.520 ist (modell-unabhängig) — diese metrik trennt die Modelle nicht , nur judge + latenz tun es. Die in produktion beobachteten ~60 s TTFT müssen separat debuggt werden (vermutlich auto-pick XL + cold-load + multi-query).

- **GPU- vs CPU-timing.** Alle TTFT/latenz-zahlen stammen von GPU-läufen (RTX 5090). Das ist ein korrektheits-/qualitäts-check , NICHT der produktions-CPU-timing-benchmark. Auf CPU streuen embedder + prefill viel stärker (CPU bge-m3 ≈ 1.5 s/chunk ; reranker auf CPU 1–2 s statt ~80 ms GPU). CPU-only-end-user-pfad sollte rerank=off lassen.

- **Dirty git-state.** Beide quell-läufe tragen `_dirty` im run-dir-namen: 3-Modell `45bf322_dirty` , 15-Modell `961e6d4_dirty`. Zusätzlich meldet die `env.json` des 15-Modell-Sweeps git shortSha `c7ef2e3` (branch `feat/tier-infrastructure`) statt des im ordnernamen genannten `961e6d4` — diese SHA-diskrepanz ist nicht aufgelöst. Ebenso heißt der pack in `model-pack.json` `loklm-rag-eval-15` , während die summary den run-tag `loklm-rag-eval-10` trägt.

- **contextSize-cap.** Im 15-Modell-Sweep ist contextSize 8192 ein ctx-cap , nicht die native grenze (z.B. Phi-4 ist real 16k). Modelle mit größerer nativer kapazität wurden gleich beschnitten.

- **Self-Bias-schutz.** Der under-test-LLM muss vom XL-Judge (Nemotron 30B-A3B) getrennt bleiben ; im config-default per Pin auf `'full'` , in den modell-vergleichen per expliziter Modell-überschreibung. Eine eigenständige judge-kalibrierung (mensch vs Nemotron) liegt nicht vor.

- **DE-lastige datensätze.** Mistral-Nemos angeblich bessere DE-stärke zeigt sich nicht — evtl. weil der Nemotron-Judge DE-nuancen nicht trennscharf bewertet , oder das dataset zu klein ist.

- **per-question.jsonl nicht gelesen.** Alle aggregate stammen aus `summary.md`/`ranking.md`/`summary.json`/`result.json`-ebene ; per-frage-fehleranalyse ist hier nicht durchgeführt.

- **TODO: Lauf nötig.** Faithful-CPU-timing-läufe (`evals:sweep --no-llm`) für den 3- und 15-Modell-vergleich liegen nicht vor ; die n=100-wiederholung knapper rangfolgen ebenfalls nicht. Diese lücken sind offen.

## 7. Reproduzierbarkeit

Voraussetzung: GGUF-Modelle in `models/` (pfade wie in `tests/evals/answer/model-pack.json`) , Judge-GGUF Nemotron 3 Nano 30B-A3B lokal , `pnpm install`. Hardware-/git-/dataset-provenienz wird automatisch in `env.json` + `dataset.json` festgehalten.

**3-Modell-Vergleich (grid-sweep , ein Modell pro lauf , GPU):**

```bash
# Qwen3-8B (--llm-models auf den jeweiligen GGUF zeigen lassen) , grid-configs , mit judge
pnpm exec tsx tests/evals/sweep.ts \
  --configs grid \
  --dataset tests/evals/data/datasets/agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json \
  --limit 30 \
  --judge --judge-path <pfad/zu/Nemotron-30B-A3B-Q4_K_M.gguf>
# entsprechend für Granite-3.3-8B und Mistral-Nemo-12B wiederholen
```

(npm-script-aliase: `pnpm evals:sweep` → `tsx tests/evals/sweep.ts`. Die quell-läufe liegen in `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/` , `…20-49-53…` , `…21-04-46…`.)

**15-Modell-Answer-Sweep (subprocess-per-Modell , resume-fähig):**

```bash
pnpm exec tsx tests/evals/answer/run-pack.ts \
  --pack tests/evals/answer/model-pack.json \
  --dataset tests/evals/data/datasets/xquad-de-300q-2026-05-24T17-05-53.json \
  --limit 25 \
  --judge-path <pfad/zu/Nemotron-30B-A3B-Q4_K_M.gguf>
# Resume nach crash: zusätzlich --run-dir <existing-run-dir>
```

(npm-script-alias: `pnpm evals:pack` → `tsx tests/evals/answer/run-pack.ts`. Der orchestrator spawnt pro Modell intern `tsx tests/evals/sweep.ts --configs answer --llm-models <temp> --run-dir <shared> --skip-summary --judge --judge-path …`. Quell-lauf: `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/`.)

**Retrieval-kontext (Wikipedia-Survival , kein LLM):**

```bash
pnpm exec tsx tests/evals/sweep.ts \
  --dataset tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json \
  --no-llm
```

**Aggregation über alle run-dirs** (flache zeile je dataset×config mit provenienz ; `--clean-only` filtert dirty-runs):

```bash
pnpm evals:paper            # tsx tests/evals/aggregate-paper.ts
pnpm evals:paper --clean-only
```

## Referenzen

**Evidence-/Quell-dateien (in-repo):**

- `papers/_evidence/methodology.md` — geteilte methodik (hardware , metriken , Judge , composite , chunker , run-dir-provenienz , datensatz-übersicht)
- `papers/_evidence/llm-comparison.md` — abschnitt A (3-Modell) + abschnitt B (15-Modell) , wörtliche tabellen
- `papers/_evidence/wikipedia-survival.md` — retrieval-kontext + GPU-timings
- `tests/evals/report/3-model-comparison-2026-05-20.md` — 3-Modell-Vergleich (composite , per-phase , findings , recommendations)
- `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/{summary.md,ranking.md,env.json}` — Qwen3-8B grid-sweep
- `tests/evals/report/runs/2026-05-20T20-49-53_45bf322_dirty/` — Granite-3.3-8B grid-sweep
- `tests/evals/report/runs/2026-05-20T21-04-46_45bf322_dirty/` — Mistral-Nemo-12B grid-sweep
- `tests/evals/report/runs/2026-05-22T12-29-08_961e6d4_dirty/{ranking.md,summary.md,summary.json,env.json}` — 15-Modell-Answer-Sweep
- `tests/evals/answer/model-pack.json` — pack `loklm-rag-eval-15` (15 Modelle , Q4_K_M , ctx 8192)
- `tests/evals/answer/run-pack.ts` — subprocess-per-Modell-orchestrator (methodik-kommentare)
- `tests/evals/metrics.ts` , `tests/evals/judge/Judge.ts` , `tests/evals/pipeline/configs.ts` , `tests/evals/pipeline/Chunker.ts` , `tests/evals/runDir.ts` — metrik- , Judge- , config- , chunker- , provenienz-implementierung

**Externe datensätze / Modelle (Lizenz):**

- XQuAD DE-subset — `google-deepmind/xquad` , **CC BY-SA 4.0** ; cite Artetxe , Ruder , Yogatama 2020 , „On the Cross-lingual Transferability of Monolingual Representations" , arXiv:1910.11856
- Wikipedia-Survival-korpus — EN-Wikipedia `prop=extracts` , **CC BY-SA 4.0** , fetched 2026-06-13
- Modelle (alle Q4_K_M GGUF) — Qwen3-8B / Qwen3-14B / Qwen3-4B-Instruct (Apache-2.0) , Qwen3.5-2B/4B/9B/27B , IBM Granite 3.3-8B Instruct (Apache-2.0) , Mistral-Nemo-Instruct-2407 12B (Apache-2.0) , Microsoft Phi-4 / Phi-4-mini (MIT) , Google Gemma-3-4B (Gemma-Lizenz) , Meta Llama-3.2-3B (Llama-3.2-Community-Lizenz) , HuggingFaceTB SmolLM3-3B (Apache-2.0) , NousResearch Hermes-3-Llama-3.1-8B
- Judge — Nemotron 3 Nano 30B-A3B (XL-profil , lokal , gepinnt)
