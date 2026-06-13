# Routing-Eval-Plan (Query-Routing, ADR-0003)

Scaffold/Handoff für die Eval-Säule. Die Korrektheits-Pyramide (passiert vs.
passiert nicht) ist bereits abgedeckt — Router-Klassifikation + Auflösung in
[tests/unit/queryRoute.test.ts](../unit/queryRoute.test.ts), Corpus-Vorlage in
[tests/unit/corpusAnswer.test.ts](../unit/corpusAnswer.test.ts), die neue SQL in
[tests/tx/db/search-repo.test.ts](../tx/db/search-repo.test.ts), Doc-Prefilter-
Wiring in [tests/unit/retrieval-doc-prefilter.test.ts](../unit/retrieval-doc-prefilter.test.ts).

Was hier **fehlt** und der Eval-Säule gehört (Zahlen, nicht Pass/Fail —
[README](README.md) „Warum getrennt"): drei Qualitäts-/Regressions-Vergleiche.
Owner-Entscheidung (Dominik), weil es Modelle + Judge braucht und Stunden läuft.

## Szenario 1 — Long-Doc-Summary-Qualität: Route vs. alte topK-12

**Frage:** Liefert die `doc_summary`-Route (gecachter Whole-Doc-Summary als
Preamble) bessere Überblicks-Antworten als das alte Verhalten (topK-12
Fragmente)?

**Setup:** Ein Datensatz aus „fasse X zusammen"-Fragen über lange Dokumente
(> 1 Generierungs-Window, damit Map-Reduce greift) mit Referenz-Summaries.
A = `QAService.answer(..., { routing: true })`, B = `{ routing: false, topK: 12 }`
(der Escape-Hatch existiert genau dafür). Judge entlang correctness /
groundedness / helpfulness (siehe [judge/Judge.ts](judge/Judge.ts)). Erwartung:
A ≥ B auf coverage/helpfulness, gleich auf groundedness.

## Szenario 2 — Corpus-Counting-Genauigkeit (deterministisch, kein Judge)

**Frage:** Zählt/listet die `corpus`-Route korrekt?

**Setup:** Eine Fixture-Library mit bekannter Themen-Verteilung (z.B. 7 Docs zu
„Strom", 3 zu „Optik") + DE/EN-Count/List-Fragen mit Ground-Truth-Zahlen.
Exact-Match-Metrik, **kein** LLM/Judge nötig — schnell und CI-tauglich. Deckt
zugleich die Embedding-Aboutness ab (mit vs. ohne summary-embeddings backfilled,
um den Recall-Lift des Phase-3-Index zu messen).

## Szenario 3 — Keine Regression auf fokussierte QA

**Frage:** Verschlechtert das Routing die normalen Faktoid-Fragen?

**Setup:** Den bestehenden Sweep ([sweep.ts](sweep.ts)) einmal mit
`routing: true` und einmal `false` über das vorhandene fokussierte Frage-Set
fahren, Delta auf recall@k + Judge-Score berichten. Erwartung: ~0 Delta — eine
fokussierte Frage trifft keine Routen-Regex und läuft identisch.

## Bench — Latenz pro Route

Pro Route die Wandzeit messen (`perf.ts` / `PhasedTimer`):

- **`doc_summary` Cache-Hit** muss schneller sein als der alte topK-12-Pfad
  (eine SELECT für das Summary statt 12 Chunk-Prompts) — die zentrale
  Latenz-Behauptung des Features.
- **`doc_summary` Cache-Miss** auf CPU ist durch den `CPU_SUMMARY_MAX_WINDOWS`-
  Guard gedeckelt (fällt auf `retrieval` zurück) — verifizieren, dass kein
  Multi-Minuten-Stall vor dem ersten Token auftritt.
- **`corpus`** ist eine DB-Query + optional ein Embedder-Pass (kein LLM) —
  sollte deutlich unter der Chunk-Pipeline-TTFT liegen.
- **`docPrefilter`** (default off) separat: ein zusätzlicher Embedder-Pass +
  Doc-Cosine-Scan vor dem Chunk-Search ; A/B gegen flat retrieval, bevor ein
  Default-Flip erwogen wird (ADR-0003 Open Question).

## Hinweis

Datensätze werden generiert + committed (klein), nicht zur Laufzeit erzeugt —
siehe [README](README.md) „Workflow". Die `routing`-Flag-Achse gehört in
`gridConfigs()`/`sweepConfigs()` ([pipeline/configs.ts](pipeline/configs.ts)),
damit der Sweep beide Seiten in einem Lauf vergleicht.
