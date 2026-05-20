# Installer Visual Regression — Manual Procedure

The installer chrome is bitmaps + Win32 controls. Automated UI testing (WinAppDriver, Playwright-electron-installer) isn't worth the investment for a release that ships ~monthly. Instead, this doc captures the manual screenshot procedure and a baseline gallery.

## When to run

- Any change to `installer/assets/*.svg`
- Any change to `installer/installer.nsh`
- Any change to `package.json` → `build.nsis`
- Any electron-builder major version bump

## Procedure

1. Build a fresh installer:

   ```powershell
   pnpm package:win
   ```

2. Launch the installer (do **not** install — we screenshot only):

   ```powershell
   .\release\LokLM-Setup-X.X.X-win-x64.exe
   ```

3. On each wizard page, press `Alt+PrintScreen` (active window snip) and save as:
   - `docs/installer/screenshots/<version>-01-welcome.png`
   - `docs/installer/screenshots/<version>-02-license.png`
   - `docs/installer/screenshots/<version>-03-install-dir-options.png`
   - `docs/installer/screenshots/<version>-04-installing.png`
   - `docs/installer/screenshots/<version>-05-finish.png`
   - `docs/installer/screenshots/<version>-06-uninstaller.png` _(launch uninstaller after install)_

4. Click **Cancel** on the wizard. **Do not actually install** (that's Tier 5).

5. Open the PR and reference both the old baseline screenshots and the new ones in the description so reviewers can eyeball the diff.

## Acceptance criteria per page

| Page                  | What to check                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Welcome               | Sidebar BMP renders left, "Welcome to LokLM Setup" heading, dark page bg                           |
| License               | Header BMP at top, MIT license text legible, "I accept" radio enabled                              |
| Install dir + options | Header BMP, path field shows `%LOCALAPPDATA%\LokLM`, 3 checkboxes (2 checked, autostart unchecked) |
| Installing            | Header BMP, progress bar visible (system default style — that's fine)                              |
| Finish                | Sidebar BMP, "LokLM is ready", "Launch LokLM" checked by default                                   |
| Uninstaller           | Uninstaller sidebar BMP (calmer palette), confirmation prompt                                      |

## Baseline

_(Populated by the first run of the procedure after this plan ships.)_
