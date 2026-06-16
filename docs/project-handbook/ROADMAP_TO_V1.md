# ROADMAP_TO_V1 — lebende To-do-/Reifeliste bis zur gebundenen Abgabe

**Zweck.** Diese Datei ist die **laufend gepflegte** Aufgabenliste, mit der das Handbuch von
**Version 0.1** bis zur **bindefähigen Version 1.0.0** wächst. Sie aggregiert alles Offene
über alle Kategorien hinweg und wird in **jeder Session aktualisiert** (Remember-Disziplin,
siehe [/CLAUDE.md](../../CLAUDE.md)). Das finale Abnahme-Gate vor dem Export bleibt
[RELEASE_AUDIT.md](RELEASE_AUDIT.md); diese Roadmap ist der Weg dorthin.

Stand der Liste: **2026-06-16**.

## Legende

- ☐ offen · ◐ in Arbeit · ☑ erledigt · ⛔ blockiert (Team/Sweep) · 🌿 branch-abhängig
- **Wer:** C = Claude (Doku-Arbeit) · T = Team (Denys/Dominik) · PAG = Projektbetreuung
- Pflege: erledigte Punkte auf ☑ setzen (nicht löschen — Nachvollziehbarkeit), neue unten
  ergänzen; bei jeder Auflösung **Remember-Trigger** ausführen ([/CLAUDE.md](../../CLAUDE.md)).

---

## A. Code-/Inhalts-Korrektheit (Sync mit dem realen Code)

|     | Aufgabe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Wer | Kapitel                       | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------- | ------ |
| A1  | main-Sync auf **v0.4.6** (Delta-Audit, Commit `e5b0227`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | C   | 06/09/11–14/16/18/20/21/23/28 | ☑      |
| A2  | **Branch-Audit** der AP-/Eval-Kapitel gegen ihre Branches (statt main) — **abgeschlossen 2026-06-16**. Genau **eine** Fehlzahl gefunden+korrigiert: Eval-Matrix 360→**315** Zellen, 8→**7** Embedder, 24→**21** Configs (Kap. 11/17/18/19/22/23, Commit `392a1a4`). Verifiziert **korrekt** (keine Änderung): Kap. 15 (`build-lap-dataset.ts`, Gold-Spans, alle 7 `GeneratedQuestion`-Felder); AP-E.1 cases.jsonl=80 (24/56, 48/20/12), Hold-out=15 (4 ref); AP-T.1 Unit-Tests 15/13/3; AP-T.2 Suiten 3/3/1, Korpus 10/60/10. Coverage-%-Werte (Kap. 11.3) stammen aus `test:cov:apt1`-Lauf (abschluss-doku), nicht aus Source ableitbar | C   | 11, 15, 17, 19                | 🌿 ☑   |
| A3  | Erneuter main-Delta-Check vor Abgabe (`git log 783ca4b..main`, HEAD prüfen) — durch B2-Merges jetzt machbar (main auf v0.4.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | C   | techn. Kap.                   | ☐      |
| A4  | Marker-Sweep: jeden `> WARN`-Marker auflösen **oder** bewusst belassen + begründen. **2026-06-16:** Inventar (57 Marker / 26 Dateien) erstellt; **3 merge-bedingte Marker aufgelöst** (Kap. 01 §1.4, 19.8, 24); Rest bewusst **🌿** (AP-E.2-Branch, inhaltlich verifiziert) bzw. **⛔** (Team/B1-GPU-Sweep) belassen                                                                                                                                                                                                                                                                                                                     | C/T | alle                          | ◐      |

## B. Team-/Sweep-abhängig (extern blockiert)

|     | Aufgabe                                                                                                                                                                  | Wer | Kapitel                            | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------- | ------ |
| B1  | **AP-E.2 Phase 2 (GPU-Matrix-Sweep)** durchführen → gemessene Zielwerte (Recall@5, Citation Accuracy, Refusal Rate), finale Matrix-Zellenzahl                            | T   | 05, 11, 15, 17, 19, 22, 24, 25, 26 | ⛔     |
| B2  | **Branch-Merges**: PRs AP-E.1 (#25), AP-T.2 (#19), AP-T.1 (#24) **gemergt 2026-06-16** → AP-Code auf main verifizierbar (löste A2/A3-Blocker); AP-E.1b als **#28** offen | T   | 10, 11, 19, 24                     | ☑      |
| B3  | **Externe Tools** Vikunja/Outline: Board-Aufbau, Task-Nrn., Wiki-Hierarchie als Export/Screenshot                                                                        | T   | 08, 10, 25                         | ⛔     |
| B4  | Usability-Test (3 Erstnutzer) + Multi-Hardware-Matrix-Bericht (AP-T.4)                                                                                                   | T   | 05, 19                             | ⛔     |
| B5  | **OPEN_QUESTIONS_FOR_TEAM** (26 Fragen) beantworten                                                                                                                      | T   | div.                               | ◐      |

## C. Formaler Apparat / Buch-Bausteine

|     | Aufgabe                                                                                                                                                                                                                                                                                                                                                                                                                           | Wer | Datei                                      | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------ | ------ |
| C1  | **Kurzfassung** finalisieren (Ergebniszahlen nach B1) + optional EN-Abstract                                                                                                                                                                                                                                                                                                                                                      | C/T | `front_10_kurzfassung.md`                  | ◐      |
| C2  | **Literaturverzeichnis**: Paper-/Norm-Detailangaben am Original verifizieren (`[6]`–`[8]`, `[17]`–`[26]`); Nummerierung auf Erscheinungsreihenfolge konsolidieren. **2026-06-16:** wissenschaftliche Quellen ([6]–[8], [17]–[26]) gegen Originale verifiziert (8/9 korrekt); **[17] BGE-M3 korrigiert** (Autoren J. Chen et al., Titel „M3-Embedding…Self-Knowledge Distillation"), [24] Seiten ergänzt. Renumbering → v1.0-Audit | C   | `back_10_literaturverzeichnis.md`          | ◐      |
| C3  | **Abkürzungsverzeichnis** gegen den finalen Text abgleichen — **2026-06-16:** 8 fehlende Standard-Akronyme (CPU/PDF/DOCX/API/SEO/YAML/UTF-8/KI) ergänzt; Voll-Abgleich + Karteileichen beim v1.0-Audit                                                                                                                                                                                                                            | C   | `front_20_abkuerzungsverzeichnis.md`       | ◐      |
| C4  | **Selbstständigkeitserklärung**: Wortlaut + KI-Hinweis gem. LBS4-Vorgabe, Name/Datum/Unterschrift                                                                                                                                                                                                                                                                                                                                 | T   | `back_20_selbststaendigkeitserklaerung.md` | ⛔     |
| C5  | `mammoth [15]` aus der Tabellenzelle (Kap. 10) in Fließtext verschoben (Kap. 10) — **erledigt 2026-06-16**                                                                                                                                                                                                                                                                                                                        | C   | 10                                         | ☑      |

## D. Konsistenz / Stil

|     | Aufgabe                                                                                                                                                | Wer | Status                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------ |
| D1  | **Stand-Daten** vereinheitlichen: Status-Snapshot (2026-06-14) vs. Dokument-/Code-Stand sauber trennen; Einzel-Stand-Zeilen (z. B. Kap. 21) angleichen | C   | ◐                                    |
| D2  | Terminologie gegen [TERMINOLOGY.md](TERMINOLOGY.md) final prüfen (z. B. „Denys", Versionsschreibweisen) — **2026-06-16 verifiziert: keine Verstöße**   | C   | ☑                                    |
| D3  | Volle [STYLE_GUIDE.md](STYLE_GUIDE.md)-Konformität aller Kapitel (Kapitelschablone, Tempus/Person)                                                     | C   | ☐                                    |
| D4  | Nummerierung/Beschriftungen final prüfen (alle `K.M`, `Tabelle/Abbildung K.n`)                                                                         | C   | ☑ (Stand 06-16, vor Abgabe re-check) |

## E. Export / Bindung

|     | Aufgabe                                                                                                                                                                   | Wer | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| E1  | **Mermaid-Diagramme** → SVG nach `assets/` rendern — **2026-06-16: 15/15 gerendert** (mmdc 11.15; Kap.-21-Kanten-Label gequotet). Kapitel-`.md` behalten inline-`mermaid` | C/T | ☑      |
| E2  | **Probebuild** über [BOOK_MANIFEST.md](BOOK_MANIFEST.md) (Pandoc/typst) fehlerfrei; Front-/Schlussteil unnummeriert, Verzeichnisse erzeugt                                | T   | ☐      |
| E3  | Sichtprüfung gerendertes PDF (Deckblatt, Seitenzahlen, Umlaute, Diagramme)                                                                                                | T   | ☐      |

## F. Sicherheit / Anonymisierung

|     | Aufgabe                                                                                                                                    | Wer | Status                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- | --------------------- |
| F1  | **Secret-Sweep** final über alle Handbuch-Dateien inkl. `assets/` ([SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md)) — 0 Treffer | C   | ◐ (laufend 0 Treffer) |
| F2  | Finaler Sensitivdaten-Blick auf das **gerenderte PDF** (Bilder)                                                                            | T   | ☐                     |

## G. v1.0-Release

|     | Aufgabe                                                          | Wer | Status |
| --- | ---------------------------------------------------------------- | --- | ------ |
| G1  | [RELEASE_AUDIT.md](RELEASE_AUDIT.md) vollständig abgehakt        | C/T | ☐      |
| G2  | Version-Bump Handbuch **0.1 → 1.0.0** (Cover, README, Fußzeilen) | C   | ☐      |
| G3  | Push/PR (nur mit ausdrücklichem OK; nie zu `main` mergen)        | T   | ⛔     |

---

## Nächste 3 sinnvolle Schritte (ohne Team-Blocker)

1. **C2** Literaturverzeichnis-Quellen verifizieren (Web-Recherche gegen Original).
2. **A2** Branch-Audit von Kap. 17/15 gegen `dom/ap-e2-matrix-eval` (statt main).
3. **D1/D2** Stand-Daten + Terminologie vereinheitlichen.

> Diese Liste ist **lebendig**: sie wächst und schrumpft mit dem Projekt. „Perfekt" heißt
> hier: jeder Punkt entweder ☑ oder bewusst als ⛔/🌿 dokumentiert — kein verdeckter
> Rückstand.
