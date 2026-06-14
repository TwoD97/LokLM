# BOOK_MANIFEST

Verbindliche **Bind-Reihenfolge** der gebundenen Fassung. Diese Datei — nicht der nackte
Glob `[0-2][0-9]_*.md` — bestimmt, welche Dateien in welcher Reihenfolge in die
PDF-/Buch-Fassung einfließen. So lassen sich **Front- und Schlussteil** ohne Umnummerierung
der festnummerierten Kapitel `00`–`28` einbinden. Stand: **2026-06-14**.

Build-Anleitung und Werkzeuge: [EXPORT_NOTES.md](EXPORT_NOTES.md).

---

## Frontteil (römische Seitenzahlen)

| # | Datei | Inhalt |
| --- | --- | --- |
| 1 | [00_cover.md](00_cover.md) | Titel-/Deckblatt |
| 2 | [front_10_kurzfassung.md](front_10_kurzfassung.md) | Kurzfassung / Abstract |
| 3 | *(automatisch)* | Inhaltsverzeichnis (`--toc`) |
| 4 | *(automatisch)* | Abbildungsverzeichnis (`\listoffigures`) |
| 5 | *(automatisch)* | Tabellenverzeichnis (`\listoftables`) |
| 6 | [front_20_abkuerzungsverzeichnis.md](front_20_abkuerzungsverzeichnis.md) | Abkürzungsverzeichnis |

## Hauptteil (arabische Seitenzahlen)

In numerischer Reihenfolge `01` … `28` (das Deckblatt `00` steht bereits im Frontteil):

```
01_preface_and_document_purpose · 02_management_summary · 03_project_assignment ·
04_initial_situation_and_problem · 05_project_goals_and_success_criteria ·
06_project_scope_and_boundaries · 07_team_roles_and_responsibilities ·
08_project_management_kanban_outline · 09_versioning_and_github_workflow ·
10_work_package_landscape · 11_work_package_details · 12_system_overview ·
13_system_architecture · 14_components_and_modules · 15_data_pipeline ·
16_rag_ai_pipeline · 17_eval_matrix · 18_model_selection_and_open_source_licenses ·
19_testing_and_quality_assurance · 20_deployment_operation_and_runtime ·
21_security_privacy_and_sensitive_data · 22_risks_problems_and_mitigations ·
23_decision_log · 24_current_status_after_9_weeks · 25_backlog_and_roadmap ·
26_lessons_learned · 27_glossary · 28_appendix
```

## Schlussteil

| # | Datei | Inhalt |
| --- | --- | --- |
| 1 | [back_10_literaturverzeichnis.md](back_10_literaturverzeichnis.md) | Literaturverzeichnis (externe Quellen, IEEE) |
| 2 | [back_20_selbststaendigkeitserklaerung.md](back_20_selbststaendigkeitserklaerung.md) | Selbstständigkeitserklärung |

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
