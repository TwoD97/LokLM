# LokLM Website

Verteilungs-Homepage für LokLM. Astro 5 + Tailwind 4, rein statischer
Build. Eigener pnpm-Workspace — läuft komplett getrennt von der
Electron-App.

## Loslegen

```bash
cd website
cp .env.example .env       # PUBLIC_INSTALLER_BASE_URL eintragen
pnpm install
pnpm dev                   # http://localhost:4321
```

## Scripts

| Script                 | Zweck                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`             | Astro-Dev-Server mit HMR                                               |
| `pnpm build`           | Production-Build → `dist/`                                             |
| `pnpm preview`         | Den `dist/`-Stand lokal servieren                                      |
| `pnpm check`           | Astro- und TypeScript-Check                                            |
| `pnpm test`            | Vitest-Unit-Suite (i18n-Parität, Releases, Schema, GitHub, Blog)       |
| `pnpm test:watch`      | Vitest im Watch-Modus                                                  |
| `pnpm test:coverage`   | Coverage-Report (v8; Schwellen 80 % / 70 % in `vitest.config`)         |
| `pnpm test:e2e`        | Playwright-E2E (Home, Lang-Switch, Download, Anchors, a11y, Visual)    |
| `pnpm test:e2e:headed` | E2E mit sichtbarem Browser                                             |
| `pnpm lighthouse`      | Lighthouse-Report (Preview muss laufen; Ausgabe in `.lighthouse/`)     |
| `pnpm ci`              | Komplette Pipeline lokal: check → coverage → build → e2e               |

## Test-Ebenen

| Ebene  | Pfad                          | Deckt ab                                                                         |
| ------ | ----------------------------- | --------------------------------------------------------------------------------- |
| Unit   | `src/**/*.test.ts`            | `lib/github`, `lib/schema`, `i18n/ui`, `i18n/utils`, `data/releases`, `data/blog` |
| Public | `tests/public-assets.test.ts` | Brand-Assets, Screenshots, robots.txt vorhanden und keine 1×1-Stubs               |
| Dist   | `tests/dist-smoke.test.ts`    | HTML-Seiten, JSON-LD, canonical, Sitemap (skippt ohne `dist/`)                    |
| E2E    | `tests/e2e/*.spec.ts`         | DE/EN-Smoke, LangSwitch, Download-Links, Anker-Navigation, axe-a11y, Visual       |

Die visuellen Baselines liegen unter `tests/e2e/visual.spec.ts-snapshots/`.
Nach gewollten Design-Änderungen per `pnpm test:e2e --update-snapshots`
neu erzeugen.

Das E2E-Setup fährt `astro preview` selbst hoch (Build + Serve auf
`127.0.0.1:4321`); im `ci`-Script passiert der Build vorab und `preview`
wird wiederverwendet.

### Lighthouse-Baseline (Desktop, Mai 2026)

| Kategorie      | Score |
| -------------- | ----- |
| Performance    | 100   |
| Accessibility  | 93    |
| Best Practices | 100   |
| SEO            | 100   |

Die verbleibenden A11y-Punkte (Kontrast der dekorativen
`aria-hidden`-Ziffern in `how__num`, Touch-Target-Größe der kleinen
Nav-Pills) sind bewusste Design-Entscheidungen — hier ist kein Fix offen.

## Struktur

| Pfad                       | Inhalt                                              |
| -------------------------- | --------------------------------------------------- |
| `src/pages/index.astro`    | Startseite DE (Default-Locale, `/`)                 |
| `src/pages/en/index.astro` | Startseite EN (`/en/`)                              |
| `src/components/`          | Hero, Features, Download, Nav, Footer, BackgroundFx |
| `src/layouts/Base.astro`   | Seiten-Shell (Meta, Background, Nav, Footer)        |
| `src/content/blog/`        | Blog-Artikel DE/EN (Content Collections)            |
| `src/i18n/ui.ts`           | Übersetzungs-Strings DE/EN                          |
| `src/data/releases.ts`     | Version + Asset-Manifest pro Plattform              |
| `src/styles/global.css`    | Tailwind-Tokens + Komponenten-Klassen               |

## Release veröffentlichen

1. Installer bauen (Electron-App).
2. Nach `${PUBLIC_INSTALLER_BASE_URL}/v<version>/<asset>` hochladen — die
   zugehörige `.sha256`-Datei direkt daneben.
3. In `src/data/releases.ts` bumpen: `version`, `releasedAt`, `sizeBytes`,
   `sha256`, `available`.
4. Auf `main` pushen — die Action baut und rsync't.

Die Site hostet selbst keine Installer, sie verlinkt nur darauf.

## Plattform-Verfügbarkeit

Jedes Asset trägt ein `available: boolean`. Bei `false` zeigt die Card
„Bald verfügbar" statt eines Links. Aktuell sind Windows, macOS und Linux
alle auf `true`.

Die OS-Erkennung in der Download-Komponente setzt nur ein
„Erkannt"-Badge auf die passende Card — ohne JS rendert alles trotzdem
normal.

## CI

| Workflow             | Trigger                                           | Was                       |
| -------------------- | ------------------------------------------------- | ------------------------- |
| `checks.yml`         | PR + Push auf Branches ≠ `main`                   | Astro-Check + Smoke-Build |
| `deploy-website.yml` | Push auf `main` (`website/**`), workflow_dispatch | Build + rsync auf Hetzner |

### Secrets

Repo-Settings → Secrets and variables → Actions.

| Name                        | Inhalt                                                   |
| --------------------------- | -------------------------------------------------------- |
| `HETZNER_HOST`              | Hostname/IP (z. B. `loklm.example`)                      |
| `HETZNER_USER`              | SSH-User (z. B. `deploy`)                                |
| `HETZNER_PATH`              | Webroot (z. B. `/var/www/loklm`)                         |
| `HETZNER_SSH_KEY`           | Private Key, kompletter PEM inkl. BEGIN/END              |
| `PUBLIC_INSTALLER_BASE_URL` | z. B. `https://downloads.loklm.example` (ohne trailing /) |

### SSH-Key

```bash
# lokal: Deploy-Key ohne Passphrase generieren
ssh-keygen -t ed25519 -C "loklm-deploy" -f ~/.ssh/loklm_deploy -N ""

# Public Key auf den Server
ssh-copy-id -i ~/.ssh/loklm_deploy.pub deploy@loklm.example

# Private Key in GitHub als HETZNER_SSH_KEY hinterlegen
cat ~/.ssh/loklm_deploy
```

Der `deploy`-User braucht kein sudo — Schreibrechte auf den Webroot
genügen.

### Fallback (manuell)

```bash
cd website
pnpm build
rsync -avz --delete dist/ deploy@loklm.example:/var/www/loklm/
```

## nginx-Beispiel

```nginx
server {
  listen 443 ssl http2;
  server_name loklm.example;

  root /var/www/loklm;
  index index.html;

  location / {
    try_files $uri $uri/ $uri.html =404;
  }

  # gehashte Assets — aggressiv cachen
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
}

server {
  listen 443 ssl http2;
  server_name downloads.loklm.example;

  root /srv/installers;

  location / {
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
}
```

## i18n

Astros eingebautes i18n: `de` ist Default ohne Präfix (`/`), `en` liegt
unter `/en/`. `LangSwitch` wechselt zwischen den Sprachvarianten einer
Route — neue Routen dort nachziehen.

## Offene Punkte

- Installer-Build-Automation: die ~20-GB-Artefakte passen nicht auf
  GH-hosted Runner (~14 GB Disk) — muss auf Hetzner laufen, per Cron oder
  self-hosted Runner.
- Hinweis zur Code-Signatur im UI, sobald signiert ausgeliefert wird.
