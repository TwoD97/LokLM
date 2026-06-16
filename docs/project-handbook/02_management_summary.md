# Management Summary

## 2.1 Was wurde gebaut

**LokLM** ist eine lokale, offline lauffähige Desktop-Anwendung (Electron), mit der Benutzer eigene Dokumente — PDF, Markdown, Text, Quellcode, optional DOCX — importieren, in benannten Arbeitsbereichen organisieren und über eine Chat-Oberfläche befragen können. Jede Antwort enthält **klickbare Quellenverweise**, über die der Benutzer zur Originaltextstelle springt und die Aussage selbst überprüft. Die Anwendung arbeitet im Standardbetrieb vollständig lokal; eine Internetverbindung ist nur einmalig für Installation und die Modell-Akquise des Installer-Wizards erforderlich.

## 2.2 Welches Problem wird gelöst

Wissen liegt verstreut in Dateien, Skripten und Notizen; es belegbar zu zitieren ist aufwendig. Verbreitete KI-Chatlösungen verarbeiten Anfragen auf externen Servern — für DSGVO-relevante, schulische oder berufliche Inhalte oft nicht akzeptabel. LokLM schließt diese Lücke: Es macht eigenes Wissen durchsuchbar und beantwortet Fragen **ausschließlich aus den lokal gespeicherten Dokumenten**. Findet sich keine passende Quelle, gibt das System eine klare Verweigerungsmeldung aus, statt eine Antwort zu erfinden (Lastenheft §1–§2).

## 2.3 Zentrale technische Bestandteile

Tabelle 2.1 nennt die zentralen technischen Bestandteile und ihre Umsetzung.

**Tabelle 2.1:** Zentrale technische Bestandteile von LokLM.

| Bestandteil                              | Umsetzung                                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lokaler Betrieb**                      | Electron-Desktop-App; In-Process-Datenbank (pglite / WASM-Postgres) + lokales Sprachmodell (node-llama-cpp, GGUF); keine externen KI-APIs                                                                 |
| **RAG (Retrieval-Augmented Generation)** | Zweistufige Retrieval-Pipeline: hybride Suche (`tsvector`-Volltext + `pgvector`/HNSW-Semantik) → RRF-Fusion → Cross-Encoder-Reranking → Promptaufbau → gestreamte Antwort                                 |
| **Quellenverifikation**                  | Strukturierte Citations `[doc:<id>, chunk:<id>]`; Klick öffnet den SourceViewer mit Originalpassage und Kontext                                                                                           |
| **Ehrlichkeit statt Erfindung**          | Verweigerungslogik mit Score-Schwellenwert; Out-of-Corpus-Fragen werden abgelehnt statt erfunden                                                                                                          |
| **Eval-Matrix**                          | Eval-Harness mit Dev-Set (80 Fälle) + Hold-out (15 Fälle) und kartesischer RAG-Matrix (Embedder × Reranker × Chunker × LLM) zur Messung von Citation Accuracy, Faithfulness, Refusal Rate und Span-Recall |

## 2.4 Ergebnisse nach ca. 9 Wochen

In rund neun Wochen wurde von der Projekt-Initialisierung bis zum Release **v0.4.1** geliefert. Die Releasereihe **v0.1.x → v0.4.x** umfasst u. a. das Auth-/Krypto-Fundament, den Datenbank-Layer, die Verteilungs-Website auf eigener Domain, die komplette Release-Pipeline (GitHub Actions → CDN + Backup-Mirror), die Provider-Abstraktion (gebündelt + optional Ollama), Dokumentenimport inkl. DOCX, Suche/Filter, Settings, Chat mit Streaming und Quellenanzeige sowie spätere Erweiterungen (Audio-Transkription, Quiz-Generator, QA-Routing, Electron-Sicherheitshärtung). Die Test- und Eval-Säule (Unit-, Integrations- und Eval-Tests) ist weit ausgebaut.

Zum Release-Bereich: Der Auftrag nennt „v0.1.1–v0.4.2". v0.4.2 existiert als **Release-Commit (`783ca4b`), aber (noch) kein Git-Tag — der höchste gesetzte Tag ist v0.4.1**. Die per Tag markierten Releases reichen also bis einschließlich v0.4.1 (13.06.2026); v0.4.2 ist bislang nur ein Release-Commit (14.06.2026) ohne zugehörigen Tag.

## 2.5 Größte offene Punkte

Die größten offenen Punkte zum Handbuchstand fasst Tabelle 2.2 zusammen.

**Tabelle 2.2:** Größte offene Punkte zum Handbuchstand.

| Offener Punkt                         | Stand                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **AP-E.2 GPU-Matrix-Sweep (Phase 2)** | Dataset steht (2.322 Chunks, 163 DE-Fragen); GPU-Sweep + Auswertung für den Laborbericht offen            |
| **Test-PRs**                          | AP-T.1 (#24), AP-T.2 (#19), AP-E.1 (#25) gemergt (16.06.); AP-E.1b als #28 offen                          |
| **E2E-Playwright (Electron)**         | Läuft nicht in CI (Electron-Start im Runner nicht möglich); Website-E2E davon nicht betroffen             |
| **macOS-Release**                     | Build-Pipeline existiert; Payloads noch nicht publiziert → kein zugesicherter v1-Liefergegenstand         |
| **Code-Signing / Auto-Update**        | Windows-Code-Signing läuft; EV-Zertifikat und Auto-Update-Strategie (Velopack vs. electron-updater) offen |

## 2.6 Bedeutung von Werkzeugen und KI-Unterstützung

Das Projekt wurde mit einem durchgängigen Werkzeug-Setup organisiert:

- **GitHub** als Quellcodeverwaltung mit täglichen Commits, Pull-Request-Workflow und Code-Review; der Projektbetreuer hat Leserechte.
- **Kanban (Vikunja)** zur Arbeitspaket- und Task-Steuerung.
- **Outline** als internes Wissens-/Dokumentations-Wiki für AP-Abschluss-Dokumente.
- **KI-Unterstützung** als Werkzeug für Entwurf, Tests und Dokumentation, unter klaren Team-Regeln (keine eigenmächtige Logik-Änderung, keine KI-Erwähnung in Commits, kein Merge nach `main` ohne Freigabe).

> WARN durch Team zu ergaenzen — Die konkreten internen Domains für Vikunja/Outline/MinIO sind interne Dienste (`<PRIVATE_DOMAIN>`) und werden im Handbuch nicht genannt.
