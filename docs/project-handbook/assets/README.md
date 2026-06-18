# assets/ — gerenderte Diagramme

Die 15 Mermaid-Diagramme des Handbuchs als statische **SVG** — Binding-Artefakt für die
Export-Pipeline (siehe [BOOK_MANIFEST.md](../BOOK_MANIFEST.md), Roadmap-Punkt E2). Quelle je
Diagramm ist die gleichnamige `.mmd`-Datei (1:1 aus dem inline-`mermaid`-Block des jeweiligen
Kapitels extrahiert). Die Kapitel-Markdown behalten ihre inline-`mermaid`-Blöcke (für die
GitHub-Vorschau); für die gebundene Fassung werden die SVG eingebunden.

**Benennung:** `abb-<Kapitel>-<Nr>.svg` entspricht „Abbildung K.n" im Text
(z. B. `abb-13-2.svg` = Abbildung 13.2). Kapitel mit Diagrammen: 06, 08, 12, 13 (×3), 15,
16 (×2), 17, 18, 19 (×2), 21, 22.

## Neu rendern

Renderer: `@mermaid-js/mermaid-cli` (`mmdc`). Hinweis: `mmdc` nutzt **puppeteer-core** und
lädt **kein** Chromium selbst — es braucht eine vorhandene Chrome-/Chromium-Executable,
angegeben über `executablePath` in der puppeteer-Config:

```jsonc
// puppeteer.json
{ "args": ["--no-sandbox", "--disable-gpu"], "executablePath": "<Pfad zu chrome.exe>" }
```

```bash
for f in docs/project-handbook/assets/abb-*.mmd; do
  pnpm dlx @mermaid-js/mermaid-cli -i "$f" -o "${f%.mmd}.svg" -p puppeteer.json
done
```

Stand: 2026-06-16 · mermaid-cli 11.15.0 · 15/15 gerendert (System-Chrome als Executable).
