# EXPORT_NOTES

Anleitung, wie das Markdown-Projekthandbuch (`docs/project-handbook/`) in eine
gebundene **PDF-/Buch-Version** überführt wird. Stand: **2026-06-14**. Ausgabeziel:
`docs/project-handbook/export/`; Bildmaterial unter `docs/project-handbook/assets/`.

> **Vor jedem Export:** den finalen Sensitivdaten-Prüfschritt aus
> [SENSITIVE_DATA_CHECKLIST.md](SENSITIVE_DATA_CHECKLIST.md) ausführen (Secret-Sweep über
> alle Handbuch-Dateien inkl. `assets/`). Kein Export mit ungeprüften Bildern.

---

## 1. Kapitelreihenfolge (Build-Manifest)

Die Hauptkapitel werden in numerischer Reihenfolge zusammengeführt; die Steuerdateien
(README, HANDBOOK_STATUS, SOURCE_MAP, OPEN_QUESTIONS_FOR_TEAM, SENSITIVE_DATA_CHECKLIST,
EXPORT_NOTES) gehören **nicht** in die gebundene Fassung (interne Verwaltung) — höchstens
SOURCE_MAP/OPEN_QUESTIONS als Anhang, falls gewünscht.

```
00_cover · 01_preface… · 02_management_summary · 03 … 28_appendix
```

Glob-Reihenfolge (POSIX-Sortierung): `[0-2][0-9]_*.md`.

---

## 2. Export-Werkzeuge (Optionen)

Mehrere Wege führen zum Ziel; empfohlen ist **Pandoc** (am flexibelsten für Buch-Layout)
oder **mdbook** (am schnellsten für ein navigierbares HTML/PDF-Buch).

### Option A — Pandoc → PDF (LaTeX-Engine)

Vollständigste Kontrolle über Buch-Layout (Deckblatt, TOC, Seitenzahlen, Kapitelumbrüche).

```bash
# Reihenfolge garantieren, dann zu PDF rendern (XeLaTeX für Unicode/Umlaute)
pandoc $(ls docs/project-handbook/[0-2][0-9]_*.md | sort) \
  --from gfm \
  --pdf-engine=xelatex \
  --toc --toc-depth=2 \
  --number-sections \
  --top-level-division=chapter \
  -V documentclass=report \
  -V lang=de-DE \
  -V geometry:margin=2.5cm \
  -V mainfont="DejaVu Serif" \
  -V monofont="DejaVu Sans Mono" \
  -o docs/project-handbook/export/LokLM-Projekthandbuch.pdf
```

Hinweise:
- **XeLaTeX/LuaLaTeX** statt pdfLaTeX wählen — wegen der durchgängigen Umlaute und
  Sonderzeichen (UTF-8).
- `--top-level-division=chapter` macht aus jeder `#`-Überschrift ein LaTeX-Kapitel →
  saubere Kapitelumbrüche und Seitenzahlen.
- Mermaid-Diagramme rendert Pandoc **nicht** native — siehe Abschnitt 4.

### Option B — mdbook (HTML-Buch + Druck-PDF)

```bash
# book.toml + SUMMARY.md aus der Kapitelliste erzeugen, dann:
mdbook build         # navigierbares HTML-Buch nach book/
# PDF über den Browser-Druck der zusammengeführten Print-Ansicht
# oder das mdbook-pandoc / mdbook-pdf Backend
```

Eignet sich für eine **online navigierbare** Fassung; Mermaid via `mdbook-mermaid`-Preprocessor.

### Option C — VS Code „Markdown PDF"-Extension

Schnell für Einzeldokumente; für ein Buch müssen die Kapitel vorher zu **einer**
Markdown-Datei zusammengeführt werden (z. B. `cat $(ls [0-2][0-9]_*.md | sort) > _merged.md`).
Mermaid wird von der Extension via Headless-Chromium gerendert.

### Option D — typst

Moderner, schneller LaTeX-Ersatz. Markdown via `pandoc -t typst` nach `.typ` konvertieren
oder direkt ein typst-Template mit `#include` je Kapitel pflegen. Sehr gute
Deckblatt-/Seitenzahl-Kontrolle, Umlaute out-of-the-box.

### Option E — LaTeX direkt

Maximale Kontrolle (eigene `report`/`book`-Klasse, Titelseite, Kopf-/Fußzeilen). Pandoc
als Markdown→LaTeX-Konverter vorschalten (`pandoc -t latex`), dann manuell in ein
`book`-Gerüst einbinden. Aufwändigster, aber feinst steuerbarer Weg.

---

## 3. Buchbindungs-Hinweise

| Aspekt | Empfehlung |
| --- | --- |
| **Deckblatt** | `00_cover.md` als Titelseite; in Pandoc/LaTeX via Titelblock oder eigene `\maketitle`-Seite. Projekt, Version 0.1, Stand 2026-06-14, Team, Auftraggeber. |
| **Inhaltsverzeichnis** | automatisch generieren (`--toc --toc-depth=2`). Das README-TOC ist für die Verwaltung; im Buch das gerenderte TOC nutzen. |
| **Seitenzahlen** | über die Dokumentklasse (`report`/`book`); Frontmatter (Deckblatt/TOC) römisch, Hauptteil arabisch, falls gewünscht. |
| **Kapitelumbrüche** | jedes `00_…`-`28_…` beginnt auf neuer Seite (`--top-level-division=chapter` bzw. `\chapter`). |
| **Bilder/Diagramme** | unter `assets/` ablegen; Pfade in den Kapiteln repo-relativ halten. |
| **Mermaid-Diagramme** | vor dem Export zu statischen Bildern rendern (Abschnitt 4) — die meisten PDF-Pfade rendern Mermaid-Codeblöcke sonst als reinen Text. |
| **Quellen/Anhang** | `28_appendix.md` (Befehle/Pfade/Quellen) ans Ende; optional SOURCE_MAP als zusätzlicher Anhang. |
| **Marker** | die `> WARN …`-Blockquotes bleiben sichtbar (Ehrlichkeits-Instrument) oder werden für eine „finale" Fassung erst nach Klärung der offenen Punkte entfernt — siehe OPEN_QUESTIONS_FOR_TEAM. |
| **Schrift** | Serif-Hauptschrift mit voller Umlaut-Abdeckung (z. B. DejaVu Serif / Latin Modern); Monospace für Code. |
| **Sprache/Silbentrennung** | `lang=de-DE` setzen (korrekte Trennung, Anführungszeichen). |

---

## 4. Mermaid-Diagramme rendern

Das Handbuch enthält mehrere `mermaid`-Codeblöcke (u. a. Architektur-, Datenfluss-,
Risiko-Diagramme in Kap. 06, 08, 12, 13, 15, 16, 17, 18, 19, 21, 22). Für Pandoc/LaTeX
zuerst zu SVG/PNG rendern:

```bash
# pro Diagramm via mermaid-cli (mmdc) zu SVG, dann im Markdown einbinden
# oder das pandoc-Filter 'mermaid-filter' nutzen:
pandoc … --filter mermaid-filter -o … .pdf
```

Bei mdbook übernimmt `mdbook-mermaid` das Rendering im HTML; für die PDF-Ableitung die
gerenderten Grafiken verwenden. SVGs nach `assets/` exportieren, damit sie versioniert
neben dem Text liegen.

---

## 5. Empfohlener Export-Ablauf (Kurzfassung)

1. **Sensitivdaten-Sweep** über `docs/project-handbook/` inkl. `assets/` (Checkliste,
   finaler Prüfschritt). Erst bei „sauber" weiter.
2. **Offene Marker prüfen:** entscheiden, ob `> WARN …`-Blöcke in der gebundenen Fassung
   bleiben (Projektstand-Version) oder erst nach Team-Klärung entfernt werden
   (finale Version) — siehe [OPEN_QUESTIONS_FOR_TEAM.md](OPEN_QUESTIONS_FOR_TEAM.md).
3. **Mermaid → Bilder** rendern (Abschnitt 4), nach `assets/` ablegen.
4. **Zusammenführen** in numerischer Kapitelreihenfolge.
5. **Rendern** (Pandoc/mdbook/typst) nach `docs/project-handbook/export/`.
6. **Sichtprüfung:** Deckblatt, TOC, Seitenzahlen, Kapitelumbrüche, Diagramme,
   Umlaut-Korrektheit, keine sichtbaren Platzhalter-Lecks.
7. **Finaler Sensitivdaten-Blick** auf das gerenderte PDF (Bilder/Diagramme können
   Inhalte zeigen, die der Text-Sweep nicht erfasst).

---

## 6. Hinweis zum Stand

Die Aufgabenstellung früherer Kapitel (Anhang) verwies bereits auf dieses Dokument
(`EXPORT_NOTES`) als künftige Export-Anleitung; mit dieser Datei ist der Verweis erfüllt.
Das Export-Zielverzeichnis `docs/project-handbook/export/` existiert (mit `.gitkeep`);
`assets/` nimmt das Bildmaterial auf.
