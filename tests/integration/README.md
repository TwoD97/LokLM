# Integrationstests

Integrationstests verdrahten mehrere Module zusammen und prüfen, dass sie als
Verbund das Erwartete tun. Es läuft kein Electron-Fenster und kein
Playwright-Browser — alles passiert in-Process unter Vitest.

## Wann ein Test hier reingehört

- Der Test instanziiert mehr als ein eigenes Modul (z.B. `AuthService` _und_
  `Database`).
- Er benutzt echte Krypto oder verschlüsselte SQLite-Datenbanken, ohne
  Electron-IPC.
- Er braucht ein tmp-Verzeichnis fürs Filesystem.

Sobald der Test den vollen Vault-Disk-Round-Trip prüft, gehört er nach
`tests/tx/vault/`. Sobald er die Electron-IPC ausfährt, gehört er nach
`tests/e2e/`.

## Konventionen

- Dateinamen: `*.test.ts`. Werden über `vitest.config.ts` als project
  `integration` eingesammelt.
- Jeder Test räumt seine tmp-Pfade in einem `afterEach` weg.
- Keine globalen Singletons. Pro Test ein frischer `AuthService` mit eigenem
  tmp-Verzeichnis.

## Native Modelle ausdrücklich aktivieren

`pnpm test:integration` und `pnpm test:tx` wählen automatisch die Laufzeit,
die zur installierten SQLite-Bindung passt: Node oder Electron im Node-Modus.
Dabei wird kein Fenster geöffnet und kein natives Modul neu gebaut. So bleibt
`pnpm dev` nach dem Testlauf funktionsfähig. Bei Bedarf lässt sich die Auswahl
mit `LOKLM_TEST_RUNTIME=node` oder `LOKLM_TEST_RUNTIME=electron` festlegen.

Die vier älteren GGUF-Suites (`embedding-backfill`, `retrieval-pipeline`,
`retrieval-corpus-e2e`, `qa-answer`) laufen nur mit
`LOKLM_NATIVE_INTEGRATION=1` **und** vorhandenen Modelldateien. Ein lokaler
Modell-Cache darf den normalen Datenbank-Testlauf nicht automatisch in einen
mehrminütigen Inferenzlauf verwandeln.

```powershell
$env:LOKLM_NATIVE_INTEGRATION = '1'
pnpm.cmd test:integration tests/integration/retrieval-pipeline.test.ts
Remove-Item Env:LOKLM_NATIVE_INTEGRATION
```

Diese älteren Tests verwenden einen In-Process-Modelladapter und prüfen nicht
die GPU-Ressourcenverwaltung der Anwendung. Dafür dient der gesonderte native
Electron-Testlauf unter `tests/e2e/`; Modellläufe müssen die Hardware exklusiv
nutzen. Der normale Testlauf aktiviert diese Modelltests nicht.

## Beispiel

[`auth-flow.test.ts`](./auth-flow.test.ts) zeigt den kompletten happy-path
durch `AuthService` ohne Disk-Round-Trip-Assertion: register, status, lock,
login. Vorlage für weitere Flows wie reset-mit-Passphrase oder Lockout nach 5
Fehlversuchen.
