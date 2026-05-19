# Third-Party Licenses — LokLM

**Status:** living document
**Letzte Aktualisierung:** 2026-05-14
**Eigenes Projekt-Lizenz:** MIT (siehe [LICENSE](../LICENSE))

---

## Zweck

Diese Datei führt **alle direkten Abhängigkeiten** von LokLM (Produktion + Entwicklung) mit Version, Lizenz und Urheberrechts-Inhaber auf. Sie ist die Anlaufstelle für:

1. **Attribution** — MIT/BSD/ISC/Apache-2.0 verlangen, dass Copyright-Hinweis + Lizenztext bei Weiterverteilung mitgeliefert werden.
2. **Lizenz-Kompatibilität** — Nachweis, dass keine der eingesetzten Lizenzen mit der MIT-Lizenz des Projekts kollidiert (alle aufgeführten Lizenzen sind GPL-kompatibel-permissive und mit MIT-Distribution vereinbar).
3. **Projektdokumentation** — Pflichtenheft §1.5 verlangt eine Lizenzübersicht der eingesetzten Third-Party-Komponenten.

Transitive Abhängigkeiten (npm-/pnpm-Resolver pflegt sie in `pnpm-lock.yaml`) werden hier **nicht einzeln gelistet**. Sie sind über `pnpm licenses list` reproduzierbar abrufbar — siehe [§ Reproduzierbarkeit](#reproduzierbarkeit). Die Lizenz-Verteilung der ~700 transitiven Pakete liegt zu > 95 % bei MIT/ISC/BSD/Apache-2.0 (kompatibel) — keine Copyleft-Lizenz (GPL/AGPL/LGPL/MPL) in der `dependencies`- oder `devDependencies`-Hülle.

## Produktions-Abhängigkeiten

Diese Pakete werden mit dem Electron-Bundle ausgeliefert und müssen attributiert werden.

| Paket                                                            | Version | Lizenz       | Copyright-Inhaber      | Rolle                                                                                                                 |
| ---------------------------------------------------------------- | ------- | ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`@electric-sql/pglite`](https://github.com/electric-sql/pglite) | 0.4.5   | Apache-2.0   | Electric DB Limited    | WASM-Postgres als lokale relationale DB; Quelle des Tar-Dumps, der verschlüsselt wird.                                |
| [`argon2`](https://github.com/ranisalt/node-argon2)              | 0.44.0  | MIT          | Ranieri Althoff        | Node-Bindings zu libargon2; KDF für Passwort und Recovery-Passphrase ([ADR-0001](adr/0001-argon2id-password-kdf.md)). |
| [`dotenv`](https://github.com/motdotla/dotenv)                   | 17.4.2  | BSD-2-Clause | Scott Motte / Motdotla | Lädt `.env` für Dev-Konfiguration (Pfade, Feature-Flags). Nicht in Production aktiv.                                  |
| [`drizzle-orm`](https://github.com/drizzle-team/drizzle-orm)     | 0.45.2  | Apache-2.0   | Drizzle Team           | Typsicherer SQL-Builder für PGlite; Schema + Migrationen ([Drizzle-Spec](specs/database-drizzle.md)).                 |

### Stdlib-Komponenten (kein Lizenz-Eintrag nötig)

Werden über Node.js / Electron-Runtime bezogen und unterliegen der jeweiligen Runtime-Lizenz:

- **`node:crypto`** — AES-256-GCM, `randomBytes`, `timingSafeEqual` ([ADR-0002](adr/0002-envelope-encryption-aes-gcm.md))
- **`node:fs/promises`** — Atomare Datei-Persistenz
- **`node:path`**, **`node:os`** — Pfad-Auflösung
- **Electron Runtime / Chromium** — Renderer-Prozess; Electron MIT, Chromium BSD-3-Clause (Attribution via Electrons gebündelter `LICENSES.chromium.html` im Distributable)

## Entwicklungs-Abhängigkeiten

Werden **nicht** ausgeliefert. Attribution ist nicht zwingend erforderlich, aber Inventar für Audit und Pflichtenheft.

### Build / Bundling

| Paket                                                                 | Version | Lizenz     | Rolle                                                                            |
| --------------------------------------------------------------------- | ------- | ---------- | -------------------------------------------------------------------------------- |
| [`electron`](https://github.com/electron/electron)                    | 42.0.0  | MIT        | Desktop-Runtime; Container für Main + Renderer.                                  |
| [`electron-vite`](https://github.com/alex8088/electron-vite)          | 2.3.0   | MIT        | Build-Tool für die drei Electron-Bundles (main/preload/renderer) auf Vite-Basis. |
| [`vite`](https://github.com/vitejs/vite)                              | 5.4.20  | MIT        | Underlying Bundler.                                                              |
| [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react) | 4.7.0   | MIT        | React-Fast-Refresh + JSX-Transform für Renderer.                                 |
| [`@electron/rebuild`](https://github.com/electron/rebuild)            | 3.7.2   | MIT        | Rebuildet Native-Module (`argon2`) gegen die Electron-Node-ABI.                  |
| [`tsx`](https://github.com/privatenumber/tsx)                         | 4.20.6  | MIT        | TypeScript-Runner für Scripts (`scripts/download-models.mjs`-Pendants).          |
| [`typescript`](https://github.com/microsoft/TypeScript)               | 5.9.3   | Apache-2.0 | TypeScript-Compiler; `pnpm typecheck` und IDE-Type-Checking.                     |

### React / Renderer

| Paket                                                                    | Version  | Lizenz | Rolle                                     |
| ------------------------------------------------------------------------ | -------- | ------ | ----------------------------------------- |
| [`react`](https://github.com/facebook/react)                             | 18.3.1   | MIT    | Renderer-Framework.                       |
| [`react-dom`](https://github.com/facebook/react)                         | 18.3.1   | MIT    | DOM-Rendering-Pfad für React.             |
| [`@types/react`](https://github.com/DefinitelyTyped/DefinitelyTyped)     | 18.3.28  | MIT    | TypeScript-Typdefinitionen.               |
| [`@types/react-dom`](https://github.com/DefinitelyTyped/DefinitelyTyped) | 18.3.7   | MIT    | TypeScript-Typdefinitionen.               |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped)      | 22.19.19 | MIT    | TypeScript-Typdefinitionen für Node-APIs. |

### Tests / Qualitätssicherung

| Paket                                                                                | Version | Lizenz | Rolle                                      |
| ------------------------------------------------------------------------------------ | ------- | ------ | ------------------------------------------ |
| [`vitest`](https://github.com/vitest-dev/vitest)                                     | 2.1.9   | MIT    | Test-Runner.                               |
| [`@vitest/coverage-v8`](https://github.com/vitest-dev/vitest)                        | 2.1.9   | MIT    | Coverage-Reporter über V8-Instrumentation. |
| [`@testing-library/react`](https://github.com/testing-library/react-testing-library) | 16.3.2  | MIT    | DOM-Test-Utilities für React-Komponenten.  |
| [`@testing-library/jest-dom`](https://github.com/testing-library/jest-dom)           | 6.9.1   | MIT    | DOM-Matcher-Erweiterungen.                 |
| [`jsdom`](https://github.com/jsdom/jsdom)                                            | 25.0.1  | MIT    | Headless-DOM für Renderer-Tests.           |

### Linting / Formatting / Git-Hooks

| Paket                                                                                       | Version | Lizenz | Rolle                                                             |
| ------------------------------------------------------------------------------------------- | ------- | ------ | ----------------------------------------------------------------- |
| [`eslint`](https://github.com/eslint/eslint)                                                | 9.39.4  | MIT    | Linter.                                                           |
| [`@eslint/js`](https://github.com/eslint/eslint)                                            | 9.39.4  | MIT    | Recommended JS-Regelsatz.                                         |
| [`typescript-eslint`](https://github.com/typescript-eslint/typescript-eslint)               | 8.46.4  | MIT    | TypeScript-Integration für ESLint.                                |
| [`eslint-plugin-react`](https://github.com/jsx-eslint/eslint-plugin-react)                  | 7.37.5  | MIT    | React-spezifische Regeln.                                         |
| [`eslint-plugin-react-hooks`](https://github.com/facebook/react)                            | 5.2.0   | MIT    | Rules-of-Hooks-Validation.                                        |
| [`eslint-plugin-react-refresh`](https://github.com/ArnaudBarre/eslint-plugin-react-refresh) | 0.4.21  | MIT    | HMR-Boundary-Validation.                                          |
| [`eslint-config-prettier`](https://github.com/prettier/eslint-config-prettier)              | 9.1.2   | MIT    | Schaltet ESLint-Formatting-Regeln aus, wo Prettier zuständig ist. |
| [`prettier`](https://github.com/prettier/prettier)                                          | 3.6.2   | MIT    | Code-Formatter.                                                   |
| [`husky`](https://github.com/typicode/husky)                                                | 9.1.7   | MIT    | Git-Hook-Manager (`pre-commit`).                                  |
| [`lint-staged`](https://github.com/lint-staged/lint-staged)                                 | 15.5.2  | MIT    | Führt Linter/Formatter nur auf gestaged Dateien aus.              |
| [`globals`](https://github.com/sindresorhus/globals)                                        | 15.16.0 | MIT    | Bekannte Global-Variablen-Sets für ESLint-Konfiguration.          |

### DB-Tooling

| Paket                                                        | Version | Lizenz | Rolle                                                       |
| ------------------------------------------------------------ | ------- | ------ | ----------------------------------------------------------- |
| [`drizzle-kit`](https://github.com/drizzle-team/drizzle-orm) | 0.31.10 | MIT    | Migrations-CLI (`drizzle-kit generate`, `studio`, `check`). |

### Dokumentation

| Paket                                              | Version | Lizenz     | Rolle                                                 |
| -------------------------------------------------- | ------- | ---------- | ----------------------------------------------------- |
| [`typedoc`](https://github.com/TypeStrong/TypeDoc) | 0.27.9  | Apache-2.0 | API-Doc-Generator aus TSDoc-Kommentaren (`pnpm doc`). |

## Lizenz-Cluster und Pflichten

| Lizenz            | Bedingungen für die Weiterverteilung                                                                                                                                                                    | Im Projekt                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MIT**           | Copyright-Hinweis + Lizenztext müssen in jeder Kopie / jedem Substantial Portion enthalten sein.                                                                                                        | Erfüllt durch das Mitliefern dieser Datei + dem `node_modules/*/LICENSE`-Inhalt im Distributable (Electron-Builder packt das automatisch in `LICENSES.chromium.html`-Pendants).                                                                           |
| **BSD-2-Clause**  | Wie MIT, plus die Klausel-Liste muss reproduziert werden. Kein Werbe-Verbotszusatz (das wäre BSD-4-Clause).                                                                                             | Erfüllt analog zu MIT.                                                                                                                                                                                                                                    |
| **ISC**           | Funktional äquivalent zu MIT in der Anwendung (knapper formuliert).                                                                                                                                     | Erfüllt analog zu MIT.                                                                                                                                                                                                                                    |
| **Apache-2.0**    | Copyright-Hinweis + Lizenztext + ggf. `NOTICE`-Datei (falls vom Upstream geliefert) + Hinweis auf modifizierte Dateien (entfällt — wir modifizieren keinen Apache-2.0-Code). Patent-Grant ist explizit. | Apache-2.0-Pakete: `@electric-sql/pglite`, `drizzle-orm`, `typedoc`, `typescript`. Falls die jeweils eine `NOTICE`-Datei enthalten, muss diese ins Distributable. Aktueller Stand: weder PGlite noch Drizzle noch TypeDoc noch TypeScript haben `NOTICE`. |
| **BSD-3-Clause**  | (transitiv: einige Babel-/Istanbul-Pakete) Wie BSD-2-Clause plus Werbe-Klausel (Name darf nicht ohne Erlaubnis für Promotion verwendet werden).                                                         | Erfüllt analog.                                                                                                                                                                                                                                           |
| **BlueOak-1.0.0** | (transitiv: minimatch, glob-related) Permissiv, Copyright-Hinweis-Reproduktion.                                                                                                                         | Erfüllt analog.                                                                                                                                                                                                                                           |

**Keine Copyleft-Abhängigkeiten** in der Distribution. Das `dotenv`-Paket (BSD-2-Clause) ist die einzige Nicht-MIT-Produktions-Dependency mit Attribution-Pflicht; das wird im Distributable aus dem `node_modules/dotenv/LICENSE`-Text mitgeliefert.

## Reproduzierbarkeit

Diese Liste manuell zu pflegen ist fehleranfällig. Bei jedem nicht-trivialen Dep-Update neu erzeugen:

```bash
# Nur Produktion (für Distribution-Attribution)
pnpm licenses list --prod --long > docs/.licenses-prod.txt

# Alles inkl. transitiver Devs (für vollständigen Audit)
pnpm licenses list --long > docs/.licenses-all.txt
```

Die `.txt`-Dumps sind die Wahrheit; diese Markdown-Datei ist die kuratierte Übersicht der **direkten** Pakete. Verschiebt sich eine Lizenz beim Versions-Bump (z. B. ein MIT-Paket wird Apache-2.0), muss die Tabelle hier nachgezogen und [Lizenz-Cluster](#lizenz-cluster-und-pflichten) auf neue Pflichten geprüft werden.

## Distribution-Bundle

Beim Bauen des Installers (`pnpm build` → electron-builder) wird ein `LICENSES.chromium.html`-Pendant + ein aus `node_modules/*/LICENSE` zusammengetragenes `licenses.txt` mitgeliefert, das den vollen Lizenztext jedes mitausgelieferten Pakets enthält. Diese Datei ist die menschenlesbare Kurzfassung; die Bundle-Datei ist die rechtlich erforderliche Vollfassung.

**Aktuell offen:** Electron-Builder ist noch nicht konfiguriert (Pflichtenheft Anhang B sieht das in AP-1.x vor). Bis dahin gilt diese Datei + die unveränderten `node_modules/<paket>/LICENSE`-Dateien als Attribution-Trägermenge.
