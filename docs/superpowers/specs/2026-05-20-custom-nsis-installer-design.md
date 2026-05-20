# Custom NSIS Installer — Design Spec

**Status:** Draft (pending user review)
**Date:** 2026-05-20
**Author:** Dominik (UI/UX, tests, docs)
**Scope owner:** Dominik (installer chrome + bitmaps + local tests); deployment handoff to Denys
**Related skills:** writing-plans (next), test-driven-development (Tier 1/3/5 tests)

---

## 1. Goal

Replace electron-builder's default generic NSIS wizard with a custom-themed installer that visually aligns with the LokLM app — dark palette, blue accent, branded sidebar — while keeping the existing electron-builder pipeline, single-`.exe` distribution, and multi-page wizard flow.

**Non-goals:**
- Replacing NSIS entirely (no Squirrel, no Velopack, no custom Electron installer — see §10 Rejected Alternatives)
- Pixel-perfect match with the app (no animated gradient blobs, no custom Win32 button paint)
- Changes to CI / release workflows (Denys' domain — see [[loklm-collaboration-rules]])
- First-run wizard inside the app (parked for a future spec)

## 2. Constraints

- **NSIS technical limits:** Native Win32 controls cannot be restyled without subclassing/owner-draw. Sidebar/header artwork must be **BMP3 (24-bit, no alpha)** — no PNG, no animation, no transparency.
- **electron-builder integration:** The installer must remain buildable via `pnpm package:win`. We extend the NSIS template via `include`, `installerHeader`, `installerSidebar` hooks — we don't replace electron-builder.
- **Scope ownership:** Per project rules ([[loklm-collaboration-rules]]), no changes to GitHub Actions, release-action, code-signing, or upload steps. All installer logic stays in `installer/`; tests stay local until handed off.

## 3. Fidelity Decision

We commit to **"Same vibe (dark + branded)"** fidelity — not pixel-match. This means:

- Custom sidebar bitmap on Welcome/Finish pages (164×314 px), frozen blob gradient + logo + tagline
- Custom header bitmap on inner pages (150×57 px), small mark + wordmark
- Dark color scheme via `SetCtlColors` on all NSIS controls that accept it
- Native Windows buttons accepted as-is (no owner-draw)
- One `nsDialogs` custom page (Install Location + Options combined); everything else uses MUI2 defaults

Rationale: ~80% of the app aesthetic at ~30% of the implementation effort. Custom-drawing buttons or animating the sidebar pushes us into NSIS plugins (`nsuuimgr`, `UIControl`) which add fragility, antivirus false-positive risk, and maintenance burden disproportionate to the visual gain.

## 4. File Layout

```
installer/
├── installer.nsh                  # Custom NSIS script (color overrides, custom page)
├── installer-sidebar.bmp          # 164×314 px, BMP3 — Welcome/Finish sidebar
├── installer-header.bmp           # 150×57 px,  BMP3 — inner-page header
├── uninstaller-sidebar.bmp        # 164×314 px, BMP3 — uninstall variant
└── assets/
    ├── sidebar.svg                # Source SVG (gradient + logo + tagline)
    ├── sidebar-uninstall.svg      # Source SVG for uninstall variant
    ├── header.svg                 # Source SVG (mark + wordmark)
    └── export.mjs                 # Build-time SVG→BMP exporter (sharp)
```

SVG sources are the source of truth. BMP outputs are **committed to git** so contributors without `sharp` can still build; CI verifies BMPs by re-running the exporter and diffing.

## 5. electron-builder Configuration

Additions to `package.json` → `build.nsis`:

```jsonc
{
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "allowElevation": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "LokLM",
    "deleteAppDataOnUninstall": false,

    "include": "installer/installer.nsh",
    "installerSidebar": "installer/installer-sidebar.bmp",
    "uninstallerSidebar": "installer/uninstaller-sidebar.bmp",
    "installerHeader": "installer/installer-header.bmp"
  }
}
```

New npm scripts:

- `installer:assets` — `node installer/assets/export.mjs`
- `package:win` — updated to `electron-vite build && pnpm installer:assets && electron-builder --win nsis`

## 6. Visual Design

### 6.1 Color Tokens (mapped from `src/renderer/src/styles.css`)

| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#0e1116` | Page background, sidebar base |
| `--bg-1` | `#161b22` | Header bitmap base, secondary surfaces |
| `--bg-2` | `#1f262f` | Input field background |
| `--fg-0` | `#e6edf3` | Primary text |
| `--fg-1` | `#b6bec9` | Secondary text |
| `--fg-2` | `#8b949e` | Tertiary text, taglines |
| `--accent` | `#3b82f6` | Section titles, accent lines |
| `--brand-blue` | `#1f4fb8` | Sidebar gradient anchor |

### 6.2 Sidebar Bitmap (164×314)

Layered SVG, exported to BMP3:

1. Solid `#0e1116` background
2. Frozen radial gradient layer (top-left `#3b82f6` → transparent at 65%, bottom-right `#7c3aed` → transparent at 70%) — flattened pixels, no animation
3. LokLM mark from `resources/brand/mark-on-dark.svg`, centered ~80px from top, ~80px wide
4. "LokLM" wordmark in 22 px bold (rendered to pixels — no font dependency)
5. Tagline "Lokaler KI-Wissensassistent" in 11 px regular, `#8b949e`
6. Version label at bottom: `v{package.json.version}` in 10 px `#6e7681` — injected at export time

### 6.3 Header Bitmap (150×57)

1. Solid `#161b22` background
2. 1 px bottom border at `#3b82f6` opacity 0.3
3. LokLM mark (28×28 px) left-aligned, 12 px from left edge
4. "LokLM" wordmark in 14 px bold next to mark
5. Right portion intentionally blank (MUI2 overlays page title text there)

### 6.4 Control Coloring via SetCtlColors

| Element | Foreground | Background |
|---|---|---|
| Page background | `#e6edf3` | `#0e1116` |
| Static text | `#e6edf3` | transparent |
| Input fields (`EDITTEXT`) | `#e6edf3` | `#1f262f` |
| Section titles | `#3b82f6` | `#0e1116` |
| Buttons | system default (not overridable cleanly) | system default |
| Progress bar | system default | system default |

## 7. Page Flow

Five pages, in order:

### Page 1 — Welcome
- MUI2 standard Welcome page (`MUI_PAGE_WELCOME`)
- Sidebar bitmap (164×314) on the left
- Headline: "Welcome to LokLM Setup"
- Body: "This will install LokLM v{version} on your computer. Click Next to continue or Cancel to exit."
- Buttons: Next / Cancel

### Page 2 — License Agreement
- MUI2 license page (`MUI_PAGE_LICENSE`) reading from `LICENSE` (MIT) at repo root
- Header bitmap (150×57) at top
- Radio buttons: "I accept the terms" / "I do not accept"
- Next button disabled until "I accept" is selected
- Dark color scheme via `SetCtlColors`

### Page 3 — Install Location + Options (custom `nsDialogs` page)
- **This is the only non-MUI2 page.** Built with `nsDialogs::Create` so we can combine path picker + option checkboxes on one screen.
- Header bitmap (150×57) at top
- Section 1: **Install path** — text field + Browse button, default `%LOCALAPPDATA%\LokLM`
- Section 2: **Options checkboxes:**
  - ☑ Create desktop shortcut (default on)
  - ☑ Create Start Menu shortcut (default on)
  - ☐ Launch LokLM at Windows startup (default off — LokLM is not a tray utility)
- Footer line: "Space required: ~XXX MB | Space available: XXX GB" in `#8b949e`
- Buttons: Back / Next / Cancel

### Page 4 — Installing (Progress)
- MUI2 InstFiles page (`MUI_PAGE_INSTFILES`)
- Header bitmap at top
- Native Windows progress bar (not restyled — see §3)
- "Show details" toggle reveals log pane with `#b6bec9` text on `#0e1116`

### Page 5 — Finish
- MUI2 standard Finish page (`MUI_PAGE_FINISH`)
- Same sidebar bitmap (164×314) as Welcome page
- Headline: "LokLM is ready"
- Body: "Setup completed successfully."
- ☑ Launch LokLM checkbox (checked by default)
- Finish button

### Uninstaller
- Single confirmation page using `uninstaller-sidebar.bmp`
- Same dark color scheme
- `deleteAppDataOnUninstall: false` (user data preserved unless explicitly toggled)

## 8. Build Pipeline — SVG → BMP Exporter

### 8.1 `installer/assets/export.mjs`

- Reads `installer/assets/{sidebar,header,sidebar-uninstall}.svg`
- Uses `sharp` to:
  - Render SVG → PNG at exact target dimensions (164×314 and 150×57)
  - Convert PNG → **BMP3 (24-bit, no alpha)** — NSIS requires this exact format; BMP4/5 silently fails to render
  - Write to `installer/installer-sidebar.bmp`, `installer/installer-header.bmp`, `installer/uninstaller-sidebar.bmp`
- Reads `package.json` at export time and injects current version into `sidebar.svg` `<text>` node before rendering

### 8.2 Wiring

- New `installer:assets` script (above)
- Updated `package:win` script (above)
- BMPs committed to git; a pre-commit lint-staged hook re-runs the exporter against changed SVGs and stages the BMP diff (local verification — CI integration is on Denys' side per [[loklm-collaboration-rules]])

### 8.3 Dependencies

- `sharp` added as an explicit `devDependency`, pinned to a known-good major version for reproducibility

## 9. Testing

All five tiers, scoped to the user's lane (no CI workflow edits).

### Tier 1 — Asset generation tests (Vitest, runs everywhere)
`tests/installer/export.test.ts`:
- Run exporter against fixture SVGs
- Assert output files exist with exact dimensions (164×314 / 150×57)
- Assert BMP magic bytes (`BM`, version 3, 24bpp, no compression)
- Assert file size in sane range (sanity check against malformed output)
- Snapshot the rendered PNG (before BMP conversion) for visual regression in PR diffs

### Tier 2 — NSIS script lint (local, Windows-only)
- `pnpm lint:nsis` runs `makensis /CMDHELP installer/installer.nsh` to verify syntax
- Fails fast before electron-builder builds
- Skipped on non-Windows dev environments

### Tier 3 — Build artifact smoke test (Vitest, runs after package step)
`tests/installer/artifact.test.ts`:
- After `pnpm package:win`, assert:
  - `release/LokLM-Setup-${version}-win-x64.exe` exists
  - File size within expected range (80–150 MB)
  - Valid PE32+ binary
  - Embedded resources (via 7-zip extraction) contain the expected sidebar/header bitmaps unchanged

### Tier 4 — Manual screenshot regression (documented procedure)
`docs/installer/visual-regression.md`:
- Reference screenshots of each of the 5 pages (sidebar, license, install dir, progress, finish, uninstaller)
- Procedure to regenerate screenshots in a clean Windows VM
- Drop new screenshots into PR review for eyeball diff
- Not automated end-to-end UI testing (WinAppDriver investment not justified for monthly installer changes)

### Tier 5 — Local E2E install/uninstall script
`tests/installer/e2e.test.ts` (Windows-only, gated by `process.platform === 'win32'`):
- `pnpm test:installer:e2e` runs against a freshly-built `release/LokLM-Setup-X.X.X.exe`
- Silent install: `./release/LokLM-Setup-X.X.X.exe /S /D=C:\test-install` → assert exit 0
- Assert `C:\test-install\LokLM.exe` exists and `--version` matches `package.json` version
- Silent uninstall: `C:\test-install\Uninstall LokLM.exe /S` → assert exit 0 and directory removed
- Listed in the local pre-release checklist; **not** wired into Actions

### Handoff doc
`docs/installer/handoff-to-denys.md`:
- Documents Tier 3 + Tier 5 as candidates for the release workflow
- Includes exact command invocations Denys can drop into a Windows runner step
- Includes BMP-diff verification as a pre-merge guard

## 10. Rejected Alternatives

| Option | Why rejected |
|---|---|
| **Squirrel.Windows** (Discord-style splash) | Single-screen UX — would lose the Welcome / License / Install-dir / Options pages we committed to |
| **MSIX / AppX** | Zero installer UI customization (OS handles it); also requires Microsoft Store enrollment and code signing pipeline rework — Denys' domain |
| **Velopack** | Adds .NET runtime dependency; would replace the entire electron-builder pipeline (deployment scope = Denys) |
| **Inno Setup** | Same Win32 control limits as NSIS; not natively supported by electron-builder; net negative |
| **Pure custom Electron installer** | Requires building file-extraction, registry, shortcut, uninstaller, UAC, and code-signing logic from scratch — all installer **logic** outside the UI/UX lane. ~80 MB installer size. High AV false-positive risk. Estimated 2–3 weeks vs 1–2 days for NSIS. |
| **NSIS plugins for owner-drawn buttons / animated sidebars** | Fragility, AV heuristic risk, marginal visual gain over flat dark theme + frozen gradient |
| **First-run wizard inside the app** | Acknowledged as the higher-value polish target, but explicitly parked for a future spec — not bundled here |

## 11. Open Questions

None remaining. All open points were resolved during brainstorming:
- Fidelity level: Same vibe (§3)
- Page flow: 5 pages including Welcome, License, combined Install+Options, Progress, Finish (§7)
- File layout: `installer/` directory (§4)
- Testing scope: All 5 tiers, Tier 5 stays local (§9)
- Deployment scope: Denys' job, handoff via doc (§9, [[loklm-collaboration-rules]])

## 12. Success Criteria

- `pnpm package:win` produces `release/LokLM-Setup-${version}-win-x64.exe` with the custom sidebar/header bitmaps visible
- All 5 wizard pages render dark theme via `SetCtlColors`
- Combined Install Location + Options page works (path picker + 3 checkboxes on one screen)
- Tier 1, 3, 5 tests pass on a Windows dev machine
- Tier 2 lint passes locally on Windows
- Tier 4 screenshot doc populated with reference images
- Handoff doc delivered to Denys
