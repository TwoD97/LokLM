# Design: DB-Skalierung + Per-Workspace-Verschlüsselung

**Datum:** 2026-06-16
**Status:** Vollständig implementiert + verdrahtet (Engine, Vault-v5, Retrieval/Ingestion auf LanceDB-only, Default-Workspace-UI, v4→v5-Migration, pgvector entkoppelt). Verbleibt nur Packaging (Electron-Native-Rebuild) + Live-App-UI-Durchlauf — in dieser Node-Umgebung nicht ausführbar.
**Entscheidung:** [ADR-0005](../adr/0005-per-workspace-scaled-encrypted-vector-store.md)

Dieses Dokument ist der Umsetzungsplan zu ADR-0005: vom heutigen In-Memory-PGlite-
Single-Vault zu einem platten-residenten, per-Workspace block-verschlüsselten
Vektor-Store, der 100–500 Mio. Vektoren trägt.

## Ziel in einem Satz

Jeder Workspace ist ein eigenes, einzeln entsperrbares, block-verschlüsseltes
Verzeichnis (LanceDB-Vektoren + Metadaten-DB). Nur der aktive (bzw. Default-)
Workspace ist offen; der residente Speicher hängt am größten _einzelnen_
Workspace, nicht am Gesamtkorpus.

## Was bereits im Repo liegt (dieser Branch)

| Datei                                                        | Inhalt                                                                                                                             | Reife                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/shared/workspaceStorage.ts`                             | `VaultManifest`, `WorkspaceManifestEntry`, `EncryptionLevel`, `VectorIndexConfig`, `resolveDefaultWorkspace`, `suggestIndexConfig` | fertig, typisiert                        |
| `src/main/services/storage/blockCipher.ts`                   | `encryptBlock`/`decryptBlock` (rein, getestet) + `EncryptedBlockFile` (fs-positional)                                              | Crypto fertig + getestet; mmap-Pfad TODO |
| `src/main/services/auth/workspaceKeys.ts`                    | Master-DEK → WDEK Wrap/Unwrap (hierarchisches Envelope)                                                                            | fertig + getestet                        |
| `src/main/services/storage/VectorStore.ts`                   | Backend-agnostische Schnittstelle (der Seam)                                                                                       | fertig                                   |
| `src/main/services/storage/encryptedWorkspaceDir.ts`         | Decrypt-on-Open / Encrypt-on-Close pro Workspace (At-Rest-Block-Crypto, inkrementeller Delta-Persist)                              | implementiert                            |
| `src/main/services/storage/LanceWorkspaceStore.ts`           | LanceDB-Impl. des Seams (connect/createTable/mergeInsert/search cosine/ivfPq+ivfFlat/delete)                                       | implementiert                            |
| `src/main/services/storage/WorkspaceStore.ts`                | Orchestrator: Manifest, WDEK-Unwrap, open/close/create/delete, Default-Workspace, Index-Build                                      | implementiert                            |
| `tests/unit/*` + `tests/integration/workspace-store.test.ts` | 17 Tests grün (Crypto-Round-Trip, AAD, Tamper, WDEK, End-to-End-Verschlüsselung+Suche+Wrong-Key+Default+Delete)                    | fertig                                   |

`@lancedb/lancedb@0.30` ist als Dependency installiert und im Node-Test
nachweislich lauffähig. Der Storage-Stack ist eigenständig integrationsgetestet;
PGlite bleibt der **aktive** App-Pfad, bis die Verdrahtung unten steht. `tsc -b`
grün.

## Phasenplan

### Phase 0 — Seams & Krypto (erledigt)

Schnittstellen + verifizierbare Krypto-Primitive.

### Phase 1 — Engine-Integration (erledigt)

1. ✅ `@lancedb/lancedb` als Dependency; im Node-Test lauffähig. Native-Rebuild für
   die Electron-ABI in der `pnpm install`-Pipeline + Lizenz in
   `THIRD_PARTY_NOTICES.md` bleiben als Packaging-Aufgabe.
2. ✅ ObjectStore-Hook im Node-SDK verifiziert → **nicht verfügbar** (nur Rust).
   Daher gewählt: **Decrypt-on-Open** (`EncryptedWorkspaceDir`) statt In-Engine-Crypto.
3. ✅ `LanceWorkspaceStore` real (`open/upsert/remove/search/count/buildIndex/close`).
4. ✅ `WorkspaceStore`-Orchestrator + End-to-End-Integrationstest.

### Phase 2 — Per-Workspace-Lifecycle (erledigt)

1. ✅ `WorkspaceStore`-Orchestrator (`open/close/create/delete/ensure`, Default).
2. ✅ `AuthService`: v5-Vault-Body trägt den `VaultManifest`; `getWorkspaceStore()`
   bindet Master-DEK + Manifest; Lock schließt den aktiven Workspace + wiped WDEK.
3. ✅ `WorkspaceService.create/delete` legt/entfernt Manifest-Entry (WDEK) + Lance-Dir.
4. ✅ `setDefault`/`getDefault` + IPC (`workspaces:get/setDefault`) + Preload +
   Sidebar-Stern-Button + Auto-Load des Default-Workspace beim Unlock (AppShell).

### Phase 3 — Retrieval-Umzug (erledigt, Dual-Write)

1. ✅ `RetrievalService` bekommt eine injizierte `VectorSearchFn` → Dense-Suche liest
   aus dem per-Workspace LanceDB-Store (`WorkspaceVectorService`), Treffer werden via
   `Database.hydrateChunkHits` aus PGlite (Text/Titel/Seite) hydratisiert. BM25 + RRF
   unverändert. Ohne Injection (isolierte Tests) bleibt der pgvector-Pfad.
2. ✅ Ingestion (`DocumentService`) + `EmbeddingBackfillService` schreiben Embeddings
   **dual**: PGlite (Bookkeeping/Identity unverändert) **und** LanceDB (Such-Index).
3. ✅ Erstöffnung migriert vorhandene pgvector-Embeddings eines Workspace nach
   LanceDB (`WorkspaceVectorService.migrateIfNeeded` ← `Database.listChunkVectors`).

### Phase 4 — Vault-Migration v4→v5 (erledigt)

✅ v4-Vaults werden transparent gelesen (leeres Manifest) und beim nächsten Persist
als v5 (gerahmter Body, Magic `LOKLM05\0`) geschrieben — tx-getestet inkl.
Recovery-Reset. Kein Datenverlust; pro-Workspace-Vektoren migrieren lazy (Phase 3.3).

### Phase 5 — pgvector-Spalte entkoppelt (erledigt, kein Dual-Write mehr)

Vektoren liegen im App-Pfad **nur noch in LanceDB**; die `chunks.embedding`-Spalte
bleibt NULL. Die „missing embedding"-Buchhaltung wurde von der Spalte gelöst:

1. ✅ Migration 0011: Spalte `chunks.embedded boolean` + Backfill aus der
   Alt-Spalte + Partial-Index `idx_chunks_unembedded`.
2. ✅ `countChunksMissingEmbedding` / `listChunksMissingEmbedding` /
   `distinctEmbedderIdentities` keyen auf `embedded`.
3. ✅ `markChunksEmbedded` (Marker ohne Vektor) für den Sink-Only-Pfad;
   `set/setBatch` setzen den Marker mit.
4. ✅ Model-Swap-Purges (`purgeEmbeddings*`) resetten den Marker, geben die ids
   zurück → `EmbeddingBackfillService` entfernt sie aus LanceDB (`vectorPurge`).
5. ✅ `DocumentService`/`Backfill` schreiben Vektoren **nur** nach LanceDB +
   `markChunksEmbedded` (kein pgvector-Write). Reindex/Delete entfernen die
   Vektoren aus LanceDB (`purgeDocumentVectors`, `documents:delete`-IPC).
6. ✅ `migrateIfNeeded` kopiert Alt-Vektoren nach LanceDB **und** nullt die
   pgvector-Spalte (`clearLegacyVectors`) → Speicher-Reclaim für Bestands-User.

Verifiziert in `tests/tx/vault/workspace-vector-lifecycle.test.ts` (Sink-Only,
Model-Swap-Purge inkl. Lance-Removal, Legacy-Migration + Spalten-Reclaim) sowie
dem unveränderten Model-Swap-Integrationstest (`embedder-identity`).

### Tatsächlich verbleibend (Packaging, nicht Code-Logik)

- Electron-ABI-Native-Rebuild von `@lancedb/lancedb` in der `pnpm install`/
  `electron-builder`-Pipeline + `extraResources` + `THIRD_PARTY_NOTICES`-Eintrag.
- Live-App-Durchlauf der neuen Sidebar-Steuerung (hier nur unit-/typgeprüft).
- `chunks.embedding`-Spalte/HNSW-Index könnten später ganz entfallen (heute nur
  noch vom Legacy-/Test-Pfad genutzt); harmlos, da im App-Pfad NULL.

## Bedrohungsmodell-Delta (vs. ADR-0002)

- **Unverändert:** DEK nie im Klartext auf Platte; Master-Secret-Gating; mlock'd
  Keys; Wrong-Secret-Detection via GCM-Tag.
- **Neu:** WDEK pro Workspace, gewrappt unter Master-DEK. Kompromittierter WDEK
  exponiert nur _einen_ Workspace.
- **Neu:** Block-AAD (`fileId ‖ blockIndex`) verhindert Block-Reordering/-Relocation.
- **Akzeptiert:** Datei-/Verzeichnis-_Struktur_ (Anzahl Blöcke, Workspace-Größe)
  ist aus den Klartext-Dateigrößen ablesbar — Metadaten-Leak über Größe, kein
  Inhalts-Leak. Für ein lokales Single-User-Tool akzeptiert.

## Crash-Sicherheit / Durability (Power-Loss)

Quelle der Wahrheit ist der **Vault** (`loklm.vault`): Chunk-Text + `embedded`-
Marker + Manifest. LanceDB-Vektoren sind **abgeleitet** (aus dem Text
re-embedbar). Daraus folgt die Garantie: _bereits persistierte Daten werden von
keinem späteren Crash zerrissen, und verlorene/korrupte Vektoren regenerieren
sich aus dem Text — kein permanenter Datenverlust._

- **Vault:** unverändert tmp → fsync → atomic rename + `.bak` (ADR-0002).
- **enc/ pro Workspace:** jede Datei tmp → fsync → atomic rename, danach
  `fsync` der betroffenen Verzeichnisse. Ein Crash hinterlässt je Datei die
  alte oder die neue Version, nie eine Mischung. Lance-Fragmente sind immutable,
  der Manifest/Version-Commit kommt zuletzt → der Datensatz ist crash-konsistent.
- **Persist-Reihenfolge beim Lock:** erst enc/ (Vektoren), dann Vault (Marker).
  Der Vault ist damit nie _vor_ den Vektoren → ein Crash dazwischen lässt den
  Vault höchstens hinterher; die Backfill-Schleife embedet die Differenz neu.
- **Korruptions-Recovery:** schlägt beim Öffnen eine enc/-Datei trotz gültigem
  WDEK fehl (Bit-Rot, AV-Truncation), wird der enc/-Baum nach
  `enc.corrupt-<ts>` quarantänisiert, der Workspace startet leer, und
  `resetEmbeddedMarkers` plant das Re-Embedding aus dem Text ein.
- **Verbleibendes Fenster (vorbestehend):** PGlite ist In-Memory; nicht
  persistierte Session-Arbeit (Importe seit dem letzten Lock/Quit/Idle-Lock)
  geht bei hartem Stromausfall verloren. Das ist das Single-File-Snapshot-Modell
  aus ADR-0002, kein Regress dieser Änderung. Tests:
  `tests/integration/workspace-crash-safety.test.ts`,
  `tests/tx/vault/workspace-vector-lifecycle.test.ts` (Korruptions-Recovery
  ohne Content-Verlust), `tests/tx/vault/crash-resilience.test.ts` (Vault).

### Noch offen für echte 100–500 Mio. (Text-Seite)

Vektoren sind nun platten-resident + per-Workspace. Der **Chunk-Text** liegt
weiterhin im globalen In-Memory-PGlite-Vault, der bei jedem Persist als ein Blob
neu verschlüsselt wird. Für die Text-Seite des 100–500-Mio.-Ziels muss auch die
relationale Schicht pro Workspace aufgeteilt werden (per-Workspace `meta.db`,
über `EncryptedWorkspaceDir` verschlüsselt). Das ist der nächste große Schritt
und in dieser Node-Umgebung nicht voll verifizierbar.

## Performance-Erwartung (aus ADR-0005-Recherche)

- LanceDB IVF-PQ: ~1–5 ms bei Milliarden-Scale, hohe Recall mit Rescoring.
- Block-Crypto-Overhead: wenige 64-KiB-Blöcke pro Query × AES-NI (GB/s) → sub-ms.
- Quantisierung (PQ ~1 B/8 dims bzw. RaBitQ 1-bit) hält den residenten Codebook
  klein; volle Vektoren bleiben auf Platte fürs Rescoring.

## Teststrategie

- **Unit (vorhanden):** Block-Crypto-Round-Trip, AAD-Bindung, Tamper-Detection;
  WDEK-Wrap/Unwrap.
- **Phase 1:** Parität `PGliteVectorStore` ↔ `LanceWorkspaceStore` auf identischem
  Embedding-Set (Recall@k-Vergleich).
- **Phase 2/4 (tests/tx):** Vault-Round-Trip mit Manifest; Migration v4→v5
  (Datenerhalt, Recovery-Passphrase öffnet migrierten Vault).
- **Bench (tests/bench):** Query-Latenz + Recall bei 1M / 10M synthetischen
  Vektoren pro Workspace; Unlock-/Switch-Zeit.

## Offene Punkte

Siehe ADR-0005 §Folgearbeiten (mmap-Fast-Path, ObjectStore-Hook-Verifikation,
meta.db-Engine-Wahl, WDEK-Rotation für Export/Sharing).
