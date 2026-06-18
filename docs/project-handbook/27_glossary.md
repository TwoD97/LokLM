# Glossar

Alphabetisch geordnete Begriffe aus dem LokLM-Projekt, je 1–2 Sätze. Projektspezifische Belege verweisen auf Repo-Pfade.

## 27.1 Allgemeine Begriffe

**BM25** — Klassischer lexikalischer Ranking-Algorithmus (Term-Frequenz/Dokumentlänge); in LokLM die textbasierte Such-Komponente, deren Treffer per RRF mit der Vektor-Suche fusioniert werden.

**Branch** — Abzweigung der Versionsgeschichte in Git, auf der isoliert gearbeitet wird (z. B. `dom/ap-e2-matrix-eval`), bevor sie per PR in `main` zurückfließt.

**Chunking** — Zerlegen eines Dokuments in überlappende Textstücke (Chunks) für Indexierung und Retrieval; in LokLM u. a. der Fixed-Size-Chunker `fixed-512-64` (512 Zeichen, 64 Überlappung).

**Commit** — Eine festgeschriebene, mit Hash identifizierte Änderung in Git (z. B. `27e159d`); die kleinste nachvollziehbare Arbeitseinheit der Versionsgeschichte.

**Embedder** — Modell, das Text in einen Vektor (Embedding) übersetzt, damit semantische Ähnlichkeit berechenbar wird; in LokLM produktiv **BGE-M3**, in der Matrix eine eigene Achse.

**Gold Chunk** — Der/die für eine Eval-Frage als korrekt markierte Chunk(s); die Referenz, gegen die der Retrieval-Treffer gemessen wird (in LokLM 0-basierte Indizes `<docId>::<index>`).

**Gold Span** — Der als korrekt markierte **Zeichen-Bereich** (Offset-Bereich) im Quelldokument; chunker-unabhängige Eval-Referenz, dadurch über verschiedene Chunker hinweg vergleichbar (AP-E.2).

**GGUF** — Datei-/Quantisierungsformat für lokale LLM- und Embedder-Gewichte (von llama.cpp / `node-llama-cpp`); LokLM lädt z. B. das BGE-M3-GGUF in-process.

**Judge** — LLM, das in der Eval die generierte Antwort gegen Referenz/Beleg bewertet (z. B. korrekt / Refusal / falsch); ergänzt die rein metrische Retrieval-Bewertung (`tests/evals/answer/`).

**Kanban** — Board-basierte Aufgabensteuerung (hier über Vikunja); Tickets/APs wandern durch Spalten von „offen" bis „fertig".

**KDF (Key Derivation Function)** — Funktion, die aus einem Passwort einen kryptografischen Schlüssel ableitet; LokLM nutzt **Argon2id** (memory-hard, ADR-0001) statt PBKDF2.

**MRR (Mean Reciprocal Rank)** — Retrieval-Metrik: Mittelwert von 1/Rang des ersten relevanten Treffers über alle Fragen; belohnt das frühe Auftauchen des richtigen Chunks.

**nDCG (normalized Discounted Cumulative Gain)** — Retrieval-Metrik, die relevante Treffer höher gewichtet, je weiter oben sie ranken, normiert auf den Idealfall; in AP-E.2 neben Span-Recall pro Konfiguration ausgewertet.

**PGlite** — In-Prozess-Variante von PostgreSQL (WASM), die LokLM als lokale, datei-/speicherbasierte DB einbettet; Grundlage der modellfreien Integrationstests (echte DB statt Mock).

**pgvector** — PostgreSQL-Erweiterung für Vektor-Spalten und Ähnlichkeitssuche; in LokLM auf PGlite aktiviert, speichert die Embeddings für die Vektor-Suche.

**Pipeline** — Verkettete Verarbeitungsschritte; bei LokLM die **RAG-Pipeline** (Parsen → Chunking → Embedding → Retrieval → Rerank → Antwort) bzw. die **Eval-Pipeline** (Dataset → Sweep → Metriken → Aggregation).

**PR (Pull Request)** — Antrag, einen Branch nach Review in `main` zu mergen (z. B. PR #19/#24/#25); Ort von Diskussion, CI-Checks und Freigabe.

**RAG (Retrieval-Augmented Generation)** — Antwortgenerierung, bei der das LLM zuerst relevante Belege aus den Nutzer-Dokumenten abruft und nur darauf gestützt antwortet; das Kernprinzip von LokLM (Quellenverifikation).

**Recall** — Anteil der tatsächlich relevanten Treffer, der unter den Top-K gefunden wurde; in LokLM als **Span-Recall** (über Gold-Spans) bzw. Recall@K gemessen.

**Refusal** — Bewusste Verweigerung einer Antwort, wenn der Beleg im Workspace fehlt („nur belegt antworten, sonst Lücke kennzeichnen"); namensgebendes Verhalten und eigener Eval-Falltyp (`expected_refusal: true`).

**Reranker** — Modell, das eine erste Trefferliste neu sortiert (feinere Relevanz als der Embedder); in der Matrix eine eigene Achse, inklusive `SkipReranker` (kein Rerank) als Vergleichsbasis.

**RRF (Reciprocal Rank Fusion)** — Verfahren, das mehrere Ranglisten (z. B. BM25 + Vektor) verschmilzt: Score = Summe von 1/(k+Rang), k=60; in LokLM in `src/main/services/retrieval/rrf.ts`.

**Span Recall** — Retrieval-Metrik in AP-E.2: Anteil der Gold-Span-Zeichen, der durch die zurückgegebenen Chunks abgedeckt ist; chunker-unabhängig, dadurch zentrale Vergleichsgröße der Matrix.

**TTFT (Time To First Token)** — Latenzmaß: Zeit bis zum ersten generierten Token einer LLM-Antwort; relevant für die gefühlte Reaktionsgeschwindigkeit bei lokaler Inferenz.

**Vault / KDF** — Verschlüsselter lokaler Tresor für Nutzerdaten; aus dem Passwort wird per Argon2id-KDF ein Schlüssel abgeleitet, mit dem der Vault-Snapshot per AES-256-GCM (Envelope-Schema, ADR-0002) ver-/entschlüsselt wird.

**Worktree** — Mehrere parallele Arbeitsverzeichnisse desselben Git-Repos, je auf einem eigenen Branch; in LokLM zur Isolation von Doku-/Test-Arbeit (z. B. `.claude/worktrees/dom-doku`).

---

## 27.2 Projektspezifische Begriffe

**AP (Arbeitspaket)** — Abgegrenzte Aufgabeneinheit mit eigenem Ticket/DoD (z. B. AP-E.2, AP-T.1).

**ADR (Architecture Decision Record)** — Festgehaltene Architekturentscheidung mit Begründung (`docs/adr/`, z. B. ADR-0001 Argon2id).

**BGE-M3** — Der in LokLM produktiv genutzte mehrsprachige Embedder; Grundlage der modell-gated Retrieval-Tests.

**Dev-Set / Hold-out** — Sichtbares Eval-Set zum Entwickeln (AP-E.1, 80 Fälle) vs. versiegeltes Validierungsset gegen Selbsttäuschung (AP-E1b, 15 Fälle, R5).

**LAP-Korpus** — Aus den realen LAP-/Schulmaterialien aufgebauter Eval-Korpus (90 Dokumente, 2.322 Chunks, 163 DE-Fragen) für die Matrix-Eval.

**Matrix-Eval** — Kartesische Auswertung **Embedder × Reranker × Chunker × LLM** über das Dataset; pro Zelle Span-Recall/nDCG, Laufzeit per `buildMatrixManifest` geschätzt (AP-E.2).

**Sidecar** — Eigenständiger Hilfsprozess neben der App, hier der Windows-GPU-**Translator-Sidecar** (CUDA) für die Übersetzung (v0.4.1).

**Sweep** — Ein Durchlauf der Eval über alle Konfigurationen/Fragen; multi-pod-fähig per `--shard i/n` (round-robin, disjunkt).

> WARN durch Team zu ergaenzen: Falls weitere projektinterne Kürzel (z. B. konkrete Modell-Tier-Namen) im Handbuch standardisiert werden sollen, hier ergänzen.
