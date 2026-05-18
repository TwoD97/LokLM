# Scale-Evals

Zweite Säule innerhalb der Eval-Welt. Frage hier ist nicht "welches Modell ist
besser" sondern "wo bricht das System". Bei wie vielen Dokumenten fällt die
Retrieval-Qualität ab? Wann wird die Latenz pro Query unzumutbar? Ab welcher
Korpusgröße sprengt die Embedding-Matrix den Speicher?

## Wie es funktioniert

Der Q→A-Datensatz aus [`../synth/generate-dataset.ts`](../synth/generate-dataset.ts)
bleibt unverändert. Er zielt auf Chunks aus den Sample-Docs. Diese Chunks
sind die _Ground-Truth-Inseln_.

Drumherum wird eine _Library_ aus synthetisch erzeugten Distractor-Dokumenten
gebaut. Library-Größen werden in Stufen geliefert:

| Stufe  | Ziel-Chunk-Anzahl | Wofür                                 |
| ------ | ----------------- | ------------------------------------- |
| tiny   | ~50               | Smoke , Iteration während Entwicklung |
| small  | ~500              | Erster realistischer Stresstest       |
| medium | ~5 000            | Typische Power-User-Korpora           |
| large  | ~50 000           | Belastungstest , wo bricht's          |

Eine Library wird _einmal_ gebaut und committed (oder gecached), damit
Scaling-Vergleiche reproduzierbar sind. Neugenerieren nur wenn der Document-
Generator oder das Konzept der Sample-Docs sich ändert.

## Ordner

```
tests/evals/scale/
  README.md
  DocumentGenerator.ts        Provider-Interface für Distractor-Docs
  OllamaDocGenerator.ts       Ollama-Variante , Default
  AnthropicDocGenerator.ts    Claude-Variante , für höherwertige Distractors
  build-library.ts            CLI: target-size → libraries/<stufe>.json
  run-scale.ts                CLI: scaling-report über mehrere libraries
```

Libraries landen unter [`../data/libraries/`](../data/libraries/) als
`<stufe>.json`. Tiny ist klein genug zum Committen, alles ab small wird
gitignored.

## Was gemessen wird

Pro Library-Stufe und pro Pipeline-Config:

- **Quality**: recall@1 , recall@5 , recall@10 , MRR , nDCG@10. Erwartung
  ist , dass diese Werte mit wachsender Library tendenziell sinken , weil die
  Anzahl plausibler Distractors steigt.
- **Latency**: p50 , p95 , max pro Query in Millisekunden. Inklusive
  embedden , brute-force-cosinus , reranken.
- **Memory**: Heap-RSS in MiB nach Build des Embedding-Index. Zeigt wann der
  in-memory-Ansatz an Grenzen kommt.
- **Build-Zeit**: ms für einmaliges Embedden des gesamten Korpus.

Output ist ein Markdown-Report mit einer Zeile pro (Library × Config),
sortiert nach Library-Stufe. Auf einen Blick sieht man die Degradation und
wo's bricht.

## Scripts

| Befehl                                       | Was er tut                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm evals:build-library -- --size tiny`    | Baut die tiny-library (~50 chunks).                               |
| `pnpm evals:build-library -- --size small`   | Baut small (~500 chunks). Dauert Minuten mit Ollama.              |
| `pnpm evals:build-library -- --size medium`  | Baut medium (~5000 chunks). Dauert ~30-60 min.                    |
| `pnpm evals:scale`                           | Fährt alle vorhandenen libraries durch , schreibt Scaling-Report. |
| `pnpm evals:scale -- --libraries tiny,small` | Nur ausgewählte Stufen.                                           |

## Was die Limits typischerweise aufzeigen

Reihenfolge des Brechens , wenn man die Library vergrößert:

1. **Recall@1 fällt** zuerst , weil immer mehr Chunks mit der Frage konkurrieren.
2. **Latency wächst linear** bei Brute-Force-Cosinus , spürbar ab ~10k Chunks.
3. **Memory** ist erträglich bis ~100k Chunks bei 384-dim float32 (~150 MiB).
   Größere Dim-Vektoren verschieben das nach unten.
4. **Reranker dominiert die Latency** wenn man Top-100 vor dem Rerank holt.
   p95 kann zweistellige Sekunden erreichen.

Das ist der Punkt , an dem ANN-Index (HNSW , IVF) oder eine Vektor-DB
notwendig werden. Bis dorthin reicht Brute-Force.

## Zuständigkeit

Dominik betreibt diese Säule mit. Beim Aufnehmen eines neuen Embedders oder
Rerankers in [`../pipeline/configs.ts`](../pipeline/configs.ts) gehört ein
scale-Lauf mit dazu , bevor das Ding live geht. Die kleinen Stufen (tiny ,
small) reichen für PR-Checks , medium/large fahren wir vor jedem Release einmal.
