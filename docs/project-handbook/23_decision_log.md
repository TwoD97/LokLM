# Decision Log

Stand: **2026-06-14**. Dieses Log fasst die wesentlichen Architektur- und Projektentscheidungen zusammen. Die formalen Architektur-Entscheidungen liegen als ADRs unter `docs/adr/` (Format: Status, Context, Decision, Consequences; mit Bezug auf reale Production-Deployments). Die übrigen Einträge sind Prozess-/Tooling-Entscheidungen aus den Projektstatusberichten und Test-/Eval-Artefakten.

Quellen: `docs/adr/0001`–`0004`, `docs/adr/README.md`, `docs/work/projektstatusbericht-2026-06-07.md`, `docs/work/projektstatusbericht-2026-06-14.md`, `tests/evals/answer/matrix-manifest.ts`, `tests/evals/license/validate-model-licenses.ts`, `tests/evals/model-license-registry.json`, Memory `ap-ticket-abschluss-doku.md` / `no-internal-docs-in-repo.md`.

---

## 23.1 Formale ADRs

Tabelle 23.1 listet die vier formalen ADRs mit Status und Owner.

**Tabelle 23.1:** Übersicht der formalen ADRs.

| ADR | Status | Datum | Owner |
|---|---|---|---|
| [0001](#d1) Argon2id als KDF | accepted | 2026-05-14 | Denys |
| [0002](#d2) Envelope-Encryption AES-256-GCM | accepted | 2026-05-14 | Denys |
| [0003](#d3) Query-Routing + Summary-Index | accepted | 2026-06-13 | Denys |
| [0004](#d4) Adaptive Modell-Residency | **proposed** | 2026-06-13 | Denys |

---

### <a id="d1"></a>D1 — ADR-0001: Argon2id als Passwort-/Passphrase-KDF

Tabelle 23.2 fasst die Eckdaten von ADR-0001 zusammen.

**Tabelle 23.2:** Eckdaten ADR-0001 (Argon2id-KDF).

| Feld | Inhalt |
|---|---|
| **Entscheidung** | Argon2id (`m=64 MiB, t=3, p=4`, 32-Byte-Raw-Output = KEK) als KDF für Passwort und Recovery-Passphrase |
| **Kontext** | Lokale Single-User-App; `auth.json`/Vault liegt auf der Platte → Offline-Brute-Force-Resistenz + GPU-/ASIC-Härtung gefordert |
| **Alternativen** | PBKDF2-HMAC-SHA256 (speicherarm, GPU-billig), scrypt (solide, aber älter als PHC-Gewinner), bcrypt (72-Byte-Limit, kein Memory-Hardening), Eigenkonstruktion (verworfen) |
| **Begründung** | PHC-Gewinner + RFC 9106; Profil exakt wie Bitwarden (gleiches Bedrohungsmodell); Offline-Angriff ~5–6 Größenordnungen langsamer als PBKDF2 |
| **Konsequenz** | Native Bindings (`electron-rebuild`), spürbare Login-Latenz 300–500 ms (gewollt); DEK-Re-Wrap bei künftigem Parameter-Bump noch nicht implementiert |
| **Status** | accepted; getestet als Argon2id-Wrapper (AP-T.1), **nicht** als „PBKDF2-Wrapper" (Ticket-Wortlaut veraltet) |

### <a id="d2"></a>D2 — ADR-0002: Envelope-Encryption (DEK + KEK-Wrapping, AES-256-GCM)

Tabelle 23.3 fasst die Eckdaten von ADR-0002 zusammen.

**Tabelle 23.3:** Eckdaten ADR-0002 (Envelope-Encryption).

| Feld | Inhalt |
|---|---|
| **Entscheidung** | Ein zufälliger DEK verschlüsselt den PGlite-Snapshot (AES-256-GCM); DEK je Geheimnis unter einem Argon2id-KEK gewrappt; alles in **einer** Datei `loklm.vault` (Magic `LOKLM04\0`, atomarer Rename) |
| **Kontext** | Recovery muss denselben Tresor entsperren **ohne** Re-Encrypt; Passwort-Reset darf nicht den ganzen Tresor neu verschlüsseln |
| **Alternativen** | Snapshot direkt unter passwortabgeleitetem Key (bricht Recovery), AES-CBC+HMAC (Padding-Oracle-Fehlerquelle), AES-Key-Wrap RFC 3394/5649 (nicht in Node-Stdlib), ChaCha20-Poly1305 (kein AES-NI-Vorteil auf x86), Zwei-Datei-Layout (Drift-/Verlust-Risiko) |
| **Begründung** | Konstanter Reset-Aufwand; Wrong-Secret-Detection über GCM-Auth-Tag (kein Verifier-Leak); strukturell auf der Linie age/Bitwarden; Single-File = kein Mischzustand |
| **Konsequenz** | DEK-Rotation nicht möglich ohne Re-Encrypt (akzeptiert); Vault-Korruption ist fatal (Backup-/Export-UI als separate Spec); Magic-Byte-Versionierung manuell |
| **Status** | accepted |

### <a id="d3"></a>D3 — ADR-0003: Query-Routing + Per-Dokument-Summary-Index

Tabelle 23.4 fasst die Eckdaten von ADR-0003 zusammen.

**Tabelle 23.4:** Eckdaten ADR-0003 (Query-Routing).

| Feld | Inhalt |
|---|---|
| **Entscheidung** | Regex-first-Dispatcher routet zwischen `corpus` (typisierte SQL, kein LLM), `doc_summary` (gecachter Whole-Doc-Summary) und `retrieval` (Default); Multi-Question-Decomposition heuristisch an `?`-Grenzen; Per-Dokument-Summary-Embedding (Migration 0010) |
| **Kontext** | „Fasse X zusammen" und „Wie viele Dokumente zu Y" sind mit Chunk-Top-k strukturell nicht beantwortbar; CPU-Preset verbietet LLM-Call vor Retrieval |
| **Alternativen** | LlamaIndex `RouterQueryEngine` (LLM-Selector, `ValueError` bei Ambiguität — beide **reject**), GraphRAG DRIFT (~63 LLM-Calls/Query — reject), RAGFlow Text-zu-SQL (reject); adoptiert: GraphRAG/RAGFlow Heuristik-Routing, RAGFlow Count-Regex, LlamaIndex DocumentSummaryIndex |
| **Begründung** | „regex/heuristik-first, kein LLM vor Retrieval"; Routing-Miss erroret nie, fällt still auf `retrieval` (False-Negative ist die billigere Fehlentscheidung); Citation-Vertrag bleibt chunk-gebunden (Option A) |
| **Konsequenz** | Background-Summary-Generierung bewusst nicht implementiert; Summary-Signal lazy; mehr Code-Pfade/Audit-Surface; `routing: false` als Eval-Escape-Hatch |
| **Status** | accepted |

### <a id="d4"></a>D4 — ADR-0004: Adaptive Modell-Residency (Usage-Lernen + kostenbewusstes Caching)

Tabelle 23.5 fasst die Eckdaten von ADR-0004 zusammen.

**Tabelle 23.5:** Eckdaten ADR-0004 (Adaptive Modell-Residency).

| Feld | Inhalt |
|---|---|
| **Entscheidung** | Residency (welches der 5 Runtimes wann wohin geladen) als **kostenbewusstes Caching** (GreedyDual-Size-Frequency) über ein vault-verschlüsseltes Usage-Journal lernen; Bandit nur als schmale L5-Schicht für spekulatives Vorladen |
| **Kontext** | Heute statisches Placement (einmal zur Ladezeit); kein Usage-Signal; `runtime.conversationSwitch` ist AP-9-Platzhalter; constrained-VRAM-Zielmaschinen (6/8/12 GB) sind der eigentliche Fall |
| **Alternativen** | Multi-Armed-Bandit als Kern-Framing (**reject** — verwirft Full-Feedback-Demand), End-to-End-RL (reject — zu wenig Single-User-Daten), flaches LRU/TTL wie Ollama/Triton (reject — ignoriert Objekt-Heterogenität); adoptiert: GDSF, Ollama `keep_alive` als Floor, Markov-Prefetch, Belady-MIN nur als Eval-Orakel |
| **Begründung** | Demand ist full-feedback beobachtbar; die Entscheidung ist eine Menge (Rucksack), kein Einzelzug; Reward ist analytisch (vermiedene Latenz) |
| **Konsequenz** | Nutzen auf 32-GB-Dev-Box unsichtbar → Eval **muss** gegen constrained Budget (`LOKLM_VRAM_CAP_GB`); neue verschlüsselte Verhaltens-Tabelle (Privacy-/Audit-Pflicht); phasenweiser flag-gateter Rollout |
| **Status** | **proposed** — noch nicht implementiert; Eval-Säule (Owner Dominik) ist Teil der Abnahme |

---

## 23.2 Prozess- / Tooling-Entscheidungen

Tabelle 23.6 dokumentiert die Prozess- und Tooling-Entscheidungen.

**Tabelle 23.6:** Prozess- und Tooling-Entscheidungen.

| Datum / Zeitraum | Entscheidung | Kontext | Alternativen | Begründung | Konsequenz | Status | Quelle |
|---|---|---|---|---|---|---|---|
| 27.05.2026 | **Installer-Pivot: Embedded-Payload → Download-Stub** | Embedded-Installer war ~500 MB | Payload weiter einbetten | Stub von ~500 MB auf **~8 MB (lzma)** geschrumpft; plattformübergreifender Rust/Tauri-Wizard (Win/Linux/macOS, CUDA-Option); Modelle per Target-URL nachgeladen | Kleiner Download, aber Defender-Reputationsverlust → in **v0.3.1 Payload für Win+Linux teilweise wieder eingebettet**, um Defender-Reputation aufzubauen | umgesetzt; teil-revidiert | `projektstatusbericht-2026-06-07.md` Phase 8 |
| 2026-06-14 | **Lizenz-Gate: nur OSI-permissive Modelle in der Default-Matrix** | Eval-Matrix soll lizenzsauber sein | Beliebige Open-Weight-Modelle zulassen | `validateLicenses` lässt nur `licenseClass='osi-permissive'` UND `allowedInDefaultMatrix=true`; non-OSI (Gemma-Terms, Llama, jina CC-BY-NC) entfernt | Default-Matrix auf 15 LLMs / 8 Embedder / 2 Reranker reduziert; keine stillen Fallbacks | aktiv | `validate-model-licenses.ts`, `model-license-registry.json` |
| AP-E.2 | **Span-Metriken chunker-unabhängig** | Verschiedene Chunkings über dieselben Gold-Spans vergleichen | Chunk-Index-basierte Recall-Metrik (chunker-gebunden) | Span-Overlap über Zeichen-Offsets im Quelldokument; Chunk-Größe als **separate Dataset-Läufe** statt Matrix-Achse (sweep re-chunkt nicht pro Config) | Matrix-Chunker-Achse = 1 (`fixed-512-64`); Größenvergleich außerhalb der Matrix | umgesetzt | `matrix-manifest.ts`, `metrics-span.ts` |
| AP-E.2 | **Antwort-LLM in der Matrix fix auf 'full' (nicht 'auto')** | LLM-as-Judge soll nicht den eigenen Bias bewerten | `'auto'`-Profil | Vermeidet Self-Bias gegen den Judge | Konsistente Antwort-Qualität über alle Zellen | umgesetzt | `tests/evals/README.md` |
| AP-E.2 | **Multi-Pod-Sharding der Matrix** | 360 Zellen × 163 Fragen = hoher GPU-Bedarf | Seriell auf einem Pod | Round-robin-Shards (`parseShard`/`selectShard`), Union = volle Menge, disjunkt | Sweep auf mehrere RunPod-GPUs verteilbar | umgesetzt | `matrix-manifest.ts` |
| laufend | **Worktree-Isolation für Doku** | Doku darf den aktiven Code-Branch nicht stören | Direkt auf dem Arbeitsbranch schreiben | Separater Worktree (`.claude/worktrees/dom-doku/`) | Doku-Schreiben isoliert von AP-E.2-Arbeitsstand | aktiv | Arbeitsverzeichnis-Konfig |
| laufend | **Doku lokal vs. GitHub** | Interne Arbeitsstände sollen nicht manipulierbar/öffentlich sein | Abschluss-Dokus/Berichte committen | `docs/work/`, `docs/abgabe/`, `ANLEITUNG-DOMINIK.md` gitignored; interne Handover-Docs nicht in öffentlichem Repo-Inhalt zitieren | Abschluss-Doku-Template pro AP bleibt lokal (Copy-Paste für Outline/Vikunja) | aktiv | `.gitignore`, Memory `ap-ticket-abschluss-doku.md` / `no-internal-docs-in-repo.md` |
| AP-T.2 | **Echter Embedder statt Mock in Integrationstests** | Retrieval-Roundtrip soll real sein | BGE-M3 mocken | In-Process echtes BGE-M3-GGUF, per `describe.runIf` gegated | Suite skippt mangels Modell in CI (lokal grün) | umgesetzt | `ap-t2-abschluss-doku.md` |
| AP-T.2 | **Electron-Stub für vitest auf CI** | Mehrere Suiten importieren `electron`, das auf Ubuntu nicht lädt | Suiten in CI deaktivieren | Schlanker Stub (`tests/helpers/electron-stub.ts` + Alias in `vitest.workspace.ts`) | Erster vitest-CI-Job (integration + tx) grün | umgesetzt | `Laborbericht_…2026-06-12.md` |

---

## 23.3 Querverweise

- Krypto-Entscheidungen (D1/D2) im Sicherheitskontext: [Sicherheit & Datenschutz](21_security_privacy_and_sensitive_data.md).
- Lizenz-Gate und Span-Metrik im Test-/Eval-Kontext: [Testing & QA](19_testing_and_quality_assurance.md).
- Die Risiken, die aus diesen Entscheidungen folgen (Installer-Defender, DEK-Rotation, Matrix-Kosten): [Risiken](22_risks_problems_and_mitigations.md).

> WARN zu verifizieren — die exakte 360-Zellen-Größe folgt aus den committeten OSI-Packs (8 × 3 × 1 × 15); die ursprüngliche Design-Größe lag bei ~399 Zellen. Der final gefahrene Abgabe-Scope ist eine offene Team-Entscheidung (siehe Risiko R6/R8).
