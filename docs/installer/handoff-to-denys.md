# Installer Tests — Handoff Candidates for Release CI

These tests live as **local** scripts owned by Dominik (UI/UX + tests scope). They are candidates for the release-action workflow that Denys owns. Nothing here has been added to `.github/workflows/`; Denys decides if/when/how to wire these in.

## Tier 3 — Artifact smoke test

**Local command:**

```powershell
pnpm package:win
pnpm test:installer
```

**What it checks (against `release/LokLM-Setup-X.X.X-win-x64.exe`):**

- File exists at the expected path
- Size is in the 60–200 MB range
- Valid PE32+ binary (MZ + PE signatures)
- Embedded payload contains a BMP3 header matching 164×314 / 24bpp

**Why it's CI-worthy:** Catches "the BMPs didn't make it into the bundle" and "we shipped a corrupt exe" with no human in the loop. Runs in ~10 seconds against an already-built artifact.

**Runner requirement:** Windows runner (the artifact is Windows-only); reuses the runner that already builds via `electron-builder --win nsis`.

## Tier 5 — E2E install/uninstall

**Local command:**

```powershell
pnpm package:win
pnpm test:installer:e2e
```

**What it checks:**

- Silent install to `C:\test-loklm-install` exits 0
- `LokLM.exe` exists at the install target
- Silent uninstall exits 0

**Why it's CI-worthy:** Catches "the installer crashes on a real Windows machine" before release — the highest-value pre-release signal.

**Runner requirements:**

- Windows runner with admin/elevation available (installer prompts for UAC unless `perMachine: false` keeps it user-scoped — which we use)
- ~5 minutes runtime budget
- Clean state between runs (the test does best-effort cleanup but a fresh runner is ideal)

## BMP-diff pre-merge guard (optional)

`installer/installer-sidebar.bmp` and friends are committed to git. To catch SVG changes that weren't re-exported, the release pipeline can re-run the exporter and diff:

```powershell
pnpm installer:assets
git diff --exit-code installer/*.bmp
```

Non-zero exit means the committed BMPs don't match the current SVGs — fail the build with a "run `pnpm installer:assets` before pushing" message.

## What is NOT being handed off

- **Tier 1** (exporter unit tests) — already runs in the standard test suite, no special config
- **Tier 2** (`makensis` lint) — local-only, requires NSIS installed
- **Tier 4** (manual screenshots) — explicitly manual

## Contact

Dominik owns the installer UI/UX, bitmaps, and the local test scripts.
Denys owns the release pipeline, code signing, Bunny/MinIO upload, and runner config.
