# Evaluierung der Retrieval-Pipeline: Embedder, Reranker und Top-K

**Kurzfassung.** Dieses paper evaluiert die retrieval-qualität der LokLM-pipeline aus
embedder `bge-m3` und cross-encoder-reranker `bge-reranker-v2-m3` über zwei achsen:
`topK` (an den LLM gereichte chunks) und `rerank-pool` (vor dem rerank gezogene
kandidaten). Auf dem kleinen , sauber vor-sortierten `agent-batch`-pool (52 chunks)
zeigt ein grid-sweep , dass `k=3` die qualität maximiert und ein cross-encoder-rerank
dort nur inkonsistent hilft — der judge-gewinner ist rerank-off (`grid_k3_rr0` ,
composite 2.243). Eine skalierte cross-dataset-validierung auf dem
`wikipedia-survival`-haystack (2939 chunks , 1255 fragen) kehrt diesen befund um: der
reranker hebt recall@1 von 0.552 auf 0.844 (+0.292) und MRR von 0.623 auf 0.867 , wobei
recall@5 = recall@10 = 0.894 das ceiling des dense-top-50-pools markiert. Wir
analysieren diesen recall-ceiling-effekt , den reranker-nutzen als funktion der
pool-noisigkeit und die GPU-vs-CPU-timing-caveats (GPU-rerank ~80–160 ms vs. CPU
1–2 s ; CPU-korpus-embed > 70 min). Alle zahlen stammen ausschließlich aus committeten
run-reports bzw. den evidence-dateien ; offene messungen sind als „TODO: Lauf nötig"
markiert.

---

## 1 Einleitung / Motivation

LokLM ist eine lokal laufende RAG-anwendung ; die retrieval-stufe entscheidet , ob der
under-test-LLM überhaupt den richtigen text-ausschnitt sieht. Diese stufe besteht aus
einem dense embedder (`bge-m3` , prod-default auf CPU) und einem optionalen
cross-encoder-reranker (`bge-reranker-v2-m3` , prod-default opt-in). Zwei
freiheitsgrade bestimmen qualität und latenz unmittelbar: `topK` (wie viele chunks in
den prompt wandern) und der `rerank-pool` (wie tief der reranker den dense-kandidatensatz
re-ordnet). Die leitfrage lautet: **hilft cross-encoder-rerank auf einem sauberen
cosine-pool , und welcher `topK` maximiert qualität bei niedrigster TTFT?**

Diese frage hat eine produktrelevanz: rerank kostet latenz (auf CPU 1–2 s) und sollte
nur dann default-on sein , wenn der qualitätsgewinn ihn rechtfertigt. Zugleich war zu
prüfen , ob ein befund vom kleinen 52-chunk-pool auf einen realistischen haystack mit
tausenden distractor-chunks generalisiert — daher die skalierte cross-dataset-validierung
auf `wikipedia-survival` (2939 chunks). Evals sind in LokLM eine **eigene säule neben
der test-pyramide** (`unit/`, `integration/`, `tx/`, `e2e/`): sie testen nicht
korrektheit (pass/fail) , sondern die **qualität einer probabilistischen pipeline** und
liefern vergleichbare zahlen (recall@k , MRR , nDCG) statt binärer assertions. Eine eval
„schlägt nicht fehl" — sie schneidet besser oder schlechter ab.

## 2 Aufbau & Methodik

### 2.1 Hardware (Dev-/Mess-Box)

Alle läufe liefen auf derselben mess-box: **Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz ×
16 , 31.9 GB RAM** , dazu eine **RTX 5090 (32 GB VRAM)**. OS `win32` , release
`10.0.26200` , arch `x64` , node `v22.15.1`. Die hardware-info wird von `runDir.ts`
(`hardwareInfo()`) automatisch in `env.json` erfasst ; VRAM/GPU-backend reicht der
caller nach.

**Placement-konvention** (spiegelt den prod-default): **embedder auf CPU** ,
reranker/LLM auf GPU. GPU-läufe sind explizit ein **korrektheits-/qualitäts-check ,
NICHT der produktions-CPU-timing-benchmark** — faithful-CPU-timings sind separate
`evals:sweep --no-llm`-läufe. Diese trennung ist für die timing-aussagen in abschnitt 5
zentral.

### 2.2 Harness und Provenienz

Jeder sweep-run schreibt einen unveränderlichen run-dir
`report/runs/<stamp>_<git-sha>[_dirty]/` mit `env.json` (CPU/RAM/OS/git/node) ,
`dataset.json` (path + sha256-hash) , `summary.md`/`.json` (vergleichstabelle aller
configs) , `ranking.md` (nach composite sortiert) und pro config einem unterordner mit
`result.json` , `per-question.jsonl` und `resource-samples.jsonl`. **Folders werden nie
überschrieben** ; git-sha + `_dirty`-flag im namen verhindern , dass ein dirty-run
heimlich als clean-baseline gilt. `dataset.json` trägt einen sha256-prefix (erste 16
hex) , damit reports über zeit komparabel bleiben.

Der chunker ist in allen produktiv genutzten configs der kanonische default
`fixed-512-64` (512-zeichen-fenster , 64 overlap ; `step = size − overlap`). `size`
ist dabei **zeichen , nicht tokens** — beim übersetzen in token-aussagen zu beachten.

### 2.3 Metrik-Definitionen

Wörtlich aus `tests/evals/metrics.ts` , single-relevant (jede query hat genau einen
ground-truth `chunkId`):

| Metrik       | Definition (`metrics.ts`)                                                             | Formel im Code                                                                    |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **recall@k** | anteil der queries , bei denen die richtige antwort in den ersten k ergebnissen liegt | `hits / results.length` , hit wenn `chunkIds.slice(0,k).includes(expected)`       |
| **MRR**      | mean reciprocal rank , 1/rank über alle queries gemittelt                             | `Σ (1/rank) / N` , `rank = indexOf(expected)+1`                                   |
| **nDCG@k**   | normalized discounted cumulative gain auf k                                           | `Σ (1/log2(rank+1)) / N` ; single-relevant ist ideal-DCG konstant `1/log2(2) = 1` |

Für broad/summary-fragen existiert zusätzlich `recall_req@k` (multi-relevant , mittlerer
anteil der required-chunks in top-k) ; es reduziert sich exakt auf recall@k wenn
`|required|=1`. Beide hier verwendeten datensätze sind single-relevant
(`requiredChunkIds=[chunkId]`) , daher ist diese metrik hier deckungsgleich mit recall@k.

### 2.4 Composite-Score und Judge

Für die LLM-läufe (Lauf B) sortiert ein **composite-score** die configs:

```
composite = 2 × judge.score + 1 × recall@5 − 0.5 × (TTFT_p50_ms / 1000)
```

Gewichte (opinionated): judge ×2 (qualität ist hauptsache) , recall@5 ×1 (fallback wenn
judge fehlt) , TTFT-penalty ×0.5 linear in sekunden (maximal −1 bei 2 s TTFT). Höher =
besser , NaN-safe. Der **judge** ist **Nemotron 3 Nano 30B-A3B** (XL-profil , lokal ,
~18 GB VRAM , deterministisch fest gepinnt , nur im 2. pass geladen). Er bewertet drei
dimensionen (correctness , groundedness , helpfulness , skala 0–10 → normalisiert
0..1) ; `score = (c + g + h) / 3`. Der under-test-LLM ist bewusst vom judge getrennt
(pin auf `'full'` = Qwen3-8B) , sonst self-bias.

Für den reinen retrieval-lauf (Lauf A , `llmEnabled` aus) ist die judge-spalte leer
(`-`) , der composite reduziert sich faktisch auf `recall@5 − ttft_sec × 0.5`. **Die
composite-werte der beiden läufe sind daher NICHT direkt vergleichbar** (A: ~0.19–0.51
ohne judge-term ; B: ~2.0–2.24 mit `2·judge`).

### 2.5 Pipeline-Configs und Namensschema

Die grid-configs heißen `grid_k<topK>_rr<pool>` — `k` = an den LLM gereichte chunks ,
`rr` = rerank-pool-tiefe (`rr0` = rerank aus). Configs unterscheiden sich nur in diesen
zwei achsen ; embedder (`bge-m3`) und reranker (`bge-reranker-v2-m3`) sind fix. Der
under-test-LLM in Lauf B ist Qwen3-8B Instruct (GPU/CUDA , Q4_K_M , ~5 GB VRAM). Das
LLM ist auf `'full'` gepinnt , nie `'auto'` , damit `resolveLlmPath` nicht das
XL-judge-modell als under-test mountet.

TTFT setzt sich aus sechs phasen zusammen (`ttftMs = sum(queryEmbed, retrieve, rerank,
promptAssemble, prefill, firstDecode)`). Relevant für rerank-kosten ist die
`rerank`-phase (cross-encoder ; 0 wenn `topKToRerank=0`).

## 3 Datensatz

Drei datensätze sind beteiligt ; alle tragen denselben chunker `fixed-512-64`.

| Dataset (Datei)                                        | Fragen | Chunks | Generator                                     | Lizenz / Quelle                                                                                                   |
| ------------------------------------------------------ | -----: | -----: | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json` |    260 |     52 | `agent-batch:claude-opus-4-7`                 | quell-batch des grid-sweeps ; sha256 `43207410dc46debe` , `generatedAt 2026-05-17T20:43:09.742Z` , `library null` |
| `focused-260q-2026-05-24T16-59-04.json`                |    260 |     52 | `salvage-focused:agent-batch:claude-opus-4-7` | salvage des agent-batch ; alle 260 `intent=focused` , `requiredChunkIds=[chunkId]` , single-relevant              |
| `wikipedia-survival-1255q-2026-06-13T11-42-44.json`    |   1255 |   2939 | `wikipedia-survival:agent-verified`           | **CC BY-SA 4.0** ; EN-Wikipedia `prop=extracts` , fetched 2026-06-13                                              |

**Grid-sweep-datensatz.** Beide grid-läufe (A und B) teilen den `agent-batch`-datensatz
(260 fragen , 52 chunks). Pro config wurden nur stichproben gewertet: **n=10** in Lauf A
, **n=30** in Lauf B — nicht alle 260 fragen.

**Wikipedia-survival-haystack.** EN-Wikipedia-plaintext über `prop=extracts` (kein OCR ,
kein PDF/HTML-parsing) , 50 artikel in 5 survival/referenz-themen (je 10 artikel:
`first-aid` , `water-food` , `disease-sanitation` , `wilderness-navigation` ,
`rebuild-tech`). End-sektionen (References/External links/…) abgeschnitten , whitespace
normalisiert , dann `fixed-512-64`-chunking → **2939 chunks**. Davon **869 referenziert**
(tragen eine frage) + **2070 distractors** (bleiben im haystack). Die fragen sind
agent-generiert (Opus) + adversarial verifiziert durch einen unabhängigen verifier-agent:
**1322 kandidaten generiert → 1255 behalten** (~5 % verworfen) , über 112
verifier-/generator-agenten. Pro-thema (behalten): first-aid 192 , water-food 258 ,
disease-sanitation 267 , wilderness-navigation 251 , rebuild-tech 287. Assemble-validierung:
0 bad lines , 0 unknown-id , 0 dupes , 0 dangling required-refs.

Reproduzierbarkeits-konvention: datensätze werden **einmal generiert und committed** ,
nur regeneriert wenn sample-docs oder generator-prompts sich ändern.

## 4 Ergebnisse

> Alle zahlen wörtlich aus committeten run-reports bzw. den evidence-dateien.
> `per-question.jsonl` wurde nicht gelesen (zu groß) — nur summary/ranking/result.

### 4.1 Lauf A — reines Retrieval (kein LLM/Judge) , n=10

Breiterer pool-fächer (rr0/10/20/40) und höhere k (k3/5/8). `judge` = `-`. Composite
ohne judge = `recall@5 − ttft_sec × 0.5`.
Quelle: `report/runs/2026-05-20T18-31-49_9498853_dirty/summary.md` + `summary.json` +
`ranking.md` (git `9498853` , dirty , branch `feat/settings-ollama-connector`).

| Config       |   n | r@1 |   r@5 |  r@10 |    MRR | nDCG@10 | TTFT p50 (ms) | rerank (ms) | composite |
| ------------ | --: | --: | ----: | ----: | -----: | ------: | ------------: | ----------: | --------: |
| grid_k3_rr0  |  10 | 0.5 | 0.800 | 0.800 | 0.6333 |  0.6762 |           667 |         0.0 |     0.467 |
| grid_k5_rr0  |  10 | 0.5 | 0.800 | 0.800 | 0.6333 |  0.6762 |           634 |         0.0 |     0.483 |
| grid_k8_rr0  |  10 | 0.5 | 0.800 | 0.800 | 0.6333 |  0.6762 |           735 |         0.0 |     0.432 |
| grid_k3_rr10 |  10 | 0.7 | 0.900 | 0.900 | 0.8000 |  0.8262 |           792 |       211.9 |     0.504 |
| grid_k5_rr10 |  10 | 0.7 | 0.900 | 0.900 | 0.8000 |  0.8262 |           790 |       158.0 | **0.505** |
| grid_k8_rr10 |  10 | 0.7 | 0.900 | 0.900 | 0.8000 |  0.8262 |           869 |       156.8 |     0.465 |
| grid_k3_rr20 |  10 | 0.6 | 0.800 | 0.800 | 0.7000 |  0.7262 |           963 |       330.4 |     0.318 |
| grid_k5_rr20 |  10 | 0.6 | 0.900 | 0.900 | 0.7250 |  0.7693 |           950 |       311.8 |     0.425 |
| grid_k8_rr20 |  10 | 0.6 | 0.900 | 0.900 | 0.7250 |  0.7693 |          1033 |       312.9 |     0.384 |
| grid_k3_rr40 |  10 | 0.6 | 0.800 | 0.800 | 0.7000 |  0.7262 |          1216 |       628.1 |     0.192 |

Befund: rerank hebt recall/MRR moderat — bei rr10 steigen r@5/r@10 von 0.800 auf 0.900 ,
MRR von 0.633 auf 0.800 , nDCG@10 von 0.6762 auf 0.8262. Aber rr20/rr40 verschlechtern
wieder (MRR fällt auf 0.700–0.725 ; rr40 r@5 zurück auf 0.800). **Das optimum liegt bei
rr10 , nicht am tiefsten pool.** Composite-sieger ist `grid_k5_rr10` (0.505) , knapp vor
`grid_k3_rr10` (0.504). Die TTFT-rerank-phase wächst monoton mit pool-tiefe: bei k=3
0.0 → 211.9 → 330.4 → 628.1 ms (rr0 → rr10 → rr20 → rr40).

### 4.2 Lauf B — Retrieval + LLM (Qwen3-8B) + Judge , n=30

Engerer pool-fächer (rr0/3/5/10) , niedrigere k (k2/3/5). Dies ist der
Qwen3-8B-quell-lauf der 3-modell-vergleichstabelle.
Quelle: `report/runs/2026-05-20T19-46-39_45bf322_dirty/summary.md` + `summary.json` +
`ranking.md` (git `45bf322` , dirty). Composite = 2·judge + recall@5 − 0.5·TTFT_sec.

| Config       |   n |    r@1 |   r@5 |  r@10 |   MRR | nDCG@10 |  judge |  corr | ground |  help | TTFT p50 (ms) | rerank (ms) | composite |
| ------------ | --: | -----: | ----: | ----: | ----: | ------: | -----: | ----: | -----: | ----: | ------------: | ----------: | --------: |
| grid_k3_rr0  |  30 |    0.5 | 0.700 | 0.700 | 0.589 |  0.6175 | 0.9233 | 0.950 |  0.963 | 0.857 |           606 |         0.0 | **2.243** |
| grid_k5_rr0  |  30 |    0.5 | 0.700 | 0.700 | 0.589 |  0.6175 | 0.9233 | 0.953 |  0.967 | 0.850 |           640 |         0.0 |     2.227 |
| grid_k2_rr5  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.9222 | 0.950 |  0.967 | 0.850 |           648 |        79.1 |     2.221 |
| grid_k2_rr3  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.8933 | 0.923 |  0.933 | 0.823 |           610 |       109.7 |     2.182 |
| grid_k3_rr10 |  30 | 0.6333 | 0.733 | 0.733 | 0.683 |  0.6964 | 0.9056 | 0.937 |  0.940 | 0.840 |           743 |       158.9 |     2.173 |
| grid_k5_rr5  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.9122 | 0.937 |  0.957 | 0.843 |           722 |        79.2 |     2.163 |
| grid_k2_rr10 |  30 | 0.6333 | 0.733 | 0.733 | 0.683 |  0.6964 | 0.8922 | 0.920 |  0.933 | 0.823 |           709 |       159.8 |     2.163 |
| grid_k3_rr3  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.8878 | 0.913 |  0.930 | 0.820 |           628 |        47.7 |     2.162 |
| grid_k5_rr3  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.8878 | 0.913 |  0.930 | 0.820 |           645 |        48.6 |     2.153 |
| grid_k5_rr10 |  30 | 0.6333 | 0.733 | 0.733 | 0.683 |  0.6964 | 0.8867 | 0.917 |  0.933 | 0.810 |           787 |       157.9 |     2.113 |
| grid_k3_rr5  |  30 |    0.7 | 0.700 | 0.700 | 0.700 |  0.7000 | 0.8600 | 0.887 |  0.900 | 0.793 |           679 |        81.5 |     2.081 |
| grid_k2_rr0  |  30 |    0.5 | 0.633 | 0.633 | 0.567 |  0.5841 | 0.8311 | 0.860 |  0.867 | 0.767 |           581 |         0.0 |     2.005 |

Befund: die top-2 plätze sind **rerank-off** (`grid_k3_rr0` 2.243 , `grid_k5_rr0` 2.227 ,
beide judge 0.923). Erst platz 3 ist eine rerank-config (`grid_k2_rr5` 2.221 , judge
0.922). Der judge-effekt von rerank ist **achsen-abhängig**: bei k=2 hebt rr5 den judge
von 0.831 (rr0) auf 0.922 (sonst recall-collapse — `grid_k2_rr0` ist mit composite 2.005
/ r@5 0.633 schlusslicht) ; bei k=3 senkt rr5 ihn von 0.923 auf 0.860 ; bei k=5 von
0.923 auf 0.912. Beachte: das reine recall@1 ist bei den rerank-configs höher (0.7 vs.
0.5 bei `grid_k3_rr0`) , aber die judge-bewertete antwort-qualität folgt dem nicht.

### 4.3 Per-Phase-Latenz und Cross-Model-Kontext (Lauf B)

Der 3-modell-vergleich zitiert dieselben Lauf-B-zahlen plus die per-phase-latenz quer
über drei modelle. Hier nur die retrieval/rerank/latenz-relevanten teile.
Quelle: `report/3-model-comparison-2026-05-20.md` (Per-Phase Latency , Composite
Ranking).

| Modell       | Config      | qEmb (CPU , ms) | retrieve (ms) | rerank (GPU , ms) | prefill (GPU , ms) | fullResp p50 (ms) |
| ------------ | ----------- | --------------: | ------------: | ----------------: | -----------------: | ----------------: |
| Qwen3-8B     | grid_k3_rr0 |             503 |           0.3 |                 0 |                190 |               809 |
| Qwen3-8B     | grid_k5_rr0 |             514 |           0.3 |                 0 |                138 |               920 |
| Qwen3-8B     | grid_k2_rr5 |             513 |           0.3 |                79 |                 54 |               786 |
| Granite      | grid_k3_rr0 |             505 |           0.3 |                 0 |                123 |               800 |
| Granite      | grid_k2_rr5 |             511 |           0.3 |                84 |                 61 |               691 |
| Mistral-Nemo | grid_k3_rr0 |             518 |           0.4 |                 0 |                112 |               613 |
| Mistral-Nemo | grid_k2_rr5 |             523 |           0.3 |                84 |                 64 |               578 |

Der `qEmb`-anteil (CPU-embedder) dominiert die TTFT-vorderkante (~500 ms) ; `retrieve`
(BM25+dense+sort) ist <0.5 ms ; `rerank` auf GPU kostet ~79–84 ms im k2_rr5-fall. Die
GPU-TTFT-spannen sind über alle drei modelle klein (606–693 ms ; siehe
3-modell-vergleich).

### 4.4 Tabelle C — Wikipedia-Survival Retrieval (n=1255 , voller 2939-Chunk-Haystack)

Voller lauf: alle 1255 fragen über den vollen 2939-chunk-haystack. **GPU placement** ,
embedder `bge-m3` (Q4_K_M) , reranker `bge-reranker-v2-m3` (Q4_K_M , **pool=50
dense-kandidaten**) , single-relevant.
Quelle: `papers/_evidence/wikipedia-survival.md` (Retrieval-Ergebnisse).

| Metrik    | dense (bge-m3 , kein rerank) | dense + rerank (bge-reranker-v2-m3) |
| --------- | ---------------------------: | ----------------------------------: |
| recall@1  |                        0.552 |                           **0.844** |
| recall@5  |                        0.714 |                           **0.894** |
| recall@10 |                        0.758 |                           **0.894** |
| MRR       |                        0.623 |                           **0.867** |
| nDCG@10   |                        0.656 |                           **0.874** |

Validierungs-stichprobe vorab (250 stride-gesampelte fragen , dense , kein rerank):
recall@1 0.544 , recall@5 0.688 , recall@10 0.744 , MRR 0.615 , nDCG@10 0.646 —
konsistent mit dem vollen lauf.

**Timing (GPU).** Embedder warm 3.6 s ; korpus-embed (2939 chunks) **48.7 s** ;
query+rerank-loop (1255 fragen) **1052 s (~17.5 min , seriell)** — 1255 query-embeds +
1255 rerank-calls. `EmbedderBridge.embedBatch` embeddet seriell (keine batch-API in
node-llama-cpp). Zum vergleich: CPU `bge-m3` ≈ 1.5 s/chunk → 2939 chunks > 70 min , unter
dauerlast thermisch gedrosselt (i9-9900K).

## 5 Diskussion / Befunde

**1) Rerank hilft inkonsistent auf dem sauberen cosine-pool — aber stark auf dem
realen haystack.** Das ist der zentrale befund , und er ist datensatz-abhängig. Auf dem
kleinen 52-chunk-`agent-batch`-pool ist der dense-kandidatensatz bereits sauber
vor-sortiert ; ein cross-encoder findet dort wenig zu korrigieren. Im LLM-judge-lauf B
gewinnen die rerank-off-configs , und auch im reinen retrieval-lauf A überschreitet der
nutzen bei rr20/rr40 sein optimum (rr10) und kehrt sich um. **Auf dem realen
2939-chunk-haystack dreht sich das bild:** der reranker hebt recall@1 von 0.552 auf
0.844 (+0.292) und MRR von 0.623 auf 0.867. Der unterschied ist die pool-noisigkeit —
ein großer haystack mit 2070 distractors liefert dem dense-retriever genug
fehl-treffer in den vorderen rängen , dass der cross-encoder echten reordering-wert
schafft.

**2) Recall-ceiling-analyse.** Im wikipedia-lauf gilt recall@5 = recall@10 = 0.894
**identisch** für den reranker. Das ist kein zufall: der reranker re-ordnet nur , was
der dense-retriever in seine top-50 gehoben hat (pool=50). 0.894 ist also das **ceiling
des dense-top-50-pools** — dense bringt das gold-chunk in 89.4 % der fälle in die
top-50 , und der reranker promotet davon 84.4 % aller fragen auf rang 1. Die restlichen
~11 % misses sind überwiegend genuin schwer: bei 512-zeichen-overlap teilen benachbarte
chunks den antwort-text , sodass der „gold"-chunk mit seinen nachbarn konkurriert — ein
artefakt des single-relevant-scorings , kein qualitäts-defekt. Eine erhöhung des
rerank-pools über 50 würde dieses ceiling weiter heben (offene erweiterung).

**3) k=3 maxt qualität , ist der lande-default.** Über den grid-sweep (und im
3-modell-vergleich über alle drei modelle) maximiert `k=3` die judge-qualität bei
gleichzeitig kleinerem prompt → schnellere TTFT. Die produktions-empfehlung
`QAService.DEFAULT_TOP_K` 8 → 3 ist entsprechend „gelandet".

**4) GPU-TTFT-spannen sind klein** (606–693 ms quer über alle modelle/configs) ; auf
CPU würden sowohl embedder (qEmb heute ~500 ms) als auch LLM-prefill viel stärker
streuen. Random-baseline-kontext: recall@1 ≈ 1/2939 ≈ 0.0003 , gegen die dense-bge-m3 ,
die 0.552 erreicht — die fragen sind also präzise , geerdete retrieval-targets , kein
trivial-leichtes set.

**5) Reranker bleibt produktions-default opt-in.** Die data ist ambivalent: auf dem
sauberen pool hilft er kaum/inkonsistent , auf dem noisigeren produktions-fusion-pool
(BM25+dense) hilft er wahrscheinlich — was die wikipedia-validierung stützt. Da der
CPU-only-end-user-pfad ihn nicht bezahlen will (1–2 s) , bleibt er opt-in
(`cpuOptimized` schaltet aus).

## 6 Limitationen & Threats to Validity

- **Kleine stichprobe in den grid-läufen.** Lauf A n=10/config , Lauf B n=30/config
  (nicht alle 260 fragen). Die margins (~0.01–0.03 composite) liegen knapp über
  statistischem rauschen ; vor finalen entscheidungen bei knappen rangfolgen mit n=100
  wiederholen. Der wikipedia-lauf (n=1255) ist demgegenüber statistisch deutlich
  robuster.
- **Eval umgeht die produktions-RAG-pipeline.** Übersprungen: BM25+dense-fusion ,
  multi-query expansion , heuristiken (title boost / short-chunk penalty / recency) ,
  doc diversification , whole-doc fallback , neighbour expansion , database-I/O ,
  worker-IPC. Gemessen wird isoliert embedder + reranker + LLM auf vorgefertigten
  chunks. Genau hier kommt der rerank-befund her: der cosine-pool ist sauber
  vor-sortiert ; der noisigere produktions-fusion-pool ist nicht direkt gemessen. Die
  produktions-TTFT von ~60 s muss separat debuggt werden (vermutlich auto-pick XL +
  cold-load + multi-query).
- **GPU-vs-CPU-timing.** Sämtliche timing-zahlen oben sind GPU-läufe und sind ein
  **korrektheits-/qualitäts-check , NICHT der produktions-CPU-timing-benchmark.** Der
  prod-default ist embedder auf CPU. Faithful-CPU-timings sind separate
  `evals:sweep --no-llm`-läufe — **TODO: Lauf nötig** für end-to-end-CPU-TTFT der
  retrieval-stufe.
- **Reranker nicht auf CPU getestet.** Auf GPU ist rerank ~80–160 ms ; auf CPU würde es
  1–2 s kosten und die qualität noch weniger rechtfertigen → CPU-only-pfad sollte
  rerank=off lassen. Konsistent mit den gemessenen rerank-mean-zeiten 47–159 ms (Lauf B)
  bzw. 156–628 ms (Lauf A , tiefere pools).
- **Dirty git-state.** Beide grid-läufe sind `dirty` (uncommitted working tree): Lauf A
  git `9498853` , Lauf B git `45bf322` , beide branch `feat/settings-ollama-connector`.
  Sie gelten daher nicht als clean-baseline.
- **Spannung zwischen den beiden grid-läufen.** Der retrieval-only-befund (Lauf A:
  „rr10 hilft") steht in spannung zum LLM-judge-befund (Lauf B: „rr0 gewinnt"). Reines
  recall/MRR zeigt rerank-nutzen , die judge-bewertete antwort-qualität nicht. Beide
  läufe nutzen unterschiedliche k/rr-fächer (A: k3/5/8 × rr0/10/20/40 @ n=10 ; B:
  k2/3/5 × rr0/3/5/10 @ n=30) und sind nicht 1:1 vergleichbar.
- **Composite-werte der läufe sind nicht vergleichbar.** Lauf A hat eine leere
  judge-spalte ; sein composite (~0.19–0.51) ist nicht mit dem von Lauf B (~2.0–2.24 ,
  mit `2·judge`) komparabel.
- **Free-VRAM-werte unterscheiden sich zwischen den läufen** (Lauf A ~21.3–21.6 GB ,
  Lauf B ~19.2–25.2 GB) — gemessen während laufender judge/LLM-belegung , nicht als
  reiner retrieval-footprint interpretierbar.
- **Mehrheitlich-DE grid-datensatz , judge ist Nemotron 30B-A3B.** DE-nuancen sind evtl.
  nicht trennscharf bewertbar (oder dataset zu klein) ; der wikipedia-haystack ist
  hingegen EN.
- **single-relevant-artefakt.** Die ~11 % wikipedia-misses sind teils durch
  512-zeichen-overlap bedingt (nachbar-chunks teilen den antwort-text) — kein
  retrieval-qualitäts-defekt.
- **chunk-`size` = zeichen , nicht tokens** im eval-chunker — bei token-aussagen zu
  beachten.

## 7 Reproduzierbarkeit

Modelle holen (embedder/reranker/judge/under-test-LLM):

```bash
pnpm models:evals          # node scripts/download-models.mjs evals
```

**Lauf A — reines Retrieval-Grid (kein LLM/Judge) , n=10:**

```bash
pnpm evals:sweep \
  --dataset tests/evals/data/datasets/agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json \
  --configs grid \
  --no-llm \
  --limit 10
# = tsx tests/evals/sweep.ts --dataset <…> --configs grid --no-llm --limit 10
```

`--configs grid` baut den cartesian rerank × k ; `--no-llm` überschreibt alle
`config.llm` auf `null` (skip TTFT/judge) ; `--limit 10` cappt auf 10 fragen/config.

**Lauf B — Retrieval + LLM (Qwen3-8B) + Judge , n=30:**

```bash
pnpm evals:sweep \
  --dataset tests/evals/data/datasets/agent-batch-claude-opus-4-7-2026-05-17T20-43-09.json \
  --configs grid \
  --judge \
  --limit 30
# judge-modell via --judge-path <gguf> oder LOKLM_JUDGE_PATH (sonst profile='xl' = Nemotron 30B-A3B)
```

`--judge` aktiviert den 2-pass-judge (braucht configs mit LLM) ; das under-test-LLM
ist auf `'full'` (Qwen3-8B) gepinnt , der judge separat auf das XL-profil.

**Wikipedia-Survival — voller Retrieval-Lauf (n=1255 , GPU):**

```bash
pnpm evals:run \
  --dataset tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json
# = tsx tests/evals/run.ts --dataset <…>  (single-config retrieval scoring über den vollen haystack)
```

Korpus-(re)build (nur falls sample-docs/prompts sich ändern):
`tsx tests/evals/synth/fetch-wikipedia-corpus.ts` → `prep-gen-batches.ts` →
`assemble-wiki-dataset.ts` → `inspect-dataset.ts` (provenienz in
`tests/evals/data/corpora/wikipedia-survival/manifest.json`).

**Paper-aggregation über alle run-dirs:**

```bash
pnpm evals:paper --clean-only   # tsx tests/evals/aggregate-paper.ts ; --clean-only filtert dirty-runs
```

Hinweis: die zwei committeten grid-läufe sind `dirty` und würden von `--clean-only`
gefiltert ; ein clean re-run ist **TODO: Lauf nötig** für eine zitierfähige
clean-baseline.

## Referenzen

**Quell-Läufe und Reports (LokLM-repo):**

- `tests/evals/report/runs/2026-05-20T18-31-49_9498853_dirty/` — Lauf A (retrieval-only ,
  n=10): `summary.md` , `summary.json` , `ranking.md` , `dataset.json` , `env.json` ,
  `configs/<name>/result.json`.
- `tests/evals/report/runs/2026-05-20T19-46-39_45bf322_dirty/` — Lauf B (Qwen3-8B +
  judge , n=30): `summary.md` , `summary.json` , `ranking.md` , `dataset.json` ,
  `env.json` , `configs/<name>/result.json`.
- `tests/evals/report/3-model-comparison-2026-05-20.md` — per-phase-latenz ,
  cross-model-cell , findings , production-recommendations , caveats.
- `papers/_evidence/methodology.md` — gemeinsame methodik (hardware , metriken , judge ,
  chunker , provenienz).
- `papers/_evidence/retrieval-grid.md` — Tabellen A/B + cross-model-latenz.
- `papers/_evidence/wikipedia-survival.md` — Tabelle C + GPU-timings + korpus-konstruktion.

**Harness-Code:**

- `tests/evals/metrics.ts` — recall@k / recall_req@k / MRR / nDCG@k.
- `tests/evals/judge/Judge.ts` — 3-dim-judge , composite-score.
- `tests/evals/pipeline/configs.ts` — config-quellen , grid , LLM-pin.
- `tests/evals/pipeline/Chunker.ts` — `FixedSizeChunker` (512/64).
- `tests/evals/runDir.ts` — run-dir-layout , env/git/dataset-provenienz , sha256.
- `tests/evals/sweep.ts` , `tests/evals/run.ts` , `tests/evals/aggregate-paper.ts` —
  CLI-entrypoints.

**Externe Datensätze / Modelle (Lizenz):**

- EN-Wikipedia (`prop=extracts`) — **CC BY-SA 4.0** ; korpus des
  `wikipedia-survival`-haystacks.
- `bge-m3` — dense embedder (prod-default CPU).
- `bge-reranker-v2-m3` — cross-encoder-reranker (prod-default opt-in).
- Qwen3-8B Instruct (Q4_K_M) — under-test-LLM in Lauf B.
- Nemotron 3 Nano 30B-A3B — LLM-as-judge (XL-profil , gepinnt).
- IBM Granite 3.3-8B Instruct , Mistral-Nemo-Instruct-2407 (12B) — vergleichsmodelle
  (per-phase-latenz-kontext , abschnitt 4.3).
