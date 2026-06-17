# Laborbericht — LokLM

|                          |                                                                          |
| ------------------------ | ------------------------------------------------------------------------ |
| **Datum**                | 12.06.2026                                                               |
| **Bearbeiter**           | Dominik Furlan                                                           |
| **Rolle**                | UI/UX · Tests · Dokumentation                                            |
| **Projekt**              | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation              |
| **Sprint / Meilenstein** | Sprint 6 (08.06.–12.06.) · Schwerpunkt **Testabdeckung (AP-T.2)**        |
| **Software-Stand**       | v0.4.0 (main) · AP-T.2 auf Branch `dom/ap-t2-integrationstests` (PR #19) |

---

## 1. Tagesziele

1. Integrationstest-Suite (AP-T.2) für die drei E2E-Tests aus Strukturplan §8.2 implementieren
   (DocumentService, RetrievalService, Auth) — gegen reale Services + echte DB, keine Mocks.
2. Reproduzierbares Retrieval-Korpus erstellen und ins Repo committen.
3. Ersten vitest-CI-Job im Repository einrichten (grün auf Ubuntu/GitHub Actions).
4. PR #19 erstellen, alle Akzeptanzkriterien des Tickets erfüllen und verifizieren.

---

## 2. Durchgeführte Arbeiten

### 2.1 Drei E2E-Suiten gegen reale Services (§8.2)

Alle drei Tests booten eine echte In-Memory-**PGlite** (inkl. pgvector + Drizzle- und Raw-SQL-Migrationen)
über `AuthService.register` — keine Mocks. Muster der bestehenden Integration-Tests übernommen
(`mkdtemp` + `AuthService` + `WorkspaceService`, `importFile` mit Fake-Sender, Polling auf
`IndexProgress`-Phase `done`).

- **DocumentService E2E** (`tests/integration/document-pdf-e2e.test.ts`, modellfrei, läuft in CI):
  Committetes `sample.pdf` importieren → `documents`-Zeile auf `ready`, Chunks vorhanden,
  `chunk_count` exakt = tatsächliche Chunk-Anzahl. Volltextsuche: Index `idx_chunks_fts` existiert und
  die FTS-Expression matcht echten importierten Chunk-Text. `chunk_count` folgt auch dem DELETE-Pfad
  des Statement-Triggers.
- **RetrievalService E2E** (`tests/integration/retrieval-corpus-e2e.test.ts`, echter BGE-M3, modell-gated):
  Korpus importieren, jede der 10 Fragen muss ihre erwartete `##`-Sektion im Top-5 treffen; zusätzlich
  In-Prozess-Determinismus (zwei identische Anfragen → identisches Ranking). Alle nicht-deterministischen
  Stellschrauben (Rerank, Multi-Query, Recency-Boost, Whole-Doc-Fallback) im Test fixiert.
- **Auth E2E** (`tests/integration/auth-e2e.test.ts`): voller §8.2-Round-Trip
  (Register → Login → Verschlüsseln → Neustart → Entschlüsseln → Recovery-Reset → neuer Login)
  mit Datenpersistenz-Prüfung über den verschlüsselten Vault-Snapshot.

### 2.2 Reproduzierbares Retrieval-Korpus

- `tests/fixtures/retrieval/korpus.ts` committed: **10 Dokumente / 60 Chunks / 10 Fragen**
  (Bio/Geo/Astro/Physik/Geschichte/Mathe, DE + EN).
- Jede Frage ist eindeutig einer `##`-Sektion zugeordnet und gegen den echten BGE-M3 als eindeutig
  auflösbar verifiziert — damit ist das Korpus als deterministische Test-Grundlage belastbar.

### 2.3 Erster vitest-CI-Job im Repository

- Neuer Job in `.github/workflows/checks.yml` ergänzt (`pnpm test:integration` + `pnpm test:tx`,
  Timeout 15 min) — der **erste** Test-Job im Repo (CI baute bisher nur die Website).
- Damit vitest auf Ubuntu **ohne** Electron-Runtime lädt, wurde ein schlanker **Electron-Stub**
  ergänzt (`tests/helpers/electron-stub.ts` + Alias in `vitest.workspace.ts`); er behebt Ladefehler
  in den `embedder-identity`/`embedding-backfill`-Suiten unter dem neuen CI-Job.
- Ergebnis: CI-Job **(integration + tx)** grün in ~2:40 min.

### 2.4 Schlüsselentscheidungen & an die Logik-Domäne gemeldet

- **Volltextsuche statt toter Spalte:** Die Spec nennt „`text_search` durch Trigger befüllt". Migration
  `0006` hat Spalte **und** Trigger jedoch durch den GIN-Expression-Index `idx_chunks_fts` ersetzt.
  Der Test prüft daher das **heutige Äquivalent** (Index-Existenz + FTS-Expression matcht echten
  Chunk-Text), nicht eine nicht mehr existierende Spalte.
- **Echter Embedder statt Fakes:** Retrieval läuft gegen das echte BGE-M3-GGUF (in-process); die Suite ist
  wie die bestehenden modellgebundenen Tests per `describe.runIf(GGUF vorhanden)` gegated.
- **An Denys gemeldet (Logik-Domäne, nur Hinweis):** (1) `searchChunks`/`searchChunksByVector` ohne
  Tie-Break im `ORDER BY` → Cross-Session-Determinismus nicht garantiert (Empfehlung: zweiter
  Sortierschlüssel `document_id`/`chunk_id`). (2) `document-import.test.ts` nutzt fixes `setTimeout(2000)`
  → latentes Flake-Risiko (Empfehlung: auf Polling-`waitFor` umstellen).

---

## 3. Ergebnisse (Überblick)

| Ziel                    | Ergebnis                                                    |
| ----------------------- | ----------------------------------------------------------- |
| DocumentService E2E     | ✅ 3/3 grün, modellfrei, läuft in CI (~11 s)                |
| RetrievalService E2E    | ✅ 3/3 grün lokal (echter BGE-M3), modell-gated (~51 s)     |
| Auth E2E §8.2           | ✅ 1/1 grün (~8 s)                                          |
| Reproduzierbares Korpus | ✅ 10 Dok / 60 Chunks / 10 Fragen committed                 |
| Erster CI-Test-Job      | ✅ grün (~2:40 min), Gesamtlaufzeit lokal ~70 s (< 5 min ✓) |

---

## 4. Probleme & Erkenntnisse

- **Spec ≠ aktueller Schema-Stand:** Die im Strukturplan genannte `text_search`-Spalte existiert nicht mehr
  (durch GIN-Expression-Index ersetzt). Statt eine tote Spalte zu testen, wurde das real existierende
  Äquivalent geprüft — Beleglage vor Spec-Wortlaut.
- **Electron-Runtime fehlt in CI:** vitest lud auf Ubuntu nicht, weil mehrere Suiten `electron` importieren.
  Gelöst über einen schlanken Electron-Stub (Alias in `vitest.workspace.ts`), statt die Suiten zu deaktivieren.
- **Determinismus muss erzwungen werden:** Reranking, Multi-Query, Recency-Boost und Whole-Doc-Fallback
  sind nicht-deterministisch — für reproduzierbare Tests im Korpus-Test fixiert.
- **Modell-gated ≠ ungetestet:** Die RetrievalService-E2E skippt in CI (BGE-M3-GGUF liegt nicht im Runner),
  läuft aber lokal mit Modell grün — exakt wie die bestehenden modellgebundenen Suiten.

---

## 5. Offene Punkte / Nächste Schritte

- **Review-Freigabe + Merge** von PR #19 (mergebar, keine Konflikte, alle Checks grün; nur durch
  Branch-Protection/Review gehalten).
- **CI-Frage an das Team:** Soll die RetrievalService-E2E zwingend _in CI_ laufen? Das bräuchte einen
  Modell-Download-Step in der Pipeline (Laufzeit-/Kostenabwägung).
- **Fachliche Gegenprobe** der 10 Korpus-Fragen (Domäne).
- **An Denys** (s. 2.4): Tie-Break in `searchChunks` ergänzen; `setTimeout(2000)`-Flake entschärfen.

---

## 6. Artefakte / Nachweise

- **Test-Nachweis (lokal):**
  ```
  pnpm models:embedder   # einmalig, für die RetrievalService-E2E
  pnpm vitest run --project integration tests/integration/document-pdf-e2e.test.ts tests/integration/retrieval-corpus-e2e.test.ts tests/integration/auth-e2e.test.ts
  ```

| Suite                | Datei                                            | Tests | Ergebnis                | Läuft in CI?             | Laufzeit (lokal) |
| -------------------- | ------------------------------------------------ | ----- | ----------------------- | ------------------------ | ---------------- |
| DocumentService E2E  | `tests/integration/document-pdf-e2e.test.ts`     | 3     | ✅ grün                 | ✅ ja (modellfrei)       | ~11 s            |
| RetrievalService E2E | `tests/integration/retrieval-corpus-e2e.test.ts` | 3     | ✅ grün (lokal, BGE-M3) | ⏭️ skippt (modell-gated) | ~51 s            |
| Auth E2E §8.2        | `tests/integration/auth-e2e.test.ts`             | 1     | ✅ grün                 | ✅ ja                    | ~8 s             |

- **CI (GitHub Actions, PR #19):** Job **Tests (integration + tx)** ✅ grün (~2:40 min), Job **Website** ✅ grün.
- **Relevante Commits:** `3e0a4d2` (E2E + CI-Job), `9644d60` (Korpus), `48255ab` (Electron-Stub → grüner CI-Job).
- **Branch / PR:** `dom/ap-t2-integrationstests` · PR #19.
- **Vikunja:** Task AP-T.2 (Integrationstests).
