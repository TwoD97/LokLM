# LokLM — Projekthandbuch

**Lokaler KI-Wissensassistent mit Quellenverifikation**

Stand: **2026-06-16** · Handbuch-Version **0.1** · Projektstand nach ca. 9 Wochen Projektarbeit; technische Kapitel mit `main` (v0.4.7) abgeglichen. Die Deliverables AP-E.1/T.1/T.2 sind nach `main` gemergt (PRs #25/#24/#19, 16.06.); AP-E.1b (#28) und die AP-E.2-Matrix (`dom/ap-e2-matrix-eval`) liegen noch auf Feature-Branches — siehe Marker in Kap. 11/15/17/19.

> 🚧 **Entwicklungsstand — in Arbeit.** Dieses Handbuch ist ein **lebendes Dokument** und entsteht **während** der laufenden Projektentwicklung. Der vorliegende Stand ist eine **datierte Momentaufnahme**; eine **finale Durchsicht und Konsolidierung steht noch aus** (offene Punkte: [HANDBOOK_STATUS.md](HANDBOOK_STATUS.md) und [OPEN_QUESTIONS_FOR_TEAM.md](OPEN_QUESTIONS_FOR_TEAM.md)). Erst nach dieser Schluss-Durchsicht erfolgen Export/Bindung und eine etwaige Veröffentlichung. Bis dahin bleibt alles lokal.

---

## Kurzbeschreibung

Dieses Projekthandbuch beschreibt das Projekt **LokLM** — eine lokale, offline lauffähige
Desktop-Anwendung (Electron), mit der Benutzer eigene Dokumente (PDF, Markdown, Text,
Quellcode, optional DOCX) importieren, in Arbeitsbereichen organisieren und über eine
Chat-Oberfläche befragen können. Jede Antwort enthält klickbare **Quellenverweise** auf
die zugrundeliegenden Textstellen; findet sich keine passende Quelle, verweigert das
System ehrlich, statt zu erfinden. Die Anwendung arbeitet im Standardbetrieb vollständig
lokal (lokales Sprachmodell + In-Process-Datenbank); eine Internetverbindung ist nur
einmalig für Installation und First-Launch-Modell-Download erforderlich.

Das Handbuch ergänzt die beiden Vertragsdokumente — **Lastenheft** und **Pflichtenheft** —
um eine durchgängige, erzählende Darstellung des realen Umsetzungsstands (abgeleitet aus
Quellcode, ADRs, Feature-Specs und den wöchentlichen Projektstatusberichten). Es bildet
einen **Projektstand** (Momentaufnahme einer laufenden Arbeit) ab, kein abgeschlossenes
Endprodukt. Eine spätere gebundene PDF-/Buch-Version konsolidiert den finalen Stand für
die Schul-Abgabe.

---

## Inhaltsverzeichnis

### Hauptkapitel (00–28)

| Kap. | Datei                                                                                            | Inhalt                                                        |
| ---- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 00   | [00_cover.md](00_cover.md)                                                                       | Deckblatt: Projekt-, Team-, Repository-Angaben                |
| 01   | [01_preface_and_document_purpose.md](01_preface_and_document_purpose.md)                         | Vorwort, Zweck, Zielgruppe, Marker-Konvention, Anonymisierung |
| 02   | [02_management_summary.md](02_management_summary.md)                                             | Management Summary: was gebaut wurde, offene Punkte           |
| 03   | [03_project_assignment.md](03_project_assignment.md)                                             | Projektauftrag, Rahmen, Deliverables, Abgrenzung              |
| 04   | [04_initial_situation_and_problem.md](04_initial_situation_and_problem.md)                       | Ausgangslage, Problemstellung (Cloud-LLM vs. Lokalität)       |
| 05   | [05_project_goals_and_success_criteria.md](05_project_goals_and_success_criteria.md)             | Haupt-/Neben-/Nicht-Ziele (SMART), Erfolgs-/Abnahmekriterien  |
| 06   | [06_project_scope_and_boundaries.md](06_project_scope_and_boundaries.md)                         | Projektumfang, Scope-Erweiterungen, Plattform-Abgrenzung      |
| 07   | [07_team_roles_and_responsibilities.md](07_team_roles_and_responsibilities.md)                   | Team, Rollen, AP-Zuordnung, Team-Regeln                       |
| 08   | [08_project_management_kanban_outline.md](08_project_management_kanban_outline.md)               | Projektmanagement: Vikunja-Kanban + Outline-Wiki + GitHub     |
| 09   | [09_versioning_and_github_workflow.md](09_versioning_and_github_workflow.md)                     | Versionierung, Branch-/PR-/Tag-Strategie, CI/CD               |
| 10   | [10_work_package_landscape.md](10_work_package_landscape.md)                                     | Arbeitspaket-Landkarte (alle APs, Status, Nachweise)          |
| 11   | [11_work_package_details.md](11_work_package_details.md)                                         | Arbeitspaket-Details (Kern-APs ausführlich)                   |
| 12   | [12_system_overview.md](12_system_overview.md)                                                   | Systemüberblick: Module, Use-Cases, Übersichtsdiagramm        |
| 13   | [13_system_architecture.md](13_system_architecture.md)                                           | Technische Architektur: Schichten, IPC, Datenflüsse, ADRs     |
| 14   | [14_components_and_modules.md](14_components_and_modules.md)                                     | Komponenten/Module (Services im Detail)                       |
| 15   | [15_data_pipeline.md](15_data_pipeline.md)                                                       | Datenpipeline + Eval-Datensätze (LAP-Korpus, Gold-Spans)      |
| 16   | [16_rag_ai_pipeline.md](16_rag_ai_pipeline.md)                                                   | RAG-/KI-Pipeline: Routing, Retrieval, Refusal, Provider       |
| 17   | [17_eval_matrix.md](17_eval_matrix.md)                                                           | Eval-Matrix: Achsen, Metriken, Judge, 2-Pass-Sweep            |
| 18   | [18_model_selection_and_open_source_licenses.md](18_model_selection_and_open_source_licenses.md) | Modellauswahl + Open-Source-Lizenzen (License-Gate)           |
| 19   | [19_testing_and_quality_assurance.md](19_testing_and_quality_assurance.md)                       | Testing & QA: Testpyramide, Coverage, CI, Lücken              |
| 20   | [20_deployment_operation_and_runtime.md](20_deployment_operation_and_runtime.md)                 | Deployment, Betrieb, Laufzeit, Installer, RunPod              |
| 21   | [21_security_privacy_and_sensitive_data.md](21_security_privacy_and_sensitive_data.md)           | Sicherheit, Datenschutz, sensible Daten (Vault, Härtung)      |
| 22   | [22_risks_problems_and_mitigations.md](22_risks_problems_and_mitigations.md)                     | Risiken, Probleme und Gegenmaßnahmen (R1–R16)                 |
| 23   | [23_decision_log.md](23_decision_log.md)                                                         | Decision Log (ADRs + Prozess-/Tooling-Entscheidungen)         |
| 24   | [24_current_status_after_9_weeks.md](24_current_status_after_9_weeks.md)                         | Aktueller Status nach 9 Wochen (Reifegrade)                   |
| 25   | [25_backlog_and_roadmap.md](25_backlog_and_roadmap.md)                                           | Backlog und Roadmap (priorisiert)                             |
| 26   | [26_lessons_learned.md](26_lessons_learned.md)                                                   | Lessons Learned (technisch, PM, Architektur, KI)              |
| 27   | [27_glossary.md](27_glossary.md)                                                                 | Glossar                                                       |
| 28   | [28_appendix.md](28_appendix.md)                                                                 | Anhang (Befehle, Pfade, Quellen, Matrix-Referenz)             |

### Front-/Schlussteil (gebundene Fassung)

Diese Teile umrahmen den Hauptteil in der gebundenen Version (Reihenfolge: siehe
[BOOK_MANIFEST.md](BOOK_MANIFEST.md)). Inhaltsverzeichnis, Abbildungs- und
Tabellenverzeichnis werden beim Export automatisch erzeugt.

| Teil        | Datei                                                                                | Inhalt                                       |
| ----------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| Frontteil   | [front_10_kurzfassung.md](front_10_kurzfassung.md)                                   | Kurzfassung / Abstract                       |
| Frontteil   | [front_20_abkuerzungsverzeichnis.md](front_20_abkuerzungsverzeichnis.md)             | Abkürzungsverzeichnis                        |
| Schlussteil | [back_10_literaturverzeichnis.md](back_10_literaturverzeichnis.md)                   | Literaturverzeichnis (externe Quellen, IEEE) |
| Schlussteil | [back_20_selbststaendigkeitserklaerung.md](back_20_selbststaendigkeitserklaerung.md) | Selbstständigkeitserklärung                  |

### Steuerdateien (Handbuch-Verwaltung)

| Datei                                                      | Zweck                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [README.md](README.md)                                     | Diese Startseite (Titel, Inhaltsverzeichnis, Lesehinweis)               |
| [STYLE_GUIDE.md](STYLE_GUIDE.md)                           | Stil-, Struktur- und Belegregeln (akademische Konventionen)             |
| [TERMINOLOGY.md](TERMINOLOGY.md)                           | Begriffs-/Schreibweisen-Register (kanonische Schreibweisen)             |
| [BOOK_MANIFEST.md](BOOK_MANIFEST.md)                       | Bind-Reihenfolge der gebundenen Fassung                                 |
| [HANDBOOK_STATUS.md](HANDBOOK_STATUS.md)                   | Kapitelweise Statusübersicht (begonnen/teilweise/vollständig/zu prüfen) |
| [SOURCE_MAP.md](SOURCE_MAP.md)                             | Quellenkarte (interne Provenienz → Kapitel, Vertrauensgrad)             |
| [OPEN_QUESTIONS_FOR_TEAM.md](OPEN_QUESTIONS_FOR_TEAM.md)   | Gezielte Rückfragen ans Team                                            |
| [SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md) | Sensitivdaten-Checkliste + Secret-Sweep-Befund                          |
| [EXPORT_NOTES.md](EXPORT_NOTES.md)                         | Export-Anleitung (Markdown → PDF/Buch)                                  |
| [ROADMAP_TO_V1.md](ROADMAP_TO_V1.md)                       | Lebende To-do-/Reifeliste bis zur gebundenen v1.0.0                     |
| [RELEASE_AUDIT.md](RELEASE_AUDIT.md)                       | v1.0.0-Audit-Checkliste vor der Bindung                                 |

---

## Lesehinweis: Bedeutung der Marker

Wo der Umsetzungsstand offen, unklar oder noch nicht belegbar ist, steht im Fließtext
genau **ein Marker als eigene Blockquote-Zeile**. Solche Marker sind ein
**Ehrlichkeits-Instrument**: Sie kennzeichnen, dass eine Aussage durch das Team zu
bestätigen oder durch eine Quelle zu belegen ist, statt einen falschen Anschein von
Vollständigkeit zu erwecken. Die verwendeten Marker (eingeleitet mit `> WARN …` bzw.
`> ⚠️ …` in einzelnen Kapiteln) bedeuten:

| Marker                      | Bedeutung                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Status unklar**           | Der Stand ist zum Handbuchstand nicht eindeutig; vor Abgabe zu klären.                               |
| **zu verifizieren**         | Aussage plausibel, aber gegen Quelle/Team gegenzuprüfen (oft Zahlen/Versionen).                      |
| **durch Team zu ergaenzen** | Information liegt außerhalb des Repos (extern/Partner-Domäne) und muss vom Team beigesteuert werden. |
| **Annahme, bitte pruefen**  | Begründete Annahme aus den Quellen; vom Team zu bestätigen.                                          |
| **Quelle fehlt**            | Es existiert keine belegbare Repo-Quelle; nur Projektangabe.                                         |

> **Anonymisierung:** Aus Sicherheits-/Datenschutzgründen enthält das Handbuch keine
> sensiblen Daten. Schlüssel/Tokens stehen als `<API_KEY>` / `<S3_KEY>` / `<TOKEN>`,
> interne Dienst-Domains als `<PRIVATE_DOMAIN>`, persönliche E-Mail-Adressen als
> `<EMAIL>`, absolute lokale Pfade als `<INTERNAL_PATH>`. Kurze repo-relative Pfade
> (z. B. `src/main/services/`) sind erlaubt und erwünscht. Details siehe
> [SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md).

---

## Verweise auf die Vertragsdokumente

Dieses Handbuch ergänzt die beiden Anforderungsdokumente und ist mit ihnen gemeinsam zu
lesen:

- **Lastenheft** → [../Lastenheft.md](../Lastenheft.md) (Was wird gefordert? Auftrag, Ziele, Soll-Anforderungen.)
- **Pflichtenheft** → [../Pflichtenheft.md](../Pflichtenheft.md) (Wie wird es umgesetzt? Architektur, Datenmodell, Testkonzept, Abnahmekriterien.)

Weitere Provenienz: Architecture Decision Records unter [../adr/](../adr/), Feature-Specs
unter [../specs/](../specs/), Software-Lizenzen unter [../licenses.md](../licenses.md).
Interne Steuer-/Arbeitsdokumente (Projektstatusberichte, Laborberichte,
AP-Abschluss-Dokus) liegen unter `docs/work/` und sind bewusst gitignored.

---

_Projekthandbuch LokLM · Version 0.1 · Stand 2026-06-16_
