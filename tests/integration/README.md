# Integrationstests

Integrationstests verdrahten mehrere Module zusammen und prüfen, dass sie als
Verbund das Erwartete tun. Es läuft kein Electron-Fenster und kein
Playwright-Browser — alles passiert in-Process unter Vitest.

## Wann ein Test hier reingehört

- Der Test instanziiert mehr als ein eigenes Modul (z.B. `AuthService` _und_
  `Database`).
- Er benutzt echte Krypto oder echte PGlite, _aber_ ohne Disk-Round-Trip oder
  ohne IPC.
- Er braucht ein tmp-Verzeichnis fürs Filesystem.

Sobald der Test den vollen Vault-Disk-Round-Trip prüft, gehört er nach
`tests/tx/vault/`. Sobald er die Electron-IPC ausfährt, gehört er nach
`tests/e2e/`.

## Konventionen

- Dateinamen: `*.test.ts`. Werden über `vitest.workspace.ts` als project
  `integration` eingesammelt.
- Jeder Test räumt seine tmp-Pfade in einem `afterEach` weg.
- Keine globalen Singletons. Pro Test ein frischer `AuthService` mit eigenem
  tmp-Verzeichnis.

## Beispiel

[`auth-flow.test.ts`](./auth-flow.test.ts) zeigt den kompletten happy-path
durch `AuthService` ohne Disk-Round-Trip-Assertion: register, status, lock,
login. Vorlage für weitere Flows wie reset-mit-Passphrase oder Lockout nach 5
Fehlversuchen.
