# ADR-0005 — Per-Workspace skalierter, verschlüsselter Vektor-Store (LanceDB + Block-Crypto)

**Status:** proposed
**Datum:** 2026-06-16
**Owner:** Denys
**Bezug:** [ADR-0002](0002-envelope-encryption-aes-gcm.md) (Envelope-Encryption), [ADR-0003](0003-query-routing-und-summary-index.md) (Retrieval), [PH] §3.1.1 (Verschlüsselung), §3.2 (Retrieval/Skalierung)
**Scaffold:** [src/main/services/storage/](../../src/main/services/storage/), [src/main/services/auth/workspaceKeys.ts](../../src/main/services/auth/workspaceKeys.ts), [src/shared/workspaceStorage.ts](../../src/shared/workspaceStorage.ts)

## Libraries

| Paket                  | Rolle in dieser Entscheidung                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lancedb/lancedb`     | **Neu.** Embedded (In-Process, kein Sidecar) Vektor-DB. Rust-Kern, Native-Node-Bindings. IVF-PQ / RaBitQ auf Platte, ~1–5 ms bei Milliarden-Scale. Dataset = ein Verzeichnis pro Workspace. |
| `node:crypto`          | Block-Crypto (`aes-256-gcm`) für den verschlüsselten ObjectStore unter LanceDB + WDEK-Wrapping. Gleiche Primitive wie ADR-0002, kein neues Krypto-Surface.                                  |
| `@electric-sql/pglite` | **Bestand, Rolle schrumpft.** Bleibt zunächst pro Workspace als Relationen-/FTS-Store (documents, chunks-Text, conversations, BM25). Hält _keine_ Vektoren mehr im WASM-Heap.               |
| `argon2`               | Unverändert — leitet nur noch den Master-KEK ab (ADR-0001). WDEKs hängen am Master-DEK, nicht direkt an Argon2.                                                                             |

Bewusst **nicht** gewählt (Begründung unter „Verworfene Alternativen"): Qdrant (Sidecar), usearch, sqlite-vec, pgvectorscale, gocryptfs/Cryptomator-FUSE, Full-File-Encryption des Index.

---

## Context

### Das Skalierungsziel bricht das aktuelle Modell

Ziel: 100–500 Mio. Vektoren. Der heutige Stack hält die **gesamte DB im Speicher**: PGlite ist Postgres-in-WASM, und der Vault-Body wird beim Unlock vollständig entschlüsselt und via `loadDataDir` in den WASM-Heap geladen ([AuthService.login](../../src/main/services/auth/AuthService.ts)). Das ist mit dem Ziel grundsätzlich unvereinbar — keine Tuning-Maßnahme rettet es:

| Vektoren | float32 (roh) | int8 (scalar) | 1-bit (binary/RaBitQ) |
| -------: | ------------: | ------------: | --------------------: |
| 100 Mio. |       ~410 GB |       ~102 GB |                ~13 GB |
| 500 Mio. |         ~2 TB |       ~512 GB |                ~64 GB |

(BGE-M3, 1024 dim: 4096 B/Vektor roh.) WASM hat eine harte Speichergrenze, und PGlite kann keinen platten-residenten, memory-mapped ANN-Index betreiben. Selbst die _binary_-Spalte ist im Prozess nicht haltbar. Hinzu kommt der HNSW-Graph-Overhead (~128 B/Vektor bei M=16) — bei 500 Mio. nochmal ~64 GB nur für Kanten.

### Was der Nutzer will (und warum es zusammenfällt)

1. **Pro Workspace laden, nicht den ganzen Vault.** Der residente Speicher soll am _größten einzelnen_ Workspace hängen, nicht an der Summe.
2. **Mehrere verschlüsselte Dateien statt einer Monolith-Vault.** Das alte Ein-Datei-Layout (ADR-0002) musste bei jedem Lock den kompletten Tresor neu schreiben — bei dieser Datenmenge untragbar (die Open Question „Snapshot-Splitting > 1 GB" aus ADR-0002 wird hier eingelöst).
3. **Verschlüsselungs-Level pro Workspace.**
4. **Default-Workspace** automatisch laden.
5. **Performanteste Lösung.**

Alle fünf fallen auf **eine** Architektur zusammen: _ein platten-residenter, block-verschlüsselter Index- und Metadaten-Satz pro Workspace, von denen nur der aktive geöffnet wird._

### Die eigentliche Spannung: Verschlüsselung vs. Disk-ANN-Performance

Disk-ANN ist schnell, _weil_ der Index gemappt wird und eine Query nur wenige Seiten anfasst. Eine Voll-Datei-Verschlüsselung zerstört das (zurück zum „alles entschlüsseln" — genau der Schmerz, den wir loswerden). Die performante Antwort ist **Block-/Seiten-Verschlüsselung**: dieselbe Konstruktion, mit der SQLCipher SQLite seitenweise (per-page AES) verschlüsselt — eine Query entschlüsselt nur die Blöcke, die sie liest.

---

## Decision

### 1. Storage-Topologie: ein Verzeichnis pro Workspace

```
userData/
  loklm.vault                 ← klein: Auth-Header + verschlüsselter VaultManifest (defaultWorkspaceId, wrapped WDEKs)
  workspaces/
    ws-1/
      vectors.lance/          ← LanceDB-Dataset (block-verschlüsselt)
      meta.db                 ← Relationen + Chunk-Text + BM25 (per Workspace)
    ws-2/
      …
```

Nur der **aktive** Workspace ist geöffnet (`WorkspaceStore.open(id)`); Wechsel schließt den vorigen. Resident-Footprint ∝ größter Workspace.

### 2. Vektor-Engine: LanceDB (embedded), quantisiert, platten-resident

- Einzige _wirklich_ embedded Vektor-DB im Node-Ökosystem (In-Process, kein Sidecar-Prozess zu verwalten) — passt zum Electron-Modell. AnythingLLM nutzt sie genau so als Zero-Config-Backend.
- IVF-PQ / RaBitQ: Coarse-Quantizer (IVF-Zentroiden) + PQ-Codes resident, volle Vektoren auf Platte zum Rescoring. Genau das DiskANN-Muster, das Single-Node-Milliarden-Scale erst ermöglicht.
- Columnar Dataset = Verzeichnis pro Workspace → 1:1-Mapping auf Topologie und „pro Workspace laden".
- Indexparameter pro Workspace nach Größe ([`suggestIndexConfig`](../../src/shared/workspaceStorage.ts)): < 50k Vektoren → flach (Brute-Force schlägt Indexpflege), darüber IVF mit `numPartitions ≈ √rows`, PQ ~1 Byte / 8 dims.

### 3. Verschlüsselung: Block-Level AES-256-GCM unter der Engine (für _alle_ Workspaces)

LanceDB OSS hat keine At-Rest-Verschlüsselung, also lassen wir es **nicht** direkt aufs Dateisystem schreiben. Es bekommt einen **verschlüsselten ObjectStore**, dessen Reads/Writes durch [`EncryptedBlockFile`](../../src/main/services/storage/blockCipher.ts) laufen:

- Blocklayout: `nonce(12) ‖ tag(16) ‖ ciphertext`. Default 64 KiB Klartext/Block.
- Frischer 96-bit-Random-Nonce pro Write (Blöcke werden in-place überschrieben → Counter-Nonce riskierte (key,nonce)-Reuse).
- **AAD = fileId ‖ blockIndex(uint64 BE):** bindet jeden Block an seine Position in einer konkreten Datei. Ein Angreifer kann Blöcke weder innerhalb noch zwischen Dateien (gleicher WS-Key) verschieben, ohne dass der Tag-Check failt → positionsgebundene Integrität.
- Wrong-Key-Detection wieder rein über den GCM-Tag, kein separater Verifier (konsistent mit ADR-0002).

Der `meta.db` (Relationen + Chunk-Text) ist klein genug für SQLCipher-artige Seitenverschlüsselung bzw. dasselbe Block-Layer. **Entscheidung Q2: „full block-level crypto" für jeden Workspace** — `EncryptionLevel` bleibt als Feld im Manifest (forward-compat), aktuell nur `'full'`.

### 4. Schlüssel: hierarchisches Envelope, Master-DEK → WDEK pro Workspace

Erweitert ADR-0002 um eine zweite Ebene ([`workspaceKeys.ts`](../../src/main/services/auth/workspaceKeys.ts)):

```
master DEK (32 B, install-lifetime, gewrappt unter Passwort- + Recovery-KEK)
   │ wraps (AES-256-GCM)
   ▼
WDEK[workspace_i] (32 B)  ──► keyt EncryptedBlockFile für vectors.lance + meta.db
```

- **Unabhängiges Laden:** Öffnen eines Workspaces unwrappt nur dessen WDEK.
- **Pro-Workspace-Lifecycle:** Löschen = WDEK vergessen + Verzeichnis droppen, kein Re-Encrypt von irgendwas anderem.
- **Recovery gratis:** Der Master-DEK ist über die 18-Wort-Passphrase wiederherstellbar → jeder davon gewrappte WDEK auch. Kein neuer Recovery-Channel.

Das ist das Standard-Hierarchie-Muster: 1Password („Account Unlock Key" → Vault-Keys), AWS KMS (CMK → per-object Data Keys).

### 5. Vault-Manifest + Default-Workspace

Der `loklm.vault` schrumpft zum **Manifest** ([`VaultManifest`](../../src/shared/workspaceStorage.ts)): `defaultWorkspaceId`, und pro Workspace `{ id, name, dir, encryptionLevel, wrappedKey, vectorCount, indexConfig }`. Klein, vollständig beim Unlock geladen, liegt im verschlüsselten Vault-Body (erbt dessen Vertraulichkeit). [`resolveDefaultWorkspace`](../../src/shared/workspaceStorage.ts) wählt beim Unlock: konfigurierter Default → sonst jüngster → sonst Picker.

---

## Prior Art

| System                         | Übernommenes Muster                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **LanceDB / AnythingLLM**      | Embedded Disk-ANN, ein Dataset-Verzeichnis pro Scope, IVF-PQ/RaBitQ.                                                           |
| **SQLCipher / Signal-Desktop** | Per-Page-AES → Random-Access bleibt bezahlbar trotz At-Rest-Crypto.                                                            |
| **1Password / AWS KMS**        | Hierarchische Keys: Root-Key wrappt per-Scope Data-Keys (unser Master-DEK → WDEK).                                             |
| **Qdrant**                     | Quantisierungs-Stufen (binary + Rescoring) als Recall/RAM-Trade — wir übernehmen die _Technik_ (in LanceDB), nicht den Server. |

---

## Verworfene Alternativen

- **Qdrant als Sidecar.** Stark bei Scale + Quantisierung, und Sidecar-Infra existiert (`sidecars/`). Aber: zweiter Prozess (Lifecycle, Ports, Crash-Recovery), und **keine** native At-Rest-Verschlüsselung → wir müssten das Block-Layer trotzdem bauen, dann lieber In-Process. Re-evaluieren, falls LanceDB-Bindings sich als unzureichend erweisen.
- **usearch.** Leichtgewichtig, mmap, Quantisierung — aber nur ein Index, Metadaten/Text müssten separat verwaltet werden. Mehr Eigenbau für weniger DB.
- **sqlite-vec / sqlite-vss.** Beste Krypto-Story (SQLCipher gratis), aber Brute-Force/limitiertes ANN — bei 100–500 Mio. nicht tragfähig. Genau der Trade, der die Engine-Wahl forciert: beste Crypto ↔ schlechtestes Scaling.
- **pgvectorscale (StreamingDiskANN auf pgvector).** Exzellent — aber braucht echtes Postgres, nicht PGlite-WASM. Würde einen Postgres-Sidecar bedeuten; widerspricht dem Offline-Single-File-Desktop-Modell.
- **Full-File-Encryption des Lance-Datasets.** Erzwingt Voll-Decrypt → tötet Disk-ANN. Der Kern-Grund für Block-Crypto.
- **Decrypt-on-Unlock in ein Klartext-Arbeitsverzeichnis.** Bei 100–500 GB pro Unlock minutenlang + Klartext auf Platte — genau das, was der Nutzer ablehnt.
- **gocryptfs / Cryptomator-FUSE.** Cross-Platform-Treiber/Driver-Schmerz in einer Electron-App; Windows-First macht das untragbar.

---

## Consequences

**Positiv**

- Skaliert auf 100–500 Mio. Vektoren — beschränkt durch Platte, nicht RAM.
- Pro-Workspace-Lock: schneller Switch, Footprint am aktiven Workspace, kein Monolith-Rewrite beim Lock (löst ADR-0002 Open Question „Snapshot-Splitting").
- Per-Workspace-Lifecycle (Erstellen/Löschen/Backup) wird billig und granular.
- At-Rest-Verschlüsselung bleibt, ohne Disk-ANN zu opfern (Block-Crypto).

**Negativ**

- **Großer Architektur-Schnitt.** Neuer Engine-Dependency (Rust-Native-Build pro Plattform), neue I/O-Schicht, Retrieval muss von `searchChunksByVector` auf `VectorStore` umziehen.
- **Migrationspfad nötig** für bestehende v4-Single-Vaults → Manifest + per-Workspace-Stores (siehe Spec).
- **Block-Crypto kostet** AES-NI-Zyklen pro angefasstem Block (statt Zero-Copy-mmap). Vernachlässigbar, weil Queries wenige Blöcke anfassen und AES-NI GB/s liefert — aber nicht null.
- **Zwei Stores pro Workspace** (Lance + meta.db) statt einer DB → mehr Konsistenz-Sorgfalt (Dokument-Löschung muss beide treffen).

---

## Folgearbeiten / Open Questions

- **mmap-Fast-Path:** `EncryptedBlockFile` ist heute `fs`-positional (korrekt, getestet). Der Decrypt-on-Page-Fault-Pfad über den LanceDB-ObjectStore ist der Performance-Follow-up.
- **LanceDB-ObjectStore-Hook:** verifizieren, dass die Node-Bindings einen Custom-Store mit unseren Read/Write-Hooks zulassen; sonst Fallback auf Block-verschlüsseltes Dataset-Verzeichnis mit Datei-Granularität.
- **meta.db-Engine:** SQLCipher vs. Block-verschlüsseltes PGlite-Dump pro Workspace — Bench entscheidet.
- **WDEK-Rotation** bei Workspace-Export/-Sharing (heute, wie Master-DEK, nicht rotierbar).
- **Backfill-/Embedding-Pipeline** muss pro-Workspace batchen statt global (EmbeddingBackfillService).
