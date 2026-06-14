# Projektziele und Erfolgskriterien

Dieses Kapitel führt Haupt-, Neben- und Nicht-Ziele sowie die messbaren Erfolgskriterien zusammen. Die fünf Hauptziele entsprechen den SMART-Zielen des Pflichtenhefts (§1.2); die Erfolgskriterien den Abnahmekriterien (§11) und den Soll-Anforderungen des Lastenhefts (§5).

## 5.1 Hauptziele (SMART)

Tabelle 5.1 listet die fünf Hauptziele mit Messgröße und Termin.

**Tabelle 5.1:** Hauptziele (SMART) mit Messgröße und Termin.

| ID  | Ziel (Benutzersicht)            | Messung                                                                                                  | Termin     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| **Z-1** | **Datenhoheit** — Dokumente, Fragen und Antworten verlassen das Gerät im Standardbetrieb nicht; auch Anmeldung und Passwort-Wiederherstellung ohne Drittdienst | Wireshark-Mitschnitt über 30 min Standardnutzung: 0 ausgehende Verbindungen außerhalb Loopback | 12.06.2026 |
| **Z-2** | **Eigene Unterlagen befragen** — PDF/MD/Text/Code in Workspaces sammeln, DE+EN durchsuchen, befragen | 50-Datei-Korpus 100 % importiert, durchsuchbar p95 ≤ 60 s; 30-Anfragen-Set Recall@5 ≥ 0,7; bilingual ≥ 80 % korrekte Zuordnung je Sprache | 29.05.2026 |
| **Z-3** | **Nachvollziehbare Antworten** — Klick zur Originaltextstelle, Aussage selbst prüfbar | 50-Fragen-Set: ≥ 85 % der Antworten mit mindestens einem klickbaren, korrekten Quellenverweis (Citation Accuracy) | 12.06.2026 |
| **Z-4** | **Ehrlichkeit statt Erfindung** — bei fehlender Quelle ehrliche Verweigerung statt erfundener Antwort | 20 Out-of-Corpus-Fragen: ≥ 95 % korrekte Verweigerung, 0 erfundene Quellen (Refusal Rate, Faithfulness) | 12.06.2026 |
| **Z-5** | **Lieferbar zum Schulende** — Download, Installation und erster beantworteter Chat ohne IT-Unterstützung, mit deutschem Handbuch | Projektseite online, Installer lädt; Usability-Test 3 Erstnutzer erreichen ersten Chat ≤ 30 min; Handbuch deckt alle 11 Mindestbestandteile ab | 26.06.2026 |

## 5.2 Nebenziele (Soll-Anforderungen)

Tabelle 5.2 fasst die Soll-Anforderungen zusammen.

**Tabelle 5.2:** Nebenziele (Soll-Anforderungen).

| Nebenziel                | Beschreibung                                                                          | Lastenheft |
| ------------------------ | ------------------------------------------------------------------------------------- | ---------- |
| Semantische Suche        | Inhalte zusätzlich zur Stichwortsuche sinngemäß finden                                 | §5 Soll    |
| DOCX-Import              | Word-Dokumente (.docx) importierbar                                                    | §5 Soll    |
| Chatverlauf              | frühere Chatverläufe wieder öffnen und fortsetzen                                      | §5 Soll    |
| Einstellungen            | Chunkgröße, Überlappung, Trefferzahl konfigurierbar                                    | §5 Soll    |
| Designpattern            | erkennbare Architekturmuster im Code, in der Doku benannt                              | §5 Soll    |
| Hardware-Test            | Test auf unterschiedlichen Hardwarekonfigurationen, dokumentiert                       | §5 Soll    |
| Evaluierung              | Antwortqualität mit Testset gemessen (Citation Accuracy, Faithfulness, Refusal Rate)   | §5 Soll    |
| Verteilungsseite         | öffentliche Projektseite mit Installer + Anwenderdoku                                  | §5 Soll    |

## 5.3 Nicht-Ziele

Bewusst nicht enthalten in Version 1 (Pflichtenheft §1.3, Lastenheft §10) — siehe Tabelle 5.3:

**Tabelle 5.3:** Nicht-Ziele der Version 1 mit Begründung.

| Nicht-Ziel                                                  | Begründung (Kurzform)                              |
| ----------------------------------------------------------- | -------------------------------------------------- |
| Multi-Device-Synchronisation (NZ-1)                         | widerspricht Lokalitätsprinzip                     |
| Antworten aus allgemeinem Internetwissen (NZ-2)             | Quellenverifikation nur mit lokalen Quellen möglich |
| Mehrbenutzerbetrieb auf einer Installation (NZ-3)           | Einzelgeräte-Anwendung                             |
| iOS-/Android-/Browser-Erweiterung (NZ-4)                    | Plattform-Scope ist Windows-Desktop                |
| OCR für gescannte PDFs (NZ-5)                               | eigenes Teilprojekt                                |
| Audio-/Videotranskription als Kernumfang (NZ-6)             | eigenes Teilprojekt                                |
| Zwei-Faktor-Authentifizierung (NZ-7)                        | bei Einzelgerät ohne Trust-Domain kein Mehrwert    |
| macOS-Release als zugesicherter Liefergegenstand (NZ-8)     | Build-Pipeline vorhanden, Payloads nicht publiziert |
| Echtzeit-Zusammenarbeit (NZ-9)                              | Einzelnutzer-Fokus                                 |
| Automatisches Modell-Auto-Update (NZ-10)                    | Offline-Prinzip; Update via neuen Installer        |
| Kostenpflichtige Funktionen / Lizenzaktivierung (NZ-11)     | MIT-Schulprojekt                                   |
| Externe / gemeinsame Datenbanken (NZ-12)                    | Konflikt mit lokaler Datenhaltung                  |

## 5.4 Erfolgs- / Abnahmekriterien

Maßgeblich sind die Abnahmekriterien des Pflichtenhefts (§11). Auszug mit den zentralen messbaren Schwellen (Tabelle 5.4):

**Tabelle 5.4:** Erfolgs-/Abnahmekriterien (Auszug der messbaren Schwellen).

| Kriterium                                              | Schwelle / Bedingung                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Muss-Anforderungen umgesetzt + per M-Szenario geprüft  | alle (Lastenheft §5)                                                         |
| Mindestumfang Lastenheft §9                             | alle 11 Punkte                                                              |
| DB-Objekte produktiv                                   | ≥ je 1 Trigger, Funktion, Prozedur, namentlich genannt                      |
| **Eval-Tabelle**                                       | Refusal Rate **≥ 75 %**, Citation Accuracy **≥ 85 %** (Baseline + System-Prompt) |
| Hardware-Matrix-Bericht                                | ≥ 3 von 4 Konfigurationen dokumentiert                                       |
| Live-Demo                                              | Login → Workspace → Import → Frage → Antwort mit Quellen → Quelle öffnen → Verweigerung |
| Verteilungs-Webseite                                   | erreichbar, mit Doku + Installer-Download                                    |
| Code-Doku (TypeDoc)                                    | unter `docs/api/`, auf der Website verlinkt                                  |

## 5.5 Aktuelle Zielerreichung (Stand 2026-06-14)

Die folgende Einschätzung beruht auf den Projektstatusberichten und dem Repository-Stand. Der **gemessene Erreichungsgrad einzelner Zahlenziele** (z. B. exakte Recall@5- oder Citation-Accuracy-Werte) ist erst nach der ausstehenden GPU-Matrix-Auswertung belastbar (Tabelle 5.5).

**Tabelle 5.5:** Aktuelle Zielerreichung (Stand 2026-06-14).

| Ziel | Stand                                                                                                       | Bewertung |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------- |
| Z-1  | Lokal-/Offline-Architektur umgesetzt; optionaler Ollama-Provider kontaktiert nur eine lokale Instanz        | weitgehend erreicht |
| Z-2  | Import (inkl. DOCX), Workspaces, hybride DE/EN-Suche, Settings umgesetzt                                     | weitgehend erreicht |
| Z-3  | Citations + SourceViewer umgesetzt; exakte Citation-Accuracy aus Eval-Sweep ausstehend                      | umgesetzt, Messung offen |
| Z-4  | Verweigerungslogik (AP-7.4) umgesetzt; exakte Refusal Rate aus Eval-Sweep ausstehend                        | umgesetzt, Messung offen |
| Z-5  | Website online, Installer (Win/Linux) ausgeliefert; Usability-Test mit 3 Erstnutzern und finales Handbuch ausstehend | teilweise erreicht |

> WARN zu verifizieren — Die konkreten Zielwerte (Z-2 Recall@5 ≥ 0,7, Z-3 Citation Accuracy ≥ 85 %, Z-4 Refusal Rate ≥ 95 % bzw. Abnahme-Schwelle ≥ 75 %) sind als gemessene Endwerte noch nicht belegt; sie hängen am Abschluss des AP-E.2-Matrix-Sweeps (Phase 2, offen). Der Erreichungsgrad ist nach Vorliegen des Laborberichts zu aktualisieren.

> WARN durch Team zu ergaenzen — Der Usability-Test mit drei Erstnutzern (Z-5) und der Multi-Hardware-Matrix-Bericht (AP-T.4, ≥ 3 Konfigurationen) sind in den gelesenen Quellen nicht als abgeschlossen belegt und vom Team zu ergänzen.
