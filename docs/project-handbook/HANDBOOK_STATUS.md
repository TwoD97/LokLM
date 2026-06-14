# HANDBOOK_STATUS

Kapitelweiser Status des Projekthandbuchs, abgeleitet aus dem **tatsächlichen
Dateiinhalt** (Stand 2026-06-14). Alle 29 Hauptkapitel (00–28) sind inhaltlich
geschrieben; „zu pruefen" markiert Kapitel, deren Aussagen substanziell stehen, aber an
offenen Markern (Team-Bestätigung, ausstehender GPU-Sweep, Versions-/Zahlen-Klärung)
hängen.

## Legende

- **Status:** `leer` = keine Inhalte · `begonnen` = Gerüst/Stub · `teilweise` = Kern
  vorhanden, Abschnitte offen · `vollstaendig` = inhaltlich geschlossen, belegt ·
  `zu pruefen` = inhaltlich vollständig, aber offene Marker/Team-Bestätigung ausstehend.
- **Quelle vorhanden?** Ob belegbare Repo-/Projekt-Quellen für das Kapitel existieren.
- **Prioritaet:** Dringlichkeit der noch offenen Punkte vor der gebundenen Abgabe.

## Statusübersicht

| Kap. | Titel | Status | Quelle vorhanden? | Offene Fragen | Prio |
| --- | --- | --- | --- | --- | --- |
| 00 | Deckblatt | vollstaendig | ja (Lasten-/Pflichtenheft, Statusberichte) | Schreibweise Vorname Projekt-Owner („Denys" vs. „Denis"); v0.4.2-Tag | mittel |
| 01 | Vorwort & Zweck | vollstaendig | ja (eigene Festlegung + Quellen) | — | niedrig |
| 02 | Management Summary | zu pruefen | ja (Statusberichte) | Release-Bereich v0.4.2 unbestätigt; interne Domains | mittel |
| 03 | Projektauftrag | zu pruefen | ja (Lasten-/Pflichtenheft) | Transkription als bewusste Scope-Erweiterung einordnen | mittel |
| 04 | Ausgangslage & Problem | zu pruefen | ja (Lastenheft, Statusbericht) | Org-Auswirkungen Partnerausfall KW 23 | niedrig |
| 05 | Ziele & Erfolgskriterien | zu pruefen | ja (Pflichtenheft §1.2/§11) | gemessene Zielwerte (Recall@5/Citation/Refusal) hängen am Eval-Sweep; Usability-Test + HW-Matrix | hoch |
| 06 | Umfang & Abgrenzung | zu pruefen | ja (Lastenheft §5/§10, Pflichtenheft §1.3) | Status von Transkription/Quiz als v1-Liefergegenstand | mittel |
| 07 | Team, Rollen | zu pruefen | ja (Pflichtenheft §9.2, Statusberichte) | Patt-Entscheidungsfall; Vorname-Schreibweise | mittel |
| 08 | Projektmanagement (Kanban/Outline) | zu pruefen | teilweise (in-Repo-Spiegelung belegbar; Board/Wiki extern) | Board-Aufbau, Outline-Hierarchie, Prioritätsskala, exakte Task-Nrn. — extern | hoch |
| 09 | Versionierung & GitHub | zu pruefen | ja (Git-/PR-/Tag-Historie) | Rolle von `development`; v0.4.2 Tag vs. Commit | mittel |
| 10 | AP-Landkarte | zu pruefen | ja (Abschluss-Dokus + Commits/PRs) | Partner-AP-Benennung aus Commits rekonstruiert (Vikunja-Bestätigung) | mittel |
| 11 | AP-Details | zu pruefen | ja (Abschluss-Dokus, ADRs, Commits) | AP-E.2 Phase-2-Lauf-/Auswertungsstand; Partner-Implementierungsdetails | hoch |
| 12 | Systemüberblick | vollstaendig | ja (Quellcode-Belege) | — | niedrig |
| 13 | Technische Architektur | zu pruefen | ja (Quellcode, ADRs) | IPC-Handler-Gesamtzahl (~105, ungezählt); ADR-0004-Implementierungsstand | niedrig |
| 14 | Komponenten & Module | vollstaendig | ja (src/main/services-Belege) | — | niedrig |
| 15 | Datenpipeline & Eval-Daten | zu pruefen | teilweise (LAP-Korpus/Fragen gitignored) | Kennzahlen ~90 Docs / 2.322 Chunks / 163 Fragen aus Projektangabe, nachzuzählen | hoch |
| 16 | RAG-/KI-Pipeline | vollstaendig | ja (Quellcode-Belege) | — | niedrig |
| 17 | Eval-Matrix | zu pruefen | ja (Code/Packs) | Zellenzahl 360 vs. 399 Design; GPU-Sweep (Phase 2) offen; „72"-Kommentar im Code veraltet | hoch |
| 18 | Modellauswahl & Lizenzen | zu pruefen | ja (License-Registry verifiziert 2026-06-14) | Re-Prüfung der Registry vor Abgabe; einzelne technische Caveats | mittel |
| 19 | Testing & QA | zu pruefen | ja (Test-READMEs, Abschluss-Dokus) | M-Szenarien nicht protokolliert; CI-Test-Job hängt an PR #19; Coverage-Gate | hoch |
| 20 | Deployment & Laufzeit | zu pruefen | ja (package.json, Installer-README) | RunPod-Betriebsdetails extern; AP-E.2-Sweep offen | mittel |
| 21 | Sicherheit & Datenschutz | zu pruefen | ja (ADR-0001/0002, .gitignore, .env.example) | Fuses-/CSP-Detailaufstellung (Partner-Domäne); fehlendes DSGVO-Verzeichnis | mittel |
| 22 | Risiken & Gegenmaßnahmen | zu pruefen | ja (Statusberichte, ADRs, Memory) | R8/R6 (Phase-2-Sweep, Rechenkosten) offen | hoch |
| 23 | Decision Log | zu pruefen | ja (ADRs, Statusberichte) | 360- vs. 399-Zellen; final gefahrener Abgabe-Scope | mittel |
| 24 | Status nach 9 Wochen | zu pruefen | ja (Statusbericht 2026-06-14) | AP-E.2 Phase 2; Dependabot-PRs; gitignored-Quellen | hoch |
| 25 | Backlog & Roadmap | zu pruefen | ja (Statusbericht „Nächste Schritte") | endgültige Matrix-Zellenzahl; Vikunja-Task-Nr. AP-E.1; Outline-Status | hoch |
| 26 | Lessons Learned | zu pruefen | ja (Laborberichte, Abschluss-Dokus) | quantitative Bestätigung „Größe ≠ Qualität" hängt am Sweep | niedrig |
| 27 | Glossar | vollstaendig | ja | optionale weitere projektinterne Kürzel | niedrig |
| 28 | Anhang | zu pruefen | ja (package.json) | EXPORT_NOTES jetzt angelegt (Verweis aktualisierbar) | niedrig |

## Querschnitt: dominierende offene Punkte

Ein einziger Block zieht sich durch die meisten „zu pruefen"-Kapitel und ist der
wichtigste Treiber vor der gebundenen Abgabe:

1. **AP-E.2 Phase 2 (GPU-Matrix-Sweep) offen** → betrifft Kap. 05, 11, 15, 17, 19, 20,
   22, 24, 25, 26. Erst nach dem Sweep sind die gemessenen Zielwerte und die finale
   Matrix-Zellenzahl belastbar.
2. **Externe Werkzeuge (Vikunja/Outline) nicht aus dem Repo rekonstruierbar** →
   betrifft Kap. 08, 10, 25 (Board-Detailverlauf, exakte Task-Nrn., Status-„fertig").
3. **Versions-/Benennungs-Klärungen** → v0.4.2-Tag (Kap. 02, 09), Vorname Projekt-Owner
   (Kap. 00, 07).
4. **CI-/Test-Verankerung** → vitest-CI-Job hängt an Merge von PR #19 (Kap. 19, 22, 24).

## Gesamteinschätzung

Das Handbuch ist **inhaltlich vollständig geschrieben** (alle 29 Hauptkapitel + 6
Steuerdateien). Kein Kapitel ist `leer`, `begonnen` oder `teilweise` im Sinne fehlender
Inhalte. Die durchgängige `zu pruefen`-Einstufung spiegelt die bewusste Ehrlichkeit der
Marker-Konvention wider: Die Aussagen stehen, sind aber an wenigen, klar benannten
Stellen vor der finalen Abgabe durch das Team zu bestätigen — insbesondere nach Abschluss
des AP-E.2-Sweeps.
