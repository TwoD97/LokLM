# CLAUDE.md — Arbeitsregeln für den Handbuch-Worktree

Dieser Worktree (`dom/doku`) ist **ausschließlich** dem LokLM-Projekthandbuch unter
[docs/project-handbook/](docs/project-handbook/) gewidmet. Diese Datei ist die
**verbindliche Verhaltensquelle** für jede Session, die hier arbeitet. Ausführliche
Konventionen stehen im [Style Guide](docs/project-handbook/STYLE_GUIDE.md); diese Datei
fasst die Regeln zusammen, die immer gelten.

## Mission & Lebenszyklus

Das Handbuch ist ein **lebendes Dokument**, das **mitwächst** bis Handbuch-Version
**v1.0.0**. Danach: **Audit-/Aktualisierungs-Check** ([RELEASE_AUDIT.md](docs/project-handbook/RELEASE_AUDIT.md))
→ **Bindung** (PDF/Buch für die Schul-Abgabe). Ziel ist ein **fachlich kompetentes,
abschlussarbeits-/„doktorarbeits"-ähnliches, bindefähiges** Werk.

Jede Aussage ist entweder **belegt** (Repo-Pfad oder Literaturverzeichnis) oder **markiert**
(Marker-Konvention). Niemals Vollständigkeit vortäuschen; niemals Fakten erfinden.

## Sprache & wissenschaftlicher Stil

- Durchgängig **sachliches Hochdeutsch**, technisch präzise.
- **Keine 1. Person Singular** („ich"). „Wir" nur für bewusste Team-Entscheidungen, sonst
  unpersönlich/Passiv.
- **Tempus:** Präsens für System-/Sachbeschreibung; Präteritum/Perfekt für Projektverlauf.
- **Abkürzungen** bei Ersterwähnung ausschreiben, z. B. „Inter-Process Communication (IPC)";
  danach das Kürzel. Aufnahme ins [Abkürzungsverzeichnis](docs/project-handbook/front_20_abkuerzungsverzeichnis.md).
- **Deutsche Zahlschreibung** (Dezimalkomma, Tausenderpunkt: `2.322`) und deutsche
  Anführungszeichen „…".
- **Fachterminologie konsistent** halten — verbindliche Schreibweisen im
  [TERMINOLOGY.md](docs/project-handbook/TERMINOLOGY.md). Englische Fachbegriffe bei
  Ersterwähnung kursiv.

## Quellen- & Zitierdisziplin

- **Interne Fakten** (Code, ADRs, committete Docs) mit **Repo-Dateipfad** belegen
  (z. B. `src/main/services/`); Provenienz und Vertrauensgrad in
  [SOURCE_MAP.md](docs/project-handbook/SOURCE_MAP.md).
- **Externe Quellen** (Tools, Standards, Bibliotheks-/Framework-Doku, Normen, Paper) im
  **IEEE-numerischen Stil** `[n]` zitieren → Eintrag im
  [Literaturverzeichnis](docs/project-handbook/back_10_literaturverzeichnis.md).
- Regeln im Detail: [Style Guide → Zitierweise](docs/project-handbook/STYLE_GUIDE.md).

## Marker-Disziplin

Wo der Stand offen, unklar oder unbelegt ist, steht genau **ein Marker als eigene
Blockquote-Zeile** (Ehrlichkeits-Instrument), z. B.:

```text
> WARN Status unklar
> WARN zu verifizieren
> WARN durch Team zu ergaenzen
> WARN Annahme, bitte pruefen
> WARN Quelle fehlt
```

Wird ein Marker aufgelöst, **Remember-Trigger 1** ausführen (siehe unten).

## Anonymisierung

Keine sensiblen Daten. Platzhalter: `<API_KEY>` / `<S3_KEY>` / `<TOKEN>`,
`<PRIVATE_DOMAIN>`, `<EMAIL>`, `<INTERNAL_PATH>`. Kurze repo-relative Pfade sind erlaubt und
erwünscht. Vor jedem Export Secret-Sweep gemäß
[SENSITIVE_DATA_CHECKLIST.md](docs/project-handbook/SENSITIVE_DATA_CHECKLIST.md).

## Branch- & Commit-Sicherheit

- **Nie zu `main` mergen.** Alle Handbucharbeit bleibt auf `dom/doku`.
- **`git push` nur mit explizitem OK** (hook-erzwungen). Commits sind frei.
- Commit-Format: `docs , handbook , <kurzbeschreibung>`.
- Kein „Claude"/Co-author-Hinweis in Commits.

## Remember-Regeln (Dual-Write)

Jede Klärung wird **doppelt** festgehalten: (a) in der passenden **Repo-Tracking-Datei**
(bleibt im gebundenen Werk nachvollziehbar) **und** (b) als **Memory-Fakt** in der zentralen
LokLM-Projekt-Memory (Verzeichnis `<…>/.claude/projects/<…>-LokLM/memory/`, vom Harness je
Session bereitgestellt; enthält bereits `MEMORY.md` + `project-handbook.md`), inkl.
`MEMORY.md`-Indexzeile.

| Trigger | Auslöser | Repo-Ziel (a) | Memory-Fakt (b) |
| --- | --- | --- | --- |
| **1 Team-Antwort / Marker-Auflösung** | Frage beantwortet, Marker geklärt | [OPEN_QUESTIONS_FOR_TEAM.md](docs/project-handbook/OPEN_QUESTIONS_FOR_TEAM.md) (als beantwortet) + [HANDBOOK_STATUS.md](docs/project-handbook/HANDBOOK_STATUS.md) | `handbook-team-answers.md` |
| **2 Terminologie/Benennung** | verbindliche Schreibweise/Begriff festgelegt | [TERMINOLOGY.md](docs/project-handbook/TERMINOLOGY.md) | `handbook-terminology.md` |
| **3 Verifizierte Zahl/Fakt** | nachgezählter/belegter Wert | betroffenes Kapitel + [SOURCE_MAP.md](docs/project-handbook/SOURCE_MAP.md) | `handbook-verified-numbers.md` (Wert, Quelle, Prüfdatum) |
| **4 Struktur-/Stil-Entscheidung** | Konvention/Aufbau/Zitierweise geändert | [STYLE_GUIDE.md](docs/project-handbook/STYLE_GUIDE.md) | `handbook-conventions.md` |

Der Session-Handoff (`.remember/remember.md`) ist nur für **laufende, halbfertige**
Kapitelarbeit zuständig; **persistente** Fakten gehören in die Memory-Dateien oben.

## Vor der Bindung

Vor dem Bump auf v1.0.0 und dem Export die Checkliste
[RELEASE_AUDIT.md](docs/project-handbook/RELEASE_AUDIT.md) vollständig abarbeiten.
