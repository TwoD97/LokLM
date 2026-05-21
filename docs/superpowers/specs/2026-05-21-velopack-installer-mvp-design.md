# Velopack installer + auto-update MVP — design

**Date:** 2026-05-21
**Target release:** v0.3.0 (first Velopack-published release)
**Branch:** `feat/velopack-installer` (to be created)

## Summary

Replace electron-builder's NSIS (Windows), DMG (macOS), and AppImage (Linux) installer outputs with **Velopack** as the single installer + auto-updater across all three platforms. Velopack ships its own ~3 MB stub on each OS (no .NET runtime needed on the target machine — Windows or otherwise), publishes updates via GitHub Releases, and lets the running app pick up new versions on user-initiated check. On Windows, an `afterInstall` hook installs the bundled VC++ 2015–2022 redistributable if missing, so a clean Windows 11 machine never hits a `msvcp140.dll not found` error on first launch. Tagged releases (`v*.*.*` push) fan out across a GitHub Actions matrix (`windows-latest` / `macos-latest` / `ubuntu-latest`) and a single publish job uploads all three channels to one GitHub Release.

## Goals

- One installer story across Windows, macOS, and Linux — same tooling, same release flow, same update mechanism.
- Auto-update on user check ("Check for updates" button in Settings). The running app downloads and applies a new version without reinstalling.
- No bundled runtimes pushed at the user: Velopack's stub does not require .NET on the target; the VC++ redist is only invoked when actually absent.
- Tagged-release-driven CI: `git tag v0.x.y && git push --tags` is the entire developer-facing release surface.
- Per-user installs everywhere (matches current `perMachine: false` NSIS config; aligns with Velopack's happy path for seamless auto-update).

## Non-goals

- **Code signing and Apple notarization.** The MVP ships unsigned. Windows SmartScreen ("unknown publisher"), macOS Gatekeeper ("unidentified developer"), and Linux AppImage `chmod +x` are accepted MVP UX; the README documents the workarounds. Velopack's `vpk pack --signParams` / `--signTemplate` / Apple notary options stay in place so wiring a cert later is configuration-only.
- **Per-machine ("install for all users") on Windows.** Per-user only. Velopack's auto-updater fights against per-machine because applying updates would need admin rights on every release.
- **Migrating existing NSIS-installed users.** The MVP treats Velopack as a clean install. NSIS-installed copies become orphaned; users uninstall the old version manually and run the new installer. Migration is a follow-up if telemetry ever shows a meaningful NSIS install base.
- **Channels (stable/beta), delta-update tuning, telemetry, custom installer UI polish.** Velopack defaults only.
- **Mac PKG/DMG choice or Linux .deb/.rpm targets.** Mac ships `.pkg` (Velopack default); Linux ships `.AppImage`.
- **Auto-check on app start, background update polling, in-product update notifications.** User-initiated check only. Background polling is a follow-up.
- **Website download-page rewiring.** [loklm.com](https://loklm.com) currently links to installers on Bunny CDN/MinIO, kept fresh by the existing `release-installer.yml`'s `bump-and-redeploy` job (rsync to Hetzner, patch `website/src/data/releases.ts`). This MVP retires that workflow. Until a follow-up spec rewires the website to either link to `https://github.com/TwoD97/LokLM/releases/latest` or read a manifest from GH Releases, the website's "Download" button will point at the last-Bunny-published version and become stale. **Accepted MVP regression.**
- **Bunny CDN / MinIO continued use.** Deprecated by this MVP. Existing v0.2.x installer artifacts on those hosts stay accessible (we don't actively delete them), but no new releases land there.

## Section 1 — Architecture

Three components.

**1. `vpk` CLI** — Velopack's packaging tool, installed in CI and dev environments via `dotnet tool install -g vpk` (the canonical distribution; requires .NET 8 SDK on the *build* machine, not on user machines). Consumes a directory of built app files and emits installers + an update feed.

**2. `velopack` Node.js SDK** — `npm i velopack`. Two entry points:
- `VelopackApp.build().run()` — must be the *first* statement in `src/main/index.ts`, before any other Electron imports execute side effects. Handles the special `--veloapp-install` / `--veloapp-updated` / `--veloapp-uninstall` CLI flags the Velopack stub passes back during install/update/uninstall lifecycle events.
- `UpdateManager` — runtime API to check for, download, and apply updates against the configured GitHub Releases feed.

**3. GitHub Actions release workflow** — `.github/workflows/release.yml`. Triggered on `v*.*.*` tag push. Matrix-builds the three OS artifacts in parallel, then a single publish job uploads them to one GitHub Release with the per-channel update feeds attached.

**Per-OS build pipeline (replaces current `electron-builder --win nsis` etc.):**

```
electron-vite build                              # produces out/main, out/preload, out/renderer
  → electron-builder --<os> --dir                # produces release/<os>-unpacked/ only, no installer
    → vpk pack -u com.loklm.desktop \
                -v $npm_package_version \
                -p release/<os>-unpacked \
                -e LokLM.{exe,app,(linux binary name)} \
                --packTitle LokLM \
                --icon resources/icon.{ico,icns,png}
      → Releases/                                           # vpk default output dir
          ├── LokLM-Setup-<version>.{exe,pkg,AppImage}   # installer artifact
          ├── LokLM-<version>-full.nupkg                  # update package (full)
          ├── LokLM-<version>-delta.nupkg                 # update package (delta, when applicable)
          └── releases.<channel>.json                     # update feed (channel: win|osx|linux)
```

We keep `electron-builder --dir` because it handles asar packing, native-module rebuild (argon2, node-llama-cpp), and `extraResources` copying — Velopack does not replicate this. We discard everything else `electron-builder` produces.

## Section 2 — Project layout additions

- **`src/main/velopack.ts`** (new) — wraps `UpdateManager`. Exports `initVelopack()`, `checkForUpdates()`, `downloadUpdates(info)`, `applyUpdatesAndRestart(info)`. Only file in the codebase that imports `velopack`.
- **`src/main/velopack-hooks.ts`** (new, Windows-only logic gated by `process.platform === 'win32'`) — exports `installVcRedistIfMissing()`. Probes registry, spawns redist installer, writes failure marker.
- **`src/main/index.ts`** — `VelopackApp.build().onAfterInstallFastCallback(...).run()` is moved to the top of the file, before all other imports. IPC handlers (`velopack:check`, `velopack:download`, `velopack:apply`) registered alongside existing handlers.
- **`src/preload/index.ts`** — exposes `window.velopackApi.{checkForUpdates, downloadUpdates, applyUpdates}` via `contextBridge`. Mirrors the IPC handler names.
- **`src/renderer/.../SettingsAdvanced.tsx`** (existing) — adds a "Check for updates" button (single button, no auto-polling) that drives the update flow described in Section 4.
- **`resources/vcredist/vc_redist.x64.exe`** (new, committed binary, ~13 MB) — Microsoft's current VC++ 2015–2022 x64 redistributable. Listed in `build.extraResources` so it lands in `process.resourcesPath` of the packaged app.
- **`.github/workflows/release.yml`** (new) — matrix build + publish workflow described in Section 5.
- **`package.json` `scripts`** — `package:win`, `package:mac` (renamed `osx`), `package:linux` rewritten to the `electron-builder --dir && vpk pack ...` pipeline. The `build` block's `win.target`, `nsis.*`, `mac.target`, and `linux.target` keys are removed; only `build.files`, `build.extraResources`, `build.asar`, `build.appId`, `build.productName`, `build.directories` stay.

## Section 3 — App integration (main + renderer)

**Main process — top of `src/main/index.ts`:**

```ts
import { VelopackApp } from 'velopack';
import { installVcRedistIfMissing } from './velopack-hooks';

VelopackApp.build()
  .onAfterInstallFastCallback(() => {
    if (process.platform === 'win32') installVcRedistIfMissing();
  })
  .run();

// existing imports follow
import { app, BrowserWindow, ipcMain } from 'electron';
// ...
```

The "fast" callback runs synchronously, before any window opens — correct for a prerequisite step. After it returns, `.run()` exits the process for the install-hook code path; normal-launch code paths continue past `.run()` to the rest of `index.ts`.

**`src/main/velopack.ts`:**

```ts
import { UpdateManager, type UpdateInfo } from 'velopack';

const GITHUB_REPO = 'https://github.com/TwoD97/LokLM';
let manager: UpdateManager | null = null;

export function initVelopack() {
  manager = new UpdateManager(GITHUB_REPO);
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  return manager!.checkForUpdatesAsync();
}

export async function downloadUpdates(info: UpdateInfo): Promise<void> {
  await manager!.downloadUpdatesAsync(info);
}

export async function applyUpdatesAndRestart(info: UpdateInfo): Promise<void> {
  manager!.waitExitThenApplyUpdates(info, { silent: false, restart: true });
  app.quit();
}
```

**IPC handlers in `src/main/index.ts`:**

```ts
ipcMain.handle('velopack:check',    () => velopack.checkForUpdates());
ipcMain.handle('velopack:download', (_, info) => velopack.downloadUpdates(info));
ipcMain.handle('velopack:apply',    (_, info) => velopack.applyUpdatesAndRestart(info));
```

**Preload — `src/preload/index.ts`:**

```ts
contextBridge.exposeInMainWorld('velopackApi', {
  checkForUpdates: () => ipcRenderer.invoke('velopack:check'),
  downloadUpdates: (info) => ipcRenderer.invoke('velopack:download', info),
  applyUpdates:    (info) => ipcRenderer.invoke('velopack:apply', info),
});
```

## Section 4 — Renderer UI (minimum viable)

One **"Check for updates"** button in the Settings → Advanced tab (this branch already lays out that tab, so it's the natural home). No auto-polling, no background checks, no toast on every launch.

**Flow:**
1. User clicks "Check for updates". Button shows spinner.
2. `await window.velopackApi.checkForUpdates()`.
3. If result is `null`: button label flashes "You're on the latest version (v$version)" for ~2 s, returns to normal.
4. If result is `UpdateInfo`: confirm dialog `"Update to v{TargetVersion}? (~{SizeMb} MB)"` with `Update now` / `Later` buttons.
5. On confirm: progress bar (Velopack's `downloadUpdatesAsync` accepts a progress callback; we relay it via an additional IPC event `velopack:download:progress`).
6. On download complete: `applyUpdatesAndRestart` — the app exits and Velopack's updater stub re-launches it on the new version.

If `checkForUpdates` throws (offline, GH rate limit), surface the error string in a toast and re-enable the button. No retry loop.

**Boundary:** `src/main/velopack.ts` is the only file that imports `velopack`. The renderer never sees the SDK directly — only `window.velopackApi`. This keeps the SDK's Node-only dependencies out of the renderer bundle and the update logic testable in isolation.

## Section 5 — VC++ redist hook on Windows

**Problem.** `argon2` and `node-llama-cpp` link against MSVC 2015–2022 runtime DLLs (`msvcp140.dll`, `vcruntime140.dll`). Modern Windows machines usually have them, but a clean Windows 11 install does not. Without them, the app crashes on first launch with a confusing `msvcp140.dll not found` system dialog *before* any of our error handling runs.

**Probe.** `src/main/velopack-hooks.ts` reads `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64` → `Installed` (DWORD). This is Microsoft's documented detection key for VC++ 2015–2022 x64. If `Installed == 1`, return early.

**Install if missing.** Spawn the bundled redist installer synchronously:

```ts
spawnSync(path.join(process.resourcesPath, 'vcredist', 'vc_redist.x64.exe'),
          ['/install', '/quiet', '/norestart'],
          { stdio: 'ignore' });
```

The Microsoft redist binary's manifest declares `requireAdministrator`, so it self-elevates and the user sees one UAC prompt during install. Treat exit codes `0` (installed), `1638` (already installed, newer version), and `3010` (success, restart required) as success.

**On unexpected exit code,** write a marker file `%LOCALAPPDATA%\LokLM\vcredist-failed.flag` and return — do not block the install. On normal first-launch, `src/main/index.ts` checks for this marker before `BrowserWindow` creation; if present, it shows a native dialog pointing the user at the Microsoft download URL, then quits. The marker is deleted once the user dismisses the dialog.

**Why fast-callback, not regular `onAfterInstall`.** Velopack invokes the app a second time for the regular `onAfterInstall` hook after the install UI has closed. The fast callback runs synchronously, before any window or full Electron lifecycle starts — which is what we want for a prerequisite installer (we don't want to flash a main window, then UAC-prompt, then continue).

**Tradeoff flagged.** Bundling the redist adds ~13 MB to the Windows installer. Accepted vs. the "msvcp140.dll not found" black screen on a clean Win11 machine.

## Section 6 — Release flow & GitHub Actions

**Existing workflow retired.** `.github/workflows/release-installer.yml` (Bunny CDN + MinIO mirror + Hetzner website redeploy + `bump-and-redeploy` job that patched `website/src/data/releases.ts`) is **deleted** by this MVP. The website continues to point at the last Bunny-published version until the follow-up website-rewiring spec lands (noted in Non-goals).

**Trigger.** Push a tag matching `v*.*.*` (e.g., `git tag v0.3.0 && git push origin v0.3.0`). Pushes to `main` do **not** release.

**Versioning.** Human-driven. The author bumps `package.json` version, commits, tags `v<that version>`, pushes. `release-please` / `changesets` automation is a follow-up.

**`package.json` script changes:**

```jsonc
"scripts": {
  "package:win":   "electron-vite build && electron-builder --win --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/win-unpacked -e LokLM.exe --packTitle LokLM --icon resources/icon.ico",
  "package:mac":   "electron-vite build && electron-builder --mac --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/mac-unpacked -e LokLM.app --packTitle LokLM --icon resources/icon.icns",
  "package:linux": "electron-vite build && electron-builder --linux --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/linux-unpacked -e loklm --packTitle LokLM --icon resources/icon.png"
}
```

(The pre-Velopack scripts that invoked `electron-builder --win nsis` / `--mac dmg` / `--linux AppImage` are deleted. `--dir` tells electron-builder to emit only the staging directory.)

**Workflow — `.github/workflows/release.yml`:**

```yaml
name: release
on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write   # needed for GitHub Release creation

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest, channel: win,   script: package:win }
          - { os: macos-latest,   channel: osx,   script: package:mac }
          - { os: ubuntu-latest,  channel: linux, script: package:linux }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.0.x' }
      - run: dotnet tool install -g vpk
      - run: pnpm install --frozen-lockfile
      - run: pnpm run ${{ matrix.script }}
      - uses: actions/upload-artifact@v4
        with:
          name: loklm-${{ matrix.channel }}
          path: Releases/

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.0.x' }
      - run: dotnet tool install -g vpk
      - uses: actions/download-artifact@v4
        with: { path: Releases-all }
      - name: Upload to GitHub Release
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          for channel in win osx linux; do
            vpk upload github \
              --repoUrl https://github.com/${{ github.repository }} \
              --tag ${{ github.ref_name }} \
              --releaseName "LokLM ${{ github.ref_name }}" \
              --token "$GITHUB_TOKEN" \
              --publish \
              --channel "$channel" \
              --packDir "Releases-all/loklm-$channel"
          done
```

**Why matrix-build + single publish job (not each matrix job uploading its own channel):**
- Three concurrent jobs racing to create the same GitHub Release is a known 422 footgun.
- A single publish job is a natural insertion point for a future manual-approval gate (out of MVP, but the shape is right).

**Update feed.** `vpk upload github --publish` attaches `releases.win.json`, `releases.osx.json`, `releases.linux.json` to the Release. The Node SDK's `UpdateManager`, constructed with the repo URL, fetches the right channel automatically based on `process.platform`.

## Section 7 — Testing & verification

**Unit / integration (Vitest):**
- `src/main/velopack.ts` with `UpdateManager` mocked. Covers: returns `null` when no update; returns `UpdateInfo` when one exists; propagates download errors.
- `src/main/velopack-hooks.ts` with the registry probe and `spawnSync` mocked. Covers: present registry key → no spawn; absent → spawn with exact `/install /quiet /norestart` args; non-zero non-allowlist exit → writes marker file.

**Manual verification matrix (required before declaring MVP shippable):**

| OS | Scenario | Expected |
|---|---|---|
| Windows 11 (clean VM, no VC++) | Install MVP installer | UAC prompt for redist → install completes → app launches → no `msvcp140` error |
| Windows 11 (clean VM, no VC++) | Tag v0.x.y, install; tag v0.x.(y+1), click "Check for updates" in old install | Update found → download → app restarts on new version |
| Windows 11 (with VC++ already present) | Install MVP | No UAC prompt (probe short-circuits) → install completes |
| macOS (Apple Silicon) | Install `.pkg` from GH Release | App opens with Gatekeeper warning; right-click → Open works first time |
| macOS | Update flow as Windows | Update found → restart on new version |
| Ubuntu 22.04 | Run `.AppImage` after `chmod +x` | App launches; update flow works |

**CI dry-run.** Before the real first Velopack release, push a throwaway tag `v0.0.0-test.1` to confirm the matrix workflow runs end-to-end. Delete the resulting GitHub Release after.

**SmartScreen / Gatekeeper expected UX (unsigned MVP), documented in README:**
- Windows: "Windows protected your PC" → "More info" → "Run anyway".
- macOS: First launch must be right-click → Open.
- Linux: `chmod +x LokLM-*.AppImage` before first run.

**Rollback.** If a release goes bad: delete the GitHub Release (un-publishes the update feed for that version) and tag `v0.x.(y+1)` with the fix. Installed users on the bad version pick up the next good release on their next manual check. No proactive rollback mechanism in MVP.

## Open questions / future work

- **Code signing.** Procurement of Windows EV cert / Apple Developer ID is an org-level decision. When ready, wire `vpk pack --signParams` and Apple notary args through GH Actions secrets.
- **Auto-check on startup.** Probably a quiet background check 30 s after app idle + toast if update available, with user opt-out in Settings. Deferred.
- **Migrating existing NSIS installs.** Only worth tackling if telemetry shows non-trivial NSIS install base. Mechanism would be a one-time NSIS uninstaller release that triggers the Velopack installer.
- **Channels.** `--channel beta` for prereleases, settings toggle to opt in to beta. Trivially supported by Velopack; deferred until there's a beta cohort.
- **Delta update tuning.** Velopack defaults to `BestSpeed` deltas. Profile after first few releases; switch to `BestSize` if bandwidth becomes a concern.
