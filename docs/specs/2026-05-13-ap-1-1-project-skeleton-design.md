# AP-1.1 — Projekt-Skelett & Build-Pipeline — Design

**Status:** draft
**Datum:** 2026-05-13
**Owner:** Denys
**Bezug:** [LH] Lastenheft v1.0 §8, [PH] Pflichtenheft v1.1 §2.5, Anhang A, Anhang B
**Aufwand:** ~8h
**Vorgänger:** —
**Nachfolger:** AP-2.1 (Auth), AP-3.x (Dokumentenimport), alle weiteren APs

---

## Ziel

Aufsetzen eines reproduzierbaren Electron-Skeletts mit funktionierender Build-Pipeline, das alle nachfolgenden APs (Auth, DB, Import, Indexierung, Retrieval, Chat, Settings) als Fundament nutzen können. Ergebnis am Ende:

- `pnpm dev` startet die Anwendung mit leerem Renderer
- `pnpm test` läuft grün
- `pnpm typecheck`, `pnpm lint`, `pnpm build` und `pnpm doc` laufen ohne Fehler
- Pre-commit-Hook formatiert + lintet automatisch

## Kontext

Das Repo enthält bereits Teil-Arbeiten aus parallelen APs:

- `electron@^42.0.0`, `drizzle-orm`, `@electric-sql/pglite`, `argon2`, `tsx` in `package.json`
- `src/main/db/{database,schema}.ts` — Drizzle-DB-Schicht (halb-fertig; separate Spec [drizzle-switch-design](2026-05-13-drizzle-switch-design.md) deckt Fertigstellung ab)
- `src/main/services/auth/AuthService.ts` — AuthService in Arbeit
- `src/preload/index.ts` — IPC-Bridge mit `window.api.auth.*`
- `src/shared/authHelpers.ts` + `src/shared/passPhraseWords/{de,en}.ts` — Passwort-/Passphrase-Helper
- `src/main/index.ts` — leer (Window-Lifecycle fehlt)
- `drizzle/`, `drizzle.config.ts` — DB-Migrationen
- `docs/specs/`, `docs/work/` — bestehende Dokumentation

AP-1.1 berührt diese bestehenden Dateien **nicht semantisch**. Es fügt nur die fehlenden Skelett-Bestandteile hinzu (Build-Tooling, Renderer-Wurzel, Test-Setup, Lint/Format/Doku-Pipeline) und schreibt `src/main/index.ts` als minimalen Window-Lifecycle.

## Architektur-Entscheidungen

### Build-System: `electron-vite`

Pflichtenheft Anhang B pinnt `electron-vite ^2.3.0`. Das Tool bedient drei Bundles aus einer einzigen Config:

| Bundle       | Quelle          | Ziel                   | Entry                     | Tsconfig             |
| ------------ | --------------- | ---------------------- | ------------------------- | -------------------- |
| **main**     | `src/main/`     | `out/main/index.js`    | `src/main/index.ts`       | `tsconfig.node.json` |
| **preload**  | `src/preload/`  | `out/preload/index.js` | `src/preload/index.ts`    | `tsconfig.node.json` |
| **renderer** | `src/renderer/` | `out/renderer/`        | `src/renderer/index.html` | `tsconfig.web.json`  |

`pnpm dev` startet alle drei mit HMR (Renderer hot-reload, Main/Preload Neustart bei Änderung).

### Electron-Version

Pflichtenheft Anhang B pinnt Electron 33, das Repo läuft auf Electron 42. **Entscheidung: 42 bleibt**, Pflichtenheft wird in v1.2 angepasst. Risiko (Inkompatibilität electron-vite 2.3 ↔ Electron 42) ist in den Risiken erfasst.

### Path-Aliase

In `electron.vite.config.ts` und beiden tsconfigs identisch:

- `@main/*` → `src/main/*`
- `@preload/*` → `src/preload/*`
- `@shared/*` → `src/shared/*`
- `@renderer/*` → `src/renderer/src/*`

### TypeScript: drei Konfigurationen via Project References

**`tsconfig.json` (Root, Referenz-Hub):**

- `references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.web.json' }]`
- `files: []` — selbst kompiliert nichts
- `compilerOptions`: nur `baseUrl` + `paths` (Quelle für ESLint und IDE)

**`tsconfig.node.json` (main + preload + shared + Configs):**

- `include`: `src/main/**/*`, `src/preload/**/*`, `src/shared/**/*`, `electron.vite.config.ts`, `vitest.workspace.ts`, `drizzle.config.ts` (Configs nur als TS-Files; `eslint.config.js` wird nicht type-checked, da `allowJs` aus bleibt)
- `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`
- `types: ['node', 'electron']`
- `composite: true`, `outDir: '.tsbuildinfo-node'`

**`tsconfig.web.json` (renderer):**

- `include`: `src/renderer/**/*`, `src/shared/**/*`, `src/preload/index.d.ts`
- Gleicher strict-Stack
- `lib: ['ES2022', 'DOM', 'DOM.Iterable']`, `jsx: 'react-jsx'`
- `types: ['vite/client']` (kein `node`)
- `composite: true`, `outDir: '.tsbuildinfo-web'`

`pnpm typecheck` ruft `tsc -b` auf — beide Projekte parallel, incremental.

### Test-Setup: Vitest Workspaces

**`vitest.workspace.ts`** definiert zwei Projekte mit unterschiedlichen Environments:

```ts
export default defineWorkspace([
  {
    test: {
      name: 'node',
      include: ['src/main/**/*.test.ts', 'src/preload/**/*.test.ts', 'src/shared/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'web',
      include: ['src/renderer/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./src/renderer/src/setupTests.ts'],
    },
  },
])
```

- Co-located Tests gemäß Anhang-A-Konvention (`*.test.ts`/`*.test.tsx` neben dem getesteten Modul)
- `pnpm test` läuft beide Workspaces
- Coverage über `pnpm test:cov` → `coverage/` (gitignored)
- `setupTests.ts` füllt `globalThis.window.api` mit no-op Stubs, damit Renderer-Tests ohne preload laufen

**Zwei Smoke-Tests in AP-1.1** beweisen, dass beide Pipelines stehen:

1. `src/shared/authHelpers.smoke.test.ts` — importiert ein Pure-Function-Util aus `authHelpers.ts` und asserted ein triviales Verhalten (node env)
2. `src/renderer/src/App.smoke.test.tsx` — rendert `<App />` mit `@testing-library/react`, prüft `screen.getByRole('heading', { name: 'LokLM' })` (jsdom env)

DevDeps: `vitest@^2.1.8`, `@vitest/coverage-v8@^2.1.8`, `jsdom@^25`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`.

### ESLint: Flat Config v9

**`eslint.config.js`** als einzige Quelle:

- Basis: `@eslint/js` recommended
- TypeScript: `typescript-eslint@^8` mit `recommendedTypeChecked` (nutzt `tsconfig.json` als project)
- React (gegated auf `src/renderer/**`): `eslint-plugin-react`, `eslint-plugin-react-hooks@^5` (flat-config-bereit), `eslint-plugin-react-refresh`
- Globals: `node` für `src/main`, `src/preload`, `src/shared`, Root-Configs; `browser` für `src/renderer`
- `eslint-config-prettier` deaktiviert stilistische Regeln
- Ignored: `out/`, `dist/`, `coverage/`, `drizzle/`, `docs/api/`, `node_modules/`, `.tsbuildinfo*`, `public/`

### Prettier 3

`.prettierrc.json` mit projektweiten Defaults:

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "semi": false,
  "trailingComma": "all"
}
```

`.prettierignore` deckt dieselben Pfade ab wie ESLint-Ignored.

### Pre-commit-Hook (husky + lint-staged)

**`.husky/pre-commit`** läuft zwei Stufen:

1. `pnpm exec lint-staged` — auf staged Files:
   - `*.{ts,tsx}`: `prettier --write` → `eslint --fix`
   - `*.{json,md,yml,yaml,css,html}`: `prettier --write`
2. `pnpm typecheck` — `tsc -b` über das ganze Projekt (incremental, typisch <5s nach Erstlauf)

`prepare`-Script (`husky`) installiert den Hook bei `pnpm install`.

### TypeDoc

**`typedoc.json`:**

- `entryPoints`: `['src/main/index.ts', 'src/preload/index.ts', 'src/shared/index.ts']`
- `entryPointStrategy: 'expand'` — TypeDoc folgt Imports
- `out: 'docs/api'`
- `tsconfig: 'tsconfig.node.json'`
- `excludePrivate: true`, `excludeInternal: true`
- Default-Theme (kein Tuning in AP-1.1)

AP-1.1 legt einen kleinen Re-Export `src/shared/index.ts` an, damit TypeDoc dort einsteigen kann (re-exportiert `authHelpers`).

`docs/api/` ist gitignored — Doku wird beim Release neu generiert.

### Verzeichnis-Layout

Vollständige Repo-Struktur am Ende von AP-1.1:

```
LokLM/
├── electron.vite.config.ts          [neu]
├── vitest.workspace.ts              [neu]
├── tsconfig.json                    [neu — Root, Project References]
├── tsconfig.node.json               [neu — main + preload + shared]
├── tsconfig.web.json                [neu — renderer]
├── eslint.config.js                 [neu — flat config]
├── .prettierrc.json                 [neu]
├── .prettierignore                  [neu]
├── typedoc.json                     [neu]
├── .husky/pre-commit                [neu]
├── package.json                     [überarbeitet — scripts, devDeps, packageManager]
├── pnpm-lock.yaml                   [regeneriert]
├── README.md                        [erweitert — Quickstart, Scripts-Tabelle]
├── LICENSE                          [vorhanden]
├── .gitignore                       [erweitert: out/, dist/, coverage/, docs/api/, .vite/, .tsbuildinfo*, models/]
├── drizzle.config.ts                [vorhanden, unverändert]
├── drizzle/                         [vorhanden, unverändert]
├── docs/
│   ├── adr/                         [neu, leer + README]
│   ├── specs/                       [vorhanden]
│   ├── work/                        [vorhanden]
│   └── api/                         [neu, gitignored]
├── scripts/                         [vorhanden, leer]
├── tests/manual/                    [neu — README mit Verweis auf PH §8.3]
├── public/                          [vorhanden]
└── src/
    ├── main/
    │   ├── index.ts                 [aktuell leer — wird befüllt: minimaler BrowserWindow-Bootstrap]
    │   ├── env.d.ts                 [vorhanden]
    │   ├── db/                      [vorhanden, unangetastet]
    │   └── services/
    │       └── auth/AuthService.ts  [vorhanden, unangetastet]
    ├── preload/
    │   ├── index.ts                 [vorhanden, unverändert]
    │   └── index.d.ts               [vorhanden]
    ├── shared/
    │   ├── index.ts                 [neu — TypeDoc-Entry, re-exportiert authHelpers]
    │   ├── authHelpers.ts           [vorhanden, unverändert]
    │   └── passPhraseWords/         [vorhanden, unverändert]
    └── renderer/
        ├── index.html               [neu]
        └── src/
            ├── main.tsx             [neu — React-Bootstrap]
            ├── App.tsx              [neu — minimaler Inhalt]
            ├── App.smoke.test.tsx   [neu]
            ├── setupTests.ts        [neu — window.api-Stubs]
            └── styles.css           [neu, minimal]
```

### `src/main/index.ts` (Window-Lifecycle, AP-1.1-Inhalt)

Minimaler, AP-2.1-kompatibler Bootstrap. Lädt **noch keine** IPC-Handler — das macht AP-2.1.

Verantwortlichkeiten:

- `app.whenReady()` → `createWindow()`
- `BrowserWindow` mit `webPreferences.preload` auf den preload-Build und `contextIsolation: true`, `nodeIntegration: false`
- Im Dev: lädt die Vite-Dev-URL (`process.env.ELECTRON_RENDERER_URL`); im Prod: lädt `out/renderer/index.html`
- `window-all-closed` → quit (außer auf macOS — Pflichtenheft sagt Windows-only, also egal, aber Standard-Pattern lassen)
- `activate` (macOS) → ggf. neues Fenster

Renderer ruft beim Mount defensiv `window.api?.auth?.status()` mit try/catch auf — die Auth-Handler sind noch nicht registriert, der Catch fängt das.

### `package.json` Scripts (Endstand)

| Script         | Befehl                  | Zweck                                         |
| -------------- | ----------------------- | --------------------------------------------- |
| `dev`          | `electron-vite dev`     | Dev-Server mit HMR                            |
| `build`        | `electron-vite build`   | Production-Build                              |
| `start`        | `electron-vite preview` | Production-Build lokal testen                 |
| `test`         | `vitest run`            | Test-Lauf beider Workspaces                   |
| `test:watch`   | `vitest`                | Watch-Modus                                   |
| `test:cov`     | `vitest run --coverage` | Mit Coverage-Report                           |
| `lint`         | `eslint .`              | Lint ohne Auto-Fix                            |
| `lint:fix`     | `eslint . --fix`        | Lint mit Auto-Fix                             |
| `format`       | `prettier --write .`    | Prettier über alles                           |
| `format:check` | `prettier --check .`    | Prettier-Check                                |
| `typecheck`    | `tsc -b`                | Type-Check beide References                   |
| `doc`          | `typedoc`               | API-Doku → `docs/api/`                        |
| `doc:watch`    | `typedoc --watch`       | Doc-Watch                                     |
| `prepare`      | `husky`                 | Husky-Setup                                   |
| `db:generate`  | `drizzle-kit generate`  | [vorhanden]                                   |
| `db:studio`    | `drizzle-kit studio`    | [vorhanden]                                   |
| `db:check`     | `drizzle-kit check`     | [vorhanden]                                   |
| `postinstall`  | `electron-rebuild -f`   | Native Module für Electron neu bauen (argon2) |

## Definition of Done

Vor commit/merge **manuell** durchlaufen:

1. `pnpm install` läuft fehlerfrei durch (inkl. `postinstall: electron-rebuild`)
2. `pnpm dev` öffnet ein Electron-Fenster mit `<h1>LokLM</h1>` — keine Konsole-Errors
3. `pnpm build` produziert `out/main/`, `out/preload/`, `out/renderer/` ohne Errors
4. `pnpm test` läuft grün (beide Workspaces, ≥2 Tests)
5. `pnpm typecheck` läuft grün
6. `pnpm lint` läuft grün
7. `pnpm format:check` läuft grün
8. `pnpm doc` produziert `docs/api/index.html`
9. Pre-commit-Hook: testweise schlecht formatierte Datei stagen + commit-Versuch → Hook formatiert sie

## Anhang-A-Anpassungen (gehen ins Pflichtenheft v1.2)

Diffs gegen Anhang A v1.1, die nach AP-1.1 ins Pflichtenheft eingepflegt werden:

1. `src/main/services/` darf Sub-Folder enthalten (z.B. `auth/`); AuthService bleibt unter `services/auth/AuthService.ts`
2. `tests/manual/` als Heimat für PH §8.3-Szenarien
3. Root-Configs erweitert um `vitest.workspace.ts`, `eslint.config.js`, `.prettierrc.json`, `typedoc.json`
4. `docs/adr/` wird als leeres Skelett ergänzt
5. `src/shared/index.ts` als TypeDoc-Entrypoint
6. `src/main/db/schema.sql` → `schema.ts` (durch separate Drizzle-Switch-Spec abgedeckt, nur Querverweis)
7. Electron-Version: 33 → 42

Diese Anpassungen werden **nicht** im AP-1.1-Spec selbst beschlossen — sie wandern in eine Note für AP-12 (Dokumentation).

## Risiken & Mitigations

| #   | Risiko                                                                                                                                     | Mitigation                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Electron 42 + electron-vite 2.3: electron-vite 2.x wurde primär gegen Electron 33 getestet. Mögliche ESM-Inkompatibilität im Main-Prozess. | Frühe Smoke-Aktion in der Implementierung: blanker `electron-vite create` Smoke-Test mit Electron 42. Falls bricht: entweder electron-vite 3-Beta oder Electron auf 33 zurück. Entscheidung ad hoc, im Implementierungs-Plan als Gate. |
| 2   | `@node-rs/argon2` (in AuthService importiert) hat native Bindings, die für die Electron-Node-Version neu gebaut werden müssen.             | `electron-rebuild` als devDep + `postinstall`-Script.                                                                                                                                                                                  |
| 3   | Flat-Config-ESLint-Plugins für React teils noch in Migration.                                                                              | Versionen im Plan exakt fixieren: `typescript-eslint@^8`, `eslint-plugin-react@^7.35`, `eslint-plugin-react-hooks@^5`. Fallback: `@eslint/compat`'s `fixupConfigRules`.                                                                |
| 4   | `pnpm typecheck` im pre-commit kann auf langsamen Rechnern >15s dauern.                                                                    | `composite: true` für incremental builds. Erstlauf ~10s, Folgeläufe <2s. Eskalation: typecheck in pre-push verschieben.                                                                                                                |
| 5   | Renderer-Smoke-Test braucht `window.api`-Mock.                                                                                             | `setupTests.ts` füllt `globalThis.window.api` mit no-op Stubs.                                                                                                                                                                         |
| 6   | Anhang A hat kein `tests/manual/` — Konflikt mit AP-1.1-Wortlaut.                                                                          | Pragmatisch: Ordner mit README anlegen, Diff für v1.2-Pflichtenheft dokumentieren.                                                                                                                                                     |

## Out of Scope für AP-1.1

- GitHub Actions CI (eigenes späteres AP)
- `electron-builder` Installer-Config (AP-12 Verteilung)
- Conventional Commits + commitlint
- VS-Code-Workspace-Empfehlungen
- Migration von `src/main/services/auth/` → `services/` (per Entscheidung Anhang A wird angepasst)
- Migration von `schema.sql` → `schema.ts` (durch separate Drizzle-Spec abgedeckt)
- Befüllung der IPC-Handler-Registrierung (AP-2.1)
- Renderer-Routing, i18n, UI-Komponenten (kommt mit AP-2.x ff.)

## Dep-Liste (AP-1.1 installiert)

**dependencies:** keine Änderungen — `@electric-sql/pglite`, `argon2`, `dotenv`, `drizzle-orm` bleiben wie sie sind.

**devDependencies (neu, mit gepinnten Ranges):**

| Paket                         | Range   | Rolle                                                         |
| ----------------------------- | ------- | ------------------------------------------------------------- |
| `electron-vite`               | ^2.3.0  | Build-Tooling                                                 |
| `vite`                        | ^5.4.0  | (transitiv via electron-vite, aber explizit gepinnt für Lock) |
| `electron-rebuild`            | ^3.2.9  | Native Module neu bauen                                       |
| `typescript`                  | ^5.6.3  | strict mode                                                   |
| `@types/node`                 | ^22     | Node-Typen für main/preload                                   |
| `react`                       | ^18.3.1 | UI                                                            |
| `react-dom`                   | ^18.3.1 | UI                                                            |
| `@types/react`                | ^18.3   | React-Typen                                                   |
| `@types/react-dom`            | ^18.3   | React-DOM-Typen                                               |
| `@vitejs/plugin-react`        | ^4.3    | React-Plugin für Renderer-Build                               |
| `vitest`                      | ^2.1.8  | Test-Runner                                                   |
| `@vitest/coverage-v8`         | ^2.1.8  | Coverage                                                      |
| `jsdom`                       | ^25     | DOM-Environment für Renderer-Tests                            |
| `@testing-library/react`      | ^16     | Renderer-Test-Utils                                           |
| `@testing-library/jest-dom`   | ^6      | DOM-Matcher                                                   |
| `eslint`                      | ^9.15   | Linter                                                        |
| `@eslint/js`                  | ^9.15   | ESLint Basis-Configs                                          |
| `typescript-eslint`           | ^8.16   | TS-ESLint (flat-config)                                       |
| `eslint-plugin-react`         | ^7.37   | React-Lint-Regeln                                             |
| `eslint-plugin-react-hooks`   | ^5.0    | Hook-Regeln (flat-config-bereit)                              |
| `eslint-plugin-react-refresh` | ^0.4    | Refresh-Regeln                                                |
| `eslint-config-prettier`      | ^9.1    | Prettier-Integration                                          |
| `prettier`                    | ^3.3    | Formatter                                                     |
| `husky`                       | ^9.1    | Git-Hooks                                                     |
| `lint-staged`                 | ^15.2   | Staged-File-Linter                                            |
| `typedoc`                     | ^0.26   | Code-Doku                                                     |
| `globals`                     | ^15     | ESLint-Globals-Set                                            |

**Bestehende devDeps:** `drizzle-kit`, `electron`, `tsx` bleiben (Electron-Version aber bestätigt: ^42.0.0).

Versionen werden im Implementierungs-Plan endgültig festgenagelt und in `pnpm-lock.yaml` deterministisch gemacht.
