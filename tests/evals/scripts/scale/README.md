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
  run-scale.ts                CLI: scaling-report über mehrere libraries (in-memory)
  run-storage-scale.ts        CLI: echter file-based Stresstest (LanceDB + At-Rest-Crypto)
  report/                     Report-Snapshots (storage-<stamp>.{md,json})
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

## Storage-Scale — der echte file-based Stack (LanceDB + At-Rest-Crypto)

`run-scale.ts` (oben) misst **Retrieval-Qualität** in-memory (Brute-Force-Cosinus

- JS-BM25) — er schreibt keinen Byte der echten Storage-Schicht. `run-storage-scale.ts`
  ist die Ergänzung: er fährt den **echten** `LanceWorkspaceStore` über
  `@lancedb/lancedb` , eingewickelt in die **echte** At-Rest-Block-Crypto
  (`EncryptedWorkspaceDir` / `blockCipher` , Decrypt-on-Open / Encrypt-on-Close ,
  ADR-0005) , und beantwortet „wo bricht ein Workspace , wenn er groß wird" auf der
  Platte statt im Heap.

Entkoppelt nach Design: synthetische 1024-d-Einheitsvektoren füllen den Store
schnell (der Inhalt verschiebt die Storage-Grenzen nicht — Dimension und
Zeilenzahl tun es) , während ein separater Probe-Lauf einen echten
Wikipedia-Ausschnitt mit bge-m3 embedded , um ehrliche chunks/s zu bekommen.
Beide kombinieren zur 100-GB-Hochrechnung.

### Befehl

```
tsx tests/evals/scale/run-storage-scale.ts \
  --dims 1024 \
  --steps 10000,50000,100000,250000,500000,1000000,2000000,3500000,5000000 \
  --embed-placement gpu --time-budget-min 35 --target-gb 100
```

Default-Embed-Placement ist `cpu` (= Produktion , vgl. den `feedback`-Grundsatz
„Evals spiegeln Produktions-Defaults"); der Size-Stresstest oben nutzt bewusst
`gpu` , weil hier **nur die Workspace-Größe** interessiert , nicht die
nutzerseitige Embed-Latenz.

### Was gemessen wird (pro Checkpoint)

- **Ingest**: Durchsatz (vec/s) + die **echte** Produktions-Ingest-Latenz
  (LanceDB `mergeInsert` , 32-Zeilen-Batch wie `EMBED_BATCH`).
- **Index**: IVF-PQ-Bauzeit über den 50k-Flat→ANN-Übergang.
- **Query**: p50/p95-Latenz (topK 10 , perDocK 6 = Produktion).
- **Platte**: Bytes/Vektor (work/) + Encrypt-on-Persist + enc/-Größe.
- **RSS** , plus am Ende ein Cold-Open-Roundtrip: Decrypt-on-Open des _ganzen_
  verschlüsselten Stores (die „Switch-in-den-Workspace"-Wartezeit).

### Ergebnis (Lauf 2026-06-23 , i9-9900K / 32 GB / RTX 5090 , bis 5 Mio. Vektoren)

Volle Tabelle: [`report/storage-2026-06-23T12-53-46.md`](report/storage-2026-06-23T12-53-46.md). Auszug:

| Vektoren |  Platte | B/Vek | q p95 | Ingest (Prod-32er) | IVF-PQ-Bau |     RSS |
| -------: | ------: | ----: | ----: | -----------------: | ---------: | ------: |
|      50k |  214 MB |  4288 |  8 ms |              14 ms |       66 s | 662 MiB |
|   1 Mio. | 4,38 GB |  4378 | 26 ms |              50 ms |      157 s | 1,0 GiB |
|   5 Mio. | 22,2 GB |  4448 | 43 ms |             176 ms |      264 s | 1,6 GiB |

**Kernaussage — Query-Latenz und RAM brechen nie.** IVF-PQ greift bei 50k und
hält q p95 bei ~43 ms bis 5 Mio. (sublinear); RSS bleibt ~1,6 GiB , weil LanceDB
platten-resident/mmap ist (0 VRAM — die Vektorsuche läuft auf der CPU). Die Wände
sind alle **Platte + Krypto-Zeit** , in der Reihenfolge , in der man sie trifft:

1. **Platten-Fußabdruck** — ~4,4 GB pro 1 Mio. Vektoren , und er **verdoppelt
   sich , solange der Workspace offen ist** (enc/ at-rest + Klartext-work/).
2. **Decrypt-on-Open** — der ganze verschlüsselte Store wird bei jedem
   Unlock/Switch auf Klartext entschlüsselt , gemessen ~163 MB/s. 22 GB = 2,3 min.
3. **Ingest-Verlangsamung** — der Produktionspfad (`mergeInsert`) scannt die ganze
   Tabelle → Batch-Latenz wuchs linear 14 → 176 ms (10k → 5 Mio.).

### 100-GB-Hochrechnung (chunk-größen-abhängig)

Bei Produktions-Chunking (~2000 Zeichen): 100 GB Text ≈ **50 Mio. Vektoren** →
**~222 GB** at-rest / **~444 GB** offen / **~23 min Decrypt pro Unlock** / **~9,5 d**
einmaliges (sequentielles GPU-)Embedding. RAM bleibt dabei niedrig-einstellig
(~2–4 GB) — er skaliert _nicht_ mit der Korpusgröße. (Der Probe-Korpus hatte
winzige 508-B-Chunks → die Roh-Hochrechnung im Report überschätzt die Vektorzahl
um ~4×; B/Vektor und die Krypto-/Query-Kurven sind davon unberührt.)

### Caveats

- RSS ist **nur die Storage-Schicht**; die Modelle (LLM/Embedder/Reranker) sind
  der große , **größen-unabhängige** Speicherposten.
- Embed-Durchsatz ist **sequentiell** (die Eval-Bridge embedded chunk-für-chunk ,
  kein GPU-Batching) — Obergrenze; Produktion mit Worker-Batching kann schneller sein.
- Gemessen bis 5 Mio. / 22 GB; alles darüber ist Hochrechnung per Design
  (sublinearer Index + mmap) , nicht bewiesen.
- **SQLite/FTS5 (meta.db) ungetestet** — `better-sqlite3-multiple-ciphers` ist für
  Electrons ABI (NODE_MODULE_VERSION 146) gebaut , nicht für node (137) , lädt also
  im headless-tsx-Harness nicht. Braucht einen In-Electron-Lauf.

## Zuständigkeit

Beim Aufnehmen eines neuen Embedders oder
Rerankers in [`../pipeline/configs.ts`](../pipeline/configs.ts) gehört ein
scale-Lauf mit dazu , bevor das Ding live geht. Die kleinen Stufen (tiny ,
small) reichen für PR-Checks , medium/large fahren wir vor jedem Release einmal.
