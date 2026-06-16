# ADR-0003 — Query-Routing + Per-Dokument-Summary-Index

**Status:** accepted
**Datum:** 2026-06-13
**Owner:** Denys
**Bezug:** [PH] Pflichtenheft §3.5 (Retrieval), §3.6 (Chat/QA) ; [ADR-0002](0002-envelope-encryption-aes-gcm.md) (Vault, in dem die Summaries+Embeddings liegen)
**Implementierung:**
[src/main/services/qa/router.ts](../../src/main/services/qa/router.ts),
[src/main/services/qa/QAService.ts](../../src/main/services/qa/QAService.ts),
[src/main/services/qa/corpusAnswer.ts](../../src/main/services/qa/corpusAnswer.ts),
[src/main/db/database.ts](../../src/main/db/database.ts) (`searchDocumentsByTheme`, `topDocumentsBySummarySimilarity`, Summary-Embedding-Methoden),
[src/main/db/migrations/0010_document_summary_embedding.sql](../../src/main/db/migrations/0010_document_summary_embedding.sql),
[src/main/services/embeddings/EmbeddingBackfillService.ts](../../src/main/services/embeddings/EmbeddingBackfillService.ts),
[src/main/services/retrieval/RetrievalService.ts](../../src/main/services/retrieval/RetrievalService.ts) (`docPrefilter`)

## Context

Vor diesem ADR lief **jede** Chat-Frage durch dieselbe Chunk-Retrieval-Pipeline (BM25 + dense + RRF + optional Rerank), und die einzige Anpassung an die Fragetyp war ein topK-Bump (`classifyQueryBreadth`: summary → 12 Chunks). Zwei Fragetypen sind damit strukturell nicht beantwortbar:

1. **„Fasse Dokument X zusammen"** — top-k Chunks liefern Fragmente, nie einen Überblick über das ganze Dokument. Gleichzeitig lag ein gecachter Whole-Doc-Summarizer ([SummarizationService](../../src/main/services/summarize/SummarizationService.ts), Mig 0008) ungenutzt daneben — der nur über die Library-„Summarize"-Aktion erreichbar war, nicht aus dem Chat.
2. **„Wie viele / welche Dokumente habe ich zu Y"** — eine Aggregation über die Dokumentmenge. Chunk-top-k kann sie prinzipiell nicht beantworten: sie zählt Chunks, nicht Dokumente.

Die Aufgabe: Anfragen an die **richtige** Strategie routen, ohne die bestehende, hart erkämpfte Pipeline (CPU-Preset, kein-LLM-vor-Retrieval, bilingual DE/EN, Stage-Reporter) umzubauen.

Drei produktive Open-Source-Implementierungen desselben Problems wurden im Quelltext studiert — **LlamaIndex** (`RouterQueryEngine`, `DocumentSummaryIndex`), **Microsoft GraphRAG** (local/global search), **RAGFlow** (Metadaten-Filter + `doc_aggs`). Die Adopt/Reject-Tabelle unten ist das Ergebnis ; jede Zeile wurde gegen den tatsächlichen Quelltext der Projekte verifiziert, nicht gegen deren Docs.

## Decision

### Drei Routen hinter einem regex-first Dispatcher

`resolveRoute(query, ctx)` ([router.ts](../../src/main/services/qa/router.ts)) entscheidet **rein heuristisch** (Regex + Titel-Token-Matching, kein LLM-Call) zwischen:

- **`corpus`** — „wie viele / welche Dokumente zu X" → beantwortet aus der `documents`-Tabelle (Drizzle/PGlite), templatierte DE/EN-Antwort, **kein LLM**.
- **`doc_summary`** — „fasse X zusammen" mit eindeutig aufgelöstem Zieldokument → gecachter Whole-Doc-Summary als unzitierter Context-Preamble.
- **`retrieval`** — der Default ; jeder Routing-Miss landet hier.

**Präzedenz: `corpus` > `doc_summary` > `retrieval`.** Corpus hat das engste Gate (Intent UND Scope-Noun), darf also zuerst greifen. Ein Query, das weder Gate trifft, zahlt **keinen** zusätzlichen DB-Round-Trip — `getDocuments` ist lazy.

Routing-Fehler **erroren nie und fragen nie das LLM**. Das ist die bewusste Inversion von LlamaIndex' `RouterQueryEngine`, das bei mehrdeutiger Selektion `ValueError` wirft: Bei uns fällt ein nicht-auflösbarer Treffer still auf `retrieval` zurück — dort produziert die Chunk-Pipeline immer _irgendetwas_, während eine falsche Routing-Entscheidung eine echte Antwort durch eine Dokumentliste / das falsche Summary ersetzt. Daher die durchgehende Regel: **False-Negative ist die billigere Fehlentscheidung.**

### Multi-Question-Messages (Decomposition)

Eine Chat-Nachricht kann mehrere distinkte Fragen enthalten („Was ist argon2id? Und wie viele Dokumente habe ich zum Vault?"). Ohne Behandlung wären drei Fehlermodi aktiv: (1) das Routing wählt **einen** Gewinner für die ganze Nachricht — die corpus-Regex greift auf der zweiten Hälfte und die erste Frage fällt still weg ; (2) der Dense-Embedder bekommt **einen** Vektor für mehrere Themen, ein Zentroid, der keines gut trifft ; (3) das kleine lokale Modell beantwortet oft nur den auffälligsten Teil.

`splitQuestions(query)` ([retrieval/heuristics.ts](../../src/main/services/retrieval/heuristics.ts)) zerlegt die Nachricht **rein heuristisch** (Split nur an `?`-Grenzen, kein LLM, hot-path-safe). Konservativ: ein „and"/„und" **innerhalb** einer Frage („Unterschied zwischen X und Y?", „wie funktioniert X und warum?") bleibt zusammen, weil nur an `?` getrennt wird — ein False-Merge (Status quo) ist billiger als ein False-Split. Daraus zwei Eingriffe:

- **Router-Guard:** eine compound Message umgeht die single-intent-Routen (corpus/doc*summary beantworten je \_ein* Ding) und geht auf `retrieval`.
- **Retrieval-Decomposition** ([RetrievalService](../../src/main/services/retrieval/RetrievalService.ts)): jede Teilfrage wird separat retrievt, die Pools werden RRF-fusioniert (dieselbe Maschinerie wie `multiQuery`, nur sind die Varianten die Teilfragen statt Paraphrasen — und heuristisch statt LLM-generiert). Das Modell bekommt **eine** zusammengeführte Kontext-Menge mit Coverage über alle Themen und beantwortet die ganze Nachricht. Default on (`decomposeQuestions`, opt-out für Evals) ; nimmt Vorrang vor der Paraphrase-Expansion. **Eine** Antwort, kein separater Pro-Frage-Stream — der Citation/Streaming-Vertrag bleibt unverändert.

### Prompt-Komposition + Citation-Vertrag (Option A)

Phase 1 traf auf das parallel entwickelte Pinned-Docs-Feature (`dd62973`). Beide stellen dem Prompt Inhalt voran. Die Auflösung (in [prompt.ts `buildPrompt`](../../src/main/services/llm/prompt.ts)):

```
[system] → [Context (pinned)] → [history] → [Context: summary-preamble → rag-hits] → [question]
```

- **Pinned-Sektion führt** — sie ist über Turns hinweg byte-stabil, was node-llama-cpp's Sequence-Alignment in KV-Cache-Reuse übersetzt. Alles davor würde diesen stabilen Präfix pro Turn invalidieren.
- **Summary-Preamble danach, vor den RAG-Hits** — sie ist per-Turn volatil (aufgelöstes Doc + Packing-Ergebnis), gehört also in die volatile Region. Innerhalb dieser: Summaries zuerst, Chunks absorbieren den Budget-Overflow (GraphRAG-Fill-Order).

**Citation-Vertrag bleibt chunk-gebunden (Option A).** Das Summary wird als _unzitierter_ Hintergrund-Block gefüttert (`buildSummaryPreamble`, ohne `[doc:X, chunk:Y]`-Header) ; die zitierbaren Belege sind die top-up-Chunks aus demselben Dokument. Damit bleiben das Marker-Grammar, die `citations.chunkId`-NOT-NULL-FK und die Renderer-Chips unverändert. Korpus-Antworten zitieren jedes gelistete Dokument über den **ersten Chunk** (`[doc:X, chunk:firstChunkId]`) — gleicher Mechanismus, kein neues StreamEvent.

### Per-Dokument-Summary-Embedding-Index (Phase 3)

Migration 0010 fügt `documents.summary_embedding vector(1024)` + `summary_embedder_identity` hinzu. **Kein HNSW** — die Tabelle hat hunderte Zeilen, ein sequenzieller Cosine-Scan ist billiger als der Index-Unterhalt (Gegensatz zu `chunks`, das Größenordnungen größer ist und HNSW hat).

- **Lazy + Identity-diszipliniert** wie Chunk-Embeddings: NULL bis der Idle-Backfill ein vorhandenes Summary embedded ; `reindex_document` nullt Summary + Embedding gemeinsam ; ein Embedder-Wechsel (anderer `embedderModelStem`) purged + re-embedded.
- **Genutzt für (a)** die Aboutness-Erkennung der Corpus-Route (Cosine ≥ 0.2 als zusätzliches Signal neben Title/Summary-ILIKE + Chunk-`doc_aggs`) und **(b)** einen optionalen hierarchischen Doc-Prefilter (`RetrievalOptions.docPrefilter`, **default off**, eval-gated) für broad Queries.

### Schlüsselparameter

| Parameter             | Wert               | Begründung                                                                                                                                               |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titel-Coverage-Gate   | `≥ 0.5`            | Anteil der Titel-Token (ohne Extension), die im Query vorkommen. Filename-Titel („TudosaDenys_Wochenbuch") lösen auf, ein generisches Einzeltoken nicht. |
| Titel-Margin          | `best ≥ 2× second` | Darunter mehrdeutig → Fallback. Kein OSS-Projekt liefert einen Default — empirisch in `queryRoute.test.ts` gepinnt.                                      |
| Corpus-Summary-Cosine | `≥ 0.2`            | RAGFlow's post-rerank-Similarity-Floor. Hoch genug gegen Fremdtreffer, niedrig genug für anderes Vokabular.                                              |
| docPrefilter top-N    | `5`                | LlamaIndex' Drill-Down-`top_k`, hochkorrigiert von dessen brüchigem Default `1`.                                                                         |
| CPU-Summary-Guard     | `> 2` Windows      | Bei Cache-Miss auf CPU + langem Doc fällt `doc_summary` auf `retrieval` zurück (Map-Reduce vor dem ersten Token = Minuten Stille).                       |

## Adopt / Reject — was aus dem OSS-Quelltext übernommen wurde

| Pattern                                                                          | Quelle               | Verdikt    | Begründung (LokLM-Constraint)                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explizite Routen-Funktionen hinter dünnem heuristischem Dispatcher               | GraphRAG             | **adopt**  | GraphRAG liefert vier explizite Such-Modi und **null** Router — selbst die MS-Demo lässt den Nutzer wählen. Validiert, dass der heuristik-first-Dispatcher die Schicht ist, die GraphRAG bewusst weglässt ; kein Upstream-Druck Richtung LLM-vor-Retrieval. |
| Regex-Shortcut für Count-Fragen → typisierte Query statt LLM                     | RAGFlow              | **adopt**  | RAGFlow's `is_row_count_question` ist genau diese Form in Produktion (zweiteilige Regex → hardcoded `COUNT(*)`). LokLM's `documents`-Schema ist statisch bekannt → typisierte Drizzle-Query, strikt besser als GraphRAGs LLM, das „top themes" durchzählt.  |
| Summary-as-Retrieval-Unit (DocumentSummaryIndex EMBEDDING-Mode)                  | LlamaIndex           | **adopt**  | Phase-3-Feature fast wörtlich, bleibt embedder-only auf dem Hot Path. Eine nullable Vector-Spalte auf `documents` ersetzt den separaten Vector-Store ; `chunks.documentId`-FK kodiert bereits `summary_id_to_node_ids`.                                     |
| Doc-Filter als echter Pre-Filter (gleicher Filter auf BM25- + kNN-Zweig)         | RAGFlow              | **adopt**  | `WHERE document_id IN (...)` in derselben SQL wie tsquery/Vector-ORDER-BY — `searchChunks` macht das schon. Als Invariante für alle neuen Routen kodifiziert (fetch-then-filter würde top-k still schrumpfen).                                              |
| Distinkte Empty-Filter-Semantik (explizit → 0 Treffer ; inferiert → ungefiltert) | RAGFlow              | **adopt**  | Ein vom Nutzer gesetzter Pin/Filter, der nichts trifft, gibt 0 zurück ; ein heuristisch inferierter Filter-Miss degradiert zu ungefiltertem Retrieval. Der heuristische Extraktor fehlt öfter (DE/EN) → inferiert-Miss = sicherer Fallback.                 |
| Doc-pinned Zero-Hit-Fallback (Doc trotzdem beantworten)                          | RAGFlow              | **adopt**  | Ein aufgelöstes Doc, dessen Chunks die Query-Phrasierung nicht treffen, bekommt trotzdem sein Summary beantwortet (kein „no results").                                                                                                                      |
| Map-Reduce über vorab-berechnete Summaries für Korpus-Antworten                  | GraphRAG             | **adapt**  | Kernidee (Dataset-weite Fragen nur aus Summaries) übernommen ; die volle Map-Phase (1 LLM-Call pro 12k-Batch, 32-fach parallel, JSON) ist cloud-shaped → ersetzt durch Embedding-Preselection + templatierte Antwort ohne LLM.                              |
| Title-first Target-Resolution mit Margin, Embedding als Tiebreak                 | RAGFlow / LlamaIndex | **adapt**  | RAGFlow löst Ziel-Docs gar nicht aus Query-Text auf, LlamaIndex embedding-only bei `top_k=1`. LokLM sitzt dazwischen: Title-Token primär, Margin-Check, Embedding sekundär.                                                                                 |
| Token-Budget mit summaries-first Fill-Order                                      | GraphRAG             | **adapt**  | Reine Arithmetik, null Runtime-Kosten. Pinned + Summary werden vorab budgetiert, Chunks absorbieren Overflow — nie umgekehrt.                                                                                                                               |
| LLM-Selector auf dem Hot Path (`RouterQueryEngine` + `BaseSelector`)             | LlamaIndex           | **reject** | Verletzt direkt „regex/heuristik-first, kein LLM vor Retrieval". Auf dem CPU-Preset addiert schon ein kleiner GGUF-Call Sekunden.                                                                                                                           |
| `ValueError` bei mehrdeutiger Selektion, kein Default-Engine                     | LlamaIndex           | **reject** | Ein Routing-Miss darf in einer Offline-Desktop-App nie als Fehler erscheinen → invertiert zu stillem Fallback auf `retrieval`.                                                                                                                              |
| Multi-Selection + LLM-Antwort-Fusion (`TreeSummarize`)                           | LlamaIndex           | **reject** | Verdoppelt/verdreifacht LLM-Passes pro Query. Routen sind mutually exclusive mit deterministischer Präzedenz.                                                                                                                                               |
| Allgemeines LLM-Text-zu-SQL für Aggregation (`use_sql` + Retry/Repair)           | RAGFlow              | **reject** | Bis zu drei LLM-Invocations vor Retrieval + SQL-Injection-Guarding für ein statisch bekanntes Schema. Typisierte Drizzle-Queries decken Count/List ab.                                                                                                      |
| LLM-Choice-Select-Retriever (`ceil(n_docs/10)` LLM-Calls/Query)                  | LlamaIndex           | **reject** | O(n_docs) LLM-Calls vor Retrieval — Minuten auf CPU. Embedding-Mode deckt denselben Bedarf.                                                                                                                                                                 |
| DRIFT-Style iterative Decomposition (~63 LLM-Calls/Query default)                | GraphRAG             | **reject** | Größenordnungen außerhalb des CPU-Budgets. Die eine brauchbare Idee (Top-Docs via Summary-Embeddings, dann Chunks darin) ist bereits unser `docPrefilter` ohne die Follow-up-Schleife.                                                                      |

**Drei Disagreements, in denen die Projekte sich widersprechen, und unsere Seite:**

- _Routing-Mechanismus:_ LlamaIndex routet jede Query durch ein LLM ; GraphRAG hat keinen Router ; RAGFlow ist explizit-first + ein Regex-Shortcut. → **Seite GraphRAG/RAGFlow.**
- _Failure-Handling:_ LlamaIndex wirft ; RAGFlow degradiert ; GraphRAG gibt fixe NO_DATA-Antwort. → **RAGFlows Fail-Soft fürs Routing, GraphRAGs fixe lokalisierte Refusal für Zero-Evidence-Corpus.**
- _„Welche Dokumente sind über X":_ RAGFlow aus Chunk-Hit-Counts (`doc_aggs`) ; LlamaIndex/GraphRAG aus Summary-Embeddings. → **Summary-Embeddings primär (Aboutness ≠ Erwähnungshäufigkeit), `doc_aggs` als Fallback solange Summaries lazy fehlen.**

## Hardening (adversariale Review, alle Findings vor Commit gefixt)

Ein mehrperspektivischer Review (drei Lenses, jedes Finding gegen den Quelltext gegenverifiziert) brachte u.a.:

- **ILIKE-Escape:** Das hand-gebaute Postgres-Array-Literal aß den Escape-Backslash → ein nacktes `%`-Theme-Token matchte jedes Doc. Fix: gebundene `sql`-Parameter statt Literal.
- **Pin-Fallback respektiert Source-Focus:** Ein gepinntes Doc außerhalb der `activeDocumentIds`-Auswahl wird nicht mehr zum Summary-Ziel.
- **Corpus-Regex SCOPE_TAIL:** Blockt Possessiv + Content-Auxiliar („how many documents **does chapter 3 mention**" → `retrieval`).
- **Citations slice-then-filter** (spiegelt die gerenderte Liste, keine Phantom-Citations jenseits des Caps) ; **themeless count** sagt „Auswahl" statt „Workspace" unter Source-Focus ; **tokensPerSec** null bei 1-Token-Corpus-Turns.

## Consequences

**Positiv**

- „Fasse X zusammen" und „wie viele Dokumente zu Y" werden korrekt beantwortet, ohne die Chunk-Pipeline anzufassen.
- Corpus-Antworten sind exakt (typisierte SQL, kein LLM, das eine Zahl paraphrasiert) und billig (Cache-Hit-Summary-Route schlägt die alte topK-12-Latenz).
- Der Hot Path bleibt regex-first ; jeder neue LLM-/Embedder-Touch ist gegated und degradiert sauber.
- `routing: false` als Escape-Hatch (wie topK-Pinning) hält Evals/Tests auf der Plain-Pipeline.

**Negativ**

- **Background-Summary-_Generierung_ ist bewusst nicht implementiert.** Der Index füllt sich aus on-demand generierten Summaries (Library-Aktion / doc_summary-Route) + Inline-Embedding + Idle-Embedding-Backfill. Hintergrund-Generierung für nie-angefragte Docs bräuchte Chat-Activity-Gating (sonst monopolisiert sie den einzigen LLM-Worker) — verschoben, konsistent mit dem „deliberately NOT at ingest"-Prinzip des SummarizationService.
- **Summary-Embedding-Signal ist lazy** — vor dem Backfill fällt die Corpus-Route auf ILIKE + `doc_aggs` zurück (per Design robust, aber „Aboutness" ist anfangs schwächer).
- **Regex-Grenze bei polysemen Scope-Nomen** — „how many notes are in a C major scale" bleibt ein möglicher False-Positive (notes = musikalisch), weil „are in" auch in „how many documents are in this workspace" (legitim) vorkommt. Bewusst nicht über-getightened.
- Mehr Code-Pfade in QAService/RetrievalService → mehr Tests, mehr Audit-Surface.

## Open Questions

- **Background-Summary-Generierung auf GPU** (idle-throttled, chat-activity-gated) — der nächste sinnvolle Schritt, sobald die Activity-Koordination steht.
- **docPrefilter-Default** — aktuell off, separat zu evaluieren (A/B gegen flat retrieval auf der Eval-Säule), bevor ein Default-Flip erwogen wird.
- **Opt-in LLM-Fallback-Klassifikator** (hinter demselben Flag-Stil wie `multiQuery`, off im CPU-Preset) für Queries, die die Regex verfehlt — Prompt-Struktur-Input aus dem LlamaIndex-Selector + GBNF-constrained Output liegt recherchiert vor, ist aber nicht gebaut.
