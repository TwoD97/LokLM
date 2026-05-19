# LokLM Website

Landingpage. Astro 5 + Tailwind 4. Statischer output. Eigener
pnpm-workspace , unabhängig von der Electron-App.

## Quickstart

```bash
cd website
cp .env.example .env       # PUBLIC_INSTALLER_BASE_URL setzen
pnpm install
pnpm dev                   # http://localhost:4321
```

## Scripts

| Script         | Zweck                      |
| -------------- | -------------------------- |
| `pnpm dev`     | Astro Dev-Server mit HMR   |
| `pnpm build`   | Production build → `dist/` |
| `pnpm preview` | `dist/` lokal anschauen    |
| `pnpm check`   | Astro + TypeScript check   |

## Struktur

| Pfad                       | Inhalt                                              |
| -------------------------- | --------------------------------------------------- |
| `src/pages/index.astro`    | DE (default locale, `/`)                            |
| `src/pages/en/index.astro` | EN (`/en/`)                                         |
| `src/components/`          | Hero, Features, Download, Nav, Footer, BackgroundFx |
| `src/layouts/Base.astro`   | Shell (Meta, Background, Nav, Footer)               |
| `src/i18n/ui.ts`           | Übersetzungs-Strings DE/EN                          |
| `src/data/releases.ts`     | Version + Asset-Manifest pro Plattform              |
| `src/styles/global.css`    | Tailwind tokens + Komponenten-Klassen               |

## Release ausliefern

1. Installer bauen (Electron-App).
2. Hochladen nach `${PUBLIC_INSTALLER_BASE_URL}/v<version>/<asset>` , die
   `.sha256`-Datei direkt daneben.
3. `src/data/releases.ts` bumpen: `version`, `releasedAt`, `sizeBytes`,
   `sha256`, `available`.
4. Push auf `main`. Action baut + rsync't.

Die Site selbst hostet keine Installer , sie verlinkt nur.

## Plattform-Verfügbarkeit

`available: boolean` in jedem Asset. Wenn `false` → Card zeigt "Bald
verfügbar" statt link. Flippen sobald installer existiert.

- Windows , `true`
- macOS , `false`
- Linux , `false`

OS-Detection im Download component setzt nur ein "Erkannt"-Badge auf
die passende Card. Render läuft ohne JS auch normal.

## CI

| Workflow             | Trigger                                           | Was                       |
| -------------------- | ------------------------------------------------- | ------------------------- |
| `checks.yml`         | PR + Push auf branches ≠ `main`                   | Astro check + smoke build |
| `deploy-website.yml` | Push auf `main` (`website/**`), workflow_dispatch | Build + rsync auf Hetzner |

### Secrets

Repo-Settings → Secrets and variables → Actions.

| Name                        | Inhalt                                                   |
| --------------------------- | -------------------------------------------------------- |
| `HETZNER_HOST`              | Hostname/IP (z.B. `loklm.example`)                       |
| `HETZNER_USER`              | SSH-User (z.B. `deploy`)                                 |
| `HETZNER_PATH`              | Webroot (z.B. `/var/www/loklm`)                          |
| `HETZNER_SSH_KEY`           | Private key , kompletter PEM inkl. BEGIN/END             |
| `PUBLIC_INSTALLER_BASE_URL` | z.B. `https://downloads.loklm.example` (kein trailing /) |

### SSH-Key

```bash
# lokal: deploy-key generieren (ohne passphrase)
ssh-keygen -t ed25519 -C "loklm-deploy" -f ~/.ssh/loklm_deploy -N ""

# public key auf server
ssh-copy-id -i ~/.ssh/loklm_deploy.pub deploy@loklm.example

# private key in GitHub als HETZNER_SSH_KEY
cat ~/.ssh/loklm_deploy
```

Der `deploy`-user am besten ohne sudo , nur schreibrechte auf den webroot.

### Fallback (manuell)

```bash
cd website
pnpm build
rsync -avz --delete dist/ deploy@loklm.example:/var/www/loklm/
```

## nginx beispiel

```nginx
server {
  listen 443 ssl http2;
  server_name loklm.example;

  root /var/www/loklm;
  index index.html;

  location / {
    try_files $uri $uri/ $uri.html =404;
  }

  # gehashte assets , aggressives caching
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

Astro's eingebautes i18n. `de` ist default ohne präfix (`/`), `en` unter
`/en/`. `LangSwitch` schaltet zwischen den startseiten , bei mehr routen
dort pro route nachziehen.

## Offen

- Installer-build-automation , 20 GB-artefakte passen nicht auf GH-hosted
  runners (~14 GB disk). Muss auf hetzner laufen , entweder cron oder
  self-hosted runner.
- Code-signatur-hinweis im UI , sobald wir signiert ausliefern.
