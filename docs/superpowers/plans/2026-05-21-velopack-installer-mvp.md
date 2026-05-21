# Velopack installer + auto-update MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace electron-builder's NSIS/DMG/AppImage installer outputs with Velopack across Windows, macOS, and Linux, add GitHub-Releases-driven auto-update, and bundle a one-shot VC++ redist installer on Windows so a clean Win11 machine never hits `msvcp140.dll not found`.

**Architecture:** Velopack ships a small native bootstrap stub per OS (no .NET on user machine needed). `electron-builder --dir` still produces the unpacked app (handles asar + native-module rebuild for `argon2` / `node-llama-cpp`); `vpk pack` consumes that directory and emits installer + update package. Main process calls `VelopackApp.build().run()` as the *very first* statement so Velopack lifecycle flags (`--veloapp-install`, `--veloapp-updated`) are handled correctly. Renderer triggers updates via a new `window.api.velopack.*` namespace exposed through preload's `contextBridge`. CI is a matrix workflow (`windows-latest` / `macos-latest` / `ubuntu-latest`) triggered on `v*.*.*` tag push, fan-in to a single publish job that uploads all three channels to one GitHub Release with the per-channel update feeds attached. Existing `release-installer.yml` (Bunny CDN + MinIO + Hetzner website redeploy) is deleted.

**Tech Stack:** `velopack` (Node SDK) + `vpk` (dotnet CLI) for installer/update; `electron-builder --dir` retained only for the unpacked build stage; GitHub Actions; vitest for unit tests; existing React/contextBridge stack in renderer.

**Spec:** [docs/superpowers/specs/2026-05-21-velopack-installer-mvp-design.md](../specs/2026-05-21-velopack-installer-mvp-design.md)

---

## File map

**Create:**
- `src/main/velopack.ts` — UpdateManager wrapper (init, check, download, apply)
- `src/main/velopack.test.ts` — vitest unit tests for above
- `src/main/velopack-hooks.ts` — VC++ redist install + registry probe (Windows-only logic)
- `src/main/velopack-hooks.test.ts` — vitest unit tests for above
- `src/renderer/src/settings/sections/UpdatesSection.tsx` — "Check for updates" UI
- `src/renderer/src/settings/sections/UpdatesSection.test.tsx` — vitest+jsdom tests for above
- `scripts/fetch-vcredist.mjs` — downloads `vc_redist.x64.exe` from Microsoft into `resources/vcredist/`
- `resources/vcredist/.gitkeep` — placeholder so the directory exists; actual `vc_redist.x64.exe` is gitignored and fetched at build time
- `.github/workflows/release.yml` — new matrix release workflow (Velopack)

**Modify:**
- `package.json` — add `velopack` dep, rewrite `package:win`/`package:mac`/`package:linux` scripts, remove `build.win.target` / `build.mac.target` / `build.linux.target` / `build.nsis` blocks, add `build.win.extraResources` for `vcredist/`, add a `fetch-vcredist` script
- `.gitignore` — ignore `resources/vcredist/vc_redist.x64.exe`
- `src/main/index.ts` — add `VelopackApp.build().onAfterInstallFastCallback(...).run()` as the **first** statement, add vcredist-failed marker dialog before `BrowserWindow` creation, register `velopack:*` IPC handlers, call `initVelopack()`
- `src/preload/index.ts` — add `velopack: { check, download, apply, onDownloadProgress }` namespace to existing `api` object
- `src/preload/index.d.ts` — (no change needed; `Api` is `typeof api` so it picks up the new namespace automatically)
- `src/renderer/src/settings/AdvancedTab.tsx` — mount `<UpdatesSection />`
- `README.md` — add "Installing LokLM" section (SmartScreen / Gatekeeper / AppImage workarounds)

**Delete:**
- `.github/workflows/release-installer.yml` — old NSIS / Bunny / MinIO / Hetzner workflow

---

## Task 1: Add velopack dependency, retire old electron-builder installer config, delete old workflow

This task isolates the dependency + config cleanup so subsequent tasks can build on a clean base. After this task the app still builds and runs in dev; only the release artifact shape is broken (release workflow doesn't yet exist for the new path).

**Files:**
- Modify: `package.json`
- Delete: `.github/workflows/release-installer.yml`

- [ ] **Step 1.1: Add `velopack` runtime dependency**

```bash
pnpm add velopack
```

Expected: `velopack` appears in `dependencies` of `package.json`. Pin version is fine — accept whatever pnpm resolves.

- [ ] **Step 1.2: Remove electron-builder Windows/Mac/Linux installer-target config**

In `package.json`, delete the entire `build.win`, `build.nsis`, `build.linux`, and `build.mac` objects. Keep `build.appId`, `build.productName`, `build.directories`, `build.files`, `build.asar`, `build.publish`, `build.npmRebuild`, `build.extraResources`. The resulting `build` object should look like:

```jsonc
"build": {
  "appId": "com.loklm.desktop",
  "productName": "LokLM",
  "directories": {
    "output": "release",
    "buildResources": "resources"
  },
  "files": [
    "out/**/*",
    "package.json",
    "!**/node_modules/**/{CHANGELOG.md,README.md,README,readme.md,readme}",
    "!**/node_modules/**/{test,__tests__,tests,powered-test,example,examples}",
    "!**/node_modules/**/*.d.ts",
    "!**/node_modules/**/*.map"
  ],
  "asar": true,
  "publish": null,
  "npmRebuild": false,
  "extraResources": [
    { "from": "drizzle", "to": "drizzle" },
    { "from": "src/main/db/migrations", "to": "migrations" }
  ]
}
```

- [ ] **Step 1.3: Stub out `package:win` / `package:mac` / `package:linux` scripts**

The full pipeline (with `vpk pack`) lands in Task 8. For now, just make them produce the unpacked build so devs can still smoke-test locally without erroring. In `package.json` `"scripts"`:

```jsonc
"package:win":   "electron-vite build && electron-builder --win --dir",
"package:mac":   "electron-vite build && electron-builder --mac --dir",
"package:linux": "electron-vite build && electron-builder --linux --dir",
```

- [ ] **Step 1.4: Delete the old workflow**

```bash
git rm .github/workflows/release-installer.yml
```

Expected: file is removed from working tree and staged for deletion.

- [ ] **Step 1.5: Verify build still works**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
```

Expected: both succeed with no errors. (We haven't added any new TS code yet — this verifies the dependency add didn't break type resolution and the build config edits are syntactically valid JSON.)

- [ ] **Step 1.6: Commit**

```bash
git add package.json pnpm-lock.yaml .github/workflows/release-installer.yml
git commit -m "release , add velopack dep + retire old NSIS/Bunny/MinIO workflow"
```

---

## Task 2: Bundle the VC++ 2015–2022 redistributable (download-at-build-time)

The redist binary (~13 MB) is too big to commit. We download it on demand into a gitignored path. CI runs the download script before `vpk pack`. Dev machines that run `pnpm package:win` also trigger it.

**Files:**
- Create: `scripts/fetch-vcredist.mjs`
- Create: `resources/vcredist/.gitkeep`
- Modify: `package.json` (add `fetch-vcredist` script, wire into `package:win`, add Windows-only `extraResources`)
- Modify: `.gitignore`

- [ ] **Step 2.1: Write the fetch script**

Create `scripts/fetch-vcredist.mjs`:

```js
// downloads Microsoft's VC++ 2015-2022 x64 redistributable into
// resources/vcredist/vc_redist.x64.exe so the windows installer can bundle
// it via electron-builder's extraResources. The file is gitignored
// (~13 MB) and re-downloaded by CI on every release build.
import { existsSync, mkdirSync, createWriteStream, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
const DEST = 'resources/vcredist/vc_redist.x64.exe'

if (existsSync(DEST)) {
  const size = statSync(DEST).size
  console.log(`vcredist , already present (${size} bytes) , skip download`)
  process.exit(0)
}

mkdirSync(dirname(DEST), { recursive: true })

console.log(`vcredist , fetching ${URL}`)
const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok || !res.body) {
  console.error(`vcredist , fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}

await finished(Readable.fromWeb(res.body).pipe(createWriteStream(DEST)))
const size = statSync(DEST).size
if (size < 10_000_000) {
  console.error(`vcredist , suspiciously small file (${size} bytes) , aborting`)
  process.exit(1)
}
console.log(`vcredist , downloaded (${size} bytes) -> ${DEST}`)
```

- [ ] **Step 2.2: Create the directory placeholder**

```bash
mkdir -p resources/vcredist
touch resources/vcredist/.gitkeep
```

- [ ] **Step 2.3: Gitignore the binary**

Append to `.gitignore`:

```
# fetched at build time by scripts/fetch-vcredist.mjs , don't commit
resources/vcredist/vc_redist.x64.exe
```

- [ ] **Step 2.4: Add the script and wire into package:win**

In `package.json` `"scripts"`:

```jsonc
"fetch-vcredist": "node scripts/fetch-vcredist.mjs",
"package:win":   "node scripts/fetch-vcredist.mjs && electron-vite build && electron-builder --win --dir",
```

(Leave `package:mac` and `package:linux` alone — they don't need vcredist.)

- [ ] **Step 2.5: Add Windows-only extraResources entry**

In `package.json` `"build"`, add a `win` block (separate from the deleted `win.target` config — this one only carries `extraResources` overrides):

```jsonc
"build": {
  "appId": "com.loklm.desktop",
  // ...existing keys unchanged...
  "extraResources": [
    { "from": "drizzle", "to": "drizzle" },
    { "from": "src/main/db/migrations", "to": "migrations" }
  ],
  "win": {
    "extraResources": [
      { "from": "resources/vcredist/vc_redist.x64.exe", "to": "vcredist/vc_redist.x64.exe" }
    ]
  }
}
```

This puts the binary at `process.resourcesPath/vcredist/vc_redist.x64.exe` inside the packaged Windows app only — mac/linux installers don't get it.

- [ ] **Step 2.6: Smoke-test the fetch script**

```bash
pnpm run fetch-vcredist
```

Expected (first run): downloads, prints `vcredist , downloaded (~13xxxxx bytes) -> resources/vcredist/vc_redist.x64.exe`. (Second run skips with `already present` message.)

- [ ] **Step 2.7: Commit**

```bash
git add scripts/fetch-vcredist.mjs resources/vcredist/.gitkeep .gitignore package.json
git commit -m "release , add vcredist fetch script + windows-only extraResources entry"
```

---

## Task 3: `src/main/velopack-hooks.ts` — VC++ probe + redist installer (TDD)

Windows-only. Probes registry for the VC++ 2015–2022 x64 runtime; if absent, runs the bundled redist installer synchronously; writes a failure marker on unexpected exit.

**Files:**
- Create: `src/main/velopack-hooks.ts`
- Create: `src/main/velopack-hooks.test.ts`

- [ ] **Step 3.1: Write the failing test file**

Create `src/main/velopack-hooks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// mock node:child_process so we can capture spawnSync calls without
// actually spawning the redist installer in the test runner.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

// mock the registry probe — implementation detail of velopack-hooks.ts , we
// don't want to depend on the real windows registry inside vitest.
vi.mock('./velopack-hooks-registry', () => ({
  isVcRuntimeInstalled: vi.fn(),
}))

import { spawnSync } from 'node:child_process'
import { isVcRuntimeInstalled } from './velopack-hooks-registry'
import { installVcRedistIfMissing, VCREDIST_MARKER_NAME } from './velopack-hooks'

const tmp = mkdtempSync(join(tmpdir(), 'velopack-hooks-test-'))
const RESOURCES = join(tmp, 'resources')
const USERDATA = join(tmp, 'userdata')

beforeEach(() => {
  vi.mocked(spawnSync).mockReset()
  vi.mocked(isVcRuntimeInstalled).mockReset()
  // clean marker between tests
  const marker = join(USERDATA, VCREDIST_MARKER_NAME)
  if (existsSync(marker)) rmSync(marker)
})

describe('installVcRedistIfMissing', () => {
  it('short-circuits when the VC++ runtime is already installed', () => {
    vi.mocked(isVcRuntimeInstalled).mockReturnValue(true)

    installVcRedistIfMissing({ resourcesPath: RESOURCES, userDataPath: USERDATA })

    expect(spawnSync).not.toHaveBeenCalled()
    expect(existsSync(join(USERDATA, VCREDIST_MARKER_NAME))).toBe(false)
  })

  it('spawns the bundled redist installer with /install /quiet /norestart when missing', () => {
    vi.mocked(isVcRuntimeInstalled).mockReturnValue(false)
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    } as ReturnType<typeof spawnSync>)

    installVcRedistIfMissing({ resourcesPath: RESOURCES, userDataPath: USERDATA })

    expect(spawnSync).toHaveBeenCalledTimes(1)
    const [exe, args, opts] = vi.mocked(spawnSync).mock.calls[0]!
    expect(exe).toBe(join(RESOURCES, 'vcredist', 'vc_redist.x64.exe'))
    expect(args).toEqual(['/install', '/quiet', '/norestart'])
    expect(opts).toMatchObject({ stdio: 'ignore' })
    expect(existsSync(join(USERDATA, VCREDIST_MARKER_NAME))).toBe(false)
  })

  it.each([0, 1638, 3010])('treats exit code %i as success (no marker)', (code) => {
    vi.mocked(isVcRuntimeInstalled).mockReturnValue(false)
    vi.mocked(spawnSync).mockReturnValue({
      status: code,
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    } as ReturnType<typeof spawnSync>)

    installVcRedistIfMissing({ resourcesPath: RESOURCES, userDataPath: USERDATA })

    expect(existsSync(join(USERDATA, VCREDIST_MARKER_NAME))).toBe(false)
  })

  it('writes a marker file when the installer exits with an unexpected non-zero code', () => {
    vi.mocked(isVcRuntimeInstalled).mockReturnValue(false)
    vi.mocked(spawnSync).mockReturnValue({
      status: 1603, // generic MSI failure
      pid: 1,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      signal: null,
    } as ReturnType<typeof spawnSync>)

    installVcRedistIfMissing({ resourcesPath: RESOURCES, userDataPath: USERDATA })

    const marker = join(USERDATA, VCREDIST_MARKER_NAME)
    expect(existsSync(marker)).toBe(true)
    const payload = JSON.parse(readFileSync(marker, 'utf8'))
    expect(payload).toMatchObject({ exitCode: 1603 })
    expect(typeof payload.timestamp).toBe('string')
  })

  it('writes a marker file when spawnSync throws (e.g. exe missing)', () => {
    vi.mocked(isVcRuntimeInstalled).mockReturnValue(false)
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error('ENOENT: missing vc_redist.x64.exe')
    })

    installVcRedistIfMissing({ resourcesPath: RESOURCES, userDataPath: USERDATA })

    const marker = join(USERDATA, VCREDIST_MARKER_NAME)
    expect(existsSync(marker)).toBe(true)
    const payload = JSON.parse(readFileSync(marker, 'utf8'))
    expect(payload).toMatchObject({ error: expect.stringContaining('ENOENT') })
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
pnpm exec vitest run --project node src/main/velopack-hooks.test.ts
```

Expected: FAIL with module-not-found errors for `./velopack-hooks` and `./velopack-hooks-registry`.

- [ ] **Step 3.3: Write the registry probe (separate module so it can be mocked)**

Create `src/main/velopack-hooks-registry.ts`:

```ts
// thin wrapper around the windows registry probe so velopack-hooks.ts stays
// pure (just spawnSync + fs) and the registry call can be mocked in tests.
//
// HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64\Installed
// is microsoft's documented detection key for the VC++ 2015-2022 x64 runtime.
// REG_DWORD = 1 means installed.
import { spawnSync } from 'node:child_process'

export function isVcRuntimeInstalled(): boolean {
  if (process.platform !== 'win32') return true // no-op on non-windows

  // shells out to reg.exe — simplest cross-node-version way that doesn't
  // need a native module. parsing is robust enough for one DWORD value.
  const res = spawnSync(
    'reg',
    [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
      '/v',
      'Installed',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
  )

  if (res.status !== 0 || !res.stdout) return false
  // expected output line: "    Installed    REG_DWORD    0x1"
  return /Installed\s+REG_DWORD\s+0x1\b/i.test(res.stdout)
}
```

- [ ] **Step 3.4: Write the hook implementation**

Create `src/main/velopack-hooks.ts`:

```ts
// VC++ 2015-2022 x64 redistributable installer — invoked from velopack's
// onAfterInstallFastCallback in src/main/index.ts. Synchronous on purpose:
// the velopack fast-callback runs before any electron window opens, and we
// need the redist installed before the app's first launch can load argon2
// or node-llama-cpp's native modules (both link msvcp140.dll).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isVcRuntimeInstalled } from './velopack-hooks-registry'

export const VCREDIST_MARKER_NAME = 'vcredist-failed.flag'

// exit codes treated as success per microsoft's redist documentation:
//   0    = success
//   1638 = another , newer version is already installed
//   3010 = success , restart required (we ignore — first launch happens
//          after install anyway , and the runtime DLLs are usable without
//          a reboot)
const ALLOWED_EXIT = new Set([0, 1638, 3010])

export interface VcRedistOptions {
  resourcesPath: string // typically process.resourcesPath
  userDataPath: string // typically app.getPath('userData')
}

export function installVcRedistIfMissing(opts: VcRedistOptions): void {
  if (process.platform !== 'win32') return
  if (isVcRuntimeInstalled()) return

  const exe = join(opts.resourcesPath, 'vcredist', 'vc_redist.x64.exe')

  try {
    const result = spawnSync(exe, ['/install', '/quiet', '/norestart'], {
      stdio: 'ignore',
    })
    const status = result.status ?? -1
    if (!ALLOWED_EXIT.has(status)) {
      writeMarker(opts.userDataPath, { exitCode: status, timestamp: nowIso() })
    }
  } catch (err) {
    writeMarker(opts.userDataPath, {
      error: err instanceof Error ? err.message : String(err),
      timestamp: nowIso(),
    })
  }
}

function writeMarker(userDataPath: string, payload: Record<string, unknown>): void {
  const file = join(userDataPath, VCREDIST_MARKER_NAME)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
}

function nowIso(): string {
  return new Date().toISOString()
}
```

- [ ] **Step 3.5: Run tests to verify they pass**

```bash
pnpm exec vitest run --project node src/main/velopack-hooks.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add src/main/velopack-hooks.ts src/main/velopack-hooks-registry.ts src/main/velopack-hooks.test.ts
git commit -m "main , velopack-hooks , vc++ redist probe + installer (windows-only)"
```

---

## Task 4: `src/main/velopack.ts` — UpdateManager wrapper (TDD)

Thin wrapper around Velopack's `UpdateManager`. Single source of truth for the GitHub Releases URL. Only file in the codebase that imports `velopack` at runtime.

**Files:**
- Create: `src/main/velopack.ts`
- Create: `src/main/velopack.test.ts`

- [ ] **Step 4.1: Write the failing test file**

Create `src/main/velopack.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock the velopack module so we can drive UpdateManager behavior without
// network calls or any real package files on disk.
const mockCheckForUpdatesAsync = vi.fn()
const mockDownloadUpdatesAsync = vi.fn()
const mockWaitExitThenApplyUpdates = vi.fn()

vi.mock('velopack', () => ({
  UpdateManager: vi.fn().mockImplementation(() => ({
    checkForUpdatesAsync: mockCheckForUpdatesAsync,
    downloadUpdatesAsync: mockDownloadUpdatesAsync,
    waitExitThenApplyUpdates: mockWaitExitThenApplyUpdates,
  })),
}))

import { UpdateManager } from 'velopack'
import {
  initVelopack,
  checkForUpdates,
  downloadUpdates,
  applyUpdatesAndRestart,
  GITHUB_REPO_URL,
} from './velopack'

beforeEach(() => {
  vi.mocked(UpdateManager).mockClear()
  mockCheckForUpdatesAsync.mockReset()
  mockDownloadUpdatesAsync.mockReset()
  mockWaitExitThenApplyUpdates.mockReset()
})

describe('velopack wrapper', () => {
  it('constructs UpdateManager with the github repo url on init', () => {
    initVelopack()
    expect(UpdateManager).toHaveBeenCalledWith(GITHUB_REPO_URL)
    expect(GITHUB_REPO_URL).toBe('https://github.com/TwoD97/LokLM')
  })

  it('returns null when checkForUpdates finds no update', async () => {
    initVelopack()
    mockCheckForUpdatesAsync.mockResolvedValue(null)

    await expect(checkForUpdates()).resolves.toBeNull()
  })

  it('returns the UpdateInfo when one is available', async () => {
    initVelopack()
    const info = { TargetFullRelease: { Version: '0.3.1', Size: 1234 } }
    mockCheckForUpdatesAsync.mockResolvedValue(info)

    await expect(checkForUpdates()).resolves.toBe(info)
  })

  it('propagates the error when checkForUpdates rejects', async () => {
    initVelopack()
    mockCheckForUpdatesAsync.mockRejectedValue(new Error('offline'))

    await expect(checkForUpdates()).rejects.toThrow('offline')
  })

  it('forwards downloadUpdates with the same UpdateInfo it received', async () => {
    initVelopack()
    const info = { TargetFullRelease: { Version: '0.3.1' } }
    mockDownloadUpdatesAsync.mockResolvedValue(undefined)

    await downloadUpdates(info as never)

    expect(mockDownloadUpdatesAsync).toHaveBeenCalledWith(info)
  })

  it('applyUpdatesAndRestart calls waitExitThenApplyUpdates with silent=false, restart=true', async () => {
    initVelopack()
    const info = { TargetFullRelease: { Version: '0.3.1' } }

    await applyUpdatesAndRestart(info as never)

    expect(mockWaitExitThenApplyUpdates).toHaveBeenCalledWith(info, {
      silent: false,
      restart: true,
    })
  })

  it('throws if any API is called before initVelopack', async () => {
    // re-import to reset module state — needs vitest's resetModules between
    // tests, but we keep the simpler path: a fresh dynamic import.
    vi.resetModules()
    const { checkForUpdates: fresh } = await import('./velopack')
    await expect(fresh()).rejects.toThrow(/initVelopack/)
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
pnpm exec vitest run --project node src/main/velopack.test.ts
```

Expected: FAIL with module-not-found for `./velopack`.

- [ ] **Step 4.3: Write the implementation**

Create `src/main/velopack.ts`:

```ts
// thin wrapper around velopack's UpdateManager. exists so:
//   1. only one file imports `velopack` at runtime (boundary clarity)
//   2. the github releases URL has a single source of truth
//   3. the wrapper can be vi.mock()'d cleanly in tests
import { UpdateManager, type UpdateInfo } from 'velopack'

export const GITHUB_REPO_URL = 'https://github.com/TwoD97/LokLM'

let manager: UpdateManager | null = null

export function initVelopack(): void {
  manager = new UpdateManager(GITHUB_REPO_URL)
}

function requireManager(): UpdateManager {
  if (!manager) {
    throw new Error('velopack , call initVelopack() before using update API')
  }
  return manager
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  return requireManager().checkForUpdatesAsync()
}

export async function downloadUpdates(info: UpdateInfo): Promise<void> {
  await requireManager().downloadUpdatesAsync(info)
}

export async function applyUpdatesAndRestart(info: UpdateInfo): Promise<void> {
  requireManager().waitExitThenApplyUpdates(info, { silent: false, restart: true })
}

export type { UpdateInfo }
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
pnpm exec vitest run --project node src/main/velopack.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/main/velopack.ts src/main/velopack.test.ts
git commit -m "main , velopack , thin UpdateManager wrapper with init+check+download+apply"
```

---

## Task 5: Wire VelopackApp lifecycle, IPC handlers, and vcredist marker dialog in `src/main/index.ts`

This is the integration step. `VelopackApp.build().run()` must be the **very first** thing the main process does — before `electron`'s `app` module imports execute side effects. The marker-file dialog (set by Task 3's hook on failure) is shown before `BrowserWindow` creation so a clean Win11 user gets a clear "install VC++" message instead of a `msvcp140.dll not found` crash.

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 5.1: Add the VelopackApp boot call at the top of the file**

Edit `src/main/index.ts`. The current first line is `import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'`. Insert ABOVE it:

```ts
// MUST be the first executed code in the main process. velopack invokes the
// installed app with --veloapp-install / --veloapp-updated / --veloapp-uninstall
// flags during its lifecycle , and the onAfterInstallFastCallback runs for the
// --veloapp-install case BEFORE any electron window or app.whenReady() lifecycle
// touches the user's machine. doing this any later means the redist install would
// race against argon2 / node-llama-cpp loading their native modules.
import { VelopackApp } from 'velopack'
import { installVcRedistIfMissing } from './velopack-hooks'

VelopackApp.build()
  .onAfterInstallFastCallback(() => {
    if (process.platform === 'win32') {
      // synchronous on purpose. process.resourcesPath and a userData path are
      // both available at this point — userData via electron's default
      // resolution (app module loaded via velopack's stub for this code path).
      installVcRedistIfMissing({
        resourcesPath: process.resourcesPath,
        userDataPath: defaultUserDataPath(),
      })
    }
  })
  .run()

// derives the per-user appData/Roaming path WITHOUT pulling electron's app
// module (which is too heavy to load inside the velopack lifecycle hook).
function defaultUserDataPath(): string {
  const appName = 'LokLM'
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? '', appName)
  }
  if (process.platform === 'darwin') {
    return join(process.env.HOME ?? '', 'Library', 'Application Support', appName)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config'), appName)
}

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
```

NOTE: the second `import { join }` line below (the existing one) becomes a duplicate. Delete the existing `import { dirname, join } from 'node:path'` if needed, or merge — keep one. After this edit, the file should have exactly one `import` of `join` from `'node:path'`. The cleanest layout: put `import { join } from 'node:path'` ABOVE the `VelopackApp.build()` call so `defaultUserDataPath` can use it, then keep `import { dirname, join } from 'node:path'` deleted and replace it with `import { dirname } from 'node:path'` further down.

Final ordering at the top of the file:

```ts
import { join } from 'node:path'
import { VelopackApp } from 'velopack'
import { installVcRedistIfMissing } from './velopack-hooks'

VelopackApp.build()
  .onAfterInstallFastCallback(() => {
    if (process.platform === 'win32') {
      installVcRedistIfMissing({
        resourcesPath: process.resourcesPath,
        userDataPath: defaultUserDataPath(),
      })
    }
  })
  .run()

function defaultUserDataPath(): string {
  const appName = 'LokLM'
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? '', appName)
  }
  if (process.platform === 'darwin') {
    return join(process.env.HOME ?? '', 'Library', 'Application Support', appName)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config'), appName)
}

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
// ... (rest of existing imports)
```

- [ ] **Step 5.2: Add vcredist marker check before BrowserWindow creation**

First, update the velopack-hooks import at the top of `src/main/index.ts` to also pull in `VCREDIST_MARKER_NAME`:

```ts
import { installVcRedistIfMissing, VCREDIST_MARKER_NAME } from './velopack-hooks'
```

Then find where the first `BrowserWindow` is created in `src/main/index.ts` (typically inside an `app.whenReady().then(...)` block or a `createWindow()` function called from it). BEFORE the `new BrowserWindow(...)` call, insert:

```ts
// if the velopack post-install vcredist installer failed (marker written by
// installVcRedistIfMissing), surface a one-shot dialog and quit. retrying is
// pointless — the user needs to install the runtime manually.
const vcredistMarker = join(app.getPath('userData'), VCREDIST_MARKER_NAME)
if (existsSync(vcredistMarker)) {
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'Missing Visual C++ Runtime',
    message: 'LokLM needs the Microsoft Visual C++ 2015–2022 x64 runtime.',
    detail:
      'The bundled installer could not run automatically. Click "Download" to open ' +
      'Microsoft\'s download page in your browser. After installing, restart LokLM.',
    buttons: ['Download', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  })
  // marker is single-shot — delete it either way so the dialog doesn't loop on
  // every launch if the user took the "Quit" path and later installed the
  // runtime by other means.
  rmSync(vcredistMarker, { force: true })
  if (choice === 0) {
    void shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe')
  }
  app.quit()
  return
}
```

Add `existsSync` and `rmSync` to the `import { ... } from 'node:fs'` line in the file (or add the import if not present). If the file doesn't already import from `'node:fs'`, add at the top of the imports block:

```ts
import { existsSync, rmSync } from 'node:fs'
```

- [ ] **Step 5.3: Add velopack init + IPC handlers**

Find the block where other `ipcMain.handle(...)` calls live (e.g., near `ipcMain.handle('settings:get', ...)`). Add the velopack init call and three handlers. The init must happen once at startup — placing it alongside other service inits inside `app.whenReady().then(...)` is fine.

Add to the imports block:

```ts
import * as velopack from './velopack'
```

Inside the startup function (the one that sets up auth/settings/etc.), add:

```ts
velopack.initVelopack()
```

Alongside the other `ipcMain.handle` calls, add:

```ts
ipcMain.handle('velopack:check', async () => {
  return velopack.checkForUpdates()
})

ipcMain.handle('velopack:download', async (_event, info) => {
  await velopack.downloadUpdates(info)
})

ipcMain.handle('velopack:apply', async (_event, info) => {
  await velopack.applyUpdatesAndRestart(info)
  // velopack tells its updater to wait for us to exit. quit explicitly so
  // electron doesn't sit around waiting for renderer windows to close.
  app.quit()
})
```

- [ ] **Step 5.4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. If a "duplicate import" or "join is not defined" error appears, fix the import layout per Step 5.1 and re-run.

- [ ] **Step 5.5: Smoke-test the app still launches in dev**

```bash
pnpm dev
```

Expected: app window opens normally. Velopack's `.run()` is a no-op in non-installed contexts (it only does work when launched with one of its `--veloapp-*` flags). Close the window after confirming.

- [ ] **Step 5.6: Commit**

```bash
git add src/main/index.ts
git commit -m "main , wire VelopackApp lifecycle + vcredist marker dialog + velopack IPC handlers"
```

---

## Task 6: Expose `velopack` namespace through preload `api`

The renderer is sandboxed (contextIsolation). All main↔renderer calls go through the preload's `contextBridge`. We extend the existing `api` object with a `velopack` namespace so the renderer can call `window.api.velopack.checkForUpdates()` etc.

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 6.1: Add the `velopack` namespace inside the existing `api` object**

In `src/preload/index.ts`, find the existing `api` object (it has `auth`, `settings`, `ollama`, `providers`, etc. as namespaces). Add a new sibling namespace `velopack`. The exact `UpdateInfo` shape is opaque to the renderer — we type it as `unknown` and pass it back to main as-is on `download` / `apply`:

```ts
const api = {
  // ... existing auth, settings, ollama, providers namespaces ...
  velopack: {
    checkForUpdates: (): Promise<unknown | null> => ipcRenderer.invoke('velopack:check'),
    downloadUpdates: (info: unknown): Promise<void> =>
      ipcRenderer.invoke('velopack:download', info),
    applyUpdates: (info: unknown): Promise<void> => ipcRenderer.invoke('velopack:apply', info),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

The `Api` type is already `typeof api`, so `window.api.velopack` is automatically typed in the renderer without changes to `index.d.ts`.

- [ ] **Step 6.2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6.3: Smoke-test in dev**

```bash
pnpm dev
```

Open DevTools in the running app, switch to the Console, and run:

```js
window.api.velopack
```

Expected: an object with `checkForUpdates`, `downloadUpdates`, `applyUpdates` function properties.

- [ ] **Step 6.4: Commit**

```bash
git add src/preload/index.ts
git commit -m "preload , expose velopack namespace via contextBridge"
```

---

## Task 7: `UpdatesSection.tsx` — renderer UI (TDD)

A single "Check for updates" button mounted in the Advanced tab. Uses the existing `settings-group__*` and `settings-btn--*` CSS classes for visual parity with sibling sections.

**Files:**
- Create: `src/renderer/src/settings/sections/UpdatesSection.tsx`
- Create: `src/renderer/src/settings/sections/UpdatesSection.test.tsx`
- Modify: `src/renderer/src/settings/AdvancedTab.tsx`

- [ ] **Step 7.1: Write the failing test file**

Create `src/renderer/src/settings/sections/UpdatesSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UpdatesSection } from './UpdatesSection'

const mockCheck = vi.fn()
const mockDownload = vi.fn()
const mockApply = vi.fn()

beforeEach(() => {
  mockCheck.mockReset()
  mockDownload.mockReset()
  mockApply.mockReset()
  // jsdom global — assign window.api so the component can call it
  ;(window as unknown as { api: unknown }).api = {
    velopack: {
      checkForUpdates: mockCheck,
      downloadUpdates: mockDownload,
      applyUpdates: mockApply,
    },
  }
  // window.confirm is needed for the "update available" prompt
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('UpdatesSection', () => {
  it('renders a check-for-updates button when idle', () => {
    render(<UpdatesSection />)
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled()
  })

  it('shows "up to date" status when no update is available', async () => {
    mockCheck.mockResolvedValue(null)
    render(<UpdatesSection />)

    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeInTheDocument()
    })
  })

  it('runs download + apply when an update is found and the user confirms', async () => {
    const info = { TargetFullRelease: { Version: '0.3.1', Size: 1234567 } }
    mockCheck.mockResolvedValue(info)
    mockDownload.mockResolvedValue(undefined)
    mockApply.mockResolvedValue(undefined)

    render(<UpdatesSection />)
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith(info)
      expect(mockApply).toHaveBeenCalledWith(info)
    })
  })

  it('does not call apply when the user declines the confirm prompt', async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    const info = { TargetFullRelease: { Version: '0.3.1', Size: 1234567 } }
    mockCheck.mockResolvedValue(info)

    render(<UpdatesSection />)
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalled()
    })
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('surfaces an error message when checkForUpdates rejects', async () => {
    mockCheck.mockRejectedValue(new Error('network unreachable'))
    render(<UpdatesSection />)

    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => {
      expect(screen.getByText(/network unreachable/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled()
  })
})
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
pnpm exec vitest run --project web src/renderer/src/settings/sections/UpdatesSection.test.tsx
```

Expected: FAIL with module-not-found for `./UpdatesSection`.

- [ ] **Step 7.3: Write the component**

Create `src/renderer/src/settings/sections/UpdatesSection.tsx`:

```tsx
import { useState } from 'react'

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string }
  | { kind: 'error'; message: string }

interface UpdateInfoShape {
  TargetFullRelease?: { Version?: string; Size?: number }
}

function describeSize(bytes: number | undefined): string {
  if (!bytes || bytes < 1024) return ''
  const mb = bytes / (1024 * 1024)
  return ` (~${mb.toFixed(0)} MB)`
}

export function UpdatesSection(): JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function handleCheck(): Promise<void> {
    setStatus({ kind: 'checking' })
    try {
      const info = (await window.api.velopack.checkForUpdates()) as UpdateInfoShape | null
      if (!info) {
        setStatus({ kind: 'up-to-date' })
        return
      }
      const version = info.TargetFullRelease?.Version ?? 'unknown'
      const size = describeSize(info.TargetFullRelease?.Size)
      const ok = window.confirm(`Update to v${version}?${size}\n\nLokLM will restart after install.`)
      if (!ok) {
        setStatus({ kind: 'idle' })
        return
      }
      setStatus({ kind: 'downloading', version })
      await window.api.velopack.downloadUpdates(info)
      await window.api.velopack.applyUpdates(info)
      // applyUpdates triggers app quit + restart on the new version — UI state
      // past this point is moot, but keep "downloading" so the button stays
      // disabled while the process tears down.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ kind: 'error', message })
    }
  }

  const busy = status.kind === 'checking' || status.kind === 'downloading'

  return (
    <div className="settings-group">
      <div className="settings-group__header">
        <div className="settings-group__title">
          <div className="settings-group__title-row">Updates</div>
          <div className="settings-group__sub">
            LokLM checks for new versions on demand. No automatic background checks.
          </div>
        </div>
      </div>
      <div className="settings-group__body">
        <button className="settings-btn" disabled={busy} onClick={() => void handleCheck()}>
          {status.kind === 'checking'
            ? 'Checking…'
            : status.kind === 'downloading'
              ? `Downloading v${status.version}…`
              : 'Check for updates'}
        </button>
        {status.kind === 'up-to-date' && (
          <span className="settings-saved-flash settings-saved-flash--on">
            ✓ Up to date
          </span>
        )}
        {status.kind === 'error' && (
          <span className="settings-group__sub" role="alert">
            {status.message}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7.4: Run tests to verify they pass**

```bash
pnpm exec vitest run --project web src/renderer/src/settings/sections/UpdatesSection.test.tsx
```

Expected: all 5 tests pass.

- [ ] **Step 7.5: Mount the section in AdvancedTab**

Edit `src/renderer/src/settings/AdvancedTab.tsx`. Add the import (alphabetically placed with sibling section imports):

```tsx
import { UpdatesSection } from './sections/UpdatesSection'
```

Add the JSX element after `<DiagnosticsSection />` and before the `<div className="settings-reset-row">`:

```tsx
<DiagnosticsSection />
<UpdatesSection />

<div className="settings-reset-row">
```

- [ ] **Step 7.6: Typecheck + dev smoke-test**

```bash
pnpm typecheck
pnpm dev
```

Open the running app → Settings → Advanced tab. Confirm an "Updates" section appears with a "Check for updates" button. Clicking it will hit the IPC handler — in dev (uninstalled context) the Velopack call will fail with something like "package source not configured" or "no .nupkg found" — that's the expected error state for dev. The test of actual update behavior is the manual VM check in Task 11.

- [ ] **Step 7.7: Commit**

```bash
git add src/renderer/src/settings/sections/UpdatesSection.tsx src/renderer/src/settings/sections/UpdatesSection.test.tsx src/renderer/src/settings/AdvancedTab.tsx
git commit -m "ui , settings , updates section with check-for-updates button"
```

---

## Task 8: Replace `package:*` scripts with the full `vpk pack` pipeline

Tasks 1 and 2 left these scripts producing `release/<os>-unpacked/` only. Now we tack on `vpk pack` to emit the actual installers + update feeds.

**Files:**
- Modify: `package.json`

- [ ] **Step 8.1: Verify `vpk` is installed locally**

Velopack is shipped as a dotnet tool. On the dev machine:

```bash
dotnet tool install -g vpk
vpk --version
```

Expected: a version number prints. If `dotnet` itself is missing, install [.NET 8 SDK](https://dotnet.microsoft.com/download) first (this is needed on dev + CI build machines only, never on user machines).

- [ ] **Step 8.2: Rewrite the three package scripts**

In `package.json` `"scripts"`:

```jsonc
"package:win":   "node scripts/fetch-vcredist.mjs && electron-vite build && electron-builder --win --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/win-unpacked -e LokLM.exe --packTitle LokLM --icon resources/icon.ico",
"package:mac":   "electron-vite build && electron-builder --mac --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/mac-unpacked -e LokLM.app --packTitle LokLM --icon resources/icon.icns",
"package:linux": "electron-vite build && electron-builder --linux --dir && vpk pack -u com.loklm.desktop -v $npm_package_version -p release/linux-unpacked -e loklm --packTitle LokLM --icon resources/icon.png"
```

NOTE: `$npm_package_version` is npm-style — pnpm exposes the same env var. The icon paths assume `resources/icon.{ico,icns,png}` exist (they do — `resources/` is `buildResources` in electron-builder's config). If any icon file is actually missing, you can drop the `--icon ...` segment from that platform's script for the MVP — Velopack will fall back to a default icon.

- [ ] **Step 8.3: Local smoke test on the current platform**

Run only the script for the host OS. On Windows:

```bash
pnpm run package:win
```

(On mac, run `package:mac`; on linux, run `package:linux`.)

Expected: the command completes with the artifact directory:

```
Releases/
├── LokLM-Setup-<version>.exe       # (or .pkg on mac, .AppImage on linux)
├── LokLM-<version>-full.nupkg
└── releases.win.json               # (or .osx.json, .linux.json)
```

If `vpk` complains that `-e LokLM.exe` doesn't match any file in `release/win-unpacked/`, check the actual executable name electron-builder produced (it should match `build.productName` in package.json — "LokLM"). On Windows the binary is `LokLM.exe`; on mac the bundle is `LokLM.app`; on linux it's typically `loklm` (lowercase). Adjust the `-e` argument to match exactly.

- [ ] **Step 8.4: Commit**

```bash
git add package.json
git commit -m "release , package:* scripts emit velopack artifacts via vpk pack"
```

---

## Task 9: New GitHub Actions release workflow

Matrix builds on all three OSes in parallel, fan-in to a single publish job that uploads to a GitHub Release with all three channel feeds attached.

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 9.1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: release

# matrix-builds velopack installers + update packages for win/mac/linux on a
# v*.*.* tag push , then a single publish job uploads them all to one github
# release. replaces the deleted release-installer.yml (bunny + minio + hetzner).
# - no signing yet , installers ship "unknown publisher" / "unidentified developer"
# - the README's "Installing LokLM" section documents the smartscreen / gatekeeper
#   right-click-open workaround
on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write # needed to create the github release

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest, channel: win, script: package:win }
          - { os: macos-latest, channel: osx, script: package:mac }
          - { os: ubuntu-latest, channel: linux, script: package:linux }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Install vpk
        run: dotnet tool install -g vpk

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Package (${{ matrix.channel }})
        run: pnpm run ${{ matrix.script }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: loklm-${{ matrix.channel }}
          path: Releases/

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Install vpk
        run: dotnet tool install -g vpk

      - name: Download all matrix artifacts
        uses: actions/download-artifact@v4
        with:
          path: Releases-all

      - name: Upload to GitHub Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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

- [ ] **Step 9.2: Lint the workflow YAML**

```bash
pnpm exec prettier --check .github/workflows/release.yml
```

Expected: prettier passes. If it complains, run `pnpm exec prettier --write .github/workflows/release.yml` and re-check.

- [ ] **Step 9.3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci , release.yml , velopack matrix build + single github-release publish"
```

---

## Task 10: README — "Installing LokLM" first-launch workarounds

Unsigned MVP means users hit a SmartScreen / Gatekeeper warning on first launch. Document the click-paths.

**Files:**
- Modify: `README.md`

- [ ] **Step 10.1: Add the installation section**

Find a sensible spot in `README.md` (typically near the top, after the project description and before "Development"). Insert:

````markdown
## Installing LokLM

LokLM is currently **unsigned** while we work toward code-signing infrastructure. Each OS shows a one-time warning on first launch; here's how to get past it.

### Windows

1. Download `LokLM-Setup-<version>.exe` from the [latest GitHub Release](https://github.com/TwoD97/LokLM/releases/latest).
2. Double-click the installer. Windows will show **"Windows protected your PC"** — click **More info** → **Run anyway**.
3. The installer self-elevates if the Visual C++ 2015–2022 x64 runtime is missing (one UAC prompt). LokLM is installed per-user to `%LOCALAPPDATA%\LokLM`.

### macOS

1. Download `LokLM-<version>-osx.pkg` from the [latest GitHub Release](https://github.com/TwoD97/LokLM/releases/latest).
2. Right-click the `.pkg` and choose **Open** (double-click won't work the first time — Gatekeeper blocks unidentified developers).
3. macOS will show a warning; click **Open** to confirm.

### Linux

1. Download `LokLM-<version>-linux.AppImage` from the [latest GitHub Release](https://github.com/TwoD97/LokLM/releases/latest).
2. Mark it executable: `chmod +x LokLM-*.AppImage`
3. Run it: `./LokLM-*.AppImage`

### Updates

Once installed, open LokLM, go to **Settings → Advanced → Updates → Check for updates**. New versions install with one click and restart the app automatically.
````

- [ ] **Step 10.2: Format check**

```bash
pnpm exec prettier --check README.md
```

If prettier rewrites it, accept the changes:

```bash
pnpm exec prettier --write README.md
```

- [ ] **Step 10.3: Commit**

```bash
git add README.md
git commit -m "docs , readme , installing loklm section (windows/mac/linux first-launch + updates)"
```

---

## Task 11: Verification

Manual verification required before declaring the MVP shippable. The CI dry-run gates the workflow correctness; the per-OS install tests gate the runtime behavior.

**No files modified — this is a checklist.**

- [ ] **Step 11.1: CI dry-run with a throwaway tag**

```bash
git tag v0.0.0-test.1
git push origin v0.0.0-test.1
```

Watch the run at `https://github.com/TwoD97/LokLM/actions`. Expected:
1. Three matrix `build` jobs run in parallel and all succeed.
2. The `publish` job downloads all three artifacts and creates a GitHub Release tagged `v0.0.0-test.1` with all installers + `releases.win.json` / `releases.osx.json` / `releases.linux.json` attached.
3. Delete the release + tag afterward:

```bash
gh release delete v0.0.0-test.1 --yes
git push origin --delete v0.0.0-test.1
git tag -d v0.0.0-test.1
```

- [ ] **Step 11.2: Windows install on clean VM (no VC++)**

Install LokLM on a fresh Windows 11 VM that has never had Visual Studio or any C++ redist. Expected:
- UAC prompt during install (the VC++ redist self-elevates).
- After UAC, install completes silently.
- App launches without a `msvcp140.dll not found` system dialog.

- [ ] **Step 11.3: Windows update flow**

On the same VM, install v0.x.y (the released MVP). Then tag and release v0.x.(y+1). In the v0.x.y instance: **Settings → Advanced → Updates → Check for updates**. Expected:
- Confirm dialog appears showing the new version + size.
- Click "OK" → download progress shown → app exits and re-launches on the new version.

- [ ] **Step 11.4: Windows install on VM that already has VC++**

Install on a fresh Windows VM that has VC++ redist pre-installed (or has Visual Studio). Expected:
- **No UAC prompt** (the registry probe short-circuits).
- Install completes normally.

- [ ] **Step 11.5: macOS install**

On an Apple Silicon Mac that has never run LokLM: download `LokLM-<version>-osx.pkg` → right-click → Open. Expected:
- Gatekeeper warning appears.
- After clicking Open, install completes.
- App launches.

- [ ] **Step 11.6: macOS update flow**

Same as 11.3 but on mac.

- [ ] **Step 11.7: Linux install**

On Ubuntu 22.04 or similar: download `LokLM-<version>-linux.AppImage`, `chmod +x`, run it. Expected: app launches. Run the update flow.

- [ ] **Step 11.8: Mark spec complete**

Once all 7 manual checks pass, commit a note to that effect in the release tag's annotation or close the tracking issue.

---

## Out of scope (deferred to follow-up specs, recorded here for hand-off)

- Code signing (Windows EV cert via `vpk pack --signParams`, Apple Developer ID + notarization via `--signAppIdentity` / `--notaryProfile`).
- Background auto-check on app start + in-product notification.
- Website ([loklm.com](https://loklm.com)) download page rewiring — currently still pointing at the last Bunny CDN release.
- Migration of existing NSIS-installed users to the Velopack install location.
- Channels (stable/beta) via `vpk pack --channel beta`.
- `release-please` or `changesets` for version bumping.
