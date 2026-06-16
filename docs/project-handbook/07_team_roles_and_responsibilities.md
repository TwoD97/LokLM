# Team, Rollen und Verantwortlichkeiten

Das Projekt wurde von einem **Zwei-Personen-Team** mit klar getrennten Verantwortungsbereichen umgesetzt. Die Aufteilung folgt dem Pflichtenheft (§9.2, AP-Liste mit Ownern) und den Projektstatusberichten.

## 7.1 Rollenübersicht

Tabelle 7.1 gibt die Rollenübersicht des Zwei-Personen-Teams.

**Tabelle 7.1:** Rollenübersicht des Teams.

| Name               | Rolle                         | Kern-Verantwortung                                                                                                       |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Denys Tudosa**   | Projekt-Owner / Projektleiter | Architektur, Backend, Auth/Krypto, RAG-Core, Chunking, Installer/Release, Quiz, Transkription, QA-Routing                |
| **Dominik Furlan** | Dokumentations-Owner & Tester | Test-Säule (Unit/Integration/Eval), UI/UX (Auth-UI, Suche, Settings), Dokumentation, Eval-Authoring, Verteilungs-Website |

Die Rollentrennung ist auch eine **Qualitätssicherungs-Maßnahme**: Der Tester ist nicht zugleich Autor der getesteten Backend-Logik. Das senkt das Echo-Kammer-Risiko bei der Evaluierung (Risiko R5).

## 7.2 Denys Tudosa — Projekt-Owner

Tabelle 7.2 fasst Verantwortung und Beiträge des Projekt-Owners zusammen.

**Tabelle 7.2:** Verantwortungsbereich und Beiträge von Denys Tudosa.

| Feld                      | Angabe                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verantwortungsbereich** | Architektur & Backend-Services; Authentifizierung/Krypto; RAG-Core (Embeddings, Retrieval, RRF, Reranking); Chunking/Parsing; Datenbank-Schema; Chat-Pipeline & Verweigerungslogik; Quellenanzeige; Installer & Release-Pipeline; spätere Features (Transkription, Quiz, QA-Routing, Translator-Sidecar)                   |
| **Zugehörige APs**        | AP-1.1 (Setup), AP-2.1 (Auth-Backend), AP-3.1/3.2/3.3 (Import), AP-4.1–4.4 (Chunker, Index, Embeddings, RRF), AP-5.1/5.2 (DB-Schema, Workspaces), AP-7.1/7.2/7.4/7.5 (Chat, Retrieval-Pipeline, Verweigerung, Persistenz), AP-8 (Quellenanzeige), AP-1.4/1.5 (Release-Pipeline + Hardening), AP-E.2-Harness (ursprünglich) |
| **Hauptbeiträge**         | Auth-/Krypto-Fundament; Drizzle-/pglite-Datenbank-Layer; hybride Retrieval-Pipeline + RRF + Reranking; Provider-Abstraktion (gebündelt + Ollama); Release-Pipeline (GitHub Actions → CDN + Mirror); Audio-Transkription (v0.4.0); chunk-getriebener Quiz-Generator; QA-Routing (ADR-0003); Electron-Sicherheitshärtung     |
| **Status**                | Großteil der v0.4.x-Auslieferung getragen; nach Ausfall in KW 23 wieder voll eingebunden; Gesamtstatus planmäßig                                                                                                                                                                                                           |
| **Offene Klärungen**      | Mac-/Linux-Auslieferung produktiv stabilisieren; QA-Routing gegen reale Workspaces validieren; Auto-Update-Strategie (Velopack vs. electron-updater); Code-Signing/SmartScreen                                                                                                                                             |

## 7.3 Dominik Furlan — Dokumentations-Owner & Tester

Tabelle 7.3 fasst Verantwortung und Beiträge des Dokumentations-Owners und Testers zusammen.

**Tabelle 7.3:** Verantwortungsbereich und Beiträge von Dominik Furlan.

| Feld                      | Angabe                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verantwortungsbereich** | Gesamte Test-Säule (Unit-, Integrations-, Eval-Tests); UI/UX in den ihm zugeordneten Bereichen; Eval-Set-Authoring inkl. Hold-out; Dokumentation (Handbuch, Anwenderhandbuch, ADR-Mitschrieb); Verteilungs-Website-Tests; DOCX-Import (UI-/Spec-seitig)                                                                                                                                                  |
| **Zugehörige APs**        | AP-2.2 (Auth-UI), AP-3.4 (DOCX-Import), AP-6 (Suche/Filter-UI), AP-9 (Settings-UI), AP-D.1/D.2/D.3/D.4 (Website, Anwenderhandbuch, techn. Doku, TypeDoc), AP-T.1 (Unit-Tests), AP-T.2 (Integrationstests), AP-T.3/T.3b (manuelle M-Szenarien), AP-T.4 (Hardware-Matrix), AP-E.1 (Eval-Dev-Set), AP-E1b (Hold-out), AP-E.2 (RAG-Matrix-Eval)                                                              |
| **Hauptbeiträge**         | AP-6 Library-Suche (PR #12, gemerged) und AP-9 Settings (PR #13, gemerged); Unit-Tests mit ≥ 70 % Branch-Coverage (AP-T.1); Integrationstests + erster vitest-CI-Job (AP-T.2, PR #19); Eval-Dev-Set mit 80 Fällen (AP-E.1, PR #25); 15 Hold-out-Fälle (AP-E1b); RAG-Matrix-Eval Phase 1 (Span-Recall-Metrik + LAP-Korpus-Converter); Website-Test-Pipeline (Vitest + Playwright + axe-core + Lighthouse) |
| **Status**                | AP-6 und AP-9 fertig und gemerged; Test-/Eval-Pakete teils noch in PR-Review bzw. in Arbeit (AP-E.2 Phase 2)                                                                                                                                                                                                                                                                                             |
| **Offene Klärungen**      | AP-T.2 (#19) und AP-E.1 (#25) mergen, AP-T.1-Branch pushen + PR; AP-E.2 GPU-Sweep durchziehen und in den Laborbericht überführen; AP-E1b als separaten Validierungslauf einbinden; Multi-Hardware-Matrix (AP-T.4) abschließen                                                                                                                                                                            |

## 7.4 Aktueller AP-Status (Stand 2026-06-14)

Tabelle 7.4 zeigt den aktuellen Arbeitspaket-Status.

**Tabelle 7.4:** Aktueller Arbeitspaket-Status (Stand 2026-06-14).

| AP                                                    | Owner   | Stand                              |
| ----------------------------------------------------- | ------- | ---------------------------------- |
| AP-6 (Suche/Filter)                                   | Dominik | gemerged (PR #12)                  |
| AP-9 (Settings)                                       | Dominik | gemerged (PR #13)                  |
| AP-T.1 (Unit-Tests)                                   | Dominik | umgesetzt; PR #24 gemergt (16.06.) |
| AP-T.2 (Integrationstests + CI)                       | Dominik | PR offen (#19), Checks grün        |
| AP-T.3b (manuelle M-Szenarien)                        | Dominik | gemerged (PR #14)                  |
| AP-T.4 (Hardware-Matrix)                              | Dominik | offen                              |
| AP-E.1 (Eval-Dev-Set)                                 | Dominik | PR offen (#25)                     |
| AP-E1b (Hold-out)                                     | Dominik | umgesetzt (lokal, R5-geschützt)    |
| AP-E.2 Phase 1 (Metrik + LAP-Dataset)                 | Dominik | umgesetzt (lokal)                  |
| AP-E.2 Phase 2 (GPU-Sweep)                            | Dominik | **in Arbeit / offen**              |
| v0.4.0/v0.4.1 (Transkription, Quiz, Härtung, Sidecar) | Denys   | released                           |
| QA-Routing (ADR-0003)                                 | Denys   | gemerged (`main`)                  |
| Electron-Sicherheitshärtung                           | Denys   | gemerged (`main`)                  |

## 7.5 Zusammenarbeit und Team-Regeln

Die Zusammenarbeit folgt den im Lastenheft (§13) vereinbarten Dimensionen (Informieren, Planen, Entscheiden, Verändern, Zusammenarbeiten, Konflikte lösen, Verantwortung). Operativ getragen wird sie durch:

- **GitHub** mit täglichen Commits, Pull-Request-Workflow und Code-Review (Leserecht des Projektbetreuers);
- **Kanban (Vikunja)** zur AP-/Task-Steuerung;
- **Outline** als internes Doku-/Wissens-Wiki (AP-Abschluss-Dokumente);
- **wöchentliche Briefings** (Denys → Dominik) und wöchentliche Projektstatusberichte als Wissens- und Übergabe-Mechanismus (auch als Ausfall-Absicherung, Risiken R3/R7).

> WARN durch Team zu ergaenzen — Bei Patt-Entscheidungen sieht das Lastenheft (§13) eine außenstehende, nicht involvierte Person als Entscheider anhand der sachlich stärkeren Argumente vor. Ob ein solcher Fall im Projektverlauf eingetreten ist, ist beim Team zu ergänzen.

Verbindliche Schreibweise: **Denys Tudosa** (Lasten-/Pflichtenheft); die Projektstatusberichte verwenden abweichend „Denis".
