# End-to-End-Tests

Playwright steuert die **gebaute Electron-App** mit echtem Hauptprozess, Preload,
Renderer und IPC. Ein verborgenes Electron-Fenster ist **kein Headless-Browser**:
native Modelle können trotzdem CPU, RAM und GPU belegen. Native Läufe deshalb
einzeln ausführen und vorher andere LokLM-Instanzen schließen. Während eines
Laufs nicht neu bauen, weil die App ihre Dateien aus `out/` lädt.

## Isolation und Aufräumen

Neue Specs verwenden [`launchApp`](./helpers/launch.ts). Der Helper erstellt ein
temporäres Profil und setzt zusätzlich `LOKLM_DATA_DIR` auf dessen eigenen
`vault`-Unterordner. Geerbte `LOKLM_DATA_DIR`, `ELECTRON_RUN_AS_NODE` und
`ELECTRON_RENDERER_URL` können damit keinen Lauf in den Benutzertresor oder einen
Dev-Server umleiten. `restart()` öffnet dasselbe Testprofil; `cleanup()` schließt
Electron und entfernt nur das eigene temporäre Verzeichnis. `cleanup()` gehört
in `finally` oder `afterEach`, auch bei fehlgeschlagenen Assertions.

Fenster sind standardmäßig verborgen, Hintergrund-Drosselung ist deaktiviert.
Für bewusst sichtbares Debugging `launchApp({ visible: true })` verwenden.
Playwrights `--headed` beziehungsweise `test:e2e:headed` allein überschreibt
diese Electron-Option nicht. Es gibt keinen gemeinsamen Login-State zwischen
Tests und keine erforderliche Kopie eines Benutzertresors.

## Befehle

Nach `pnpm install` vom Repository-Stamm starten. Unter PowerShell verhindert
`pnpm.cmd` Konflikte mit gesperrten PowerShell-Shims:

```powershell
pnpm.cmd build
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/accessibility.spec.ts tests/e2e/settings.spec.ts
```

Nur die Testliste prüfen, ohne Electron zu starten:

```powershell
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts --list
```

`pnpm test:e2e` baut zuerst und führt die normalen Specs aus; mit `@screenshots`
markierte Aufnahmen sind ausgeschlossen. Ein gezielter Aufruf über
`pnpm exec playwright test` baut **nicht** automatisch. `--grep "Testname"`
filtert Tests; `--output out/e2e-review` bewahrt Ergebnisse anderer Läufe.
Standardmäßig liegen Artefakte in `test-results/` am Repository-Stamm. CI erstellt
zusätzlich `.playwright-report/`; beides ist ignoriert.

## Native Opt-ins

Die Variablen aktivieren jeweils nur den entsprechenden Test. Die ersten sieben
Specs benötigen installierte Modelle und eine freie GPU; OCR und der Paket-Smoke
sind unten getrennt beschrieben:

| Spec                             | Opt-in                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `chat-gpu-handoff.spec.ts`       | `LOKLM_NATIVE_CHAT=1`                                                                             |
| `generated-documents.spec.ts`    | `LOKLM_NATIVE_DOCUMENTS=1`                                                                        |
| `indexing-native.spec.ts`        | `LOKLM_TEST_PDF=<absoluter Pfad zu einer freigegebenen Test-PDF>`                                 |
| `native-rag-calibration.spec.ts` | `LOKLM_NATIVE_RAG=1`; Details im [Kalibrierungs-README](../evals/native-calibration/README.md)    |
| `native-session-restore.spec.ts` | `LOKLM_NATIVE_RESTORE=1` und explizites `LOKLM_LLM_CONTEXT_SIZE`                                  |
| `ollama-native-fallback.spec.ts` | `LOKLM_NATIVE_OLLAMA_FALLBACK=1` und `LOKLM_LLM_CONTEXT_SIZE=4096`                                |
| `session-dialogs.spec.ts`        | `LOKLM_NATIVE_SESSION_DIALOGS=1`                                                                  |
| `documents-worker-ocr.spec.ts`   | `LOKLM_NATIVE_DOCUMENTS_OCR=1`; lokale OCR-Sprachdaten, keine Modelle                             |
| `packaged-windows.spec.ts`       | `LOKLM_PACKAGED_EXE=<absoluter Pfad zur gebauten LokLM.exe>`; Windows, keine Modelle erforderlich |

Beispiel für einen einzelnen GPU-Lauf nach dem Build:

```powershell
$env:LOKLM_NATIVE_CHAT = '1'
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/chat-gpu-handoff.spec.ts
Remove-Item Env:LOKLM_NATIVE_CHAT
```

Nur den echten Chat-UI-Ablauf (Senden, Quellenleser, atomisches Regenerieren,
Navigation und gespeicherten Verlauf erneut öffnen) ausführen:

```powershell
$env:LOKLM_NATIVE_CHAT = '1'
pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/chat-gpu-handoff.spec.ts --grep 'chat UI'
Remove-Item Env:LOKLM_NATIVE_CHAT
```

Dieser Fall verwendet eine erfundene Textdatei und zwei echte Antworten, begrenzt
den gesamten Lauf auf acht Minuten und zeichnet keine Recovery-Wörter auf. Der
JSON-Anhang enthält nur Zeiten, synthetische IDs und den verwendeten Quellenpfad
in der Oberfläche (`inline` oder `provided-footer`), keine lokalen Dateipfade.

Auch ohne diese Opt-ins kann ein normaler Workflow nach dem Entsperren installierte
Modelle im Hintergrund laden. Die Opt-ins sind keine globale Abschaltung der GPU.
Kalibrierungen verwenden erfundene Dokumente und eigene Ergebnisordner; vorhandene
DEV/Held-out-Berichte nicht überschreiben oder als neue unabhängige Messung ausgeben.

### Sperren, Entsperren und GPU-Allokation

[`native-session-restore.spec.ts`](./native-session-restore.spec.ts) prüft einen
Kaltstart, einen normalen Sperr-/Login-Zyklus und direkt nacheinander gesendete
Lock-/Login-Aufrufe. Jeder Zyklus muss einen neuen Modellprozess mit GPU-Belegung
und mindestens dem angeforderten Kontext starten. Der Kandidat muss qualifizierte
Allokationshinweise übernehmen und tatsächlich verwenden; der Kontrolllauf
deaktiviert die gesamte Wiederverwendung mit `LOKLM_REUSE_GPU_LAYER_PLAN=0`.

Beide Läufe mit demselben Build, explizitem 4K-Ziel und getrennten, noch nicht
existierenden Ergebnisordnern ausführen:

```powershell
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:LOKLM_NATIVE_RESTORE = '1'
$env:LOKLM_LLM_CONTEXT_SIZE = '4096'
try {
  $env:LOKLM_REUSE_GPU_LAYER_PLAN = '0'
  $env:LOKLM_NATIVE_RESTORE_OUTPUT = "out/native-restore-$runStamp-control"
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/native-session-restore.spec.ts --output "out/playwright-restore-$runStamp-control"
  if ($LASTEXITCODE -ne 0) { throw 'Restore-Kontrolllauf fehlgeschlagen' }

  $env:LOKLM_REUSE_GPU_LAYER_PLAN = '1'
  $env:LOKLM_NATIVE_RESTORE_OUTPUT = "out/native-restore-$runStamp-candidate"
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/native-session-restore.spec.ts --output "out/playwright-restore-$runStamp-candidate"
} finally {
  Remove-Item Env:LOKLM_NATIVE_RESTORE, Env:LOKLM_LLM_CONTEXT_SIZE, Env:LOKLM_REUSE_GPU_LAYER_PLAN, Env:LOKLM_NATIVE_RESTORE_OUTPUT -ErrorAction SilentlyContinue
}
```

`restore.json` enthält getrennte Kaltstart-/Entsperrzeiten, tatsächliche Modell-
und Kontextpläne sowie Cache-Ereignisse; `app.log` enthält die Prozessdiagnostik.
Hashes aller kompilierten Main-/Worker-/Preload-Dateien werden vor und nach dem
Lauf verglichen. Die Zeiten umfassen auch Authentifizierung und UI-Warmup und
sind keine isolierten Inferenzmessungen. Jeder Arm verwendet einen eigenen
temporären Tresor; die Ergebnisordner bleiben erhalten.

### Ollama-Ausfall und ausstehende Dateidialoge

[`ollama-native-fallback.spec.ts`](./ollama-native-fallback.spec.ts) startet einen
eigenen HTTP-Server auf `127.0.0.1` mit einem freien Port und antwortet mit 503.
Nur der externe Chat-Modellname wird konfiguriert. Echte lokale Indexierung,
GPU-Fallback, Quellenbeleg und Antwortspeicherung müssen trotzdem funktionieren.
Es gibt keinen externen Server, Zugangsschlüssel oder Download. Das 4K-Ziel ist
verpflichtend; der Test prüft das native Ausgabelimit von 1.024 Tokens und den
fortbestehenden Fallback-Status. Dies ist eine zusätzliche Ablaufregression,
keine neue unabhängige Held-out-Qualitätsmessung.

```powershell
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:LOKLM_NATIVE_OLLAMA_FALLBACK = '1'
$env:LOKLM_LLM_CONTEXT_SIZE = '4096'
$env:LOKLM_NATIVE_OLLAMA_FALLBACK_OUTPUT = "out/native-fallback-$runStamp"
try {
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/ollama-native-fallback.spec.ts --output "out/playwright-fallback-$runStamp"
} finally {
  Remove-Item Env:LOKLM_NATIVE_OLLAMA_FALLBACK, Env:LOKLM_LLM_CONTEXT_SIZE, Env:LOKLM_NATIVE_OLLAMA_FALLBACK_OUTPUT -ErrorAction SilentlyContinue
}
```

Der Ergebnisordner muss neu sein. `fallback.json` und `app.log` halten Zeitstempel,
Quell-/Build-Hashes, die synthetische Antwort und numerische HTTP-Budgetdaten fest.

[`session-dialogs.spec.ts`](./session-dialogs.spec.ts) hält native Dateiauswahlen
gezielt offen. Ein Ordnerdialog aus einer inzwischen gesperrten Sitzung darf
nach erneutem Login nichts anlegen. Ein Quellenersatz nach Bibliothekswechsel
muss dagegen das ursprünglich ausgewählte Dokument ändern, auch bei identischen
lokalen Dokument-IDs. Der Test verwendet nur temporäre Dateien:

```powershell
$env:LOKLM_NATIVE_SESSION_DIALOGS = '1'
try {
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/session-dialogs.spec.ts
} finally {
  Remove-Item Env:LOKLM_NATIVE_SESSION_DIALOGS
}
```

### OCR im echten Dokumentprozess

[`documents-worker-ocr.spec.ts`](./documents-worker-ocr.spec.ts) lässt die App
gesperrt und startet ausschließlich den gebauten Dokument-Utility-Prozess.
Es ist ein CPU-Test ohne Modell-Warmup oder GPU-Inferenz. Benötigt werden lokale
`eng.traineddata` und `deu.traineddata` in `tessdata/` oder in
`LOKLM_TESSDATA_DIR` sowie eine verfügbare Systemschrift.

```powershell
$env:LOKLM_NATIVE_DOCUMENTS_OCR = '1'
try {
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/documents-worker-ocr.spec.ts
} finally {
  Remove-Item Env:LOKLM_NATIVE_DOCUMENTS_OCR
}
```

Die lokal erzeugte PDF kombiniert eine Textseite mit einer eingescannten Seite.
Zwei gleichzeitige Parse-Aufträge prüfen Seitenreihenfolge, erkannte Fakten,
Chunk-Seitenangaben, Fortschritt nach Request-ID und bestätigtes Prozessende
nach Shutdown. `ocr.json` enthält diese synthetischen Ergebnisse und Build-Hashes.
Der Test belegt keine allgemeine OCR-Qualität für Tabellen, Fotos oder Handschrift.

### Gebautes Windows-Paket

[`packaged-windows.spec.ts`](./packaged-windows.spec.ts) startet die angegebene
gepackte Anwendung mit ihren ausgelieferten Electron-Fuses. Playwright verbindet
sich nur mit Chromium über einen lokalen CDP-Port; Node-Inspektion, Main-Prozess-
Testzugänge und `ELECTRON_RUN_AS_NODE` werden nicht benötigt. Der Test verwendet
ein eigenes Profil und einen eigenen Tresor, prüft Notizen, Aufgaben und erzeugte
Dokumentquellen nach Neustart sowie abschließendes Sperren. Modelle sind für
diese Persistenzprüfung nicht erforderlich.

```powershell
$env:LOKLM_PACKAGED_EXE = 'D:\LokLM\release\optimization-smoke\win-unpacked\LokLM.exe'
try {
  pnpm.cmd exec playwright test --config tests/e2e/playwright.config.ts tests/e2e/packaged-windows.spec.ts
} finally {
  Remove-Item Env:LOKLM_PACKAGED_EXE
}
```

Den Pfad an das zuvor gebaute Paket anpassen. Dieser Smoke prüft den Paketstart
und die persistierten Funktionen, aber weder Installer-Ausführung, Signierung,
Update-Installation noch Modelldownloads. Alle fünf hier beschriebenen Specs
deaktivieren Screenshots, Videos und Traces ausdrücklich.

## Barrierefreiheit und sensible Daten

[`accessibility.spec.ts`](./accessibility.spec.ts) prüft echte gerenderte Zustände
mit axe, einschließlich nativer Farbkontrastprüfung, sowie Tastatur-Navigation und
Dialog-Fokus. Ein automatischer Pass deckt nicht die als `incomplete` markierten
Kontrastfälle oder eine vollständige Screenreader-Prüfung ab. Die angehängten
JSON-Dateien enthalten Regel-IDs und Selektoren, keine HTML-Snapshots oder Feldwerte.

Registrierung für gewöhnliche Workflows möglichst per API innerhalb des Renderers
ausführen und das Ergebnis dort verwerfen. Wiederherstellungswörter niemals an
Playwright zurückgeben, protokollieren oder in Screenshots, Videos, Traces und
Snapshots speichern. Die Accessibility- und Settings-Specs zeigen keine Wörter an
und setzen ausdrücklich `trace`, `screenshot` und `video` auf `off`. Die leere
Recovery-Eingabemaske lässt sich ohne echte Wörter prüfen. Vor zusätzlichen
Reveal-Tests auch Fehlerartefakte prüfen; die globale Fehler-Aufzeichnung ist
kein sicherer Standard für geheime Bildschirminhalte. Für Dokumente nur synthetische
oder ausdrücklich freigegebene Fixtures verwenden.

## Konventionen und Grenzen

- Specs heißen `*.spec.ts`; Vitest verwendet `*.test.ts` beziehungsweise `*.test.tsx`.
- Rollen und Labels bevorzugen; stabile Container-Selektoren für Layout oder klar
  abgegrenzte Komponenten sind zulässig.
- Fehler, verspätete Antworten, Navigation und Persistenz prüfen; zeitabhängige
  Assertions pollen statt feste lange Wartezeiten einzubauen.
- Erfolgreiche UI-Tests belegen weder Modellqualität noch Leistungsgewinne.
  Dafür gibt es getrennte native Kalibrierungen. Installer, Signierung, Updates,
  Energieverbrauch und vollständige Plattformabdeckung benötigen weitere Prüfungen.
