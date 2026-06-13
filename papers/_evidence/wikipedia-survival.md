# Evidence — Wikipedia-Survival RAG-Eval (Session 2026-06-13)

Quelle: live in dieser session gebaut + gemessen. Alle zahlen sind reale läufe ,
keine schätzungen. Hardware: Intel i9-9900K + RTX 5090 (32 GB VRAM).

## Korpus-Konstruktion

- Quelle: EN-Wikipedia , `prop=extracts&explaintext=1` (MediaWiki action-API) —
  sauberer plaintext , kein OCR , kein PDF/HTML-parsing. Lizenz CC BY-SA 4.0.
- Motivation: spiegelt den #1-Tier-1-datensatz der LokLM-zielgruppe (Kiwix
  Wikipedia ZIM) als kleiner plaintext-slice statt 110-GB-ZIM. License-konsistent
  mit dem schon committeten `xquad-de`.
- 50 artikel , 5 survival/referenz-themen (je 10 artikel):
  first-aid , water-food , disease-sanitation , wilderness-navigation , rebuild-tech.
- End-sektionen (References/External links/See also/…) abgeschnitten , whitespace
  normalisiert.
- Chunker: `fixed-512-64` (512-zeichen-fenster , 64 overlap) → **2939 chunks** (haystack).
- Skripte: `tests/evals/synth/fetch-wikipedia-corpus.ts` , `prep-gen-batches.ts` ,
  `assemble-wiki-dataset.ts` , `inspect-dataset.ts`. Provenienz in
  `tests/evals/data/corpora/wikipedia-survival/manifest.json`.

## Fragen-Generierung (multi-agent)

- **1255 focused-factoid-fragen** , agent-generiert + adversarial verifiziert.
- Pipeline: pro chunk-batch (≈15 chunks) 1 generator-agent (Opus) schreibt
  kandidaten-fragen mit exaktem `answerSpan` → 1 UNABHÄNGIGER adversarial-verifier
  prüft jede frage gegen ihren quell-chunk (grounded? self-contained? eindeutig?
  nicht reine titel-trivia?) und verwirft zweifelhaftes.
- 1322 kandidaten generiert → **1255 behalten** (~5 % verworfen). 112 verifier-/
  generator-agenten gesamt über alle themen.
- Pro-thema (behalten): first-aid 192 , water-food 258 , disease-sanitation 267 ,
  wilderness-navigation 251 , rebuild-tech 287.
- Schema identisch zu `xquad-de` / `focused-260q`: `{chunkId, question, intent:'focused',
requiredChunkIds:[chunkId], meta:{theme}}`. Kein gold-antwort-string nötig — der
  judge scored gegen den chunk-text selbst.
- Dataset: `tests/evals/data/datasets/wikipedia-survival-1255q-2026-06-13T11-42-44.json`.

## Korpus-Statistik

- 2939 chunks gesamt , davon **869 referenziert** (tragen eine frage) +
  **2070 distractors** (bleiben im haystack , wie bei xquad-de).
- Assemble-validierung: 0 bad lines , **0 unknown-id** , 0 dupes. Integritäts-check:
  0 dangling required-refs , 0 missing chunkId.

## Validierung

- Lädt + scored fehlerfrei durch den echten `evalRunner` (fake-stub smoke ,
  `evals:run` , n=1255 , keine fehler).
- Cross-theme-stichprobe (manuell): alle gesampelten fragen grounded , spezifisch ,
  self-contained (z.B. typhoid-impfstamm Ty21a , severe-sepsis-definition ,
  net-metering , triple bowline , CO₂-leavening).

## Retrieval-Ergebnisse (real , GPU placement)

Voller lauf: ALLE 1255 fragen über den vollen 2939-chunk-haystack. Embedder
bge-m3 (Q4_K_M) , reranker bge-reranker-v2-m3 (Q4_K_M , pool=50 dense-kandidaten).
Single-relevant-recall (gold = 1 chunk).

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

### Interpretation

- Random-baseline recall@1 ≈ 1/2939 ≈ 0.0003 ; dense-bge-m3 erreicht 0.552 →
  die fragen sind präzise , geerdete retrieval-targets.
- Reranker hebt recall@1 von 0.552 → 0.844 (+0.292). recall@5 = recall@10 = 0.894
  für den reranker = **ceiling des dense-top-50-pools** (der reranker reordnet nur
  was dense in die top-50 hebt) → dense bringt das gold in 89.4 % der fälle in die
  top-50 , der reranker promotet 84.4 % aller fragen auf rang 1.
- Die ~11 % misses sind überwiegend genuin schwer: 512-zeichen-chunk-overlap heißt
  benachbarte chunks teilen den antwort-text , der "gold"-chunk konkurriert mit
  seinen nachbarn (artefakt von single-relevant-scoring , kein qualitäts-defekt).

## Timing + Caveats

- GPU: embedder warm 3.6 s , korpus-embed (2939 chunks) **48.7 s** , query+rerank-loop
  (1255 fragen) **1052 s** (~17.5 min ; seriell , 1255 query-embeds + 1255 rerank-calls).
- `EmbedderBridge.embedBatch` embeddet **seriell** (keine batch-API in node-llama-cpp).
  CPU bge-m3 ≈ 1.5 s/chunk → 2939 chunks > 70 min , unter dauerlast thermisch
  gedrosselt (i9-9900K). Relevanter datenpunkt für end-user mit großen libraries auf CPU.
- **GPU placement = korrektheits-/qualitäts-check , NICHT der produktions-CPU-timing-
  benchmark.** Produktions-default ist embedder auf CPU (mirror der prod-config). Die
  faithful-CPU-timings sind ein separater `evals:sweep --no-llm`-lauf.

## Offene Erweiterungen

- DE-korpus (braucht eigene `TOPICS_DE`-titelliste).
- broad/summary-intents (schema + judge unterstützen beide bereits ; siehe adaptive-topk).
- Reranker-pool > 50 würde das recall-ceiling weiter heben.
