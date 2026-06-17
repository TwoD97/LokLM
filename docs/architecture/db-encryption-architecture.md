# LokLM Storage & Encryption Architecture (ADR-0005)

How data is stored, encrypted, and read after the per-workspace cutover. Three
views: the **key hierarchy**, the **on-disk layout**, and the **runtime request
flow**. All diagrams are Mermaid (render on GitHub).

---

## 1. Key hierarchy — what unlocks what

One install-lifetime **master DEK** encrypts the vault. Each workspace has its own
**WDEK** (workspace data key), wrapped under the master DEK and stored in the
vault manifest. A workspace's encrypted files can only be opened once its WDEK is
unwrapped — so loading one workspace never decrypts the others.

```mermaid
flowchart TD
    PW[User password] -->|Argon2id + salt| PKEK[Password KEK]
    PP[18-word passphrase] -->|Argon2id + salt| RKEK[Recovery KEK]

    PKEK -->|AES-256-GCM unwrap| DEK[(Master DEK<br/>32 bytes, mlock'd in RAM)]
    RKEK -->|AES-256-GCM unwrap| DEK

    DEK -->|decrypts| BODY[Vault body v6<br/>JSON: manifest + kv]
    BODY --> MAN[VaultManifest]

    MAN -->|wrapped WDEK #1| W1DEK[(WDEK ws-1)]
    MAN -->|wrapped WDEK #2| W2DEK[(WDEK ws-2)]
    MAN -->|wrapped WDEK #N| WNDEK[(WDEK ws-N)]

    DEK -.->|AES-256-GCM unwrap| W1DEK
    DEK -.->|AES-256-GCM unwrap| W2DEK
    DEK -.->|AES-256-GCM unwrap| WNDEK

    W1DEK -->|SQLCipher key + block cipher| WS1[ws-1 stores]
    W2DEK -->|SQLCipher key + block cipher| WS2[ws-2 stores]
    WNDEK -->|SQLCipher key + block cipher| WSN[ws-N stores]

    classDef key fill:#ffe8cc,stroke:#d9480f;
    class DEK,W1DEK,W2DEK,WNDEK key;
```

- The DEK never hits disk in plaintext; it lives in `mlock`'d memory only between
  unlock and lock.
- Password reset re-wraps the **same** DEK under new KEKs, so library content
  survives recovery.
- `kv` holds app-global settings + avatar (formerly the PGlite `settings` table).

---

## 2. On-disk layout — encrypted at rest

```mermaid
flowchart TD
    subgraph UD["&lt;userData&gt;/"]
        V["loklm.vault  (+ .bak)<br/>magic LOKLM06 ‖ header(wrapped DEKs, salts) ‖ AES-256-GCM(DEK){manifest, kv}"]
        subgraph WSDIR["workspaces/"]
            subgraph WS1["ws-1/"]
                META1["meta.db<br/>SQLCipher / AES — keyed by WDEK"]
                ENC1["enc/  (LanceDB files,<br/>AES-256-GCM block cipher, 64KiB blocks)"]
            end
            subgraph WS2["ws-2/"]
                META2["meta.db"]
                ENC2["enc/"]
            end
        end
    end

    META1 -. "tables" .-> T["documents · chunks · chunks_fts (FTS5)<br/>conversations · messages · citations<br/>quiz_decks/questions/attempts · sync_folders"]
    ENC1 -. "vectors" .-> L["IVF-PQ / ivfFlat, cosine<br/>row = (chunkId, documentId, vector[1024])"]

    classDef enc fill:#e7f5ff,stroke:#1971c2;
    class V,META1,ENC1,META2,ENC2 enc;
```

**The two stores per workspace, and why they're split:**

| Store            | Engine                            | Holds                                                            | Lifetime                                                         |
| ---------------- | --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `meta.db`        | better-sqlite3 + SQLCipher        | text, metadata, FTS5 index, chats, quizzes, **embedded markers** | cheap to open — **many** open at once (background sync)          |
| `enc/` → LanceDB | `@lancedb/lancedb` + block cipher | chunk **vectors** only                                           | expensive (decrypt-on-open) — **one** active workspace at a time |

`meta.db` is the **source of truth**: vectors are derived from chunk text and can
be re-embedded, so a lost/corrupt Lance store self-heals from SQLite.

---

## 3. Runtime request flow — unlock, switch, query

```mermaid
sequenceDiagram
    participant R as Renderer (AppShell)
    participant P as preload (window.api)
    participant I as IPC (main/index.ts)
    participant A as AuthService
    participant S as WorkspaceStore
    participant F as WorkspaceDbFacade
    participant SQL as WorkspaceDb (SQLite)
    participant LAN as LanceWorkspaceStore

    R->>P: login(password)
    P->>I: auth:login
    I->>A: login() → Argon2id, unwrap DEK, decrypt vault body
    A-->>I: manifest + kv loaded (no per-ws data yet)

    R->>P: workspaces.activate(wsId)
    P->>I: workspaces:activate
    I->>A: activate(wsId)
    A->>S: open(wsId)
    S->>S: unwrap WDEK
    S->>SQL: open meta.db (SQLCipher)
    S->>LAN: decrypt enc/ → open LanceDB
    Note over S: wsId is now the ACTIVE workspace

    R->>P: chat / retrieval query
    P->>I: chat:stream
    I->>F: requireDatabase() → documents()/conversations()
    F->>SQL: BM25 (FTS5) + text hydrate (by id → active ws)
    I->>LAN: vector search (cosine)
    Note over I,SQL: RRF fuse BM25 + vector → hydrate chunk text from SQLite
    I-->>R: streamed answer + citations
```

**Facade routing rule** (`WorkspaceDbFacade`):

```mermaid
flowchart LR
    CALL[service / IPC call] --> Q{keyed by?}
    Q -->|workspaceId| META["openMetaDb(wsId)<br/>(cheap, any workspace)"]
    Q -->|row id<br/>doc/chunk/conv/quiz| ACT["active workspace's<br/>meta.db"]
    META --> SQLITE[(SQLite store)]
    ACT --> SQLITE
```

That's why the renderer calls `workspaces.activate(id)` on every workspace
switch — id-keyed reads resolve against whichever workspace is active.

---

## 4. Component map

```mermaid
flowchart TD
    subgraph Renderer
        AS[AppShell] --> API[window.api]
    end
    API --> IPC[main/index.ts IPC handlers]

    IPC --> AUTH[AuthService<br/>DEK · vault v6 · auto-lock]
    IPC --> SVC[Services:<br/>Document · Retrieval · QA<br/>Quiz · Summarize · EmbeddingBackfill · Settings]

    AUTH -->|requireDatabase| FAC[WorkspaceDbFacade]
    AUTH -->|getWorkspaceStore| STORE[WorkspaceStore]
    AUTH -->|getKv/setKv| KV[(app-global kv)]
    SVC --> FAC

    STORE --> META[(meta.db per ws<br/>SQLCipher)]
    STORE --> ENCDIR[EncryptedWorkspaceDir] --> LANCE[(LanceDB per ws)]
    FAC --> META

    SVC -.vector read/write.-> LANCE

    classDef sec fill:#ffe8cc,stroke:#d9480f;
    class AUTH sec;
```

---

### Scale notes

- Vectors target **100–500M** at corpus scale: LanceDB uses IVF-PQ with a config
  sized by `suggestIndexConfig(dims, rowCount)`; small workspaces stay on
  `ivfFlat`. RAM tracks the **single active** workspace, not the whole corpus.
- BGE-M3, 1024-dim, cosine (`_distance = 1 − cosine`).
