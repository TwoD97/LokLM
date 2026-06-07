# LokLM — Eval-Bericht: Antwort-LLM-Vergleich (15-Modell-Pack)

**Datum:** 2026-06-07 · **Branch:** `dom/evals-automation` · **git-sha:** `af20084` (dirty=false)
**Durchgeführt von:** Dominik (Test-Owner) · **Pack:** `tests/evals/answer/model-pack.json`

---

## 1. Fragestellung

Welches **Antwort-LLM** liefert in der LokLM-RAG-Pipeline die beste Antwortqualität
bei vertretbarer Latenz? Embedder, Reranker und Chunking sind dabei **fix** — variiert
wird ausschließlich das Antwort-Modell. Ein großes, separates Modell (Mistral-Small-24B)
bewertet jede Antwort als **Judge** (correctness / groundedness / helpfulness).

## 2. Methode (Reproduzierbarkeit)

- **Orchestrierung:** `evals:pack` (subprocess-per-model, absturzsicher + resume-fähig).
- **15 Antwort-Modelle** × **2 Datensätze** × Judge.
- **Composite-Score** = `judge·2 + recall@5 − TTFT_sek·0.5` (höher = besser).
- **Judge:** Mistral-Small-3.2-24B-Instruct-2506 (Q5_K_M) — ≠ Prüfling (kein Self-Bias).
- **Embedder:** bge-m3 (Q4_K_M, CPU) · **Reranker:** bge-reranker-v2-m3 (Q4_K_M).

### Provenienz (für die Paper-Zitierfähigkeit)

| Feld            | Wert                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| git-sha / dirty | `af20084` / `false`                                                                     |
| Hardware        | RunPod, **RTX PRO 4500 Blackwell (32 GB)**, AMD EPYC 7443 (48 T), 251 GB RAM, Linux 6.8 |
| Node            | v24.16.0                                                                                |
| Datensatz A     | `xquad-de-300q` — sha256 `b9d1dc5b427dc117`, 300 Fragen, 240 Chunks                     |
| Datensatz B     | `focused-260q` — sha256 `c3c7890ee5801008`, 260 Fragen, 52 Chunks                       |

---

## 3. Ergebnisse

### 3.1 Datensatz A — xquad-de-300q (300 Fragen, recall@5 = 0,973 für alle)

| Rang | Modell                | Composite |     Judge | recall@5 | TTFT p50 (ms) | FullResp p50 (ms) |
| ---: | --------------------- | --------: | --------: | -------: | ------------: | ----------------: |
|    1 | **qwen3-4b-instruct** | **2.739** |     0.975 |    0.973 |           367 |               778 |
|    2 | qwen3.5-4b            |     2.681 |     0.961 |    0.973 |           430 |               625 |
|    3 | qwen3-8b              |     2.667 |     0.958 |    0.973 |           445 |               888 |
|    4 | mistral-nemo-12b      |     2.646 |     0.960 |    0.973 |           493 |               905 |
|    5 | qwen3.5-9b            |     2.631 |     0.957 |    0.973 |           511 |             20112 |
|    6 | smollm3-3b            |     2.628 |     0.910 |    0.973 |           330 |               335 |
|    7 | qwen3-14b             |     2.625 | **0.981** |    0.973 |           621 |              1266 |
|    8 | phi-4-14b             |     2.625 |     0.974 |    0.973 |           592 |              1154 |
|    9 | phi-4-mini            |     2.618 |     0.901 |    0.973 |           317 |               243 |
|   10 | qwen3.5-2b            |     2.617 |     0.900 |    0.973 |           313 |               963 |
|   11 | hermes-3-8b           |     2.604 |     0.921 |    0.973 |           422 |               704 |
|   12 | gemma-3-4b            |     2.600 |     0.910 |    0.973 |           384 |               385 |
|   13 | granite-3.3-8b        |     2.570 |     0.936 |    0.973 |           551 |              1349 |
|   14 | llama-3.2-3b          |     2.531 |     0.860 |    0.973 |           323 |               590 |
|   15 | qwen3.5-27b           |     2.333 |     0.956 |    0.973 |          1107 |             55167 |

### 3.2 Datensatz B — focused-260q (260 Fragen, recall@5 = 0,804 für alle)

| Rang | Modell                | Composite |     Judge | recall@5 | TTFT p50 (ms) | FullResp p50 (ms) |
| ---: | --------------------- | --------: | --------: | -------: | ------------: | ----------------: |
|    1 | **qwen3-4b-instruct** | **2.515** |     0.927 |    0.804 |           284 |              1003 |
|    2 | qwen3-14b             |     2.503 |     0.957 |    0.804 |           429 |              1291 |
|    3 | qwen3.5-4b            |     2.478 |     0.926 |    0.804 |           357 |               639 |
|    4 | qwen3-8b              |     2.474 |     0.918 |    0.804 |           331 |               982 |
|    5 | phi-4-14b             |     2.465 |     0.933 |    0.804 |           412 |              1515 |
|    6 | qwen3.5-9b            |     2.452 |     0.927 |    0.804 |           413 |             20128 |
|    7 | mistral-nemo-12b      |     2.430 |     0.905 |    0.804 |           369 |               948 |
|    8 | qwen3.5-2b            |     2.423 |     0.877 |    0.804 |           270 |              1050 |
|    9 | granite-3.3-8b        |     2.407 |     0.895 |    0.804 |           376 |              1387 |
|   10 | gemma-3-4b            |     2.363 |     0.853 |    0.804 |           296 |               404 |
|   11 | smollm3-3b            |     2.353 |     0.840 |    0.804 |           261 |               521 |
|   12 | hermes-3-8b           |     2.344 |     0.848 |    0.804 |           311 |               941 |
|   13 | phi-4-mini            |     2.268 |     0.796 |    0.804 |           257 |               218 |
|   14 | llama-3.2-3b          |     2.090 |     0.708 |    0.804 |           257 |               624 |
|   15 | qwen3.5-27b           |     0.386 | — (crash) |    0.804 |           835 |              8311 |

---

## 4. Erkenntnisse

1. **Retrieval dominiert, nicht das Antwort-LLM.** `recall@5` ist über alle 15 Modelle
   **identisch** (0,973 bzw. 0,804) — die richtige Stelle wird vom Embedder/Reranker
   gefunden, unabhängig vom Antwortmodell. Der einzige echte Qualitäts-Unterschied
   steckt im **Judge-Score**, und der variiert nur moderat.
2. **Ein 4B-Modell gewinnt beide Datensätze.** `qwen3-4b-instruct` ist 1. auf xquad _und_
   focused — gute Antwortqualität bei niedriger Latenz. Bigger ≠ better: die 14B/27B
   haben minimal höhere Judge-Werte, werden aber durch Latenz im Composite überholt.
3. **Tier-Wahl der App bestätigt.** `qwen3.5-4b` (standard-Tier) ist Platz 2/3 — das
   ausgelieferte Modell ist eine gute Wahl.
4. **Der 27B lohnt nicht.** Langsamste Antwortzeit (bis ~55 s FullResp) und auf focused
   ein Absturz (node-llama-cpp exit 134) — Aufwand/Nutzen schlecht.

## 5. Einschränkungen

- **1 von 30 Läufen fehlgeschlagen:** `qwen3.5-27b` auf focused (exit 134 / Abort beim
  größten Modell; auf xquad lief er durch). Reproduzierbarer node-llama-cpp-Effekt; ohne
  Auswirkung auf die Aussage, da der 27B ohnehin Schlusslicht ist.
- Judge-Werte sind eine Modell-Bewertung (Mistral-24B), keine menschliche Annotation.
- Rohdaten (per-Frage-jsonl, resource-samples) liegen in den Run-Dirs (gitignored);
  Provenienz oben erlaubt exakte Reproduktion bei git-sha `af20084`.
