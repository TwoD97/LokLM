# Anleitung: Eval-Säule erweitern + automatisieren (für Dominik)

Ziel am Ende: ein Knopfdruck misst **mehrere Modelle × mehrere Datensätze ×
unsere Chunking-Strategie × verschiedene Embedder × verschiedene Reranker**,
protokolliert alles versioniert, und spuckt eine **papierfertige Tabelle**
(CSV + LaTeX) mit Provenienz (git-sha, Hardware, Dataset-hash) aus.

Lies zuerst [`README.md`](./README.md) (die bestehende Architektur). Diese
Anleitung baut darauf auf.

---

## Teil 1 — Was Evals sind (das mentale Modell)

Die normalen Tests (`unit`, `integration`, `e2e`) prüfen **richtig vs. falsch**.
Evals sind anders: sie messen **Qualität** einer probabilistischen Pipeline und
liefern **Zahlen**, keine Pass/Fail-Assertion. Eine Eval „schlägt nicht fehl" —
eine Config schneidet besser oder schlechter ab als eine andere.

Drei Begriffe, die du verinnerlichen musst:

1. **PipelineConfig** — ein Bündel aus \*Chunker + Embedder + Reranker + wie viele
   Kandidaten zum Reranker (topKToRerank) + wie viele Chunks zum LLM (topKToLLM)
   - optional ein Antwort-LLM\*. Lebt in [`pipeline/configs.ts`](./pipeline/configs.ts).
     Der Sweep-Runner läuft eine Liste solcher Configs durch.

2. **Ein Sweep-Lauf = ein Datensatz × eine Liste von Configs.** Die Modelle
   (Antwort-LLM-Achse) kreuzt man über eine Pack-Datei rein; alles andere
   (Embedder, Reranker, Chunking, topK) steckt in den Configs.

3. **Run-Dir** — jeder Lauf schreibt einen versionierten Ordner unter
   `report/runs/<zeitstempel>_<git-sha>/`. Darin: `summary.json` (Zahlen),
   `env.json` (Hardware + git), `ranking.md` (Bestenliste). **Das ist die
   Rohdaten-Quelle fürs Paper.**

Die Metriken, die rausfallen: `recall@k` (steckt die richtige Stelle in den
Top-k?), `recall_req@k` (Mehrfach-Treffer-Variante), `MRR`, `nDCG@10`, dazu —
wenn das LLM mitläuft — `TTFT` (Zeit bis erstes Token) und ein **Judge-Score**
(ein großes Modell bewertet die Antwort nach correctness/groundedness/
helpfulness). Aus all dem wird ein `composite`-Score gebildet, nach dem die
`ranking.md` sortiert.

---

## Teil 2 — Was schon fertig ist (nur benutzen, nicht bauen)

Diese Befehle laufen **heute schon**. Du tippst sie nur:

| Befehl                                       | Was er macht                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm evals:generate`                        | Sample-Dokumente → synthetischer Frage-Datensatz (`data/datasets/*.json`)                                    |
| `pnpm evals:sweep`                           | 1 Datensatz × Configs, mit TTFT + Resource-Messung                                                           |
| `pnpm evals:sweep -- --judge`                | dasselbe + LLM-as-Judge (Antwort-Qualität)                                                                   |
| `pnpm evals:pack -- --pack <datei>`          | 1 Datensatz × **alle Modelle in der Pack-Datei**, je Modell ein eigener Prozess, absturzsicher + fortsetzbar |
| `pnpm evals:build-library` / `evals:scale`   | Skalierungstest mit Störchunks (Degradationskurve)                                                           |
| `pnpm pod:start` / `pod:stop` / `pod:status` | RunPod-Server an/aus/Status (Teil 6)                                                                         |

Die **Modell-Achse ist also schon gelöst** — `evals:pack` lädt jedes Modell in
einem eigenen Unterprozess (gegen einen Speicher-Leak von `node-llama-cpp` nach
~5 Modellen), ist fortsetzbar nach Absturz und schreibt am Ende eine gemeinsame
Bestenliste. **Dieses Muster ist die Vorlage** für deine Datensatz-Schleife.

**Was fehlt** und was du in Teil 4 baust:

- **A** — eine Matrix-Config: Embedder × Reranker × Chunking auf einen Schlag.
- **B** — eine äußere Schleife über mehrere Datensätze.
- **C** — ein Aggregator, der alle Läufe zu einer Paper-Tabelle zusammenzieht.

---

## Teil 3 — Einmaliges Setup

### 3.1 Modelle holen

```
pnpm models:evals
```

Lädt nach `models/`: den Embedder (`bge-m3`), den Reranker (`bge-reranker-v2-m3`),
den Judge (großes Modell) und den Pool der Antwort-Modelle. Fehlende Modelle in
einer Pack-Datei werden später einfach übersprungen, kein Absturz.

### 3.2 Ersten Datensatz erzeugen

```
pnpm evals:generate -- --provider ollama --per-chunk 3
```

Schreibt `data/datasets/<provider>-<zeitstempel>.json`. **Diesen committen.**
Datensätze werden eingefroren und nur neu erzeugt, wenn sich Sample-Dokumente
oder Generator-Prompts ändern. Wer höhere Qualität will: `--provider anthropic`
(braucht `ANTHROPIC_API_KEY` in `.env`).

### 3.3 Rauchtest, dass die Mechanik steht

```
pnpm evals:sweep -- --configs default --limit 5
```

Das nutzt Platzhalter-Stubs (kein Modell-Load), dauert Sekunden. Wenn ein Run-Dir
mit `summary.md` entsteht, ist alles verkabelt.

### 3.4 Hardware-Realismus (wichtig, nicht „optimieren")

Der Embedder läuft absichtlich auf **CPU**. Das spiegelt, was ein Endnutzer ohne
GPU erlebt — der LLM kriegt die GPU/VRAM. **Nicht** auf GPU umstellen nur weil die
5090 es schneller macht; sonst messen wir eine Konfiguration, die niemand
ausliefert. (Steht so im Kommentar von `EmbedderBridge.ts`.)

---

## Teil 4 — Die fünf Achsen und was sie kosten

Du sollst fünf Dinge variieren. Wo jede Achse sitzt und wie teuer das Variieren
ist (das bestimmt die Schleifen-Reihenfolge):

| Achse           | Wo eingestellt                         | Kosten beim Variieren                                       |
| --------------- | -------------------------------------- | ----------------------------------------------------------- |
| **Antwort-LLM** | Pack-Datei + `--llm-models`            | hoch (Modell-Reload) — **schon gelöst** via `evals:pack`    |
| **Datensatz**   | `--dataset <pfad>`                     | mittel (Korpus muss neu eingebettet werden) — **Aufgabe B** |
| **Embedder**    | Embedder-Bridge mit anderem Modellpfad | **hoch** — jeder Embedder = kompletter Re-Embed             |
| **Reranker**    | Reranker-Bridge mit anderem Modellpfad | **niedrig** — teilt sich die Embeddings                     |
| **Chunking**    | Chunker mit anderer Größe/Overlap      | **hoch** — jeder Chunker = kompletter Re-Embed              |

Merksatz: **Reranker innen (billig), Embedder/Chunker/Datensatz außen (teuer).**

Wichtig zum Verständnis: Die Embedder- und Reranker-Bausteine sind **schon
austauschbar gebaut**. Beide nehmen einen Modellpfad und einen Label entgegen
(siehe [`bridges/EmbedderBridge.ts`](./bridges/EmbedderBridge.ts) und
[`bridges/RerankerBridge.ts`](./bridges/RerankerBridge.ts)). Du musst also keine
neuen Bridges bauen — nur Configs erzeugen, die unterschiedliche Pfade/Labels
setzen. **Eine Stolperfalle:** der Label landet im internen Namen und der Name
ist Teil des Embedding-Zwischenspeicher-Schlüssels. Vergibst du zwei Embeddern
denselben Label, kollidieren ihre Embeddings still. **Also jedem Modell einen
eindeutigen Label geben.**

---

## Teil 5 — Die drei Bau-Aufgaben (in Worten)

Für jede Aufgabe steht hier: was rein soll, in welche Datei, welches bestehende
Stück du als Vorlage nimmst, was rein- und rausgeht, und woran du erkennst dass
es fertig ist.

### Aufgabe A — Die Matrix-Config

**Ziel:** eine neue Funktion, die Embedder × Reranker × Chunking als
„alles-mit-allem" (kartesisches Produkt) erzeugt, bei festem Antwort-LLM.

**Datei:** [`pipeline/configs.ts`](./pipeline/configs.ts), neue Funktion unten
anhängen.

**Vorlage:** schau dir `gridConfigs()` in derselben Datei an — die baut schon ein
kartesisches Produkt über zwei Achsen mit dem vorhandenen `cartesian()`-Helfer.
Du machst dasselbe, nur mit drei Achsen (Embedder, Chunker, Reranker).

**Anforderungen:**

- Jeder Embedder/Reranker/Chunker wird **genau einmal** erzeugt und über alle
  Kombinationen geteilt (sonst wird das Modell mehrfach geladen).
- Das Antwort-LLM bleibt **fix** auf dem „full"-Profil — **nicht** auf „auto"
  (sonst lädt versehentlich das große Judge-Modell als Prüfling = verzerrte
  Selbstbewertung). Diese Begründung steht wörtlich in `gridConfigs()`.
- **Standardmäßig nur die kanonischen Modelle**, die nach `pnpm models:evals` da
  sind: ein Embedder (bge-m3), ein Chunker (512/64), zwei Reranker-Varianten
  (keiner + bge-reranker). Ergibt 2 Configs, die **ohne weitere Downloads sofort
  laufen**. Weitere Embedder/Chunker als **auskommentierte Zeilen**, die man
  einkommentiert, sobald die GGUFs in `models/` liegen.
- Jeder Embedder/Reranker kriegt einen **eindeutigen Label** (Cache-Falle, s.o.).
- Danach muss `matrix` als Wert für `--configs` im Sweep-Runner
  ([`sweep.ts`](./sweep.ts)) auswählbar sein: Import ergänzen, einen Zweig in der
  Config-Auswahl hinzufügen, `'matrix'` in den erlaubten Werten des Arguments und
  im Argument-Parser eintragen.

**Fertig wenn:**

```
pnpm evals:sweep -- --configs matrix --no-llm --limit 5
```

durchläuft und in der `summary.md` zwei Zeilen stehen (mit und ohne Reranker).
`--no-llm` heißt „nur Retrieval-Qualität, kein Antwort-LLM" — schnell und
deterministisch.

---

### Aufgabe B — Die Multi-Datensatz-Schleife

**Ziel:** ein kleines Wrapper-Skript, das den Matrix-Sweep nacheinander für
**mehrere Datensätze** startet — je Datensatz ein eigener, sauber isolierter Lauf.

**Warum nötig:** `sweep` und `pack` nehmen genau **einen** `--dataset`. Die
Datensatz-Achse ist die äußere Schleife, die es noch nicht gibt.

**Datei:** ein neues Skript unter `tests/evals/` (PowerShell `.ps1`, weil die
Entwicklungsmaschine Windows ist; alternativ ein kleines `.ts` wie die anderen
Runner).

**Vorlage:** das Vorgehen von [`answer/run-pack.ts`](./answer/run-pack.ts) — der
ruft pro Modell einen Unterprozess auf, fängt Fehler ab und macht beim nächsten
weiter. Du machst dasselbe, nur die äußere Schleife geht über Datensatz-Pfade.

**Anforderungen:**

- Nimmt eine **Liste von Datensatz-Pfaden** (als Parameter, mit sinnvollem
  Default auf die committeten Datensätze).
- Ruft pro Datensatz `pnpm evals:sweep -- --configs matrix --dataset <pfad>` auf,
  plus `--judge` (mit Judge-Pfad) bzw. wahlweise `--no-llm` für den schnellen
  Retrieval-only-Durchlauf, plus optional `--limit`.
- **Ein fehlgeschlagener Datensatz darf die anderen nicht stoppen** (Fehler loggen,
  weitermachen) — genau wie `run-pack.ts` es bei Modellen macht.
- Jeder Aufruf erzeugt sein eigenes Run-Dir (passiert automatisch).
- Am Ende ein Hinweis, dass man jetzt den Aggregator (Aufgabe C) laufen lässt.

**Fertig wenn:** ein Aufruf über zwei Datensätze zwei frische Run-Dirs in
`report/runs/` hinterlässt.

---

### Aufgabe C — Der Paper-Aggregator

**Ziel:** ein Skript, das **alle** Run-Dirs einsammelt und eine flache Tabelle
schreibt — **CSV** (für Excel/pandas) und **LaTeX** (direkt ins Manuskript),
wobei **jede Zeile vollständig zitierfähig** ist.

**Warum das einfach ist:** jeder Lauf hat die Provenienz schon geschrieben. Du
musst nichts neu messen, nur zwei Dateien pro Run-Dir lesen und joinen:

- `env.json` — enthält git-Kurz-Sha, dirty-Flag, CPU-Modell, RAM.
- `summary.json` — enthält den verwendeten Datensatz (Pfad, sha256, Anzahl
  Fragen) und ein Array von Ergebnissen, je Config mit recall@5/@10,
  recall_req@5/@12, MRR, nDCG@10, Judge-Score (falls vorhanden), TTFT-p50 und
  composite.

**Datei:** ein neues `.ts`-Skript, z. B. unter `tests/evals/report/`.

**Anforderungen:**

- Über alle Unterordner von `report/runs/` laufen, je `summary.json` + `env.json`
  lesen.
- Pack-Aggregate (die haben kein `dataset`-Feld im `summary.json`) überspringen —
  die haben ihre eigene Bestenliste; wir wollen nur die Sweep-Form.
- Pro Ergebnis-Zeile eine flache Reihe bauen mit den Spalten: Datensatz, Config,
  n, recall@5, recall@10, recall_req@5, recall_req@12, MRR, nDCG@10, Judge,
  correctness, groundedness, helpfulness, TTFT-p50, composite, git-Sha, dirty,
  CPU, RAM, dataset-sha256.
- Sortieren nach Datensatz, dann composite absteigend.
- **CSV** und **LaTeX-longtable** (booktabs, Unterstriche escapen) in
  `tests/evals/report/paper-table.csv` bzw. `.tex` schreiben.
- Die Spaltenreihenfolge an **einer** Stelle definieren, sodass CSV-Header und
  LaTeX-Spalten garantiert übereinstimmen.

**Fertig wenn:** nach ein paar Läufen `pnpm evals:paper` eine CSV und eine TEX
mit einer Zeile pro (Datensatz × Config) erzeugt, und in jeder Zeile git-Sha +
Hardware + dataset-sha256 stehen.

---

### Zum Schluss: zwei Scripts in `package.json` eintragen

Damit die neuen Schritte zur `pnpm evals:*`-Konvention passen, ergänze unter
`scripts` in `package.json` zwei Einträge — einen für den Matrix-Sweep
(`evals:matrix` → ruft `sweep.ts` mit `--configs matrix`) und einen für den
Aggregator (`evals:paper` → ruft dein neues Skript). Danach hast du:

```
pnpm evals:matrix      # ein Datensatz, die Matrix
pnpm evals:paper       # alle Läufe → CSV + LaTeX
```

---

## Teil 6 — RunPod / Server

Wichtig, damit du keine falsche Erwartung hast: Es gibt **zwei verschiedene
Dinge**, die man „auf dem Server" machen kann, und die bestehende RunPod-Anbindung
deckt nur das erste ab.

### 6.1 Was die RunPod-Anbindung HEUTE kann: remote Ollama für Datensätze

Im Repo liegt eine Pod-Steuerung ([`runpod/pod.ts`](./runpod/pod.ts)) mit drei
Befehlen:

```
pnpm pod:start     # Pod hochfahren, warten bis Ollama bereit, Modelle vorladen
pnpm pod:status    # Status + Ollama-Gesundheit prüfen
pnpm pod:stop      # Pod runterfahren (Kosten sparen!)
```

Das steuert einen RunPod-Server über dessen REST-API und nutzt das **Ollama** auf
dem Pod. Verwendet wird das vor allem, um **Datensätze zu generieren** (der
Generator schickt seine Anfragen an die Ollama-Adresse). Der eigentliche
Mess-Sweep läuft dabei **lokal** auf deiner Maschine mit den GGUF-Modellen — der
Pod liefert nur die Frage-Generierung.

**Einrichtung** (`.env` im Repo-Wurzelverzeichnis anlegen, siehe `.env.example`):

- `RUNPOD_API_KEY` — erstellst du unter runpod.io → Console → User → Settings.
- `RUNPOD_POD_ID` — steht in der URL der Pod-Detailseite.
- `OLLAMA_BASE_URL` — die Adresse des Pod-Ollama. Wenn leer, fällt alles auf das
  lokale `http://127.0.0.1:11434` zurück. Für den RunPod-Proxy hat die Adresse
  die Form `https://<POD_ID>-11434.proxy.runpod.net`.
- `OLLAMA_BEARER_TOKEN` — nur setzen, wenn der Proxy einen verlangt (für den
  öffentlichen RunPod-Proxy **nicht** nötig).
- `OLLAMA_LLM_MODEL`, `OLLAMA_EMBEDDER_MODEL`, `OLLAMA_RERANKER_MODEL` — welche
  Modelle `pnpm pod:start` nach dem Hochfahren vorlädt. Leer = überspringen.

**Modelle dürfen nicht bei jedem Stop verschwinden.** Im Pod selbst (Template
oder „Edit Pod" → Environment Variables) muss `OLLAMA_MODELS` auf einen Pfad im
**Network-Volume** zeigen, z. B. `OLLAMA_MODELS=/workspace/ollama`. Sonst landen
die Modelle auf der flüchtigen Container-Disk und werden nach jedem `pod:stop`
neu heruntergeladen.

**Ablauf**, um einen Datensatz remote zu erzeugen:

```
pnpm pod:start                                          # Pod an, Ollama warm
pnpm evals:generate -- --provider ollama --per-chunk 3  # nutzt OLLAMA_BASE_URL
pnpm pod:stop                                           # Pod aus, sonst kostet er
```

> Den **Datensatz danach committen**. Er ist eingefroren; ab da brauchst du den
> Pod dafür nicht mehr.

### 6.2 Was die Anbindung NICHT kann: den schweren Sweep remote rechnen

Es gibt **keine** Automatik, die den Mess-Sweep selbst auf einem GPU-Server
laufen lässt (kein rsync, kein Dockerfile, kein remote-Runner). Wenn du den
großen Matrix-Lauf auf einer dicken Maschine rechnen willst (weil dein Laptop zu
langsam ist), machst du das **von Hand** per SSH. Schritt für Schritt:

1. **Pod mit GPU + Volume mieten** (RunPod, ein Template mit CUDA + Node). Die
   SSH-Adresse zeigt `pnpm pod:status` bzw. die RunPod-Konsole an
   (`root@<IP> -p <PORT>`).

2. **Per SSH einloggen** und ins Network-Volume wechseln (damit nichts beim Stop
   verloren geht):

   ```
   ssh root@<IP> -p <PORT>
   cd /workspace
   ```

3. **Repo holen** (clonen oder hochladen). Wenn das Repo privat ist, entweder
   einen Deploy-Token nutzen oder den Ordner mit `scp`/`rsync` hochschieben:

   ```
   git clone <repo-url> loklm && cd loklm
   ```

4. **Abhängigkeiten installieren** (Node 24+, pnpm):

   ```
   pnpm install
   ```

5. **Modelle auf den Server laden** — in `models/` (am besten im Volume, damit
   sie bleiben):

   ```
   pnpm models:evals
   ```

6. **Den Lauf starten.** Tipp: in `tmux` oder `screen` starten, damit es
   weiterläuft, wenn die SSH-Verbindung abbricht:

   ```
   tmux new -s evals
   pnpm evals:matrix -- --judge --judge-path models/<judge>.gguf
   # bzw. die Multi-Datensatz-Schleife aus Aufgabe B
   ```

7. **Ergebnisse zurückholen** — die Run-Dirs liegen unter
   `tests/evals/report/runs/`. Von deiner lokalen Maschine aus ziehen:

   ```
   rsync -avz -e "ssh -p <PORT>" root@<IP>:/workspace/loklm/tests/evals/report/runs/ ./tests/evals/report/runs/
   ```

8. **Aggregieren** (lokal oder auf dem Server): `pnpm evals:paper` →
   `paper-table.csv` + `.tex`.

9. **Pod stoppen**, sobald die Daten gesichert sind (`pnpm pod:stop` oder über die
   Konsole) — ein laufender GPU-Pod kostet pro Stunde.

> Wenn ihr das **öfter** auf Servern fahren wollt, lohnt sich später ein kleines
> Sync-+-Run-Skript (clone → install → models → run → rsync zurück). Das ist eine
> eigene, spätere Aufgabe; für den Anfang reicht der Weg von Hand oben.

---

## Teil 7 — Zeitbudget (bevor du nachts was Großes startest)

Grobe Hausnummern (Embedder läuft CPU-only, das ist Absicht):

- **Korpus neu einbetten**: ~5 Minuten je (Embedder × Chunker × Datensatz).
- **Judge pro Frage**: ~5–30 Sekunden. Bei 100 Fragen × 12 Configs sind das
  **3–12 Stunden** reine Judge-Zeit. **Das ist der Hauptkostenpunkt.**
- **Antwort-LLM pro Frage**: Sekunden bis zig Sekunden je nach Modellgröße.

Daumenregeln:

1. **Erst `--no-llm`** über die ganze Matrix (Retrieval-Qualität ist
   deterministisch und kostet keine Judge-Zeit). Damit den besten Embedder/
   Reranker/Chunker finden.
2. **Dann nur die Top-Configs** mit `--judge` und vollem Datensatz. Mit `--only
<namens-teil>` lässt sich aus einer früheren `ranking.md` gezielt die Top-N
   nachfahren, ohne den Code anzufassen.
3. **`--limit N`** während du die Pipeline einstellst; vollen Datensatz nur für
   die finalen Paper-Zahlen.
4. Teure Achsen (Embedder, Chunker, Datensatz) klein halten; die Reranker-Achse
   ist gratis dazu.

---

## Teil 8 — Paper-Regeln (nicht verhandelbar)

Damit die Zahlen zitierfähig sind:

1. **Niemals ein „dirty"-Lauf.** Wenn der Arbeitsbaum schmutzig war, steht
   `_dirty` im Run-Dir-Namen. Erst committen, dann messen. Der Aggregator zieht
   die dirty-Spalte mit, damit so ein Lauf nicht heimlich in die Tabelle rutscht.
2. **Datensätze sind eingefroren + committed.** Jede Zeile trägt den
   `dataset.sha256`. Zwei Zahlen mit unterschiedlichem Hash sind **nicht**
   vergleichbar — auch bei gleichem Dateinamen.
3. **Embedder/Reranker/Judge bleiben pro Mess-Serie fix** — außer die Achse wird
   _bewusst_ variiert; dann steht das Modell ohnehin im Config-Namen und damit in
   der Tabelle.
4. **Hardware-Provenienz** (CPU, RAM) steht in jeder Zeile — Timings sind
   hardware-abhängig, das gehört dazu.
5. **Judge ≠ Prüflings-LLM** (sonst Selbstbewertungs-Bias). Ist im Code schon so
   gepinnt — nicht aufweichen.
6. **Composite-Score** = `2·judge + 1·recall@5 − 0.5·(TTFT in Sekunden)`. Wenn
   ihr die Gewichte fürs Paper ändert, in der Bildunterschrift dokumentieren.

---

## Teil 9 — Runbook (die Reihenfolge zum Abarbeiten)

```
# 0. sauberer Stand
git status                                  # für Paper-Läufe muss er clean sein

# 1. Datensätze sicherstellen (ggf. neu erzeugen + committen)
pnpm evals:generate -- --provider anthropic --per-chunk 3

# 2. Aufgaben A+C gebaut? Rauchtest:
pnpm evals:sweep -- --configs matrix --no-llm --limit 5

# 3. Retrieval-Qualität über alle Datensätze (schnell, deterministisch)
#    -> deine Schleife aus Aufgabe B, mit -NoLlm
pwsh tests/evals/run-matrix.ps1 -NoLlm

# 4. Bestenlisten ansehen: report/runs/<...>/ranking.md je Datensatz

# 5. Top-Configs voll mit Judge nachfahren (langsam)
pwsh tests/evals/run-matrix.ps1            # oder evals:sweep --only <top-namen> --judge

# 6. Paper-Tabelle bauen
pnpm evals:paper
#    -> tests/evals/report/paper-table.csv  (pandas/Excel)
#    -> tests/evals/report/paper-table.tex  (\input ins Manuskript)
```

---

## Teil 10 — Wenn etwas klemmt

- **Bridge findet kein Modell** → in `.env` die Variablen `LOKLM_EMBEDDER_PATH` /
  `LOKLM_RERANKER_PATH` / `LOKLM_JUDGE_PATH` setzen, oder das GGUF nach `models/`
  legen.
- **Absturz nach ~5 Modellen** (Windows-Speicherfehler) → nicht den in-Prozess-
  Mehrmodell-Modus nutzen, sondern `evals:pack` (genau dagegen gebaut: ein
  Unterprozess pro Modell).
- **Zwei Embedder liefern gleiche Werte** → du hast denselben Label vergeben
  (Cache-Falle). Eindeutige Labels setzen.
- **Judge-Ausgabe unbrauchbar** (Anteil „parsed" < 1) → Judge-Kontext zu klein,
  `--judge-context 8192` setzen, oder ein anderes Judge-GGUF via `--judge-path`.
- **Pod kostet Geld** → nach dem Generieren/Messen immer `pnpm pod:stop`.

Die Zuständigkeit für diese Säule bleibt bei dir (Test-Owner). Diese Anleitung
ist das Gerüst; welche Embedder/Reranker/Datensätze konkret rein sollen, hängt
davon ab, was als Nächstes in die App kommt.

```

```
