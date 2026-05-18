# Tests

Übersicht über alle Test-Ebenen für LokLM. Diese Datei ist die Einstiegsstelle
für jeden, der herausfinden will _was_ getestet wird, _wo_ es liegt und _wie_
es ausgeführt wird.

Die Testpyramide gliedert sich in fünf Ebenen, von schnell und isoliert nach
langsam und realistisch:

| Ebene               | Ordner / Konvention   | Runner     | Was wird getestet                                              |
| ------------------- | --------------------- | ---------- | -------------------------------------------------------------- |
| Unit                | `src/**/*.test.ts(x)` | Vitest     | Einzelne Funktionen und Komponenten ohne externe Abhängigkeit. |
| Integration         | `tests/integration/`  | Vitest     | Mehrere Module zusammen, in-Process, ohne Electron-Fenster.    |
| Transaktional DB    | `tests/tx/db/`        | Vitest     | Datenbankoperationen mit `BEGIN/ROLLBACK`-Isolation pro Test.  |
| Transaktional Vault | `tests/tx/vault/`     | Vitest     | Voller Vault-Round-Trip: register → dump → encrypt → load.     |
| End-to-End          | `tests/e2e/`          | Playwright | Gebaute Electron-App, echte Main↔Renderer-IPC.                 |
| Manuell             | `tests/manual/`       | Mensch     | Skripte für manuelle Durchführung an einer lauffähigen App.    |

Daneben gibt es noch eine separate Säule für Qualitäts-Evals:

| Säule         | Ordner         | Runner                 | Was wird bewertet                                                         |
| ------------- | -------------- | ---------------------- | ------------------------------------------------------------------------- |
| Quality-Evals | `tests/evals/` | tsx + Ollama/Anthropic | Embedder, Reranker, Chunker im Vergleich gegen synthetische Q→A-Datasets. |

## Scripts

| Befehl                     | Was er tut                                                                |
| -------------------------- | ------------------------------------------------------------------------- |
| `pnpm test`                | Vitest run über alle automatisierten Vitest-Layer (unit + int + tx).      |
| `pnpm test:watch`          | Vitest watch-Modus für lokales Entwickeln.                                |
| `pnpm test:cov`            | Vitest mit Coverage-Report (v8).                                          |
| `pnpm test:e2e`            | Playwright e2e gegen die gebaute App. Baut vorher automatisch mit.        |
| `pnpm test:e2e:headed`     | Wie oben, aber mit sichtbarem Fenster für lokales Debuggen.               |
| `pnpm test:all`            | Vitest + Playwright nacheinander. Was die CI fährt.                       |
| `pnpm evals:generate`      | Synthetisches Dataset für Quality-Evals aus den Sample-Docs erzeugen.     |
| `pnpm evals:run`           | Pipeline-Configs gegen das jüngste Dataset durchlaufen, Report schreiben. |
| `pnpm evals:build-library` | Distractor-Library für Scale-Tests bauen (`-- --size tiny/small/...`).    |
| `pnpm evals:scale`         | Scaling-Report über alle Library-Stufen (Quality + Latency + Memory).     |

Manuelle Tests werden nicht per Script ausgeführt. Sie liegen als Markdown in
`tests/manual/` und werden Schritt für Schritt am laufenden Programm
abgearbeitet.

## Konventionen

- Dateinamen automatisierter Tests: `*.test.ts` für Vitest, `*.spec.ts` für
  Playwright e2e. Daran hängt die Workspace-Konfiguration.
- Unit-Tests liegen direkt _neben_ dem zu testenden Modul (`Foo.ts` →
  `Foo.test.ts`). Nicht in einen separaten Ordner verschieben.
- Integration- und Transaktions-Tests liegen unter `tests/`, damit klar ist,
  dass sie mehrere Module zusammenziehen.
- e2e-Tests laufen gegen den `out/`-Build. Ohne `pnpm build` schlagen sie fehl
  oder testen einen veralteten Stand.
- Jeder Test sollte sich selbst aufräumen: tmp-Verzeichnisse löschen,
  PGlite-Instanzen schließen, Electron-App killen.

## Was wo getestet wird

Konkrete Zuordnung, welcher Codebereich auf welcher Ebene abgedeckt sein soll:

| Bereich                          | Unit | Integration | Tx-DB | Tx-Vault | e2e | Manuell |
| -------------------------------- | :--: | :---------: | :---: | :------: | :-: | :-----: |
| `shared/authHelpers`             |  ✓   |             |       |          |     |         |
| `main/services/auth/AuthService` |  ✓   |      ✓      |       |    ✓     |     |    ✓    |
| `main/db/database`               |  ✓   |      ✓      |   ✓   |          |     |         |
| Renderer-Komponenten             |  ✓   |             |       |          |  ✓  |    ✓    |
| Main↔Preload↔Renderer IPC        |      |      ✓      |       |          |  ✓  |    ✓    |
| Vault-Datei auf Disk             |      |             |       |    ✓     |  ✓  |    ✓    |
| Hardware-/OS-Spezifika           |      |             |       |          |     |    ✓    |

✓ heißt: auf dieser Ebene gibt es mindestens einen Test, der den Bereich
berührt. Vollständigkeit ist nicht das Ziel — Redundanz quer durch die Pyramide
ist gewollt.

## Zuständigkeit

Dominik ist Test-Owner. Das heißt: er verantwortet die gesamte Test-Strategie,
die Abdeckung, das Schreiben und Pflegen der Tests sowie die Durchführung der
manuellen Szenarien. Denys schreibt Tests nur zu dem Code dazu, den er gerade
selbst implementiert (kleine Co-Located-Unit-Tests neben neuen Modulen) — der
Rest läuft über Dominik.

Konkret:

- **Unit-Tests**: Dominik baut die Abdeckung breitflächig auf. Denys ergänzt
  punktuell, wenn er ein Modul schreibt.
- **Integration- und Transaktions-Tests**: Dominik komplett. Bei Fragen zum
  Auth-Pfad fragt er Denys, sonst eigenverantwortlich.
- **e2e-Tests**: Dominik. Pro neuem User-Flow ein Spec.
- **Manuelle Tests**: Dominik führt durch und protokolliert in den jeweiligen
  Markdown-Dateien. Mindestens vor jedem Release.
- **Quality-Evals**: Dominik baut Datasets, pflegt Configs, fährt Vergleiche.

## Pflichtenheft-Bezug

Die Test-Ebenen decken §8 (Testkonzept) des Pflichtenhefts ab:

- §8.1 Unit-Tests → `src/**/*.test.ts`
- §8.2 Integrationstests → `tests/integration/`, `tests/tx/`
- §8.3 Manuelle Testszenarien → `tests/manual/`
- §8.4 Abnahme-/Systemtests → `tests/e2e/`
