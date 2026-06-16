# BOOK_MANIFEST

Verbindliche **Bind-Reihenfolge** der gebundenen Fassung. Diese Datei — nicht der nackte
Glob `[0-2][0-9]_*.md` — bestimmt, welche Dateien in welcher Reihenfolge in die
PDF-/Buch-Fassung einfließen. So lassen sich **Front- und Schlussteil** ohne Umnummerierung
der festnummerierten Kapitel `00`–`28` einbinden. Stand: **2026-06-14**.

Build-Anleitung und Werkzeuge: [EXPORT_NOTES.md](EXPORT_NOTES.md).

---

## Frontteil (römische Seitenzahlen)

| #   | Datei                                                                    | Inhalt                                   |
| --- | ------------------------------------------------------------------------ | ---------------------------------------- |
| 1   | [00_cover.md](00_cover.md)                                               | Titel-/Deckblatt                         |
| 2   | [front_10_kurzfassung.md](front_10_kurzfassung.md)                       | Kurzfassung / Abstract                   |
| 3   | _(automatisch)_                                                          | Inhaltsverzeichnis (`--toc`)             |
| 4   | _(automatisch)_                                                          | Abbildungsverzeichnis (`\listoffigures`) |
| 5   | _(automatisch)_                                                          | Tabellenverzeichnis (`\listoftables`)    |
| 6   | [front_20_abkuerzungsverzeichnis.md](front_20_abkuerzungsverzeichnis.md) | Abkürzungsverzeichnis                    |

## Hauptteil (arabische Seitenzahlen)

Die festnummerierten Kapitel `01`…`28` (das Deckblatt `00` steht im Frontteil) werden in
**acht Teilen** gebunden. Die Teil-Überschriften werden beim Export als Trennseiten vor die
jeweilige Kapitelgruppe gesetzt; **die Kapitelnummern bleiben unverändert** (rein bindungs-
seitige Gliederung).

| Teil     | Titel                                    | Kapitel (in numerischer Reihenfolge)                                                                                                              |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I**    | Einführung & Projektrahmen               | 01 Vorwort & Zweck · 02 Management Summary · 03 Projektauftrag · 04 Ausgangslage & Problem · 05 Ziele & Erfolgskriterien · 06 Umfang & Abgrenzung |
| **II**   | Projektorganisation, Planung & Steuerung | 07 Team, Rollen & Ressourcen · 08 Projektmanagement (Kanban, Meilenstein-, Zeit-/GANTT-, Netz- & Kostenplan) · 09 Versionierung & GitHub          |
| **III**  | Arbeitspakete                            | 10 AP-Landkarte (PSP) · 11 AP-Details (AP-Spezifikation)                                                                                          |
| **IV**   | System & technische Architektur          | 12 Systemüberblick · 13 Architektur · 14 Komponenten & Module                                                                                     |
| **V**    | Daten, KI-Pipeline, Eval & Modelle       | 15 Datenpipeline · 16 RAG-/KI-Pipeline · 17 Eval-Matrix · 18 Modellauswahl & Lizenzen                                                             |
| **VI**   | Qualität, Sicherheit & Betrieb           | 19 Testing & QA · 20 Deployment & Betrieb · 21 Sicherheit & Datenschutz                                                                           |
| **VII**  | Risiken, Entscheidungen & Abschluss      | 22 Risiken · 23 Decision Log · 24 Status & Projektabschlussbericht · 25 Backlog & Roadmap · 26 Lessons Learned                                    |
| **VIII** | Referenzen                               | 27 Glossar · 28 Anhang                                                                                                                            |

## Schlussteil

| #   | Datei                                                                                | Inhalt                                       |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | [back_10_literaturverzeichnis.md](back_10_literaturverzeichnis.md)                   | Literaturverzeichnis (externe Quellen, IEEE) |
| 2   | [back_20_selbststaendigkeitserklaerung.md](back_20_selbststaendigkeitserklaerung.md) | Selbstständigkeitserklärung                  |

---

## Nicht Teil der gebundenen Fassung (interne Verwaltung)

`README.md`, `HANDBOOK_STATUS.md`, `SOURCE_MAP.md`, `OPEN_QUESTIONS_FOR_TEAM.md`,
`SENSITIVE_DATA_CHECKLIST.md`, `EXPORT_NOTES.md`, `STYLE_GUIDE.md`, `TERMINOLOGY.md`,
`BOOK_MANIFEST.md`, `RELEASE_AUDIT.md`.

Optional als zusätzlicher Anhang aufnehmbar: `SOURCE_MAP.md` und/oder
`OPEN_QUESTIONS_FOR_TEAM.md` (Entscheidung beim Audit).

---

## Pflege

- Wird ein Kapitel oder eine Front-/Schlussteil-Datei hinzugefügt/entfernt, **hier zuerst**
  eintragen, dann [README.md](README.md)-Inhaltsverzeichnis und
  [HANDBOOK_STATUS.md](HANDBOOK_STATUS.md) angleichen.
- Das [v1.0.0-Audit](RELEASE_AUDIT.md) prüft, dass Manifest, README-TOC und tatsächliche
  Dateien deckungsgleich sind.
