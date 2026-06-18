# STYLE_GUIDE

Verbindliche Stil-, Struktur- und Belegregeln für das LokLM-Projekthandbuch. Ziel ist ein
**fachlich kompetentes, abschlussarbeits-/„doktorarbeits"-ähnliches, bindefähiges** Werk.
Diese Richtlinie wird beim **Mitwachsen** angewandt und beim **v1.0.0-Audit**
([RELEASE_AUDIT.md](RELEASE_AUDIT.md)) durchgängig durchgesetzt. Die Kurzregeln für jede
Session stehen in [/CLAUDE.md](../../CLAUDE.md). Stand: **2026-06-14**.

---

## 1. Dokument-Aufbau (Bind-Struktur)

Die gebundene Fassung folgt dem klassischen Aufbau einer wissenschaftlichen Arbeit. Die
genaue Reihenfolge der Dateien steuert das [BOOK_MANIFEST.md](BOOK_MANIFEST.md).

1. **Frontteil** (römische Seitenzahlen)
   - Titel-/Deckblatt — `00_cover.md`
   - Kurzfassung / Abstract — `front_10_kurzfassung.md`
   - Inhaltsverzeichnis — beim Export automatisch (`--toc`)
   - Abbildungsverzeichnis & Tabellenverzeichnis — beim Export automatisch
     (`\listoffigures` / `\listoftables`)
   - Abkürzungsverzeichnis — `front_20_abkuerzungsverzeichnis.md`
2. **Hauptteil** (arabische Seitenzahlen) — Kapitel `01_…` bis `28_appendix`
3. **Schlussteil**
   - Literaturverzeichnis — `back_10_literaturverzeichnis.md`
   - Selbstständigkeitserklärung — `back_20_selbststaendigkeitserklaerung.md`

Steuerdateien (README, HANDBOOK_STATUS, SOURCE_MAP, OPEN_QUESTIONS_FOR_TEAM,
SENSITIVE_DATA_CHECKLIST, EXPORT_NOTES, STYLE_GUIDE, TERMINOLOGY, BOOK_MANIFEST,
RELEASE_AUDIT) sind **interne Verwaltung** und gehören **nicht** in die gebundene Fassung.

---

## 2. Kapitelschablone

Jedes Hauptkapitel folgt einem einheitlichen inneren Aufbau:

1. **H1-Überschrift** (genau eine `#` je Datei) — der Kapiteltitel.
2. **Kurze Einleitung** (1–3 Sätze): Zweck und Gegenstand des Kapitels.
3. **Inhalt** in konsistenter Überschriftentiefe (siehe Abschnitt 3).
4. **Querverweise/Quellen** dort, wo Aussagen belegt werden (Repo-Pfad bzw. `[n]`).
5. Optional eine **kurze Zusammenfassung** bei umfangreichen Kapiteln.

Neue Kapitel sowie beim Audit nachzuziehende Kapitel orientieren sich an dieser Schablone.

---

## 3. Überschriften & Nummerierung

- Genau **eine `#`-H1 je Kapiteldatei** (Kapiteltitel **ohne** Nummer); Unterabschnitte mit
  `##`, `###` (max. drei Ebenen im Fließtext).
- **Manuelle Abschnittsnummern** im Muster `N.M` (`N` = Kapitelnummer aus dem Dateinamen),
  z. B. `## 13.1 Schichten und Prozesse` — so wie in allen bestehenden Kapiteln. Die
  Kapitelnummer selbst setzt der Export (`--top-level-division=chapter`); die manuellen
  Abschnittsnummern sitzen darunter. Daher beim Export **kein** `--number-sections`
  (sonst doppelte Nummern) — siehe [EXPORT_NOTES.md](EXPORT_NOTES.md).
- Überschriften sind **substantivisch** und knapp (keine ganzen Sätze).

---

## 4. Wissenschaftlicher Schreibstil

- **Sprache:** sachliches Hochdeutsch, technisch präzise, keine Umgangssprache.
- **Person:** keine 1. Person Singular; „wir" nur für bewusste Team-Entscheidungen, sonst
  unpersönlich/Passiv.
- **Tempus:** Präsens für System-/Sachbeschreibung; Präteritum/Perfekt für Projektverlauf
  und Historie.
- **Abkürzungen:** bei Ersterwähnung ausschreiben — „Inter-Process Communication (IPC)" —,
  danach das Kürzel; Aufnahme ins [Abkürzungsverzeichnis](front_20_abkuerzungsverzeichnis.md).
- **Fachbegriffe:** englische Fachbegriffe bei Ersterwähnung *kursiv*; danach einheitlich.
  Verbindliche Schreibweisen im [TERMINOLOGY.md](TERMINOLOGY.md).
- **Zahlen:** deutsche Schreibung (Dezimalkomma, Tausenderpunkt: `2.322`).
- **Anführungszeichen:** deutsch „…".

---

## 5. Zitierweise & Belegführung

Das Handbuch trennt **interne** (Repo-) von **externen** Belegen:

- **Interne Fakten** (eigener Code, ADRs, committete Docs, Git-/PR-/Tag-Historie) werden mit
  dem **Repo-Dateipfad** belegt, z. B. `src/main/services/retrieval/rrf.ts`. Provenienz und
  Vertrauensgrad (`hoch`/`mittel`/`niedrig`) führt [SOURCE_MAP.md](SOURCE_MAP.md).
- **Externe Quellen** (Tools, Frameworks/Bibliotheken, Standards/Normen, Spezifikationen,
  Paper, Online-Doku) werden **IEEE-numerisch** zitiert: fortlaufende Nummer in eckigen
  Klammern `[n]` an der Belegstelle; der vollständige Eintrag steht im
  [Literaturverzeichnis](back_10_literaturverzeichnis.md).
- **Regel:** externe Behauptung ⇒ `[n]` + Literaturverzeichnis-Eintrag; interne Behauptung
  ⇒ Repo-Pfad. Jede belegpflichtige Aussage ist **belegt oder markiert** — nie unbelegt
  behauptet.
- **IEEE-Format der Einträge:** `[n] Autor/Organisation, „Titel," Quelle/Version, Jahr.
  URL/DOI (Zugriff: JJJJ-MM-TT).` Nummerierung in **Erscheinungsreihenfolge im Text**.

---

## 6. Abbildungen & Tabellen

- **Beschriftung Pflicht:** Abbildungen mit „**Abbildung K.n:** …" (unter der Abbildung),
  Tabellen mit „**Tabelle K.n:** …" (über der Tabelle); `K` = Kapitelnummer, `n` fortlaufend
  je Kapitel (analog zu den manuellen Abschnittsnummern, Abschnitt 3). Nur beschriftete
  Objekte erscheinen im Abbildungs-/Tabellenverzeichnis.
- **Querverweis im Text:** jede Abbildung/Tabelle wird im Fließtext referenziert
  („… siehe Abbildung K.n").
- **Diagramme:** `mermaid`-Codeblöcke werden **vor dem Export** zu statischen Bildern
  (SVG/PNG) gerendert und unter [assets/](assets/) abgelegt (repo-relative Pfade); siehe
  [EXPORT_NOTES.md](EXPORT_NOTES.md) Abschnitt 4.
- Bilder liegen unter `assets/`; Pfade in den Kapiteln **repo-relativ**.

---

## 7. Marker-Konvention (Ehrlichkeits-Instrument)

Wo der Stand offen, unklar oder unbelegt ist, steht genau **ein Marker als eigene
Blockquote-Zeile**. Bedeutung der Marker: siehe [README.md](README.md) („Lesehinweis").
Verwendete Form: `> WARN <kurztext>` (in älteren Kapiteln teils `> ⚠️ …`). Beim Auflösen
eines Markers greift **Remember-Trigger 1** (siehe [/CLAUDE.md](../../CLAUDE.md)). Beim
v1.0.0-Audit werden alle Marker entweder aufgelöst **oder** bewusst als Projektstand
belassen und dokumentiert.

---

## 8. Anonymisierung

Keine sensiblen Daten im Handbuch. Platzhalter und Prüfschritte:
[SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md). Kurze repo-relative Pfade sind
erlaubt und erwünscht.

---

## 9. Konsistenz beim Mitwachsen

- Neue/erweiterte Inhalte folgen dieser Richtlinie sofort.
- Verbindliche Begriffe/Schreibweisen werden im [TERMINOLOGY.md](TERMINOLOGY.md) gepflegt
  (Remember-Trigger 2).
- Strukturelle/stilistische Änderungen an dieser Richtlinie lösen **Remember-Trigger 4** aus
  (Memory-Fakt `handbook-conventions.md`).
- Die vollständige Durchsetzung über **alle** Kapitel ist Gegenstand des
  [v1.0.0-Audits](RELEASE_AUDIT.md), nicht jeder Einzeländerung.
