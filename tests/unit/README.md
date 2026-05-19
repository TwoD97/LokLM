# Unit-Tests

Unit-Tests prüfen einzelne Funktionen oder Komponenten in Isolation: keine
echte DB, keine echte Krypto-IO, keine Electron-Fenster.

## Wo sie liegen

Unit-Tests werden _nicht_ unter `tests/unit/` abgelegt, sondern direkt neben
dem zu testenden Modul:

```
src/shared/authHelpers.ts
src/shared/authHelpers.smoke.test.ts        <- unit test daneben
```

Diese Konvention ist in `vitest.workspace.ts` über die Patterns
`src/main/**/*.test.ts`, `src/preload/**/*.test.ts`, `src/shared/**/*.test.ts`
und `src/renderer/**/*.test.{ts,tsx}` verdrahtet.

Diesen Ordner gibt es nur, damit die README hier dokumentiert ist. Es gehören
keine Tests hier rein.

## Beispiele im Repo

- [`src/shared/authHelpers.smoke.test.ts`](../../src/shared/authHelpers.smoke.test.ts) — reine Funktions-Tests ohne externe Abhängigkeit.
- [`src/renderer/src/App.smoke.test.tsx`](../../src/renderer/src/App.smoke.test.tsx) — React-Komponente mit gestubbtem `window.api` über `setupTests.ts`.

## Wann ein Test ein Unit-Test ist

- Er hängt nicht von der Reihenfolge anderer Tests ab.
- Er braucht keine echte Datei und keinen echten Prozess.
- Er ist in unter 100ms durch.
- Externe Abhängigkeiten (DB, Filesystem, Krypto-IO) sind gestubbt.

Sobald _eines_ davon nicht mehr stimmt, gehört der Test eine Ebene tiefer in
`tests/integration/` oder `tests/tx/`.

## Was sich hier gut testen lässt

- Reine Helper-Funktionen (`shared/`)
- Argumentvalidierung, Edge-Cases von Funktionssignaturen
- React-Komponenten gegen einen gestubbten `window.api`
- Pure Logik in Services (z.B. die Berechnung von Lockout-Zeitstempeln)

Was sich hier _nicht_ gut testen lässt: alles, was über das Filesystem, einen
echten PGlite-Prozess oder echte Krypto-Round-Trips läuft — das gehört nach
`tests/integration/` oder `tests/tx/`.
