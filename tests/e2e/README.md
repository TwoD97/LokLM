# End-to-End-Tests

Playwright steuert die _gebaute_ Electron-App über den `_electron`-Driver. Im
Gegensatz zu integration- oder tx-Tests läuft hier ein echter Hauptprozess mit
echtem Renderer-Fenster, echte IPC, echter Preload.

## Voraussetzungen

- Einmalig: `pnpm install` (zieht `@playwright/test`).
- Vor jedem e2e-Lauf: gebaute Artefakte unter `out/`. Das Script `test:e2e`
  übernimmt das automatisch via `pretest:e2e`.

## Ausführen

| Befehl                             | Was er tut                                           |
| ---------------------------------- | ---------------------------------------------------- |
| `pnpm test:e2e`                    | Baut die App und fährt Playwright headless durch.    |
| `pnpm test:e2e:headed`             | Wie oben, aber mit sichtbarem Fenster fürs Debuggen. |
| `pnpm test:e2e -- -g 'app starts'` | Filter über Test-Namen.                              |

Berichte landen in `tests/e2e/.playwright-report/`, Traces und Screenshots
fehlgeschlagener Tests in `tests/e2e/test-results/`. Beides ist gitignoriert.

## Konventionen

- Dateinamen: `*.spec.ts` (vitest nimmt nur `*.test.ts`, daher die Trennung).
- Jeder Spec startet seine eigene App-Instanz mit eigenem
  `userData`-Verzeichnis (siehe [`helpers/launch.ts`](./helpers/launch.ts)).
  Kein gemeinsamer Login-State zwischen Tests.
- Selektoren über `getByRole`, `getByLabel` etc. — keine CSS-Selektoren.
- Nach jedem Test `app.close()` in `afterEach`, sonst bleiben Prozesse offen.

## Beispiel

[`app.spec.ts`](./app.spec.ts) — startet die App, prüft dass der
Registrierungs-View kommt, schließt sauber.

Vorlagen für weitere Specs:

- `register.spec.ts`: kompletter Registrierungs-Flow inklusive Passphrase-Anzeige.
- `login.spec.ts`: pre-seed via tmp-userData mit einer existierenden vault-Datei,
  dann Login durchfahren.
- `lock-on-inactivity.spec.ts`: nach `INACTIVITY_MS` muss der Lock-Screen kommen.

## Was hier _nicht_ getestet wird

- Externe Auto-Updater, Code-Signing, Installer — das deckt der manuelle Layer
  (`tests/manual/`) ab.
- Hardware-Performance, Energieverbrauch, OS-spezifische Quirks — ebenfalls
  manuell.
