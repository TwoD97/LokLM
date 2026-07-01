# Dogfood: LokLM-Codebase als Code-RAG-Testkorpus (Standard + Pro)

Ziel: die eigene Codebase als Codebase-Workspace indexieren und die Code-RAG-Pipeline
mit realen Fragen prüfen. Lite ist außen vor (kein Codebase-Indexing,
`isCodebaseIndexingEnabled()` in `src/main/services/tier/TierMarker.ts`); die
Retrieval-Fixes (BM25-Brücke, Floor, Trace) wirken aber in der gemeinsamen Pipeline.

## Setup

1. **Tier emulieren:** `pnpm dev --standard` bzw. `pnpm dev --pro` (setzt `LOKLM_TIER`).
   Die EN-Übersetzungs-Variante im Retrieval läuft seit 0.6.5 über das **residente LLM**
   (Standard + Pro, kein MADLAD-VRAM mehr); sie erscheint im Trace unter `variants`.
   Ausnahmen: Lite (iGPU-Latenz), CPU-Preset (kein Extra-LLM-Pass) und Codebase-
   Workspaces mit aktiver Multi-Query-Expansion (deren Zeile 1 ist bereits die Übersetzung).
2. **Trace einschalten:** `LOKLM_RETRIEVAL_TRACE=1` in der Umgebung → schreibt pro
   Retrieval eine JSON-Zeile nach `<logs>/retrieval.log` (Queries, Varianten,
   Kandidaten-IDs, Scores, Floor-Drops, finale Top-K — nie Chunk-Text).
3. **Workspace anlegen:** neuen Workspace vom Typ Codebase, das LokLM-Repo als
   Sync-Ordner hinzufügen. **Wichtig:** Bestandsindizes vor dem Test neu aufbauen
   (Reindex/Neu-Sync) — der Breadcrumb enthält erst nach dem Fix den repo-relativen
   Pfad, alte Indizes haben nur den Dateinamen (Rollen-Malus bleibt dort defekt).
4. Nach jeder Frage: `retrieval.log` prüfen — welche Dateien im Top-K, welche Rolle,
   ob der Floor Kandidaten verworfen hat.

## Erwartung pro Frage

Bewertet wird: **Zieldatei im Top-K** (Retrieval) und **Antwort benennt Datei/Klasse
korrekt** (Antwortseite). Selbstreferenz-Falle beachten: die Eval-/Testdateien
(`tests/evals/code/debugQuery.ts`, Fixtures) enthalten viele der Fragen wörtlich —
nach dem Rollen-Fix müssen sie als `eval`/`test` demotiert werden; gewinnen sie
trotzdem, in `retrieval.log` prüfen, ob `heading_path[0]` wirklich der relative Pfad ist.

## Fragenkatalog (Chat, Deutsch — der Produktions-Normalfall)

Laienfragen (kein Identifier — testen Brücke + Lay-Boost + Code-Quote):

| # | Frage | Erwartete Datei |
|---|---|---|
| 1 | Was macht die auth klasse? | `src/main/services/auth/AuthService.ts` |
| 2 | Wie kommen Benutzer in die App und was passiert bei Inaktivität? | `AuthService.ts` |
| 3 | Wie findet die App die richtigen Stellen in meinen Dateien? | `retrieval/RetrievalService.ts` |
| 4 | Welche Klasse zerlegt Dokumente in Chunks? | `documents/DocumentService.ts` (+ `chunker.ts`) |
| 5 | Wo sind Datenbankschema und Migrationen definiert? | `db/sqlite/schema.sql.ts` / `WorkspaceDb.ts` |
| 6 | Wie funktioniert die Volltextsuche? | `db/sqlite/WorkspaceDb.ts` |
| 7 | Welche Klasse speichert die Einstellungen? | `settings/SettingsService.ts` |
| 8 | Woher weiß die App, welche Edition installiert ist? | `tier/TierMarker.ts` |
| 9 | Wie wird ein Ordner synchron gehalten? | `documents/FolderSyncService.ts` |
| 10 | Wie übersetzt die App offline? | `translation/TranslationService.ts` |

Identifier-Fragen (testen Symbol-Boost + Identifier-Erhalt in der Expansion):

| # | Frage | Erwartete Datei |
|---|---|---|
| 11 | Was macht RetrievalService.search Schritt für Schritt? | `RetrievalService.ts` |
| 12 | Wie funktioniert readTierMarker? | `TierMarker.ts` |
| 13 | Wo wird isCodebaseIndexingEnabled konsumiert? | `TierMarker.ts` + Aufrufer |
| 14 | Was macht fuseRrf mit den beiden Trefferlisten? | `retrieval/rrf.ts` |
| 15 | Warum ist effectiveRerank in Codebase-Workspaces false? | `RetrievalService.ts` (Fix-A-Kommentar) |

Rollen-/Routing-Fragen (testen fileRole-Demotion + Test-Intent):

| # | Frage | Erwartung |
|---|---|---|
| 16 | Wie wird die Retrieval-Heuristik getestet? | Test-Intent → `heuristics`-Tests, nicht die Implementierung |
| 17 | Wie funktioniert die auth klasse? (wörtlich der Eval-String!) | `AuthService.ts` — NICHT `debugQuery.ts` |
| 18 | Zeig mir die Architektur der Retrieval-Pipeline | Docs-Intent → ADR/Docs dürfen gewinnen |

Datenbank-Kompositum-Fragen (testen die robuste Brücke):

| # | Frage | Erwartete Datei |
|---|---|---|
| 19 | Wo wird das Datenbankschema angelegt? | `schema.sql.ts` |
| 20 | Gibt es eine Schemamigration für alte Datenbanken? | `WorkspaceDb.ts` (guarded ALTERs) |
| 21 | Welche Tabelle speichert die Sync-Ordner? | `schema.sql.ts` (`sync_folders`) |

## Messbarer Regressionstest (ohne App)

```powershell
# 1. Korpus bauen (pure Datei-Walk, kein Modell). tests/ mitnehmen, damit die
#    Selbstreferenz-Falle (debugQuery.ts-Fixtures) im Korpus liegt:
pnpm exec tsx tests/evals/code/buildCorpus.ts --roots src,tests,docs

# 2. EN-Baseline + DE-Set (lädt den Qwen3-Embedder, erster Lauf baut den Vec-Cache):
pnpm exec tsx tests/evals/code/run.ts --embedder-path models/Qwen3-Embedding-0.6B-Q8_0.gguf
pnpm exec tsx tests/evals/code/run.ts --embedder-path models/Qwen3-Embedding-0.6B-Q8_0.gguf --queries loklm-de.json

# 3. Einzel-Query-Trace (braucht den Vec-Cache aus Schritt 2):
pnpm exec tsx tests/evals/code/debugQuery.ts "was macht die auth klasse"

# Schnelle Wiring-Validierung ohne Modell: --fake
pnpm exec tsx tests/evals/code/run.ts --fake --queries loklm-de.json
```

Das deutsche Set (`tests/evals/data/code-queries/loklm-de.json`, 16 Ziele × 5
Phrasierungen) misst erstmals Deutsch→Code-Recall — vor den Fixes gab es dafür
keine einzige Messung.
