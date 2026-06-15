# Komponenten und Module

Dieses Kapitel beschreibt die wichtigsten Service-Module des Main-Prozesses einzeln: Zweck, Eingaben, Verarbeitung, Ausgaben, relevante Dateien, Abhängigkeiten, Status und bekannte Grenzen. Die Module liegen unter [src/main/services/](../../src/main/services/) und werden in [src/main/index.ts](../../src/main/index.ts) als lazy-initialisierte Singletons verdrahtet.

## 14.1 AuthService

Tabelle 14.1 fasst den AuthService zusammen.

**Tabelle 14.1:** Steckbrief des AuthService.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Registrierung, Login/Logout, Sperre, Passwortänderung, Recovery; Lebenszyklus des verschlüsselten Tresors und des In-Memory-DEK |
| **Eingaben** | Passwort, 18-Wort-Recovery-Passphrase (BIP-39-artig), Anzeigename |
| **Verarbeitung** | argon2id-KDF (64 MiB, t=3, p=4) erzeugt KEKs; ein zufälliger DEK (32 B) verschlüsselt den DB-Snapshot per AES-256-GCM; der DEK wird doppelt gewrappt (Passwort-KEK + Recovery-KEK). Tresor-Format v4 (eine Datei + `.bak`), atomares Schreiben mit `fsync`-Fence vor `rename` |
| **Ausgaben** | `AuthStatus`, `LoginResult`, live `Database`-Handle (`requireDatabase()`), Recovery-Passphrase bei Registrierung/Reset |
| **Dateien** | [auth/AuthService.ts](../../src/main/services/auth/AuthService.ts), [auth/secureMemory.ts](../../src/main/services/auth/secureMemory.ts), [auth/inactivity.ts](../../src/main/services/auth/inactivity.ts) |
| **Abhängigkeiten** | `argon2`, `node:crypto`, `sodium-native` (mlock), `Database` |
| **Status** | umgesetzt; siehe ADR-0001/0002 |
| **Grenzen** | Single-User-App (kein Identitätswechsel); 5 Fehlversuche → 5 min Sperre (nur in-memory); Auto-Sperre nach Inaktivität (Default 15 min), pausiert während laufender Modell-Downloads |

Der DEK bleibt über die gesamte Installationslebensdauer gleich; ein Passwort-Reset wrappt ihn nur neu, sodass die Bibliothek erhalten bleibt. Schlüsselmaterial liegt in `mlock`-gesichertem Speicher und wird beim Sperren genullt.

## 14.2 DocumentService + Chunker + Parser

Tabelle 14.2 fasst DocumentService, Chunker und Parser zusammen.

**Tabelle 14.2:** Steckbrief von DocumentService, Chunker und Parser.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Import, Reindex, Refresh und Source-Replace von Dokumenten; orchestriert Parsing → Chunking → Embedding |
| **Eingaben** | Dateipfad, Workspace-ID, optional Chunk-Größe/Overlap (aus Einstellungen) |
| **Verarbeitung** | `parseFile` (PDF via `pdf-parse`/`pdfjs`, Word-Dokumente `.docx` via `mammoth` → Markdown, Markdown, Text, OCR via Tesseract für Bilder/gescannte PDFs) → `chunkPages`/`chunkMarkdown` (Default 2000 Zeichen, 200 Overlap, Separator-Kaskade) → Sprach-Tagging (`eld`) → `persistChunks` (Batch 200) → Embedding (Batch 32). Hash-bewusster Refresh-Kurzschluss (`contentHash`/`sourceMtime`) |
| **Ausgaben** | `documents`-/`chunks`-Zeilen, `indexing:progress`-Events |
| **Dateien** | [documents/DocumentService.ts](../../src/main/services/documents/DocumentService.ts), [documents/chunker.ts](../../src/main/services/documents/chunker.ts), [documents/parser.ts](../../src/main/services/documents/parser.ts), [documents/markdownParser.ts](../../src/main/services/documents/markdownParser.ts), [documents/ocr.ts](../../src/main/services/documents/ocr.ts) |
| **Abhängigkeiten** | `documentsWorker`, `ProviderRegistry` (Embedder), `AuthService` |
| **Status** | umgesetzt |
| **Grenzen** | Max. Importgröße 50 MB (Pflichtenheft §3.9); max. 2 gleichzeitige Indexierungs-Jobs; laufende Worker-Requests sind mitten im Parse nicht abbrechbar; Markdown-Chunks führen `headingPath` statt Seitenzahlen |

Markdown wird sektionsbewusst gechunkt: Sektionsgrenzen werden nie überschritten, jeder Chunk trägt den hierarchischen `headingPath` für präzise Zitate (Breadcrumb statt „S. 5").

## 14.3 FolderSyncService

Tabelle 14.3 fasst den FolderSyncService zusammen.

**Tabelle 14.3:** Steckbrief des FolderSyncService.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Pro-Workspace überwachte Ordner; automatische Nachführung von Neu-/Änderungs-/Verschwinde-Ereignissen |
| **Eingaben** | Registrierte Sync-Ordnerpfade, `fs.watch`-Events |
| **Verarbeitung** | Walk + Vergleich gegen `documents` (Pfad/Hash/mtime): neu → Import, geändert → Reindex, verschwunden → soft-`missing_at` markieren |
| **Ausgaben** | `sync:progress`-Events; aktualisierte `documents`-Zeilen |
| **Dateien** | [documents/FolderSyncService.ts](../../src/main/services/documents/FolderSyncService.ts) |
| **Abhängigkeiten** | `DocumentService`, `AuthService` |
| **Status** | umgesetzt |
| **Grenzen** | Watcher halten OS-Handles und werden bei Sperre/Logout gestoppt (kein Übertritt auf ein anderes Konto); verschwundene Dateien bleiben durchsuchbar, bis der Nutzer „Behalten"/„Entfernen" entscheidet |

## 14.4 EmbeddingService + EmbeddingBackfillService

Tabelle 14.4 fasst EmbeddingService und EmbeddingBackfillService zusammen.

**Tabelle 14.4:** Steckbrief von EmbeddingService und Backfill.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Erzeugung von 1024-dim-Embeddings (BGE-M3) für Chunks und Summaries; idle-getriebenes Nachfüllen fehlender Vektoren |
| **Eingaben** | Chunk-/Summary-Texte; Placement-Wahl (auto/cpu/gpu) |
| **Verarbeitung** | Lädt das gebündelte `bge-m3-Q4_K_M.gguf` über den `modelsWorker`; Identität `bundled:bge-m3` wird pro Chunk gespeichert. Backfill purged inkompatible Identitäten (anderer `embedderModelStem`) und re-embedded |
| **Ausgaben** | `chunks.embedding` / `documents.summary_embedding`, `embedder:status`-Events |
| **Dateien** | [embeddings/EmbeddingService.ts](../../src/main/services/embeddings/EmbeddingService.ts), [embeddings/EmbeddingBackfillService.ts](../../src/main/services/embeddings/EmbeddingBackfillService.ts), [embeddings/ResourcePlanner.ts](../../src/main/services/embeddings/ResourcePlanner.ts) |
| **Abhängigkeiten** | `ModelsWorkerClient`, `ResourcePlanner` |
| **Status** | umgesetzt |
| **Grenzen** | Aktive Embedding-Spalte ist fest `vector(1024)`; ein externer Ollama-Embedder mit abweichender Dimension wird vor dem Umschalten abgewiesen (Dim-Mismatch-Guard in `embedder:trySwitchSource`) |

## 14.5 RetrievalService

Tabelle 14.5 fasst den RetrievalService zusammen.

**Tabelle 14.5:** Steckbrief des RetrievalService.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Hybride Retrieval-Pipeline: Multi-Query-Expansion → BM25 + dense + RRF → Reranking → Diversifizierung → Nachbar-/Whole-Doc-Expansion |
| **Eingaben** | Workspace-ID, Query, topK, `RetrievalOptions` (multiQuery, rerank, docPrefilter, perDocCap, Boost-Faktoren, …) |
| **Verarbeitung** | Optional hierarchischer Doc-Prefilter über Summary-Embeddings; CPU-Preset-Auto-Erkennung (LLM ohne GPU → kleinere Kandidatenpools, kein Rerank/MultiQuery); Score-Heuristiken (Title-Boost, Short-Chunk-Penalty, Recency-/Language-Boost); Round-Robin-Diversifizierung pro Dokument |
| **Ausgaben** | `RetrievalHit[]` mit `origin` (primary/neighbour/whole_doc) |
| **Dateien** | [retrieval/RetrievalService.ts](../../src/main/services/retrieval/RetrievalService.ts), [retrieval/rrf.ts](../../src/main/services/retrieval/rrf.ts), [retrieval/heuristics.ts](../../src/main/services/retrieval/heuristics.ts) |
| **Abhängigkeiten** | `Database`, `ProviderRegistry` (Embedder, Reranker, LLM) |
| **Status** | umgesetzt; programmatisch auch über `search:hybrid` (Eval-Harness AP-E.2) erreichbar |
| **Grenzen** | Stages 0 (Expansion) und 2 (Rerank) degradieren still, wenn das benötigte Modell nicht geladen ist |

## 14.6 RerankerService

Tabelle 14.6 fasst den RerankerService zusammen.

**Tabelle 14.6:** Steckbrief des RerankerService.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Cross-Encoder-Reranking des fusionierten Kandidatenpools (BGE-Reranker-v2-M3) |
| **Eingaben** | Query + Passagen-Texte |
| **Verarbeitung** | Lädt `bge-reranker-v2-m3-Q4_K_M.gguf` (lazy, vorwärmbar via `reranker:warmup`); vergibt Relevanz-Scores |
| **Ausgaben** | Score-Array; `reranker:status`-Events |
| **Dateien** | [retrieval/RerankerService.ts](../../src/main/services/retrieval/RerankerService.ts) |
| **Abhängigkeiten** | `ModelsWorkerClient`, `ResourcePlanner` |
| **Status** | umgesetzt |
| **Grenzen** | Im „lite"-Tier per Default **aus** (schwerste optionale Stage, Ziel: RAM-arme Maschinen); bei Fehler bleibt die fusionierte RRF-Reihenfolge |

## 14.7 LlamaService

Tabelle 14.7 fasst den LlamaService zusammen.

**Tabelle 14.7:** Steckbrief des LlamaService.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Fassade für das gebündelte Chat-/Generierungs-LLM (`node-llama-cpp` im `modelsWorker`) |
| **Eingaben** | Frage + gepackte Hits + AskOptions (pinnedHits, contextPreamble, history, abortSignal); Profil-, Kontext- und Geräte-Wahl (`placement` auto/cpu/gpu) |
| **Verarbeitung** | Profil-↔-GGUF-Bindung (lite=Qwen3.5-2B, full=4B, xl=9B + Fallback-Pattern für ältere Modelle); Prompt-Bau, Token-Batching (~8 ms), Think-Filter, Loop-Detector, Kontext-Overflow-Retry |
| **Ausgaben** | gestreamte Tokens (über `onChunk`), Volltext; `llm:status` |
| **Dateien** | [llm/LlamaService.ts](../../src/main/services/llm/LlamaService.ts), [llm/prompt.ts](../../src/main/services/llm/prompt.ts), [llm/conversationSwitch.ts](../../src/main/services/llm/conversationSwitch.ts) |
| **Abhängigkeiten** | `ModelsWorkerClient`, `ResourcePlanner`, `TierMarker` |
| **Status** | umgesetzt |
| **Grenzen** | Geteilter Worker verträgt **keine parallele** Inferenz (sonst 0xC0000005 auf knappen Maschinen) — Inferenz ist serialisiert; Idle-Eviction Default 30 min |

Die Geräte-Wahl (`placement` auto/cpu/gpu) spiegelt Embedder/Reranker; das tatsächlich aufgelöste Gerät (`resolvedPlacement`) und der Grund werden im `SystemInfo` geführt und in der Status-Bar als CUDA-/CPU-Chip angezeigt (`eba08e3`).

## 14.8 QAService + Router

Tabelle 14.8 fasst QAService und Router zusammen.

**Tabelle 14.8:** Steckbrief von QAService und Router.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | Streaming-RAG-Einstiegspunkt: Routing, Retrieval, Refusal-Gating, Kontext-Packing, Antwort-Streaming mit Zitaten |
| **Eingaben** | Workspace-ID, Query, `AnswerOptions` (topK, language, history, activeDocumentIds, routing, …), AbortSignal |
| **Verarbeitung** | `resolveRoute` (regex-first): **corpus** (Anzahl/Liste von Dokumenten → templatierte DE/EN-Antwort, kein LLM), **doc_summary** (gecachte Whole-Doc-Summary als unzitierter Preamble), **retrieval** (Default). Pinned-Doc-Budget, Multi-Question-Decomposition, Stage-Events |
| **Ausgaben** | `StreamEvent`-AsyncIterable (stage/citation/token/refusal/done/error) |
| **Dateien** | [qa/QAService.ts](../../src/main/services/qa/QAService.ts), [qa/router.ts](../../src/main/services/qa/router.ts), [qa/corpusAnswer.ts](../../src/main/services/qa/corpusAnswer.ts) |
| **Abhängigkeiten** | `RetrievalService`, `ProviderRegistry`, `SummarizationService`, `Database` |
| **Status** | umgesetzt; siehe ADR-0003 |
| **Grenzen** | Routing erkennt manche polyseme Scope-Nomen falsch (bewusst nicht über-getightened); Zitate sind chunk-gebunden (Option A) |

## 14.9 ModelDownloader + ProviderRegistry

Tabelle 14.9 fasst ModelDownloader und ProviderRegistry zusammen.

**Tabelle 14.9:** Steckbrief von ModelDownloader und ProviderRegistry.

| Aspekt | Beschreibung |
| --- | --- |
| **Zweck** | `ModelDownloader`: Stream-Download von GGUFs (Resume, SHA-256/Size-Verify, Cancel, ratenbegrenzte Progress-Events). `ProviderRegistry`: Abstraktion bundled vs. Ollama je LLM/Embedder/Reranker mit Auto-Fallback |
| **Eingaben** | Manifest-Eintrag (`MODEL_MANIFEST`: Embedder + Reranker als required), Quellen-Umschaltung aus Einstellungen |
| **Verarbeitung** | `.partial`-Datei + `Range`-Resume; Provider-Auswahl pro Aufruf, automatischer Bundled-Fallback bei Netzwerk-/Timeout-/Server-Fehler |
| **Ausgaben** | GGUF-Dateien auf Platte; `models:progress:*`-Events; `provider:fallback`-Events |
| **Dateien** | [models/ModelDownloader.ts](../../src/main/services/models/ModelDownloader.ts), [models/manifest.ts](../../src/main/services/models/manifest.ts), [providers/Registry.ts](../../src/main/services/providers/Registry.ts), [providers/ollama/](../../src/main/services/providers/ollama/) |
| **Abhängigkeiten** | `node:stream`, `node:crypto`; bundled/Ollama-Provider-Implementierungen |
| **Status** | umgesetzt |
| **Grenzen** | Das LLM ist **nicht** mehr im Laufzeit-Manifest (seit v0.4.x) — der Installer-Wizard besitzt die LLM-Akquise per Tier-Bundle; LLM-Erkennung läuft filename-pattern-basiert |

## 14.10 Quiz / Summarization / Writing / Transcription / Translation

Tabelle 14.10 fasst die weiteren Feature-Module zusammen.

**Tabelle 14.10:** Übersicht der weiteren Feature-Module.

| Modul | Zweck & Kern | Dateien | Status / Grenzen |
| --- | --- | --- | --- |
| **QuizService** | MCQ-Decks aus Dokumentauswahl; ein LLM-Call pro chunk-basierter Einheit, Validierung im Code (keine Themen/Embeddings/Retries) | [quiz/QuizService.ts](../../src/main/services/quiz/QuizService.ts), [quiz/generation.ts](../../src/main/services/quiz/generation.ts), [quiz/units.ts](../../src/main/services/quiz/units.ts) | umgesetzt; Sprache aus Doc-Sample auto-erkannt; hängengebliebene Decks werden beim Login auf `failed` zurückgesetzt |
| **SummarizationService** | Lazy berechnete Whole-Doc-Summary (Map-Reduce), gecacht; Quelle für die doc_summary-Route | [summarize/SummarizationService.ts](../../src/main/services/summarize/SummarizationService.ts), [summarize/prompt.ts](../../src/main/services/summarize/prompt.ts) | umgesetzt; Summary wird bei Reindex genullt; CPU-Guard gegen Minuten-Stille bei langen Docs |
| **WritingService** | DeepL-Write-artige Umformulierung auf dem gebündelten LLM (gleiche Sprache) | [writing/WritingService.ts](../../src/main/services/writing/WritingService.ts), [writing/prompt.ts](../../src/main/services/writing/prompt.ts) | umgesetzt; bei Ollama-LLM kein lokaler GGUF-Load nötig |
| **TranscriptionService** | Whisper-Transkription + optionale Sprecher-Diarisierung; Speichern als Workspace-Dokument | [transcription/TranscriptionService.ts](../../src/main/services/transcription/TranscriptionService.ts), [transcription/align.ts](../../src/main/services/transcription/align.ts) | umgesetzt; Whisper-Binding kann nicht mitten im Lauf abbrechen (Cancel überspringt nur Diarisierung) |
| **TranslationService** | MADLAD-400-Übersetzung über CTranslate2-Sidecar (lazy Start); das CT2-Modell (~2,76 GiB, vier Dateien) wird vom Installer-Wizard bereitgestellt — die App lädt es nie selbst herunter, sie lokalisiert nur die installierten Dateien (`locateModelDir`) | [translation/TranslationService.ts](../../src/main/services/translation/TranslationService.ts), [translation/TranslatorSidecar.ts](../../src/main/services/translation/TranslatorSidecar.ts), [translation/segment.ts](../../src/main/services/translation/segment.ts) | optionales Feature; nicht Teil des First-Launch-Gatings; degradiert auf klaren Status, nie auf eine kaputte App |

## 14.11 Geteilte Infrastruktur

- **ResourcePlanner** ([embeddings/ResourcePlanner.ts](../../src/main/services/embeddings/ResourcePlanner.ts)) — berechnet Placement (CPU/GPU) und Footprints (`ggufWeightBytes` + KV); heute Einmal-Advisor zur Ladezeit. Die in ADR-0004 „Adaptive Model Residency" skizzierte Erweiterung zum lebenden Live-Budget ist ein **Design-Vorschlag (ADR-0004, Status PROPOSED) — im aktuellen Stand NICHT implementiert** (kein `src/main/.../placement/`-Code vorhanden).
- **ModelLoadLock** ([concurrency/ModelLoadLock.ts](../../src/main/services/concurrency/ModelLoadLock.ts)) — serialisiert die schweren nativen Loads.
- **Worker-Clients** ([workers/](../../src/main/services/workers/)) — `ModelsWorkerClient`, `DocumentsWorkerClient`, `TranscriptionWorkerClient`, `DiarizationWorkerClient` multiplexen Request/Response per ID und fächern Status-/Token-Pushes aus.
- **TierMarker** ([tier/TierMarker.ts](../../src/main/services/tier/TierMarker.ts)) — liest den vom Installer geschriebenen `loklm-tier.json` (Tier lite/standard/pro, Hardware-Snapshot, Ollama-Opt-in). `null` = Dev/Test/Pre-v0.3.0 → Legacy-Pfad.
- **Logger** ([logging/logger.ts](../../src/main/services/logging/logger.ts)) — Datei-Logger, der `uncaughtException`/`unhandledRejection` und `console.error/warn` aller Services aufzeichnet; per `logs:openFolder` aus dem About-Tab erreichbar.
