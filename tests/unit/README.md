# Unit-Tests

`pnpm test:unit` führt alle fünf Unit-Projekte aus. Datenbanken, native Modelle
und Electron-Fenster werden dabei nicht gestartet.

| Vitest-Projekt    | Dateien                                            | Laufzeit |
| ----------------- | -------------------------------------------------- | -------- |
| `node`            | `src/{main,preload,shared}/**/*.test.ts`           | Node     |
| `unit`            | `tests/unit/**/*.test.ts`                          | Node     |
| `web`             | `src/renderer/**/*.test.{ts,tsx}`                  | jsdom    |
| `scripts`         | `tests/unit/scripts/**/*.test.mjs`                 | Node     |
| `wizard-frontend` | `installer-wizard/frontend/__tests__/**/*.test.ts` | Node     |

Die Zuordnung steht in [`vitest.config.ts`](../../vitest.config.ts). Neue Tests
können neben ihrem Modul oder bei den zugehörigen Service-Tests in diesem
Verzeichnis liegen. Tests für Race Conditions verwenden kontrollierte Promises,
damit sie nicht von der Geschwindigkeit der Maschine abhängen.

```bash
pnpm test:unit
pnpm exec vitest run --project unit tests/unit/query-embedding-cache.test.ts
pnpm exec vitest --project web
```

Renderer-Tests verwenden die IPC-Stubs aus
[`setupTests.ts`](../../src/renderer/src/setupTests.ts). Fehler, verzögerte Antworten,
Abbruch und Workspace-Wechsel sollten dort geprüft werden, wo sie für den
Workflow relevant sind.

Tests mit echter verschlüsselter SQLite-Datenbank, Krypto oder gemeinsam
verdrahteten Services gehören nach [`tests/integration`](../integration/README.md).
Vault-Transaktionen liegen unter `tests/tx/`; echte Electron-IPC und native
GPU-Workflows unter [`tests/e2e`](../e2e/README.md).
