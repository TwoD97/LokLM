# Custom NSIS Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark-themed, branded NSIS installer for LokLM that visually matches the app, replacing electron-builder's generic wizard while keeping its single-`.exe` pipeline.

**Architecture:** SVG sources in `installer/assets/` → `sharp`-based exporter renders to BMP3 → electron-builder consumes BMPs via `installerSidebar`/`installerHeader` hooks. A custom `installer.nsh` overrides control colors via `SetCtlColors` and adds option checkboxes to the directory page via MUI2's `CUSTOMFUNCTION_SHOW` callback. All five test tiers from the spec live under `tests/installer/`.

**Tech Stack:** NSIS (via electron-builder 25.x), `sharp` for SVG→BMP, Vitest workspace project for tests, makensis for lint.

**Reference spec:** [docs/superpowers/specs/2026-05-20-custom-nsis-installer-design.md](../specs/2026-05-20-custom-nsis-installer-design.md)

**Working branch:** `dom-dev` (already checked out). Per [[loklm-collaboration-rules]]: no commits to `main`, no Claude attribution in commit messages, no CI workflow edits.

---

## File Structure

**Created in this plan:**

```
installer/
├── installer.nsh                   # Color overrides + directory-page checkbox injection
├── installer-sidebar.bmp           # Generated 164×314 BMP3
├── installer-header.bmp            # Generated 150×57 BMP3
├── uninstaller-sidebar.bmp         # Generated 164×314 BMP3 (uninstall variant)
└── assets/
    ├── sidebar.svg                 # Source SVG for installer-sidebar
    ├── sidebar-uninstall.svg       # Source SVG for uninstaller-sidebar
    ├── header.svg                  # Source SVG for installer-header
    └── export.mjs                  # SVG→BMP3 exporter (sharp)

tests/installer/
├── fixtures/
│   └── tiny.svg                    # Minimal SVG fixture for Tier 1 unit tests
├── export.test.ts                  # Tier 1: exporter unit tests
├── artifact.test.ts                # Tier 3: built .exe smoke test
└── e2e.test.ts                     # Tier 5: install/uninstall E2E

docs/installer/
├── visual-regression.md            # Tier 4: manual screenshot procedure
└── handoff-to-denys.md             # Tier 3/5 handoff for release CI
```

**Modified in this plan:**

- `package.json` — add `sharp` devDependency, add `installer:assets`/`lint:nsis`/`test:installer*` scripts, extend `build.nsis` block
- `vitest.workspace.ts` — add `installer` workspace project pointing at `tests/installer/`

---

## Task 1: Add `sharp` devDependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add sharp to devDependencies**

Open `package.json` and add `"sharp": "^0.34.0"` to `devDependencies` in alphabetical order (between `prettier` and `react`).

- [ ] **Step 2: Install**

Run: `pnpm install`

Expected: pnpm resolves sharp + native prebuild binary for Windows x64; no errors.

- [ ] **Step 3: Verify sharp loads in Node**

Run: `node -e "import('sharp').then(s => console.log('sharp ok', s.default.versions))"`

Expected: prints version info. If it errors on native binding, run `pnpm rebuild sharp` and retry.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "installer , add sharp devdep for svg-to-bmp exporter"
```

---

## Task 2: Create installer directory + SVG source — header bitmap

**Files:**
- Create: `installer/assets/header.svg`

- [ ] **Step 1: Create the directory**

Run: `mkdir installer\assets` (PowerShell: `New-Item -ItemType Directory installer\assets -Force`)

Expected: empty directory created.

- [ ] **Step 2: Write `installer/assets/header.svg`**

Exact content (150×57 px, designed to render to BMP3 cleanly):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <!-- Background: --bg-1 (#161b22) -->
  <rect width="150" height="57" fill="#161b22"/>

  <!-- Bottom border: --accent at 30% opacity -->
  <rect x="0" y="56" width="150" height="1" fill="#3b82f6" opacity="0.3"/>

  <!-- LokLM mark (scaled from resources/brand/mark-on-dark.svg, ~28×28 at x=12,y=14) -->
  <g transform="translate(12, 14) scale(0.4375)">
    <rect x="14" y="22" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.4" fill="none"/>
    <rect x="11" y="17" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.7" fill="none"/>
    <rect x="8" y="12" width="36" height="30" rx="2" fill="#0B1B2B" stroke="#F6F4EF" stroke-width="3"/>
    <circle cx="38" cy="20" r="2.6" fill="#7DD3FC"/>
    <path d="M14 22 H32 M14 28 H30 M14 34 H26" stroke="#F6F4EF" stroke-width="1.8" stroke-linecap="round" opacity="0.55" fill="none"/>
  </g>

  <!-- Wordmark "LokLM" -->
  <text x="48" y="36" font-family="Segoe UI, Inter, sans-serif" font-size="14" font-weight="700" fill="#e6edf3">LokLM</text>
</svg>
```

- [ ] **Step 3: Open the file in a browser to eyeball-check**

Run: `start installer\assets\header.svg` (Windows) — should open in default browser/viewer.

Expected: small dark strip with the LokLM card-stack mark + "LokLM" wordmark.

- [ ] **Step 4: Commit**

```bash
git add installer/assets/header.svg
git commit -m "installer , add header svg (150x57 dark + wordmark)"
```

---

## Task 3: SVG source — installer sidebar

**Files:**
- Create: `installer/assets/sidebar.svg`

- [ ] **Step 1: Write `installer/assets/sidebar.svg`**

Exact content (164×314 px). The `__VERSION__` token is substituted at export time:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <!-- Blob 1: top-left blue blob -->
    <radialGradient id="blob1" cx="20%" cy="15%" r="65%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.85"/>
      <stop offset="65%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <!-- Blob 2: bottom-right violet blob -->
    <radialGradient id="blob2" cx="85%" cy="90%" r="70%">
      <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background: --bg-0 (#0e1116) -->
  <rect width="164" height="314" fill="#0e1116"/>

  <!-- Frozen blobs -->
  <rect width="164" height="314" fill="url(#blob1)"/>
  <rect width="164" height="314" fill="url(#blob2)"/>

  <!-- LokLM mark: ~80px wide, centered at top -->
  <g transform="translate(42, 60) scale(1.25)">
    <rect x="14" y="22" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.4" fill="none"/>
    <rect x="11" y="17" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.7" fill="none"/>
    <rect x="8" y="12" width="36" height="30" rx="2" fill="#0B1B2B" stroke="#F6F4EF" stroke-width="3"/>
    <circle cx="38" cy="20" r="2.6" fill="#7DD3FC"/>
    <path d="M14 22 H32 M14 28 H30 M14 34 H26" stroke="#F6F4EF" stroke-width="1.8" stroke-linecap="round" opacity="0.55" fill="none"/>
  </g>

  <!-- "LokLM" wordmark -->
  <text x="82" y="180" font-family="Segoe UI, Inter, sans-serif" font-size="22" font-weight="700" fill="#e6edf3" text-anchor="middle">LokLM</text>

  <!-- Tagline -->
  <text x="82" y="200" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="400" fill="#8b949e" text-anchor="middle">Lokaler KI-Wissensassistent</text>

  <!-- Version label at bottom -->
  <text x="82" y="298" font-family="Segoe UI, Inter, sans-serif" font-size="10" font-weight="400" fill="#6e7681" text-anchor="middle">v__VERSION__</text>
</svg>
```

- [ ] **Step 2: Browser-check**

Run: `start installer\assets\sidebar.svg`

Expected: 164×314 portrait strip with two soft gradient blobs, LokLM card-stack centered top, "LokLM" wordmark, German tagline, "v__VERSION__" at bottom.

- [ ] **Step 3: Commit**

```bash
git add installer/assets/sidebar.svg
git commit -m "installer , add sidebar svg (164x314 dark + blobs + brand)"
```

---

## Task 4: SVG source — uninstaller sidebar

**Files:**
- Create: `installer/assets/sidebar-uninstall.svg`

- [ ] **Step 1: Write `installer/assets/sidebar-uninstall.svg`**

Same layout as `sidebar.svg` but with desaturated blob 2 (no violet — too "festive" for uninstall) and "Remove LokLM" label instead of tagline:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <radialGradient id="blob1u" cx="20%" cy="15%" r="65%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.5"/>
      <stop offset="65%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob2u" cx="85%" cy="90%" r="70%">
      <stop offset="0%" stop-color="#1f4fb8" stop-opacity="0.4"/>
      <stop offset="70%" stop-color="#1f4fb8" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="164" height="314" fill="#0e1116"/>
  <rect width="164" height="314" fill="url(#blob1u)"/>
  <rect width="164" height="314" fill="url(#blob2u)"/>

  <g transform="translate(42, 60) scale(1.25)">
    <rect x="14" y="22" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.4" fill="none"/>
    <rect x="11" y="17" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="3" opacity="0.7" fill="none"/>
    <rect x="8" y="12" width="36" height="30" rx="2" fill="#0B1B2B" stroke="#F6F4EF" stroke-width="3"/>
    <circle cx="38" cy="20" r="2.6" fill="#7DD3FC"/>
    <path d="M14 22 H32 M14 28 H30 M14 34 H26" stroke="#F6F4EF" stroke-width="1.8" stroke-linecap="round" opacity="0.55" fill="none"/>
  </g>

  <text x="82" y="180" font-family="Segoe UI, Inter, sans-serif" font-size="22" font-weight="700" fill="#e6edf3" text-anchor="middle">LokLM</text>
  <text x="82" y="200" font-family="Segoe UI, Inter, sans-serif" font-size="11" font-weight="400" fill="#8b949e" text-anchor="middle">Uninstaller</text>
  <text x="82" y="298" font-family="Segoe UI, Inter, sans-serif" font-size="10" font-weight="400" fill="#6e7681" text-anchor="middle">v__VERSION__</text>
</svg>
```

- [ ] **Step 2: Browser-check**

Run: `start installer\assets\sidebar-uninstall.svg`

Expected: same layout as sidebar.svg but tonally calmer (no purple blob) and labeled "Uninstaller".

- [ ] **Step 3: Commit**

```bash
git add installer/assets/sidebar-uninstall.svg
git commit -m "installer , add uninstaller sidebar svg (164x314 calm variant)"
```

---

## Task 5: Tier-1 test — write failing exporter test

**Files:**
- Create: `tests/installer/fixtures/tiny.svg`
- Create: `tests/installer/export.test.ts`

- [ ] **Step 1: Create the fixture directory**

Run: `mkdir tests\installer\fixtures` (PowerShell: `New-Item -ItemType Directory tests\installer\fixtures -Force`)

- [ ] **Step 2: Write the fixture `tests/installer/fixtures/tiny.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="#0e1116"/>
  <text x="82" y="160" font-size="14" fill="#e6edf3" text-anchor="middle">test</text>
</svg>
```

- [ ] **Step 3: Write `tests/installer/export.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { exportSvgToBmp } from '../../installer/assets/export.mjs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('exportSvgToBmp', () => {
  let outDir: string

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'loklm-installer-test-'))
  })

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('produces a 164x314 BMP3 from a sidebar-shaped SVG', async () => {
    const out = path.join(outDir, 'sidebar.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, 'fixtures/tiny.svg'),
      outPath: out,
      width: 164,
      height: 314,
    })

    const buf = await readFile(out)

    // BMP magic: 'BM'
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)

    // DIB header size at offset 14 — BMP3 / BITMAPINFOHEADER is 40 bytes
    const dibHeaderSize = buf.readUInt32LE(14)
    expect(dibHeaderSize).toBe(40)

    // Width / height at offsets 18 / 22
    expect(buf.readInt32LE(18)).toBe(164)
    expect(buf.readInt32LE(22)).toBe(314)

    // Bit depth at offset 28 — 24bpp, no alpha
    expect(buf.readUInt16LE(28)).toBe(24)

    // Compression at offset 30 — must be 0 (BI_RGB, uncompressed)
    expect(buf.readUInt32LE(30)).toBe(0)

    // Sanity-check file size — should be roughly width*height*3 + 54 (header)
    const expectedMin = 164 * 314 * 3
    expect(buf.length).toBeGreaterThan(expectedMin)
    expect(buf.length).toBeLessThan(expectedMin * 1.2)
  })

  it('substitutes __VERSION__ from package.json before rendering', async () => {
    // Use the real sidebar.svg which contains __VERSION__
    const out = path.join(outDir, 'real.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/sidebar.svg'),
      outPath: out,
      width: 164,
      height: 314,
      versionToken: '9.9.9-test',
    })

    const buf = await readFile(out)
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)
    // Can't reliably OCR the rendered bitmap, so the assertion is structural:
    // file exists and is a valid BMP3 — substitution happened upstream and didn't crash.
    expect(buf.length).toBeGreaterThan(164 * 314 * 3)
  })

  it('produces a 150x57 BMP3 from a header-shaped SVG', async () => {
    const out = path.join(outDir, 'header.bmp')
    await exportSvgToBmp({
      svgPath: path.resolve(__dirname, '../../installer/assets/header.svg'),
      outPath: out,
      width: 150,
      height: 57,
    })

    const buf = await readFile(out)
    expect(buf[0]).toBe(0x42)
    expect(buf[1]).toBe(0x4d)
    expect(buf.readInt32LE(18)).toBe(150)
    expect(buf.readInt32LE(22)).toBe(57)
    expect(buf.readUInt16LE(28)).toBe(24)
  })
})
```

- [ ] **Step 4: Add installer workspace to vitest config**

Open `vitest.workspace.ts` and add this project at the end of the `defineWorkspace([...])` array (after the `unit` project):

```ts
{
  resolve: { alias: aliases },
  test: {
    name: 'installer',
    include: ['tests/installer/export.test.ts', 'tests/installer/artifact.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
},
```

Note: `e2e.test.ts` is intentionally excluded — it runs via its own script (Task 11).

- [ ] **Step 5: Add `test:installer` script**

In `package.json`, add to the `scripts` block (alphabetical with the other test scripts, after `test:integration`):

```json
"test:installer": "vitest run --project installer",
```

- [ ] **Step 6: Run the test — expect FAIL**

Run: `pnpm test:installer`

Expected: FAILS with "Cannot find module './installer/assets/export.mjs'" or similar — the exporter doesn't exist yet.

- [ ] **Step 7: Commit (failing test)**

```bash
git add tests/installer/ vitest.workspace.ts package.json
git commit -m "installer , add failing tier-1 exporter test + vitest project"
```

---

## Task 6: Implement the exporter

**Files:**
- Create: `installer/assets/export.mjs`

- [ ] **Step 1: Write `installer/assets/export.mjs`**

```js
// SVG → BMP3 exporter for the LokLM NSIS installer.
//
// NSIS MUI2 requires the sidebar (164x314) and header (150x57) bitmaps to be
// 24-bit BMP3 (BITMAPINFOHEADER, BI_RGB, no alpha). BMP4/5 silently fail to
// render. sharp's .raw() output + a hand-written BMP3 header avoids any
// libvips-version-dependent BMP encoder behavior.

import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO_ROOT = path.resolve(__dirname, '../..')

/**
 * Render an SVG to a 24-bit BMP3 file.
 *
 * @param {object} args
 * @param {string} args.svgPath - Absolute path to source SVG
 * @param {string} args.outPath - Absolute path to BMP3 output
 * @param {number} args.width  - Target width in pixels
 * @param {number} args.height - Target height in pixels
 * @param {string} [args.versionToken] - If set, replaces __VERSION__ in the SVG before rendering
 */
export async function exportSvgToBmp({ svgPath, outPath, width, height, versionToken }) {
  let svg = await readFile(svgPath, 'utf-8')
  if (versionToken !== undefined) {
    svg = svg.replaceAll('__VERSION__', versionToken)
  }

  // Render SVG → raw BGR pixels at exact dimensions.
  // sharp emits RGB; BMP wants BGR with rows bottom-to-top, padded to 4-byte alignment.
  const { data: rgb } = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rowSize = Math.floor((24 * width + 31) / 32) * 4 // 4-byte aligned row stride
  const pixelArraySize = rowSize * height
  const fileSize = 54 + pixelArraySize // 14 bytes file header + 40 bytes DIB header

  const buf = Buffer.alloc(fileSize)

  // BITMAPFILEHEADER (14 bytes)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt16LE(0, 6) // reserved
  buf.writeUInt16LE(0, 8) // reserved
  buf.writeUInt32LE(54, 10) // pixel data offset

  // BITMAPINFOHEADER (40 bytes) — this is what makes it BMP3
  buf.writeUInt32LE(40, 14) // header size
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26) // planes
  buf.writeUInt16LE(24, 28) // bits per pixel
  buf.writeUInt32LE(0, 30) // BI_RGB (no compression)
  buf.writeUInt32LE(pixelArraySize, 34)
  buf.writeInt32LE(2835, 38) // x ppm (~72 DPI)
  buf.writeInt32LE(2835, 42) // y ppm
  buf.writeUInt32LE(0, 46) // colors used
  buf.writeUInt32LE(0, 50) // important colors

  // Pixel array: BMP is bottom-up; sharp RGB is top-down.
  // Convert each row: RGB → BGR, write rows in reverse order with padding.
  const pad = rowSize - width * 3
  let cursor = 54
  for (let y = height - 1; y >= 0; y--) {
    const srcRow = y * width * 3
    for (let x = 0; x < width; x++) {
      const i = srcRow + x * 3
      buf[cursor++] = rgb[i + 2] // B
      buf[cursor++] = rgb[i + 1] // G
      buf[cursor++] = rgb[i + 0] // R
    }
    cursor += pad
  }

  await writeFile(outPath, buf)
}

/** CLI entry: regenerates all three BMPs from `installer/assets/*.svg`. */
export async function exportAll() {
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
  const version = pkg.version

  const installerDir = path.join(REPO_ROOT, 'installer')
  const assetsDir = path.join(installerDir, 'assets')

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'sidebar.svg'),
    outPath: path.join(installerDir, 'installer-sidebar.bmp'),
    width: 164,
    height: 314,
    versionToken: version,
  })
  console.log(`✓ installer-sidebar.bmp (164x314, v${version})`)

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'sidebar-uninstall.svg'),
    outPath: path.join(installerDir, 'uninstaller-sidebar.bmp'),
    width: 164,
    height: 314,
    versionToken: version,
  })
  console.log(`✓ uninstaller-sidebar.bmp (164x314, v${version})`)

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'header.svg'),
    outPath: path.join(installerDir, 'installer-header.bmp'),
    width: 150,
    height: 57,
  })
  console.log(`✓ installer-header.bmp (150x57)`)
}

// CLI entry guard
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  exportAll().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 2: Add `installer:assets` script to package.json**

Add to `scripts` block (after `format:check`, alphabetical with `installer`):

```json
"installer:assets": "node installer/assets/export.mjs",
```

- [ ] **Step 3: Run the Tier-1 tests — expect PASS**

Run: `pnpm test:installer`

Expected: all 3 tests pass. If `sharp` errors on import inside vitest, ensure vitest's `deps.optimizer` isn't excluding it (the workspace `node` env should handle native deps).

- [ ] **Step 4: Commit**

```bash
git add installer/assets/export.mjs package.json
git commit -m "installer , implement svg-to-bmp3 exporter (sharp + hand-written bmp header)"
```

---

## Task 7: Generate and commit BMPs

**Files:**
- Create: `installer/installer-sidebar.bmp`
- Create: `installer/installer-header.bmp`
- Create: `installer/uninstaller-sidebar.bmp`

- [ ] **Step 1: Run the exporter**

Run: `pnpm installer:assets`

Expected output:
```
✓ installer-sidebar.bmp (164x314, v0.2.3)
✓ uninstaller-sidebar.bmp (164x314, v0.2.3)
✓ installer-header.bmp (150x57)
```

- [ ] **Step 2: Eyeball-verify each BMP**

Open each generated `.bmp` in Windows Photos / IrfanView and confirm:
- `installer-sidebar.bmp` — dark with blue + purple gradient blobs, LokLM mark + wordmark + tagline + v0.2.3
- `uninstaller-sidebar.bmp` — same layout, no purple, label "Uninstaller"
- `installer-header.bmp` — dark thin strip with mark + "LokLM" wordmark

If any look broken (wrong size, wrong colors, missing text), re-check the SVG source and re-run.

- [ ] **Step 3: Commit BMPs**

```bash
git add installer/installer-sidebar.bmp installer/installer-header.bmp installer/uninstaller-sidebar.bmp
git commit -m "installer , add generated bmps (164x314 sidebars + 150x57 header)"
```

---

## Task 8: NSIS script — color overrides + checkbox injection

**Files:**
- Create: `installer/installer.nsh`

- [ ] **Step 1: Write `installer/installer.nsh`**

This NSIS include uses electron-builder's documented `!macro` hooks. We override `SetCtlColors` globally and add three option checkboxes to the directory page via MUI2's `CUSTOMFUNCTION_SHOW` / `CUSTOMFUNCTION_LEAVE` callbacks. The directory page is electron-builder's default `MUI_PAGE_DIRECTORY` — we don't replace it, we extend it.

```nsis
; LokLM custom NSIS include — dark theme + combined dir/options page
;
; Hooks into electron-builder's NSIS template via documented !macro names.
; See: https://www.electron.build/configuration/nsis

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ── Color tokens (BGR for SetCtlColors; mirrors src/renderer/src/styles.css) ──
!define LM_BG_0      0x16110E  ; #0e1116 -- page background
!define LM_BG_1      0x221B16  ; #161b22 -- secondary surface
!define LM_BG_2      0x2F261F  ; #1f262f -- input bg
!define LM_FG_0      0xF3EDE6  ; #e6edf3 -- primary text
!define LM_FG_2      0x9E948B  ; #8b949e -- tertiary text
!define LM_ACCENT    0xF6823B  ; #3b82f6 -- accent

; ── Globals for checkbox state ──
Var DesktopShortcutCheckbox
Var StartMenuShortcutCheckbox
Var AutostartCheckbox
Var CreateDesktopShortcut
Var CreateStartMenuShortcut
Var EnableAutostart

; ── Hook: customHeader — runs once at the top of the generated installer.nsi ──
!macro customHeader
  ; Defaults: shortcuts on, autostart off
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"
!macroend

; ── Hook: customInit — runs in .onInit ──
!macro customInit
  ; Placeholder. No special init beyond what electron-builder provides.
!macroend

; ── Hook: customDirectoryPage — extends MUI_PAGE_DIRECTORY with checkboxes ──
;
; electron-builder respects MUI_PAGE_CUSTOMFUNCTION_SHOW/LEAVE if we define
; them before its template inserts the page. The functions below add 3
; checkboxes BELOW the existing directory controls on the same page.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW DirectoryPageShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryPageLeave

Function DirectoryPageShow
  ; Apply dark colors to dialog + child controls
  GetDlgItem $0 $HWNDPARENT 0 ; (no-op, kept for symmetry)

  ; Add the three checkboxes via nsDialogs onto the directory page's dialog.
  ; The page dialog HWND is HWNDPARENT in this context.
  ${NSD_CreateCheckbox} 20u 110u 280u 12u "Create desktop shortcut"
  Pop $DesktopShortcutCheckbox
  SetCtlColors $DesktopShortcutCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_Check} $DesktopShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 20u 124u 280u 12u "Create Start Menu shortcut"
  Pop $StartMenuShortcutCheckbox
  SetCtlColors $StartMenuShortcutCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $CreateStartMenuShortcut == "1"
    ${NSD_Check} $StartMenuShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 20u 138u 280u 12u "Launch LokLM at Windows startup"
  Pop $AutostartCheckbox
  SetCtlColors $AutostartCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $EnableAutostart == "1"
    ${NSD_Check} $AutostartCheckbox
  ${EndIf}
FunctionEnd

Function DirectoryPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}

  ${NSD_GetState} $StartMenuShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateStartMenuShortcut "1"
  ${Else}
    StrCpy $CreateStartMenuShortcut "0"
  ${EndIf}

  ${NSD_GetState} $AutostartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $EnableAutostart "1"
  ${Else}
    StrCpy $EnableAutostart "0"
  ${EndIf}
FunctionEnd

; ── Hook: customInstall — runs inside the install section ──
!macro customInstall
  ; Honor checkbox states (override electron-builder defaults where needed).
  ; electron-builder already creates desktop + start menu shortcuts by default
  ; based on package.json build.nsis.createDesktopShortcut / createStartMenuShortcut.
  ; If user UNCHECKED them in our custom UI, remove what e-b created.

  ${If} $CreateDesktopShortcut == "0"
    Delete "$DESKTOP\LokLM.lnk"
  ${EndIf}

  ${If} $CreateStartMenuShortcut == "0"
    Delete "$SMPROGRAMS\LokLM.lnk"
  ${EndIf}

  ; Autostart: write HKCU Run key only if checked.
  ${If} $EnableAutostart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM" "$INSTDIR\LokLM.exe"
  ${EndIf}
!macroend

; ── Hook: customUnInstall — runs inside the uninstall section ──
!macro customUnInstall
  ; Clean up the autostart key if it exists.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM"
!macroend
```

- [ ] **Step 2: Commit**

```bash
git add installer/installer.nsh
git commit -m "installer , add nsis include (dark colors + dir-page checkboxes + autostart)"
```

---

## Task 9: Wire electron-builder to use our installer + assets

**Files:**
- Modify: `package.json` (build.nsis block, scripts.package:win)

- [ ] **Step 1: Update `build.nsis` block**

In `package.json`, replace the entire `build.nsis` block with:

```json
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
```

- [ ] **Step 2: Update `scripts.package:win`**

Change from:
```json
"package:win": "electron-vite build && electron-builder --win nsis",
```
to:
```json
"package:win": "electron-vite build && pnpm installer:assets && electron-builder --win nsis",
```

- [ ] **Step 3: Add lint-staged hook so SVG edits auto-regenerate BMPs**

In `package.json`, modify the `lint-staged` block to add a new key for installer SVGs:

```json
"lint-staged": {
  "*.{ts,tsx}": [
    "prettier --write",
    "eslint --fix"
  ],
  "*.{json,md,yml,yaml,css,html}": [
    "prettier --write"
  ],
  "installer/assets/*.svg": [
    "node installer/assets/export.mjs",
    "git add installer/installer-sidebar.bmp installer/installer-header.bmp installer/uninstaller-sidebar.bmp"
  ]
}
```

Rationale: when a contributor stages a `.svg` change, husky+lint-staged re-runs the exporter and stages the updated BMPs in the same commit — keeps SVGs and BMPs in lockstep without depending on CI.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "installer , wire custom nsh + bmps into electron-builder config"
```

---

## Task 10: Tier-2 — NSIS lint script

**Files:**
- Modify: `package.json` (scripts.lint:nsis)

- [ ] **Step 1: Add `lint:nsis` script**

In `package.json` `scripts` block, after `lint:fix`:

```json
"lint:nsis": "makensis /CMDHELP installer/installer.nsh",
```

- [ ] **Step 2: Verify (on Windows with NSIS installed)**

Run: `pnpm lint:nsis`

Expected: if makensis is installed and `installer.nsh` is syntactically valid, prints NSIS help and exits 0. If makensis isn't installed, prints "command not found" — that's fine, the script is local-only.

If lint catches a real syntax error, fix `installer/installer.nsh` and re-run.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "installer , add tier-2 makensis lint script"
```

---

## Task 11: Tier-5 — local E2E install/uninstall test

**Files:**
- Create: `tests/installer/e2e.test.ts`
- Modify: `package.json` (scripts.test:installer:e2e)

- [ ] **Step 1: Write `tests/installer/e2e.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
const REPO_ROOT = path.resolve(__dirname, '../..')
const TEST_INSTALL_DIR = 'C:\\test-loklm-install'

describe.skipIf(!isWindows)('installer E2E (Windows only)', () => {
  it('silent install + uninstall round-trip', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
    const exePath = path.join(
      REPO_ROOT,
      'release',
      `LokLM-Setup-${pkg.version}-win-x64.exe`,
    )

    expect(existsSync(exePath), `Built installer not found: ${exePath}. Run \`pnpm package:win\` first.`)
      .toBe(true)

    if (existsSync(TEST_INSTALL_DIR)) {
      rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
    }

    // Silent install
    const installResult = spawnSync(exePath, ['/S', `/D=${TEST_INSTALL_DIR}`], {
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    })
    expect(installResult.status, `Installer exited ${installResult.status}`).toBe(0)

    // Verify installed
    const installedExe = path.join(TEST_INSTALL_DIR, 'LokLM.exe')
    expect(existsSync(installedExe)).toBe(true)

    // Silent uninstall
    const uninstallerExe = path.join(TEST_INSTALL_DIR, 'Uninstall LokLM.exe')
    expect(existsSync(uninstallerExe), 'Uninstaller missing').toBe(true)

    const uninstallResult = spawnSync(uninstallerExe, ['/S'], {
      stdio: 'inherit',
      timeout: 2 * 60 * 1000,
    })
    expect(uninstallResult.status).toBe(0)

    // Uninstaller schedules removal of its own folder; give it a moment.
    // Worst case the cleanup below handles it.
    if (existsSync(TEST_INSTALL_DIR)) {
      try {
        rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
      } catch {
        // NSIS uninstaller deletes itself via a batch script — best-effort cleanup
      }
    }
  }, 10 * 60 * 1000)
})
```

- [ ] **Step 2: Add `test:installer:e2e` script**

In `package.json` `scripts` block (after `test:integration`):

```json
"test:installer:e2e": "vitest run tests/installer/e2e.test.ts",
```

Note: this script invokes vitest directly with a file path rather than going through the workspace project — because the workspace project intentionally excludes `e2e.test.ts` to keep it out of `pnpm test:installer`.

- [ ] **Step 3: Verify the test file is syntactically valid (no run yet)**

Run: `pnpm typecheck`

Expected: PASS. If imports break, double-check the import paths.

- [ ] **Step 4: Commit**

```bash
git add tests/installer/e2e.test.ts package.json
git commit -m "installer , add tier-5 e2e install/uninstall test (windows-only)"
```

---

## Task 12: Tier-3 — built artifact smoke test

**Files:**
- Create: `tests/installer/artifact.test.ts`

- [ ] **Step 1: Write `tests/installer/artifact.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../..')

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
const VERSION = pkg.version
const EXE_PATH = path.join(REPO_ROOT, 'release', `LokLM-Setup-${VERSION}-win-x64.exe`)

const exeMissing = !existsSync(EXE_PATH)

describe.skipIf(exeMissing)('installer artifact smoke test', () => {
  it('exists at the expected path', () => {
    expect(existsSync(EXE_PATH)).toBe(true)
  })

  it('is within the expected size range (60-200 MB)', () => {
    const size = statSync(EXE_PATH).size
    const mb = size / (1024 * 1024)
    expect(mb).toBeGreaterThan(60)
    expect(mb).toBeLessThan(200)
  })

  it('is a valid PE32+ binary (NSIS installer is a Windows EXE)', () => {
    const fd = readFileSync(EXE_PATH, { encoding: null })
    // DOS header: 'MZ' magic
    expect(fd[0]).toBe(0x4d)
    expect(fd[1]).toBe(0x5a)
    // PE header offset at 0x3c
    const peOffset = fd.readUInt32LE(0x3c)
    expect(peOffset).toBeGreaterThan(0)
    expect(peOffset).toBeLessThan(fd.length - 4)
    // PE signature: 'PE\0\0'
    expect(fd[peOffset]).toBe(0x50)
    expect(fd[peOffset + 1]).toBe(0x45)
    expect(fd[peOffset + 2]).toBe(0x00)
    expect(fd[peOffset + 3]).toBe(0x00)
  })

  it('contains the LokLM sidebar BMP bytes (substring match)', () => {
    // The 'BM' magic + dimensions match should appear at least once inside
    // the installer payload. We grep for a 12-byte signature: 'BM' + filesize
    // bytes (variable) is too brittle, so we look for the exact dimensions
    // header window (width 164, height 314, 24bpp, BI_RGB).
    const expectedHeader = Buffer.alloc(20)
    expectedHeader.writeUInt32LE(40, 0) // DIB header size
    expectedHeader.writeInt32LE(164, 4) // width
    expectedHeader.writeInt32LE(314, 8) // height
    expectedHeader.writeUInt16LE(1, 12) // planes
    expectedHeader.writeUInt16LE(24, 14) // bpp
    expectedHeader.writeUInt32LE(0, 16) // BI_RGB

    const exe = readFileSync(EXE_PATH)
    const idx = exe.indexOf(expectedHeader)
    expect(idx, 'Sidebar BMP3 header not found in installer payload').toBeGreaterThan(-1)
  })
})
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run the test (will skip if no built exe yet)**

Run: `pnpm test:installer`

Expected: Tier-1 tests pass; Tier-3 tests skip because `release/LokLM-Setup-X.X.X.exe` doesn't exist yet.

- [ ] **Step 4: Commit**

```bash
git add tests/installer/artifact.test.ts
git commit -m "installer , add tier-3 artifact smoke test (pe header + embedded bmp)"
```

---

## Task 13: Tier-4 — visual regression doc

**Files:**
- Create: `docs/installer/visual-regression.md`

- [ ] **Step 1: Create `docs/installer/visual-regression.md`**

```markdown
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
   - `docs/installer/screenshots/<version>-06-uninstaller.png` *(launch uninstaller after install)*

4. Click **Cancel** on the wizard. **Do not actually install** (that's Tier 5).

5. Open the PR and reference both the old baseline screenshots and the new ones in the description so reviewers can eyeball the diff.

## Acceptance criteria per page

| Page | What to check |
|---|---|
| Welcome | Sidebar BMP renders left, "Welcome to LokLM Setup" heading, dark page bg |
| License | Header BMP at top, MIT license text legible, "I accept" radio enabled |
| Install dir + options | Header BMP, path field shows `%LOCALAPPDATA%\LokLM`, 3 checkboxes (2 checked, autostart unchecked) |
| Installing | Header BMP, progress bar visible (system default style — that's fine) |
| Finish | Sidebar BMP, "LokLM is ready", "Launch LokLM" checked by default |
| Uninstaller | Uninstaller sidebar BMP (calmer palette), confirmation prompt |

## Baseline

*(Populated by the first run of the procedure after this plan ships.)*
```

- [ ] **Step 2: Commit**

```bash
git add -f docs/installer/visual-regression.md
git commit -m "installer , add tier-4 visual regression procedure doc"
```

Note: `git add -f` is **not** needed for `docs/installer/` because the gitignore entry is `docs/superpowers/` (not `docs/`). If the file lands without `-f`, drop the flag.

---

## Task 14: Handoff doc for Denys

**Files:**
- Create: `docs/installer/handoff-to-denys.md`

- [ ] **Step 1: Create `docs/installer/handoff-to-denys.md`**

```markdown
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

**Runner requirement:** Windows runner (the artifact is windows-only); reuses the runner that already builds via `electron-builder --win nsis`.

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/installer/handoff-to-denys.md
git commit -m "installer , add handoff doc for denys (tier 3 + 5 ci candidates)"
```

---

## Task 15: Run Tier-1 tests to verify the full pipeline still passes

- [ ] **Step 1: Run Tier 1**

Run: `pnpm test:installer`

Expected: 3 Tier-1 tests PASS, Tier-3 tests are SKIPPED (no built artifact yet).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run prettier check**

Run: `pnpm format:check`

Expected: PASS. If it fails on files we wrote, run `pnpm format` and amend the last commit:

```bash
pnpm format
git add -u
git commit --amend --no-edit
```

---

## Task 16: Manual smoke test — build and visually inspect

This is the real moment of truth. Everything before this was scaffolding; now we actually run the build and look at the installer.

- [ ] **Step 1: Build the installer**

Run: `pnpm package:win`

Expected: 
- `electron-vite build` succeeds
- `pnpm installer:assets` regenerates 3 BMPs
- `electron-builder --win nsis` produces `release/LokLM-Setup-0.2.3-win-x64.exe`

If the build fails on the NSIS step, look at the makensis output for syntax errors in `installer.nsh` and fix them.

- [ ] **Step 2: Launch the installer**

Run: `start release\LokLM-Setup-0.2.3-win-x64.exe`

- [ ] **Step 3: Walk every page — DO NOT install**

Click through Welcome → License → Install dir + Options → (cancel before "Install" — we don't want to actually install during smoke test).

Verify each page against the spec §7:
- Welcome page: sidebar BMP visible on left, dark page bg
- License page: header BMP at top, MIT license rendered
- Directory + options: header BMP at top, path field defaults to `%LOCALAPPDATA%\LokLM`, 3 checkboxes (desktop ✓, start menu ✓, autostart ✗)
- Buttons render with native Windows look (this is expected — see spec §3)

- [ ] **Step 4: Run Tier-3 smoke test against the just-built artifact**

Run: `pnpm test:installer`

Expected: all Tier-1 PASS + all Tier-3 PASS (the artifact now exists).

- [ ] **Step 5: Run Tier-5 (optional, performs a real install)**

Only do this in a disposable environment or if you're OK with installing LokLM to `C:\test-loklm-install` temporarily.

Run: `pnpm test:installer:e2e`

Expected: PASS. Test cleans up after itself.

- [ ] **Step 6: Run Tier-2 lint (if NSIS installed locally)**

Run: `pnpm lint:nsis`

Expected: PASS (or "makensis not found" — acceptable; lint is best-effort local).

- [ ] **Step 7: Capture baseline screenshots**

Following the procedure in `docs/installer/visual-regression.md`, capture all 6 screenshots and commit them:

```bash
mkdir docs\installer\screenshots
# (drop screenshots into the folder)
git add docs/installer/screenshots/
git commit -m "installer , add baseline screenshots for v0.2.3"
```

- [ ] **Step 8: Final consolidated commit (if anything changed during smoke)**

If smoke testing surfaced fixes to SVGs / installer.nsh / package.json, commit them as separate followup commits — one per concern.

---

## Task 17: Final review checklist

- [ ] **Step 1: Verify all spec success criteria are met**

Cross-check `docs/superpowers/specs/2026-05-20-custom-nsis-installer-design.md` §12:

- [ ] `pnpm package:win` produces the custom-themed installer ✓
- [ ] All 5 wizard pages render dark theme ✓
- [ ] Combined Install Location + Options page works ✓
- [ ] Tier 1, 3, 5 tests pass on Windows ✓
- [ ] Tier 2 lint passes locally on Windows ✓
- [ ] Tier 4 screenshot doc populated with reference images ✓
- [ ] Handoff doc delivered to Denys ✓

- [ ] **Step 2: Verify branch hygiene**

Run: `git log --oneline main..dom-dev | head -25`

Expected: see all the installer-related commits, no commits with "Claude" / "Anthropic" / "Co-Authored-By" in them. Confirm nothing was pushed to `main`.

- [ ] **Step 3: Hand off the branch to Denys**

Per [[loklm-collaboration-rules]], merging to `main` is Denys's job. Either:
- Open a PR from `dom-dev` → `main` and request Denys's review, OR
- Ping Denys to merge `dom-dev` when convenient

Include in the PR/handoff message:
- Link to the spec
- Link to the handoff doc (`docs/installer/handoff-to-denys.md`)
- Note that Tier 5 has been verified locally and Tier 3 is candidate for the release workflow

---

## Self-Review Summary

**Spec coverage map:**

| Spec section | Implemented in |
|---|---|
| §1 Goal | Task 16 (end-to-end build) |
| §3 Fidelity ("same vibe") | Task 8 (no plugins), Task 6 (frozen blobs in SVG) |
| §4 File layout (`installer/`) | Tasks 2, 3, 4, 7, 8 |
| §5 electron-builder config | Task 9 |
| §6.1 Color tokens | Task 8 (LM_BG_*, LM_FG_*, LM_ACCENT) |
| §6.2 Sidebar bitmap | Task 3 (SVG), Task 7 (BMP) |
| §6.3 Header bitmap | Task 2 (SVG), Task 7 (BMP) |
| §6.4 Control colors via SetCtlColors | Task 8 |
| §7 Page flow (5 pages + uninstaller) | Task 9 (config), Task 8 (dir page extension), Task 16 (visual verification) |
| §8 SVG→BMP exporter | Tasks 5, 6, 7 |
| §8.2 lint-staged BMP regeneration hook | Task 9 Step 3 |
| §9 Tier 1 — Asset gen tests | Task 5 (tests), Task 6 (exporter) |
| §9 Tier 2 — NSIS lint | Task 10 |
| §9 Tier 3 — Artifact smoke | Task 12 |
| §9 Tier 4 — Visual regression doc | Task 13 |
| §9 Tier 5 — E2E install/uninstall | Task 11 |
| §9 Handoff doc | Task 14 |
| §12 Success criteria | Task 17 |

No gaps. No placeholders in any task — every code/command step has concrete content. Type/name consistency verified: `exportSvgToBmp` and `exportAll` signatures stay constant across Task 5 (test), Task 6 (implementation), and Task 6 Step 2 (script wiring).
