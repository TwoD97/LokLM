# RELEASE_AUDIT

Gate-Checkliste für die **v1.0.0-Abnahme** des Projekthandbuchs — der vor der **Bindung**
durchzuführende **Audit-/Aktualisierungs-Check**. Das Handbuch wächst bis dahin mit; dieser
Check stellt vor dem Export die fachliche, formale und sicherheitsbezogene Reife sicher.

**Auslöser:** Sobald alle dominierenden offenen Punkte aus
[HANDBOOK_STATUS.md](HANDBOOK_STATUS.md) geklärt sind und der Bump auf **Handbuch-Version
1.0.0** ansteht. Erst nach vollständigem Abhaken erfolgt der Export gemäß
[EXPORT_NOTES.md](EXPORT_NOTES.md).

---

## 1. Inhaltliche Reife

- [ ] Alle 29 Hauptkapitel (00–28) entsprechen der [Kapitelschablone](STYLE_GUIDE.md#2-kapitelschablone).
- [ ] Dominierende offene Punkte (AP-E.2-Sweep, externe Tools, Versions-/Benennungs-Fragen,
      CI-Verankerung) aus [HANDBOOK_STATUS.md](HANDBOOK_STATUS.md) sind geklärt **oder**
      bewusst als datierter Projektstand belassen und als solcher gekennzeichnet.
- [ ] Offene Fragen in [OPEN_QUESTIONS_FOR_TEAM.md](OPEN_QUESTIONS_FOR_TEAM.md) sind
      beantwortet oder als bewusst offen markiert.

## 2. Marker-Sweep

- [ ] Jeder `> WARN …`-Marker ist entweder **aufgelöst** (Inhalt belegt/korrigiert) oder
      **bewusst belassen** und im Kapitel als Projektstand begründet.
- [ ] Aufgelöste Marker haben **Remember-Trigger 1** durchlaufen (Repo-Tracking + Memory).

## 3. Quellen & Zitate

- [ ] Jede externe Behauptung trägt eine `[n]`-Marke; jede `[n]`-Marke hat einen Eintrag im
      [Literaturverzeichnis](back_10_literaturverzeichnis.md).
- [ ] Literaturverzeichnis-Einträge folgen dem [IEEE-Format](STYLE_GUIDE.md#5-zitierweise--belegführung)
      und sind in Erscheinungsreihenfolge nummeriert.
- [ ] Interne Belege (Repo-Pfade) sind in [SOURCE_MAP.md](SOURCE_MAP.md) erfasst; keine
      verwaisten Verweise.

## 4. Terminologie & Stil

- [ ] Schreibweisen sind gegen [TERMINOLOGY.md](TERMINOLOGY.md) konsistent
      (insb. „Denys", Versionsbezeichnungen, Fachbegriffe).
- [ ] Stilregeln aus dem [STYLE_GUIDE.md](STYLE_GUIDE.md) eingehalten (Tempus, Person,
      Abkürzungseinführung, Zahl-/Anführungszeichen-Schreibung).

## 5. Abbildungen & Tabellen

- [ ] Alle Abbildungen/Tabellen sind beschriftet („Abbildung N: …" / „Tabelle N: …") und im
      Text per Querverweis referenziert.
- [ ] Alle `mermaid`-Diagramme sind zu statischen Bildern unter [assets/](assets/) gerendert.
- [ ] Abbildungs-/Tabellenverzeichnis werden beim Export erzeugt und sind vollständig.

## 6. Sicherheit & Anonymisierung

- [ ] Secret-Sweep gemäß [SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md) über
      **alle** Handbuch-Dateien **inkl. `assets/`** — 0 Treffer.
- [ ] Finaler Sensitivdaten-Blick auf das **gerenderte PDF** (Bilder/Diagramme).

## 7. Buch-Vollständigkeit & Build

- [ ] Frontteil vollständig: Deckblatt, Kurzfassung, TOC, Abbildungs-/Tabellen-/
      Abkürzungsverzeichnis.
- [ ] Schlussteil vollständig: Literaturverzeichnis, Selbstständigkeitserklärung
      (Name/Datum/Unterschrift gesetzt).
- [ ] [BOOK_MANIFEST.md](BOOK_MANIFEST.md), [README.md](README.md)-Inhaltsverzeichnis und die
      tatsächlich vorhandenen Dateien sind deckungsgleich.
- [ ] Probebuild gemäß [EXPORT_NOTES.md](EXPORT_NOTES.md) läuft fehlerfrei durch.

## 8. Versionierung

- [ ] Handbuch-Version in `00_cover.md`, [README.md](README.md) und Fußzeilen auf **1.0.0**
      und finales Datum gebumpt.
- [ ] **App-Stand gepinnt:** Tabelle 1.2 (§1.7, Zeile „1.0.0") und der Dokumentationsstand
      (§1.3) nennen den **tatsächlichen Abgabe-Release** der Anwendung (Version **+ Commit**)
      statt v0.4.6 / `af59c25`; alle weiteren Versions-Erwähnungen im Text sind konsistent.
- [ ] **Snapshot eingefroren:** Der gebundene Handbuch-Stand ist als Git-Tag/Commit
      festgehalten (z. B. Tag `handbuch-v1.0.0` auf `dom/doku`), damit die gedruckte
      Original-Fassung reproduzierbar bleibt (Snapshot-Politik §1.7).
- [ ] [HANDBOOK_STATUS.md](HANDBOOK_STATUS.md) spiegelt den finalen Stand
      (keine `zu pruefen`-Restposten ohne Begründung).

## 9. Sichtprüfung des PDF

- [ ] Deckblatt, Seitenzahlen (römisch/arabisch), Kapitelumbrüche, Umlaut-Korrektheit,
      Verzeichnisse, keine sichtbaren Platzhalter-Lecks.

---

_Nach vollständigem Abhaken: Export nach `export/`, Druck, Bindung, Abgabe._
