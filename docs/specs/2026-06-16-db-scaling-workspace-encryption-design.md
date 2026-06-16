# Design: DB-Skalierung + Per-Workspace-Verschlüsselung

**Datum:** 2026-06-16
**Status:** In Umsetzung — Storage-Engine implementiert + integrationsgetestet (Node), App-Verdrahtung (AuthService/IPC/UI/Migration) folgt
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

### Phase 2 — Per-Workspace-Lifecycle

1. `WorkspaceStore` (neu) als Orchestrator: hält den aktiven Workspace, öffnet/
   schließt dessen `VectorStore` + Metadaten-DB, unwrappt den WDEK über
   `AuthService`.
2. `AuthService` erweitern:
   - Beim Unlock: Vault-Body → `VaultManifest` parsen (statt PGlite-Dump laden).
   - `getWorkspaceKey(id)` → unwrappt WDEK aus dem Manifest mit dem Master-DEK.
   - Beim Lock: nur den aktiven Workspace flushen/schließen + WDEK wipen.
3. `WorkspaceService.create/delete` → WDEK anlegen/vergessen + Verzeichnis
   anlegen/löschen, Manifest aktualisieren.
4. `setDefaultWorkspace(id)` + IPC + Settings-UI (Default-Picker, Encryption-Badge).

### Phase 3 — Retrieval-Umzug

1. `RetrievalService` + `Database.searchChunksByVector`-Aufrufer auf `VectorStore`
   umstellen. Hybrid bleibt: Dense kommt aus LanceDB, BM25 aus der per-Workspace
   `meta.db`, RRF-Fusion unverändert.
2. `EmbeddingBackfillService` pro Workspace batchen (nicht global) — Bulk-Insert in
   LanceDB, danach `buildIndex()`.

### Phase 4 — Migration bestehender v4-Vaults

Einmalige Migration beim ersten Start der neuen Version:

1. Alten `loklm.vault` (v4) wie bisher entschlüsseln → PGlite-Dump in Memory.
2. Pro vorhandenem Workspace: neues Verzeichnis + WDEK anlegen; Chunks/Vektoren aus
   PGlite nach LanceDB streamen; Relationen/Text in die per-Workspace `meta.db`.
3. Neuen `loklm.vault` als Manifest (v5) schreiben; alten als `.v4.bak` behalten.
4. Magic-Bump `LOKLM04\0` → `LOKLM05\0` (ADR-0002-Konvention).

## Bedrohungsmodell-Delta (vs. ADR-0002)

- **Unverändert:** DEK nie im Klartext auf Platte; Master-Secret-Gating; mlock'd
  Keys; Wrong-Secret-Detection via GCM-Tag.
- **Neu:** WDEK pro Workspace, gewrappt unter Master-DEK. Kompromittierter WDEK
  exponiert nur _einen_ Workspace.
- **Neu:** Block-AAD (`fileId ‖ blockIndex`) verhindert Block-Reordering/-Relocation.
- **Akzeptiert:** Datei-/Verzeichnis-_Struktur_ (Anzahl Blöcke, Workspace-Größe)
  ist aus den Klartext-Dateigrößen ablesbar — Metadaten-Leak über Größe, kein
  Inhalts-Leak. Für ein lokales Single-User-Tool akzeptiert.

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
