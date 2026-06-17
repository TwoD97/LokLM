// Electron stub for the `integration` + `tx` vitest projects.
//
// Why this exists: CI runs these suites in a plain Node context with NO Electron
// binary installed. A few main-process modules statically `import { … } from
// 'electron'` (e.g. EmbeddingBackfillService imports BrowserWindow). The real
// `electron` entry resolves its binary path via getElectronPath(), which reads a
// `path.txt` that does not exist on CI → "ENOENT … electron/path.txt", and the
// affected test file fails to even collect (0 tests, suite FAIL).
//
// Under vitest these modules never need the real Electron runtime — they already
// guard their usage (e.g. `typeof BrowserWindow?.getAllWindows === 'function'`).
// Aliasing `electron` to this stub keeps every binding `undefined`, which is
// exactly how `electron` already behaves when required into a non-Electron Node
// process — only without the binary-path lookup that breaks CI.
//
// Bindings cover every runtime (non-type) name imported from 'electron' across
// src/main, so the alias never produces a "named export not found" build error.
export const app = undefined
export const BrowserWindow = undefined
export const ipcMain = undefined
export const dialog = undefined
export const shell = undefined
export const utilityProcess = undefined

export default undefined
