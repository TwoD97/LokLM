# Anhang

Referenztabellen zu Befehlen, Pfaden und Quellen. Alle Befehle aus `package.json` (Stand v0.4.1, pnpm 10.33.4, Node ≥ 24). Wo Modelle/GPU nötig sind, ist das vermerkt.

> WARN Keine sensiblen Rohdaten: API-/S3-Keys, Tokens, interne Domains und absolute lokale Pfade gehören nicht in dieses Handbuch — als Platzhalter behandeln (`<API_KEY>`, `<TOKEN>`, `<PRIVATE_DOMAIN>`, `<INTERNAL_PATH>`).

---

## 28.1 Wichtige Befehle

Die Befehlsreferenz (aus `package.json`) gliedert sich in die Tabellen 28.1–28.6.

### 28.1.1 Entwicklung & Build

**Tabelle 28.1:** Befehle für Entwicklung und Build.

| Befehl | Zweck |
|---|---|
| `pnpm dev` | App im Dev-Modus starten (electron-vite) |
| `pnpm build` | App bauen |
| `pnpm start` | gebaute App als Preview starten |
| `pnpm typecheck` | TypeScript-Projektbuild prüfen (`tsc -b`) |
| `pnpm lint` / `pnpm lint:fix` | ESLint prüfen / autofixen |
| `pnpm format` / `pnpm format:check` | Prettier schreiben / prüfen |
| `pnpm doc` | API-Doku generieren (typedoc) |

### 28.1.2 Tests

**Tabelle 28.2:** Test-Befehle.

| Befehl | Zweck |
|---|---|
| `pnpm test` | Gesamte vitest-Suite |
| `pnpm test:unit` | Unit-Tests (Projekte `node` + `web`) |
| `pnpm test:integration` | Integrationstests (PGlite, §8.2) |
| `pnpm test:tx` | Transaktions-/DB-Tests |
| `pnpm test:cov` | Tests mit Coverage |
| `pnpm test:e2e` | Playwright-E2E (siehe Hinweis unten) |

> WARN Status unklar: `pnpm test:e2e` ist im `package.json` verdrahtet, die `tests/e2e/`-Suite läuft jedoch derzeit nicht (Playwright kann Electron nicht starten). Siehe Kapitel 24/25.

### 28.1.3 Modelle (`models:*`)

**Tabelle 28.3:** Befehle für den Modell-Download.

| Befehl | Zweck |
|---|---|
| `pnpm models:embedder` | Embedder (BGE-M3) laden — nötig für RetrievalService-E2E |
| `pnpm models:lite` / `:medium` / `:pro` | LLM-Tier laden |
| `pnpm models:all` | alle Standardmodelle |
| `pnpm models:evals` | Modelle für die Eval-Läufe |
| `pnpm models:matrix` | Matrix-Modelle (vorab `evals:licenses:check`) |
| `pnpm models:translation` | Übersetzungsmodelle |
| `pnpm tessdata` | OCR-Sprachdaten (Tesseract) laden |

### 28.1.4 Evaluation (`evals:*`)

**Tabelle 28.4:** Evaluierungs-Befehle.

| Befehl | Zweck |
|---|---|
| `pnpm evals:generate` | synthetisches Dataset erzeugen |
| `pnpm evals:run` | Eval-Lauf |
| `pnpm evals:sweep` | Konfigurations-Sweep |
| `pnpm evals:build-lap` | LAP-Dataset bauen (Korpus → Dataset) |
| `pnpm evals:matrix-run` | Matrix-Sweep (vorab Lizenz-Gate) |
| `pnpm evals:matrix-summary` | Matrix-Zusammenfassung (Pre-Run-Manifest) |
| `pnpm evals:licenses:check` | Modell-Lizenzen validieren (Gate vor Download/Run) |
| `pnpm evals:paper` | Ergebnisse fürs Abgabe-Paper aggregieren |
| `pnpm evals:rejudge` / `:patterns` | Antworten neu bewerten / Fehlermuster |
| `pnpm pod:start` / `:stop` / `:status` | RunPod-GPU-Pod steuern |

### 28.1.5 Paketierung (`package:*`)

**Tabelle 28.5:** Paketierungs-Befehle.

| Befehl | Zweck |
|---|---|
| `pnpm package:win` | Windows-Installer (Payload + Archiv + Wizard + Stub) |
| `pnpm package:linux` | Linux-Installer (inkl. `.deb`) |
| `pnpm package:mac` | macOS-DMG |

> WARN Annahme, bitte pruefen: Der lokale `package:win:wizard`-Schritt benötigt die Rust-/Tauri-Toolchain; ohne `cargo` schlägt der Wizard-Build fehl (offizielle Installer entstehen auf dem Rechner des Projekt-Owners).

### 28.1.6 Datenbank

**Tabelle 28.6:** Datenbank-Befehle.

| Befehl | Zweck |
|---|---|
| `pnpm db:generate` | Drizzle-Migration generieren |
| `pnpm db:check` | Migrationen prüfen |
| `pnpm db:studio` | Drizzle-Studio öffnen |

---

## 28.2 Relevante repo-relative Pfade

**Tabelle 28.7:** Relevante repo-relative Pfade.

| Pfad | Inhalt |
|---|---|
| `src/main/` | Electron-Main-Prozess (Services, IPC, DB) |
| `src/main/services/retrieval/rrf.ts` | RRF-Implementierung (k=60) |
| `src/main/services/auth/AuthService.ts` | Auth/Vault (Argon2id + AES-256-GCM) |
| `src/main/db/migrations/` | DB-Migrationen (u. a. 0006 `idx_chunks_fts`) |
| `tests/unit/` | Unit-Tests (AP-T.1) |
| `tests/integration/` | Integrations-/E2E-Tests (AP-T.2, §8.2) |
| `tests/fixtures/retrieval/korpus.ts` | reproduzierbares Retrieval-Korpus (10 Dok/60 Chunks/10 Fragen) |
| `tests/evals/data/cases.jsonl` | Eval-Dev-Set (AP-E.1, 80 Fälle) |
| `tests/evals/data/holdout/dominik-15.jsonl` | Hold-out (AP-E1b, 15 Fälle, R5) |
| `tests/evals/answer/matrix-manifest.ts` | Matrix-Achsen + Laufzeit-Manifest (AP-E.2) |
| `tests/evals/answer/run-pack.ts` | Matrix-Lauf-Treiber |
| `tests/evals/license/` | Modell-Lizenz-Validierung |
| `docs/adr/` | Architecture Decision Records (0001–0004) |
| `docs/Pflichtenheft.md`, `docs/Lastenheft.md` | Anforderungsdokumente |
| `docs/project-handbook/` | dieses Handbuch |
| `docs/project-handbook/export/` | Export-Ziel des Handbuchs (z. B. PDF/zusammengeführte Ausgabe) |

---

## 28.3 Quellendateien-Liste (Basis dieses Clusters)

**Tabelle 28.8:** Quellendateien dieses Kapitels.

| Datei | Verwendung |
|---|---|
| `docs/work/projektstatusbericht-2026-06-14.md` | Status, Termine, nächste Schritte, Entscheidungen |
| `docs/work/laborberichte/Laborbericht_LokLM_2026-05-29.md` | LockedError-Diagnose, Gate G2 |
| `docs/work/laborberichte/Laborbericht_LokLM_2026-06-12.md` | AP-T.2 Integrationstests + CI-Job |
| `docs/work/ap-t1-abschluss-doku.md` | AP-T.1 Unit-Tests + Coverage |
| `docs/work/ap-t2-abschluss-doku.md` | AP-T.2 Integrationstests |
| `docs/work/ap-e1-abschluss-doku.md` | AP-E.1 Eval-Dev-Set |
| `package.json` | Skripte für diesen Anhang |

Die Build-/Export-Anleitung des Handbuchs steht in [EXPORT_NOTES.md](EXPORT_NOTES.md); das Export-Ziel ist das Verzeichnis `docs/project-handbook/export/`.

---

## 28.4 Matrix-Eval — Achsen (Referenz)

Aus `tests/evals/answer/matrix-manifest.ts`. Die Größe einer Matrix-Konfiguration:

- **Retrieval-Configs** = Embedder × (Reranker + 1 `SkipReranker`) × Chunker
- **Zellen** = Retrieval-Configs × Antwort-LLMs
- **Läufe** = Zellen × Fragen (Antwort + Judge)
- **Laufzeit** = Läufe × Sekunden/Lauf → GPU-Stunden (per `buildMatrixManifest`)

Chunker-Achse aktuell `fixed-512-64` (512/64, passend zum LAP-Dataset); der Chunk-Größen-Vergleich läuft als separate Dataset-Läufe über die chunker-unabhängige Span-Recall-Metrik.

---

## 28.5 Verweis auf den Export

Das fertige Handbuch wird nach `docs/project-handbook/export/` ausgegeben (zusammengeführte/PDF-Form). Bildmaterial liegt unter `docs/project-handbook/assets/`. Detail-Anleitung zum Export-Build siehe [EXPORT_NOTES.md](EXPORT_NOTES.md).
