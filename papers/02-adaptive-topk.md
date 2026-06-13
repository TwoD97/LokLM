# Adaptive Top-K nach Query-Intent: Coverage-Gewinn für Broad- und Summary-Anfragen

**Kurzfassung.** Dieses Paper misst , ob die `classifyQueryBreadth`-Heuristik in `QAService` — die Query-Intent auf Retrieval-Tiefe abbildet (`focused → topK=3` , `broad → topK=8` , `summary → topK=12`) — auf einem broad/summary-lastigen Datensatz tatsächlich mehr der relevanten Chunks an das LLM liefert als das vorherige fixe `topK=3`. Gemessen wird Multi-Relevant-Recall (`recall_req@K`) über 25 hand-kuratierte Fragen (6 focused , 13 broad , 6 summary) gegen einen 109-Chunk-Korpus aus 5 Sample-Dokumenten. Aggregiert hebt der Bump von `topK=3` auf `topK=12` die Coverage von `0.427` auf `0.592` (+39 %); der Per-Intent-Breakdown zeigt das eigentliche Signal: summary-Coverage steigt von `0.236` auf `0.468` (+98 %) , broad von `0.481` auf `0.615` (+28 %) , focused plateaut bei k=8 (`0.500 → 0.667`). Selbst bei `topK=12` werden für summary-Anfragen nur ~47 % der required Chunks erreicht — das ist das Coverage-Ceiling reiner Top-K-Skalierung. Der Lauf misst ausschließlich Retrieval-Recall (LLM-/Judge-Pass deaktiviert , `n` klein , git-state dirty) und ist als Coverage-Beleg , nicht als Antwort-Qualitäts-Beleg zu lesen.

## 1 Einleitung / Motivation

Ein Retrieval-Augmented-Generation-Pfad mit fester Retrieval-Tiefe behandelt jede Anfrage gleich: ob „Was ist Flash-Attention?" (ein einzelnes Faktoid) oder „Fasse die wichtigsten Chunking-Strategien für RAG zusammen" (eine Whole-Doc-Zusammenfassung) , in beiden Fällen landen dieselben `topK` Chunks im Prompt. Für Single-Chunk-Faktoide ist ein kleines `topK` korrekt — der eine richtige Chunk muss nur unter die Top-K geraten. Für broad/summary-Anfragen ist eine vollständige Antwort dagegen über mehrere Chunks verteilt , und ein zu kleines `topK` schneidet einen Teil der Belege systematisch ab , bevor das LLM sie sehen kann.

Die `classifyQueryBreadth`-Heuristik in `src/main/services/qa/QAService.ts` adressiert genau das: sie klassifiziert den Query-Intent und routet die Retrieval-Tiefe entsprechend (`focused → topK=3` , `broad → topK=8` , `summary → topK=12`). Die Frage dieses Papers ist eng und falsifizierbar: liefert diese Intent-abhängige Tiefe auf einem broad/summary-lastigen Datensatz nachweisbar mehr der relevanten Chunks als das vorherige fixe `topK=3` — und wo liegt die obere Grenze dieses Gewinns?

Was dieses Paper **nicht** beantwortet: ob die zusätzlichen Chunks die finale Antwort-Qualität verbessern. Coverage ≠ Antwort-Güte. Der Judge-Pass ist in diesem Lauf nicht gelaufen (siehe Abschnitt 6).

Quelle der Fragestellung: `tests/evals/report/adaptive-topk-2026-05-21.md` (Intro) ; `papers/_evidence/adaptive-topk.md` (Abschnitt „What was tested").

## 2 Aufbau & Methodik

### 2.1 Hardware (Dev-/Mess-Box)

Erfasst automatisch via `tests/evals/runDir.ts` (`hardwareInfo()`) in `env.json` und im Report-Header.

| Feld         | Wert                                          | Quelle                                        |
| ------------ | --------------------------------------------- | --------------------------------------------- |
| CPU          | Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz × 16 | env.json / summary.md                         |
| RAM          | 31.9 GB                                       | env.json / summary.md                         |
| GPU          | RTX 5090 (32 GB VRAM)                         | `papers/_evidence/methodology.md` Abschnitt 2 |
| OS / release | win32 / 10.0.26200                            | env.json                                      |
| node         | v22.15.1                                      | env.json                                      |

Placement in diesem Lauf (mirrors prod default): **Embedder BGE-M3 auf CPU** , **Reranker bge-reranker-v2-m3 auf GPU**. Quelle: `papers/_evidence/adaptive-topk.md` (Lauf-Umgebung , Setup „Konfigurationen") ; `papers/_evidence/methodology.md` Abschnitt 2.

### 2.2 Harness

- **Eval-als-Säule**: Evals sind eine eigene Säule neben der Test-Pyramide. Sie liefern Zahlen (recall@k , MRR , nDCG) und vergleichen Configs miteinander; eine Eval „schlägt nicht fehl" , sie schneidet besser oder schlechter ab. Quelle: `tests/evals/README.md` Z. 10–13 (via `papers/_evidence/methodology.md` Abschnitt 1).
- **Run-Dir / Provenienz**: ein Sweep-Lauf schreibt `report/runs/<stamp>_<git-sha>[_dirty]/` mit `env.json` (CPU/RAM/OS/git/node) , `dataset.json` (Pfad + sha256) , `summary.md`/`.json` (Vergleichstabelle) und `ranking.md` (nach Composite sortiert) ; pro Config zusätzlich `result.json` und `per-question.jsonl`. Folders werden nie überschrieben; das `_dirty`-Flag im Namen verhindert , dass ein dirty-Lauf als clean-Baseline gilt. Quelle: `tests/evals/runDir.ts` ; `tests/evals/README.md` Z. 127–142 (via `papers/_evidence/methodology.md` Abschnitt 7).
- **Chunker**: `fixed-512-64` (512-Zeichen-Fenster , 64 overlap , `step = size − overlap`). `size` ist Zeichen , nicht Tokens. Quelle: `tests/evals/pipeline/Chunker.ts` (via `papers/_evidence/methodology.md` Abschnitt 5).
- **Config-Set**: `adaptiveTopKConfigs()` — 3 Punkte k3/k8/k12 , alle `topKToRerank=20` , identisch außer `topKToLLM`. Quelle: `tests/evals/pipeline/configs.ts` (via `papers/_evidence/methodology.md` Abschnitt 6).

### 2.3 Metrik-Definitionen

Wörtlich aus `tests/evals/metrics.ts` (via `papers/_evidence/methodology.md` Abschnitt 3).

| Metrik           | Definition                                                                                                                    | Formel im Code                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- | --- | -------- | ------ |
| **recall@k**     | Anteil der Queries , bei denen die richtige Antwort in den ersten k Ergebnissen ist (single-relevant)                         | `hits / results.length` , hit wenn `chunkIds.slice(0,k).includes(expected)`       |
| **recall_req@k** | mittlerer Anteil der required-Chunks , die in den ersten k landen (multi-relevant) ; fehlt `required` → fallback `[expected]` | `Σ (                                                                              | required ∩ topK | /   | required | ) / N` |
| **MRR**          | mean reciprocal rank , `1/rank` über alle Queries gemittelt                                                                   | `Σ (1/rank) / N` , `rank = indexOf(expected)+1`                                   |
| **nDCG@k**       | normalized discounted cumulative gain auf k                                                                                   | `Σ (1/log2(rank+1)) / N` ; single-relevant ideal-DCG ist konstant `1/log2(2) = 1` |

Kern-Metrik dieses Papers ist **`recall_req@K`** (Multi-Relevant-Recall):

```
recall_req@K = mean_q( |required(q) ∩ retrieved_top-K(q)| / |required(q)| )
```

`recall_req@K` reduziert sich exakt auf klassisches `recall@K` , wenn `|required| = 1`. Code-Beispiel aus `metrics.ts`: `required=[A,B,C,D] , top-K=[A,X,C,Y,B] → |{A,C,B}|/4 = 0.75`. Quelle: `tests/evals/metrics.ts` Z. 15–16 , 67–82 ; `papers/_evidence/adaptive-topk.md` (Methodik , „Metrik").

**Ranking-Composite** (Sortierung in `ranking.md`):

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

In diesem Lauf ist `judge` leer (`llmEnabled:false` , `judgeAvg:null`) , der Composite reduziert sich also faktisch auf `recall@5 − 0.5 × ttft_sec`. Quelle: `tests/evals/judge/Judge.ts` Z. 226–255 (via `papers/_evidence/methodology.md` Abschnitt 4) ; `papers/_evidence/adaptive-topk.md` (Methodik , „Ranking-Composite").

## 3 Datensatz

Hand-kuratierter Multi-Relevant-Datensatz `handcrafted-adaptive-topk-2026-05-21T18-46-35.json`.

| Feld                  | Wert                                    | Quelle                                    |
| --------------------- | --------------------------------------- | ----------------------------------------- |
| generator             | `manual-handcrafted:adaptive-topk-eval` | dataset JSON header (Z. 2)                |
| generatedAt           | `2026-05-21T18:46:35.814Z`              | dataset JSON header (Z. 3)                |
| chunker               | `fixed-512-64`                          | dataset JSON header (Z. 4)                |
| numQuestions          | 25                                      | run dataset.json / summary.json `dataset` |
| numChunks             | 109                                     | run dataset.json / summary.json `dataset` |
| sha256 (erste 16 hex) | `7309d51bec624f6d`                      | run dataset.json / summary.json `dataset` |
| library               | null                                    | run dataset.json                          |

Quelle: `tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json` (Header Z. 1–4) ; `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/dataset.json` ; `papers/_evidence/adaptive-topk.md` (Datensatz / Provenienz).

**Korpus.** 5 Sample-Dokumente , 109 Chunks gesamt (fixed-512-64). Davon 2 neu für diesen Eval:

- `chunking-strategien.txt` — 29 Chunks , ~1600 Wörter ;
- `llm-inferenz-optimierung.txt` — 27 Chunks , ~1590 Wörter.

Die 3 existierenden Docs (eval-metriken , loklm-architektur , rag-grundlagen) bleiben als Distraktoren im Korpus.

**Fragen-Verteilung (Intent).** 25 hand-kuratierte Fragen über die 2 neuen Docs:

| Intent  |   n | Charakter                               |
| ------- | --: | --------------------------------------- |
| focused |   6 | Single-Chunk-Faktoide (Kontroll-Gruppe) |
| broad   |  13 | Listen / Vergleiche                     |
| summary |   6 | Whole-Doc-Zusammenfassungen             |

Jede Frage trägt ein hand-kuratiertes `requiredChunkIds`-Set , das alle für eine vollständige Antwort nötigen Chunks nennt. Quelle: `tests/evals/report/adaptive-topk-2026-05-21.md` (Setup , „Korpus" + „Fragen") ; `papers/_evidence/adaptive-topk.md` (Korpus + Fragen-Verteilung).

## 4 Ergebnisse

Alle Zahlen unten stammen aus dem Run-Dir `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/` (git `2208911` , dirty , branch `feat/settings-ollama-connector`) und dem narrativen Report `tests/evals/report/adaptive-topk-2026-05-21.md`. Quell-Datei ist je Tabelle benannt.

### 4.1 Tabelle A — Headline

Quelle: `tests/evals/report/adaptive-topk-2026-05-21.md` (## Headline).

| Config            |   n |   r@5 | r_req@5 |  r_req@12 |
| ----------------- | --: | ----: | ------: | --------: |
| adaptive_k3_rr20  |  25 | 0.480 |   0.427 |     0.427 |
| adaptive_k8_rr20  |  25 | 0.520 |   0.507 |     0.527 |
| adaptive_k12_rr20 |  25 | 0.520 |   0.507 | **0.592** |

Aggregierter Befund (Report-Wortlaut): „Bump von topK=3 → topK=12 hebt Multi-Relevant-Coverage von 0.427 auf 0.592 (+39 %)."

### 4.2 Tabelle B — Per-Intent-Breakdown (das eigentliche Signal)

Quelle: `tests/evals/report/adaptive-topk-2026-05-21.md` (## Per-Intent-Breakdown).

| Intent  |   n | k=3 r_req@12 | k=8 r_req@12 | k=12 r_req@12 | Δ (k=3→k=12) |
| ------- | --: | -----------: | -----------: | ------------: | -----------: |
| focused |   6 |        0.500 |        0.667 |         0.667 |        +33 % |
| broad   |  13 |        0.481 |        0.558 |         0.615 |        +28 % |
| summary |   6 |        0.236 |        0.319 |     **0.468** |    **+98 %** |

### 4.3 Tabelle C — Quality + TTFT (per-Config)

Quelle: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.md` (## Quality + TTFT). `judge` , `TTFT` und `FullResp` sind `-` , weil der LLM-/Judge-Pass nicht lief (`llmEnabled:false`). `qEmb`/`retr`/`rerank` sind Phasen-Mittel in ms ; `rss-max` in MiB.

| Config            |   n |   r@5 |  r@10 | r_req@5 | r_req@12 |   MRR | judge |  qEmb | retr | rerank | prefill | rss-max | cpu % | composite |
| ----------------- | --: | ----: | ----: | ------: | -------: | ----: | ----: | ----: | ---: | -----: | ------: | ------: | ----: | --------: |
| adaptive_k3_rr20  |  25 | 0.480 | 0.480 |   0.427 |    0.427 | 0.380 |     - | 406.5 |  0.7 |  342.0 |       0 |    1625 |   100 |     0.114 |
| adaptive_k8_rr20  |  25 | 0.520 | 0.520 |   0.507 |    0.527 | 0.388 |     - | 408.0 |  0.5 |  323.8 |       0 |    1352 |    95 |     0.156 |
| adaptive_k12_rr20 |  25 | 0.520 | 0.600 |   0.507 |    0.592 | 0.400 |     - | 405.0 |  0.5 |  323.4 |       0 |    1479 |    96 |     0.159 |

### 4.4 Tabelle D — Ranking nach Composite

Quelle: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/ranking.md`. `judge` , `TTFT`/`FullResp` `-` wie oben.

| Rang | Config            | Composite | recall@5 |
| ---: | ----------------- | --------: | -------: |
|    1 | adaptive_k12_rr20 |     0.159 |    0.520 |
|    2 | adaptive_k8_rr20  |     0.156 |    0.520 |
|    3 | adaptive_k3_rr20  |     0.114 |    0.480 |

### 4.5 Tabelle E — Full-precision per-Config-Metriken

Diese ungerundeten Werte liegen hinter den Tabellen A , C und D. Quelle: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json` (`results[]`).

| Config            |  nQ | recall@1 | recall@5 | recall@10 |             r_req@5 |            r_req@10 |            r_req@12 |                 MRR |             nDCG@10 |           composite | llmEnabled |
| ----------------- | --: | -------: | -------: | --------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ---------- |
| adaptive_k3_rr20  |  25 |     0.28 |     0.48 |      0.48 | 0.42666666666666664 | 0.42666666666666664 | 0.42666666666666664 |                0.38 | 0.40618595071429153 | 0.11394560000003545 | false      |
| adaptive_k8_rr20  |  25 |     0.28 |     0.52 |      0.52 |  0.5066666666666666 |  0.5266666666666666 |  0.5266666666666666 | 0.38799999999999996 |  0.4216600630036732 | 0.15636754999999541 | false      |
| adaptive_k12_rr20 |  25 |     0.28 |     0.52 |       0.6 |  0.5066666666666666 |                0.56 |  0.5923809523809525 | 0.39977777777777773 |  0.4452638558829479 |   0.158799399999989 | false      |

### 4.6 Tabelle F — Phase-Timings + Ressourcen

Quelle: `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json` (`results[].phased` , `results[].resourcePeak` , `results[].buildMs`). Werte in ms / MiB. `freeVramGBMin = null` (kein VRAM-Sampling in diesem Lauf). `prefill`/`firstDecode`/`fullResponse` durchgehend 0 (LLM-Pass deaktiviert). TTFT-Werte existieren als Mess-Stubs trotz `llmEnabled:false` ; die Headline/summary.md zeigen sie als `-`.

| Config            | qEmbed p50 | qEmbed p95 | retrieve p50 | rerank p50 | rerank p95 | ttft p50 (stub) | ttft p95 (stub) | rssMiBMax | rssMiBMean | cpuLoadMean |
| ----------------- | ---------: | ---------: | -----------: | ---------: | ---------: | --------------: | --------------: | --------: | ---------: | ----------: |
| adaptive_k3_rr20  |    392.889 |    681.384 |        0.559 |    328.380 |    435.782 |         732.109 |        1026.527 |      1625 |       1043 |       0.997 |
| adaptive_k8_rr20  |    406.069 |    673.115 |        0.467 |    323.511 |    333.071 |         727.265 |        1005.419 |      1352 |       1299 |       0.953 |
| adaptive_k12_rr20 |    401.202 |    689.638 |        0.459 |    323.119 |    337.620 |         722.401 |        1018.732 |      1479 |       1329 |       0.963 |

Hinweis zu `buildMs`: nur der erste Config-Lauf zahlt den Korpus-Embed-Aufwand (`adaptive_k3_rr20`: 271597.5674 ms ≈ 4.5 min) ; die beiden Folge-Configs treffen den Embedding-Cache (`adaptive_k8`: 0.0041 ms , `adaptive_k12`: 0.0027 ms). Quelle: `summary.json` (`results[].buildMs`).

## 5 Diskussion / Befunde

1. **Summary-Coverage verdoppelt sich nahezu** — von `topK=3` (`0.236`) auf `topK=12` (`0.468`) , Δ +98 %. Bei nur 3 Chunks im Prompt sieht das Modell durchschnittlich nicht mal ein Viertel der für eine vollständige Zusammenfassung nötigen Belege (24 %) ; bei 12 Chunks knapp die Hälfte (47 %). Das ist der stärkste Einzeleffekt der Heuristik und beruht auf 6 summary-Fragen. Quelle: `papers/_evidence/adaptive-topk.md` (Kern-Befund 1).

2. **Broad gewinnt klar im Bereich k=8 → k=12** (+10 % von `0.558` auf `0.615` ; gesamt `0.481 → 0.558 → 0.615`). Der Sweetspot für Vergleichs-/Listen-Fragen liegt bei k=8 oder höher. Quelle: `papers/_evidence/adaptive-topk.md` (Kern-Befund 2).

3. **Focused plateaut bei k=8** (`0.500 → 0.667 → 0.667`): k=12 schadet nicht , bringt aber nichts mehr. Das ist die gewünschte Form — die extra-Chunks landen dort , wo sie wirken (summary/broad) , ohne focused-Anfragen unnötig zu vergrößern. Quelle: `papers/_evidence/adaptive-topk.md` (Kern-Befund 3).

4. **Aggregat-Gewinn** `r_req` von `0.427` (k3) auf `0.592` (k12) , +39 %. Im Composite-Ranking führt `adaptive_k12_rr20` (`0.159`) vor `adaptive_k8_rr20` (`0.156`) und `adaptive_k3_rr20` (`0.114`) — getrieben allein durch recall@5 , da `judge`/TTFT in diesem Lauf fehlen. Quelle: `papers/_evidence/adaptive-topk.md` (Kern-Befunde 4–5).

5. **Coverage-Ceiling auf summary.** Selbst bei `topK=12` werden nur ~47 % der required Chunks für summary-Anfragen erreicht. Das ist die obere Grenze reiner Top-K-Skalierung auf diesem Korpus: weiteres Hochschrauben von `topK` würde zunehmend Distraktoren statt fehlender required-Chunks einsammeln. Höhere Coverage erfordert einen anderen Mechanismus (Map-Reduce über das ganze Dokument) , nicht mehr Tiefe. Quelle: `papers/_evidence/adaptive-topk.md` (Caveat „Ceiling auf summary").

6. **`FOCUSED_TOP_K=3` evtl. zu konservativ.** Der focused-Gewinn k=3 → k=8 (+33 %) ist überraschend für eine angebliche Single-Chunk-Kontrollgruppe — vermutlich landen einige focused-Faktoide nach dem Rerank auf Rang 4–7 statt 1–3 , sodass `topK=3` sie verfehlt. Falls bestätigt , wäre die Baseline `FOCUSED_TOP_K=3` selbst zu konservativ und eine breitere Default-Baseline (k=5) könnte allen drei Intents helfen. Das verlangt eine eigene focused-Eval. Quelle: `papers/_evidence/adaptive-topk.md` (Caveat „FOCUSED_TOP_K=3").

## 6 Limitationen & Threats to Validity

- **Coverage ≠ Antwort-Qualität.** Dieser Lauf misst ausschließlich Retrieval-Recall. Der Judge-Pass (Nemotron 30B-A3B XL) sollte parallel laufen , scheiterte aber an VRAM: 32 GB total auf RTX 5090 , aber nur ~19 GB frei zur Laufzeit ; Nemotron Q4 + KV-Cache braucht ~20–22 GB. Die 75 generierten Antworten liegen unter `2026-05-21T18-55-39_2208911_dirty/configs/*/per-question.jsonl` und können nach VRAM-Freigabe nachträglich gejudged werden. **TODO: Judge-Lauf nötig** , um Coverage→Qualität zu belegen. Quelle: `papers/_evidence/adaptive-topk.md` (Caveat „Coverage ≠ Antwort-Qualität") , bestätigt durch `llmEnabled:false`/`judgeAvg:null` in summary.json.

- **Kleine n pro Intent.** focused n=6 , broad n=13 , summary n=6 — gesamt 25 Fragen. Der Headline-Effekt +98 % auf summary beruht auf 6 Fragen ; einzelne Hits/Misses verschieben die Prozent-Werte stark. Margins zwischen den Configs sind als Richtung , nicht als präzise Effektgröße zu lesen. **TODO: Lauf mit größerem n nötig** für belastbare Per-Intent-Effektgrößen. Quelle: `papers/_evidence/adaptive-topk.md` (Caveat „Kleine n pro Intent").

- **Lauf ist `dirty`.** Uncommitted working tree zur Lauf-Zeit (git `2208911` , branch `feat/settings-ollama-connector`). Das `_dirty`-Flag im Run-Dir-Namen markiert das ; der Lauf gilt nicht als clean-Baseline. Quelle: env.json / summary.md (via `papers/_evidence/adaptive-topk.md` Lauf-Umgebung).

- **GPU-Reranker vs. CPU-Embedder — kein Produktions-Timing.** Embedder läuft auf CPU (mirrors prod default) , Reranker auf GPU. Die gemessenen Phasen-Timings (Tabelle F) sind daher ein Misch-Profil und kein faithful CPU-only-End-User-Timing ; zudem ist der LLM-/Prefill-Anteil (TTFT-dominant) hier 0 , weil kein LLM lief. Die TTFT-Spalten in Tabelle C/F sind Mess-Stubs , keine echten Time-to-First-Token-Werte. Quelle: `papers/_evidence/methodology.md` Abschnitt 2 + Abschnitt 11 ; `papers/_evidence/adaptive-topk.md` (Tabelle 6 Note).

- **VRAM nicht gesampelt** in diesem Lauf (`freeVramGBMin = null` für alle Configs). Quelle: summary.json (`resourcePeak.freeVramGBMin`).

- **Eval umgeht die Produktions-RAG-Pipeline.** Gemessen wird isoliert Embedder + Reranker auf vorgefertigten Chunks ; übersprungen werden BM25+dense-Fusion , multi-query expansion , title-boost / short-chunk-penalty / recency-Heuristiken , doc-diversification , whole-doc-fallback , neighbour-expansion , DB-I/O und worker-IPC. Produktions-Coverage kann durch diese Schichten abweichen. Quelle: `papers/_evidence/methodology.md` Abschnitt 11.

- **`chunk-size` = Zeichen , nicht Tokens** im Eval-Chunker (`fixed-512-64` = 512 Zeichen). Beim Übersetzen in Token-Aussagen beachten. Quelle: `tests/evals/pipeline/Chunker.ts` Z. 9 (via `papers/_evidence/methodology.md` Abschnitt 5).

## 7 Reproduzierbarkeit

Der Lauf ist ein `--configs adaptive --no-llm`-Sweep gegen den committeten Datensatz. Exakte Kommandos (aus `package.json` `scripts` + `tests/evals/sweep.ts` CLI-Header):

```bash
# 1) Modelle für Evals bereitstellen (Embedder bge-m3 , Reranker bge-reranker-v2-m3)
node scripts/download-models.mjs evals

# 2) Adaptive-TopK-Sweep gegen den committeten Datensatz , retrieval-only (kein LLM/Judge)
pnpm evals:sweep -- \
  --dataset tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json \
  --configs adaptive \
  --no-llm

# entspricht direkt:
tsx tests/evals/sweep.ts \
  --dataset tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json \
  --configs adaptive \
  --no-llm
```

Hinweise:

- `--configs adaptive` wählt `adaptiveTopKConfigs()` → 3 Punkte k3/k8/k12 , alle `topKToRerank=20`. Quelle: `tests/evals/sweep.ts` Z. 178–179 ; `tests/evals/pipeline/configs.ts`.
- `--no-llm` überschreibt alle `config.llm` auf `null` (skip TTFT-/Judge-Pass) — exakt der hier dokumentierte Lauf. Quelle: `tests/evals/sweep.ts` Z. 22 , 838.
- Ohne `--dataset` nimmt der Sweep das jüngste File unter `tests/evals/data/datasets/`. Quelle: `tests/evals/sweep.ts` Z. 19.
- Der Sweep schreibt einen neuen `report/runs/<stamp>_<git-sha>[_dirty]/`-Ordner ; bestehende Ordner werden nie überschrieben. Quelle: `tests/evals/runDir.ts`.
- **Coverage→Qualität nachholen** (nach VRAM-Freigabe): denselben Sweep mit `--judge` und gepinntem XL-Judge laufen lassen , z. B. `pnpm evals:sweep -- --dataset <…> --configs adaptive --judge --judge-context 8192`. Quelle: `tests/evals/sweep.ts` Z. 17 , 26–27 , 840.

Datensatz-Integrität: `dataset.json` trägt sha256 (erste 16 hex) `7309d51bec624f6d` ; ein Re-Run muss denselben Hash erzeugen , sonst wurde der Datensatz verändert. Quelle: `tests/evals/runDir.ts` ; `papers/_evidence/adaptive-topk.md` (Datensatz / Provenienz).

## Referenzen

**Quell-Dateien (workspace-relativ)**

- `tests/evals/report/adaptive-topk-2026-05-21.md` — narrativer Report (Headline + Per-Intent-Breakdown + Interpretation + Fazit) → Tabellen A , B.
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.md` — Quality + TTFT → Tabelle C.
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/summary.json` — full-precision Metriken + Phasen + Ressourcen → Tabellen E , F.
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/ranking.md` — Composite-Ranking → Tabelle D.
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/dataset.json` — Dataset-Provenienz (sha256 `7309d51bec624f6d`).
- `tests/evals/report/runs/2026-05-21T18-47-06_2208911_dirty/env.json` — Lauf-Umgebung (CPU/RAM/git/node).
- `tests/evals/data/datasets/handcrafted-adaptive-topk-2026-05-21T18-46-35.json` — Datensatz (Header Z. 1–4: generator/generatedAt/chunker).
- `src/main/services/qa/QAService.ts` — `classifyQueryBreadth`-Heuristik (focused→3 / broad→8 / summary→12).
- `tests/evals/metrics.ts` — `recall@k` / `recall_req@k` / `MRR` / `nDCG@k` Definitionen.
- `tests/evals/pipeline/configs.ts` — `adaptiveTopKConfigs()` , LLM-Pin.
- `tests/evals/pipeline/Chunker.ts` — `FixedSizeChunker` (512/64).
- `tests/evals/runDir.ts` — Run-Dir-Layout , env/git/dataset-Provenienz , sha256.
- `tests/evals/judge/Judge.ts` — 3-Dimensions-Judge , Composite-Formel.
- `papers/_evidence/adaptive-topk.md` — domain-Evidenz (alle Zahlen verbatim).
- `papers/_evidence/methodology.md` — geteilte Methodik-Quelle.

**Externe Datensätze / Modelle (mit Lizenz)**

- **BGE-M3** (Embedder , CPU-Placement) — BAAI ; MIT-Lizenz.
- **bge-reranker-v2-m3** (Reranker , GPU-Placement) — BAAI ; Apache-2.0-Lizenz.
- **Nemotron 3 Nano 30B-A3B** (XL-Judge , in diesem Lauf **nicht** geladen) — NVIDIA ; NVIDIA Open Model License.
- Der `handcrafted-adaptive-topk`-Datensatz ist hand-kuratiert (`manual-handcrafted:adaptive-topk-eval`) und Teil dieses Repos ; keine externe Datensatz-Lizenz.
