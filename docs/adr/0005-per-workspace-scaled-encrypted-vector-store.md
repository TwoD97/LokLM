# ADR-0005 — Per-Workspace skalierter, verschlüsselter Vektor-Store (LanceDB + Block-Crypto)

**Status:** accepted (Revision 2026-06-16: ObjectStore-Hook im Node-SDK nicht verfügbar → Decrypt-on-Open, siehe §3)
**Datum:** 2026-06-16
**Owner:** Denys
**Bezug:** [ADR-0002](0002-envelope-encryption-aes-gcm.md) (Envelope-Encryption), [ADR-0003](0003-query-routing-und-summary-index.md) (Retrieval), [PH] §3.1.1 (Verschlüsselung), §3.2 (Retrieval/Skalierung)
**Scaffold:** [src/main/services/storage/](../../src/main/services/storage/), [src/main/services/auth/workspaceKeys.ts](../../src/main/services/auth/workspaceKeys.ts), [src/shared/workspaceStorage.ts](../../src/shared/workspaceStorage.ts)

## Libraries

| Paket                  | Rolle in dieser Entscheidung                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lancedb/lancedb`     | **Neu.** Embedded (In-Process, kein Sidecar) Vektor-DB. Rust-Kern, Native-Node-Bindings. IVF-PQ / RaBitQ auf Platte, ~1–5 ms bei Milliarden-Scale. Dataset = ein Verzeichnis pro Workspace. |
| `node:crypto`          | Block-Crypto (`aes-256-gcm`) für die At-Rest-Verschlüsselung der Workspace-Dateien (Decrypt-on-Open, §3) + WDEK-Wrapping. Gleiche Primitive wie ADR-0002, kein neues Krypto-Surface.        |
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

### 3. Verschlüsselung: Block-verschlüsselt at-rest, Decrypt-on-Open pro Workspace

> **Revision 2026-06-16.** Die ursprüngliche Idee — LanceDB durch einen
> **verschlüsselten ObjectStore** schreiben zu lassen — wurde gegen die reale
> API verifiziert und **verworfen**: `ObjectStoreRegistry` / `WrappingObjectStore`
> existieren nur im **Rust-Kern**, sind im Node- (und selbst im Python-) SDK
> _nicht_ exponiert (das Python-`Session`-Binding nimmt nur Cache-Größen). LanceDB
> OSS hat keine At-Rest-Verschlüsselung für lokale Dateien (nur Cloud-KMS auf S3).
> Ein In-Process-Block-Crypto-Hook wäre nur über einen Fork der nativen Bindings
> machbar — zu groß/fragil. Gewählt (Q3): **Decrypt-on-Open pro Workspace.**

Die Block-Crypto-Primitive aus [`blockCipher.ts`](../../src/main/services/storage/blockCipher.ts)
bleiben unverändert die Grundlage — sie verschlüsseln jetzt die Dateien **at-rest**,
nicht zur Laufzeit der Engine:

- **At-Rest:** Jede Workspace-Datei (Lance-Fragmente, Manifeste, `meta.db`) liegt
  als Folge von AES-256-GCM-Blöcken im `enc/`-Verzeichnis des Workspaces.
  Blocklayout `nonce(12) ‖ tag(16) ‖ ciphertext`, 64 KiB Klartext/Block, frischer
  Random-Nonce pro Write, **AAD = relPath ‖ blockIndex** (bindet jeden Block an
  Datei + Position; Reorder/Relocation scheitert am Tag). Wrong-Key-Detection
  rein über den GCM-Tag (konsistent ADR-0002).
- **Open:** Beim Öffnen eines Workspaces wird _nur dessen_ `enc/`-Baum in ein
  0600-Arbeitsverzeichnis entschlüsselt; LanceDB läuft normal darauf. Entschlüsselt
  wird **ein** Workspace (typ. wenige GB), nicht der 100–500-GB-Gesamtkorpus —
  genau der Schmerz, den der Single-Vault hatte, ist damit auf die aktive
  Workspace-Größe begrenzt.
- **Close/Lock:** Geänderte/neue Arbeitsdateien werden zurück nach `enc/`
  verschlüsselt (inkrementell — Lance schreibt neue, immutable Fragmente, also
  ist Delta-Persist natürlich), entfernte Dateien gelöscht, dann das
  Arbeitsverzeichnis gewiped.

**Akzeptierter Trade (Q3):** Während ein Workspace _offen_ ist, liegen seine
Dateien als Klartext im 0600-Arbeitsverzeichnis. Im Ruhezustand (locked) ist
alles verschlüsselt. Das gibt **nicht** „nur die angefassten Blöcke entschlüsseln";
es ist der buildbare In-Process-Kompromiss ohne FUSE/WinFsp-Treiber oder
LanceDB-Fork. Die transparente Block-Crypto-Variante (FUSE/WinFsp oder Rust-Fork)
bleibt als Upgrade-Pfad dokumentiert.

**Entscheidung Q2: „full block-level crypto" für jeden Workspace** — `EncryptionLevel`
bleibt als Feld im Manifest (forward-compat), aktuell nur `'full'`.

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

## Empirische Validierung (2026-06-23)

Stresstest des **echten** Stacks (`LanceWorkspaceStore` + `EncryptedWorkspaceDir`, synthetische 1024-d-Vektoren, separater bge-m3-Durchsatz-Probe auf echtem Wikipedia-Text) bis **5 Mio. Vektoren** auf i9-9900K / 32 GB / RTX 5090. Harness + voller Report: [tests/evals/scale/run-storage-scale.ts](../../tests/evals/scale/run-storage-scale.ts), [report/storage-2026-06-23T12-53-46.md](../../tests/evals/scale/report/storage-2026-06-23T12-53-46.md).

**Bestätigt „beschränkt durch Platte, nicht RAM" (Consequences):** Query-p95 bleibt ~43 ms bis 5 Mio. (IVF-PQ greift bei 50k, sublinear — bei 50k sogar schneller als der Flat-Scan: 34 → 8 ms), RSS ~1,6 GiB (platten-resident/mmap), 0 VRAM (Suche läuft auf der CPU). Gemessen ~4,4 KB/Vektor → 22 GB bei 5 Mio.

**Quantifiziert den akzeptierten Trade (§3):** Decrypt-on-Open lief mit **~163 MB/s** → 22 GB = **2,3 min**, und solange offen verdoppelt das Klartext-`work/` den Platten-Fußabdruck. Damit kehrt genau der Schmerz der verworfenen Alternative _„Decrypt-on-Unlock … minutenlang pro Unlock"_ zurück, sobald **ein einzelner** Workspace die in §3 angenommene Größe (_„typ. wenige GB"_) überschreitet — Gültigkeitsgrenze der Annahme ≈ wenige zehn GB (≈ 1–2 Mio. Chunks). Hochrechnung bei Produktions-Chunking (~2000 Zeichen): 100 GB Text ≈ 50 Mio. Vektoren ≈ **~222 GB** at-rest / **~444 GB** offen / **~23 min Decrypt pro Unlock** / ~9,5 d einmaliges sequentielles Embedding.

**Ingest:** der Produktionspfad (`mergeInsert`, 32er-Batch = `EMBED_BATCH`) scannt die ganze Tabelle → Batch-Latenz wächst linear, 14 → 176 ms (10k → 5 Mio.); IVF-PQ-Neubau plateaut bei ~3–4 min. **SQLite/FTS5 (meta.db) noch ungetestet** — `better-sqlite3-multiple-ciphers` ist für Electrons ABI gebaut, nicht für node, lädt also im headless-Harness nicht; braucht einen In-Electron-Lauf.

## Folgearbeiten / Open Questions

- **mmap-Fast-Path:** `EncryptedBlockFile` ist heute `fs`-positional (korrekt, getestet). Der Decrypt-on-Page-Fault-Pfad über den LanceDB-ObjectStore ist der Performance-Follow-up. **Hochpriorisiert durch die empirische Validierung (s.o.):** bei sehr großen Einzel-Workspaces ist Decrypt-on-Open (gemessen ~163 MB/s, minutenlang ab ~zehn GB) die praktische Größengrenze — nicht RAM oder Query-Latenz. Bis der Fast-Path steht, gilt „pro Workspace wenige GB" als Design-Annahme.
- **LanceDB-ObjectStore-Hook:** verifizieren, dass die Node-Bindings einen Custom-Store mit unseren Read/Write-Hooks zulassen; sonst Fallback auf Block-verschlüsseltes Dataset-Verzeichnis mit Datei-Granularität.
- **meta.db-Engine:** SQLCipher vs. Block-verschlüsseltes PGlite-Dump pro Workspace — Bench entscheidet.
- **WDEK-Rotation** bei Workspace-Export/-Sharing (heute, wie Master-DEK, nicht rotierbar).
- **Backfill-/Embedding-Pipeline** muss pro-Workspace batchen statt global (EmbeddingBackfillService).
