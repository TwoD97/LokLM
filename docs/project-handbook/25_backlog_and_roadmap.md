# Backlog und Roadmap

Priorisiertes Backlog mit Stand **2026-06-14**. Quellen: `docs/work/projektstatusbericht-2026-06-14.md` (Abschnitte „Nächste Schritte" + „Notwendige Entscheidungen"), `docs/work/ap-*-abschluss-doku.md`, `package.json`.

Lesart der Prioritäten: **Muss als Nächstes** = blockiert die Abgabe bzw. den Integrationsstand · **Sollte bald** = mittelfristig nötig, nicht abgabekritisch · **Später / Optional** = wünschenswert, ohne Termindruck.

---

## 1. Muss als Nächstes

| Punkt | AP / Bezug | Begründung |
|---|---|---|
| **AP-E.2 GPU-Matrix-Sweep (Phase 2) fahren** | AP-E.2 | LAP-Dataset (2.322 Chunks, 163 DE-Fragen) steht; Sweep (Embedder × Reranker × Chunker × LLM) auf RunPod-GPU starten, Span-Recall/nDCG auswerten, in den Abgabe-Laborbericht überführen. Rechenintensiv (Multi-Pod, `--shard i/n`). |
| **Test-PRs mergen** | AP-T.2 #19, AP-E.1 #25, AP-T.1 #24 | #19 ist mergebar (alle Checks grün); nach #19-Merge greift der vitest-CI-Job auch für #24/#25. Damit ist die §8.2-/§8.1-Testabdeckung im Integrationsstand verankert. |
| **AP-E1b in den Eval-Workflow einbinden** | AP-E1b | Hold-out-Set (15 Fälle) als separaten Validierungslauf führen — Echo-Chamber-Schutz (R5) für die Eval-Aussage. |

## 2. Sollte bald

| Punkt | Bezug | Begründung |
|---|---|---|
| **Eval-CI-Gate festlegen** | Projektstatusbericht, „Notwendige Entscheidungen" | Modell-Download-Step in die Pipeline (RetrievalService-E2E läuft sonst nur lokal); Schwellenwerte + GPU-/Laufzeit-Budget definieren. |
| **Abgabe-Scope der Matrix bestätigen** | AP-E.2 | endgültige Anzahl Zellen/Modelle/Datensätze fixieren, damit Laufzeit und Aussagekraft zur Deadline passen (`buildMatrixManifest` liefert die Laufzeit-Schätzung pro Konfiguration). |
| **QA-Routing gegen reale Workspaces validieren** | ADR-0003 | Korpus-/Decomposition-Route am echten Nutzer-Workspace gegenprüfen (nicht nur Sample-Korpus). |
| **Mac-/Linux-Auslieferung produktiv stabilisieren** | v0.4.x | Translator-Sidecar in den regulären Build-Pfad; Diarisations-Modelle für Mac/Linux verifizieren. |

## 3. Später / Optional

| Punkt | Bezug |
|---|---|
| **Echter LAP-Korpus-Eval** als eigenes Folgeticket (Ingestion/OCR/Chunking/Lizenz/eigenes Dev+Hold-out/Baseline-Vergleich) | AP-E.1 „Future Work" |
| **Mehr-Größen-Chunker-Vergleich** über separate Dataset-Läufe (chunker-unabhängige Span-Recall-Metrik) | AP-E.2 |
| **Pfad-/Wortlaut-Angleichungen im Pflichtenheft** (`eval/cases.json` → `tests/evals/data/cases.jsonl`; PBKDF2 → Argon2id) | AP-E.1 / AP-T.1, kosmetisch |

## 4. Blocker

| Blocker | Wirkung | Status |
|---|---|---|
| **Playwright kann Electron nicht starten** (`--remote-debugging-port=0`) | ganze `tests/e2e/`-Suite unrunnable lokal/CI | offen, kein Workaround |
| **Rust-/Tauri-Toolchain fehlt lokal** | lokaler Installer-Wizard-Build nicht möglich | Workaround: Build beim Projekt-Owner bzw. In-Place-`robocopy`-Update |
| **BGE-M3-GGUF nicht im CI-Runner** | RetrievalService-E2E skippt in CI | Team-Entscheidung über Modell-Download-Step ausstehend |
| **EV-Zertifikat** | SmartScreen-Warnung bei Windows-Install bleibt | Budget-/Beschaffungsfrage |

## 5. Technische Schulden

| Schuld | Gemeldet an | Empfehlung |
|---|---|---|
| `searchChunks` / `searchChunksByVector` ohne Tie-Break im `ORDER BY` | Denys (Logik-Domäne) | zweiter Sortierschlüssel (`document_id`/`chunk_id`) → Cross-Session-Determinismus |
| `document-import.test.ts` nutzt fixes `setTimeout(2000)` | Denys | auf Polling-`waitFor` umstellen (Flake-Risiko) |
| Auth-Krypto-Wrapper nur per `export` test-sichtbar gemacht | Denys | optional später in `auth/crypto.ts` auslagern (kein AP-T.1-Eingriff) |
| Coverage-Nachweis AP-T.1 noch scoped (`test:cov:apt1`) | — | nach #19-Merge auf Voll-Suite-Lauf + dauerhaftes Threshold-Gate umstellen |

## 6. Doku-Lücken

| Lücke | Status |
|---|---|
| **Abgabe-Laborbericht zur Matrix-Eval** | offen, hängt am GPU-Sweep (Phase 2) |
| **Vikunja-Task-Nr. für AP-E.1** | in der Abschluss-Doku noch leer („Task-Nr. eintragen") |
| **Outline-/Vikunja-Status „fertig"** für AP-T.1/T.2/E.1 | offen (Code im Review, manuelle Pflege ausstehend) |

> WARN durch Team zu ergaenzen: Die endgültige Zellenzahl der Abgabe-Matrix (Abschnitt 2) ist noch nicht bestätigt.

---

## 7. Offene Entscheidungen (PAG / Team)

Aus dem Projektstatusbericht 2026-06-14:

| Entscheidung | Kern |
|---|---|
| **Eval-Suite / Modell-Tests als CI-Gate** | Modell-Download in die Pipeline? Schwellenwerte + Budget. |
| **Abgabe-Scope Eval (AP-E.2)** | Zellen-/Modell-/Datensatz-Umfang für die Abgabe. |
| **Signing-Zertifikat / SmartScreen** | EV-Zertifikat — Budget-/Beschaffungsfrage. |
| **Mac-/Linux-Builds in der regulären Auslieferung** | Priorisierung der v0.4.x-Linie. |
| **Auto-Update-Strategie** | Velopack vs. electron-updater, Update-Server-Hosting, Rollback. |

---

## 8. Nächste konkrete Schritte

1. **PR #19 mergen** (review-frei, alle Checks grün) → CI-Test-Job in `main` aktiv → danach #24 und #25 mergen.
2. **RunPod-Pod starten** (`pnpm pod:start`), Matrix-Modelle ziehen (`pnpm models:matrix`), Sweep fahren (`pnpm evals:matrix-run`), Ergebnisse aggregieren (`pnpm evals:paper`).
3. **AP-E1b-Hold-out-Lauf** als separaten Validierungsdurchgang anhängen.
4. **Abgabe-Laborbericht** aus den Span-Recall-/nDCG-Resultaten schreiben.
5. **Betriebsthemen** (EV-Zertifikat, Auto-Update, Mac/Linux) als Entscheidungsvorlagen ins Team tragen.
