# SOURCE_MAP

Quellenkarte des Projekthandbuchs: welche Quelle welche Information liefert, in welchen
Kapiteln sie verwendet wird, wie hoch der Vertrauensgrad ist und was noch zu prüfen
bleibt. Stand: **2026-06-14**.

> **Abgrenzung zum Literaturverzeichnis:** Diese Karte ist die **interne** Provenienz- und
> Vertrauensgrad-Übersicht (Repo-Pfade, lokale und externe Werkzeuge) und Teil der internen
> Verwaltung. **Externe** Quellen, die im Fließtext mit `[n]` zitiert werden (Tools,
> Frameworks, Standards, Paper), werden zusätzlich als bindefähige Einträge im
> [Literaturverzeichnis](back_10_literaturverzeichnis.md) geführt. Zitierregeln:
> [STYLE_GUIDE.md](STYLE_GUIDE.md) Abschnitt 5.

## Legende

- **Vertrauensgrad:**
  - `hoch` = im öffentlichen Repo nachprüfbar (Code, committete Docs, Git-/PR-/Tag-Historie).
  - `mittel` = belegbar, aber lokal/gitignored (Abschluss-Dokus, Laborberichte, Statusberichte) oder aus Quellen rekonstruiert.
  - `niedrig` = externe Werkzeuge / Projektangaben ohne Repo-Beleg / nicht aus dem Repo verifizierbar.
- **Ort:** `Repo` = committet & öffentlich · `lokal` = gitignored · `extern` = außerhalb des Repos.

## A. Vertragsdokumente (committet)

| Quelle | Datei / Ordner | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Lastenheft | `docs/Lastenheft.md` | Repo | Auftrag, Ziele, Soll-Anforderungen, Mindestumfang §9, Abgrenzung §10, Zusammenarbeit §13 | 02, 03, 04, 05, 06, 07 | hoch | Vorname-Schreibweise „Denys"; Release-Bereich-Angabe |
| Pflichtenheft | `docs/Pflichtenheft.md` (Version 1.1.2) | Repo | SMART-Ziele §1.2, Nicht-Ziele §1.3, Architektur, Datenmodell §4, Testkonzept §8, Abnahme §11 | 03, 05, 06, 07, 19 | hoch | gemessene Zielerreichung; Pfad-/Wortlaut-Abweichungen (PBKDF2, cases.json) |

## B. Architecture Decision Records & Specs (committet)

| Quelle | Datei / Ordner | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| ADR-0001 | `docs/adr/0001-argon2id-password-kdf.md` | Repo | Argon2id-KDF, Bitwarden-Profil, PBKDF2-Verwerfung | 13, 14, 21, 23, 26 | hoch | Parameter-Migration noch offen |
| ADR-0002 | `docs/adr/0002-envelope-encryption-aes-gcm.md` | Repo | Envelope-Encryption, DEK/KEK, Vault-Format v4 | 13, 14, 21, 22, 23 | hoch | Header-MAC offen |
| ADR-0003 | `docs/adr/0003-query-routing-und-summary-index.md` | Repo | Query-Routing (corpus/doc_summary/retrieval), Summary-Index | 13, 16, 23 | hoch | Routing-Validierung gegen reale Workspaces |
| ADR-0004 | `docs/adr/0004-adaptive-model-residency.md` | Repo | Adaptive Modell-Residency (PROPOSED) | 13, 14, 20, 21, 23 | hoch | Implementierungsstand (geplant vs. gebaut) |
| ADR-README | `docs/adr/README.md` | Repo | ADR-Format, Status-Konventionen | 23 | hoch | — |
| Feature-Specs | `docs/specs/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` | Repo | Skeleton, Drizzle-Switch, DOCX, NSIS-/Velopack-Installer, Landingpage | 06, 11 | mittel | teils abgelöste/verworfene Pläne (NSIS, Velopack) |
| DB-Normalisierung | `docs/db-normalization.md` | Repo | 3NF-Begründung, DB-Objekte | 13 | hoch | — |
| Software-Lizenzen | `docs/licenses.md` | Repo | npm-/Electron-Dependency-Lizenzen | 18 | hoch | — |

## C. Quellcode (committet, öffentlich)

| Quelle | Datei / Ordner | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Main-Prozess | `src/main/index.ts`, `src/main/services/` | Repo | Service-Topologie, IPC-Handler, Worker-Clients, Härtung | 12, 13, 14, 16 | hoch | IPC-Handler-Gesamtzahl maschinell gezählt = **105** (2026-06-14) |
| DB-Schema/Migrationen | `src/main/db/schema.ts`, `src/main/db/migrations/` | Repo | Tabellen, Trigger/Funktionen, HNSW, FTS-Index, Summary-Index | 13, 14, 15 | hoch | — |
| Retrieval/RAG | `src/main/services/retrieval/`, `qa/`, `embeddings/`, `llm/` | Repo | Hybride Pipeline, RRF, Reranking, Routing, Refusal, Profile | 14, 16 | hoch | — |
| Installer-Wizard | `installer-wizard/` | Repo | Tauri-Wizard, Tier-Marker, Payload-Modell | 06, 11, 20 | hoch | Build erfordert Rust/Tauri (lokal nicht überall) |
| package.json | `package.json` | Repo | Skripte, engines, Dependencies, Paketierung | 13, 20, 28 | hoch | — |
| Build-Konfig | `electron.vite.config.ts`, `.github/workflows/` | Repo | Worker-Inputs, CSP, CI-Workflows | 13, 19, 20 | hoch | vitest-Job nur in PR #19, nicht in `main` |

## D. Test- & Eval-Artefakte (committet)

| Quelle | Datei / Ordner | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Test-READMEs | `tests/README.md`, `tests/manual/…`, `tests/evals/README.md`, `tests/e2e/README.md` | Repo | Testpyramide, M-Szenarien, Eval-Säule | 19 | hoch | M-Szenarien nicht protokolliert |
| Eval-Dev-Set | `tests/evals/data/cases.jsonl` | Repo | 80 Fälle, Schema, Verteilung | 11, 19 | hoch | — |
| Reproduzierbares Korpus | `tests/fixtures/retrieval/korpus.ts` | Repo | 10 Docs / 60 Chunks / 10 Fragen | 11, 19 | hoch | — |
| Matrix-Manifest/Packs | `tests/evals/answer/matrix-manifest.ts`, `*-pack.json` | Repo | Achsen, Zellenrechnung, Shard-Split | 17, 22, 23, 28 | hoch | „72"-Kommentar veraltet; Zellenzahl 360 vs. 399 |
| License-Registry | `tests/evals/model-license-registry.json` (verifiedAt 2026-06-14) | Repo | Modell-Lizenzen, licenseClass, allowedInDefaultMatrix | 17, 18, 22, 23 | hoch | Re-Prüfung vor Abgabe (Lizenz-Drift) |
| License-Gate | `tests/evals/license/validate-model-licenses.ts` | Repo | OSI-only-Durchsetzung | 18, 19, 23 | hoch | — |
| LAP-Dataset-Build | `tests/evals/synth/build-lap-dataset.ts`, `metrics-span.ts` | Repo | Span-Metriken, Gold-Span-Ableitung, Refusal-Erhalt | 15, 17 | hoch | kein Auto-Normalisierer (UTF-8/LF) |
| LAP-Korpus + Fragen | `tests/evals/data/lap-corpus/`, kuratierte JSONL | lokal | ~90 Docs, 2.322 Chunks, 163 DE-Fragen | 11, 15, 17, 24 | niedrig | gitignored; Kennzahlen aus Projektangabe, nachzuzählen |

## E. Interne Steuer-/Arbeitsdokumente (gitignored, lokal)

| Quelle | Datei / Ordner | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Projektstatusberichte | `docs/work/projektstatusbericht-2026-{05-22,06-07,06-14}.md` | lokal | Phasen-Status, Termine, Entscheidungen, Partnerausfall | 02, 04, 07–11, 20–25 | mittel | Wochen 7–9 noch ohne Folgebericht |
| Laborberichte | `docs/work/laborberichte/Laborbericht_LokLM_2026-{05-29,06-12}.md` | lokal | Gate G2, LockedError-Diagnose, AP-T.2-CI-Job | 08, 09, 11, 19, 26 | mittel | — |
| AP-Abschluss-Dokus | `docs/work/ap-{t1,t2,e1}-abschluss-doku.md`, `ap-9-partner-fields.md` | lokal | DoD-Soll/Ist, Coverage-Zahlen, Offene Fragen, Task-/PR-Links | 07, 10, 11, 19 | mittel | enthalten echte interne Links — bewusst gitignored |

## F. Externe Werkzeuge (nicht im Repo)

| Quelle | Adresse | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Vikunja (Kanban) | `<PRIVATE_DOMAIN>` (`tasks.<…>`) | extern | AP-Karten, Status/Priorität, Sprint-Fluss | 08, 10, 25 | niedrig (extern) | Board-Aufbau, Spalten-Historie, exakte Task-Nrn. — nur per Export/Screenshot |
| Outline (Wiki) | `<PRIVATE_DOMAIN>` (`notes.<…>`) | extern | Pflichtenheft, AP-Specs, DoD, Status-Updates | 08, 10, 25 | niedrig (extern) | Seitenhierarchie, Detailverlauf, Status-„fertig"-Pflege |
| MinIO (Objektspeicher) | `<PRIVATE_DOMAIN>` | extern | Release-Backup-Mirror, Bericht-Snapshots | 09, 20 | niedrig (extern) | Bucket-/Pfad-Konfiguration |
| RunPod (GPU) | `<PRIVATE_DOMAIN>` / API | extern | GPU-Eval-Läufe, Judge-/Matrix-Sweep | 17, 20, 22, 25 | niedrig (extern) | Pod-/Endpoint-IDs in lokaler `.env`; Betriebsdetails im internen Leitfaden |
| GitHub `TwoD97/LokLM` | öffentlich | extern (öffentlich) | Commits, Branches, PRs #1–#26, Tags v0.1.1–v0.4.1 | 02, 08, 09, 10, 11, 24 | hoch | v0.4.2 als Commit, noch nicht getaggt |

## G. Auto-Memory (Arbeitskontext, nicht Teil der Abgabe)

| Quelle | Datei | Ort | Verwendete Information | Verwendet in Kapitel | Vertrauensgrad | Offene Prüfung |
| --- | --- | --- | --- | --- | --- | --- |
| Memory-Einträge | `e2e-harness-electron-playwright-broken.md`, `loklm-installer-build-rust.md`, `runpod-gpu-eval-workflow.md` u. a. | lokal | E2E-Blocker, Installer-Build-Workaround, RunPod-Gotchas | 19, 20, 22 | mittel | persönlicher Arbeitskontext; nicht zitierbar in Abgabe-Inhalten |

## Hinweise zur Nutzung dieser Karte

- Kapitel mit überwiegend `hoch`-Quellen (12, 14, 16, 27) sind am robustesten belegt.
- Kapitel, die auf `niedrig`-Quellen (extern, Projektangabe) aufsetzen (08, 10, 15, 17,
  25), tragen entsprechende Marker im Fließtext und sind die wichtigsten Kandidaten für
  Team-Ergänzungen (siehe [OPEN_QUESTIONS_FOR_TEAM.md](OPEN_QUESTIONS_FOR_TEAM.md)).
- Externe Werkzeuge (Vikunja/Outline/MinIO/RunPod) sind durchgängig als
  `<PRIVATE_DOMAIN>` maskiert und mit Vertrauensgrad **niedrig/extern** geführt — ihr
  Detailverlauf ist aus dem Repo grundsätzlich nicht rekonstruierbar.
