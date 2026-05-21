/**
 * Centralised model file path resolution for the LLM, embedder, and reranker
 * services. Historically each service had its own copy of this function; they
 * are now thin wrappers around the helpers here so a single change to the
 * search-path policy (e.g. switching prod from bundled `resourcesPath/models`
 * to downloaded `userData/models`) doesn't drift across three files.
 *
 * Policy
 * ------
 *  - **Dev** (`!app.isPackaged`): only look at `<repo>/models/`. The
 *    `scripts/download-models.mjs` script lands here so the dev workflow is
 *    unchanged.
 *  - **Packaged**: prefer the writable `userData/models/` (where the
 *    first-launch downloader writes), then fall back to the read-only
 *    `resourcesPath/models/` for anyone still shipping a bundle. The fallback
 *    is harmless after v0.2.2 (the installer ships no GGUFs) but keeps the option
 *    open and helps installs that side-load models into the install dir.
 *  - **Tests**: when the electron `app` import is undefined (vitest), behave
 *    like dev and use `<cwd>/models/`. Integration tests put fixture GGUFs
 *    there.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Lazy-load electron's `app` via CJS require — the ESM named-import
 *   `import { app } from 'electron'`
 * crashes at module-load when run outside the electron runtime (e.g. raw
 * `tsx tests/evals/sweep.ts`, vitest in some configurations, or any plain
 * node script importing this file transitively). CJS require on the same
 * package returns the executable-path string instead of throwing — so we
 * can detect the non-electron context and fall back to dev behavior.
 *
 * Cached after first call; the electron `app` object is a process-wide
 * singleton anyway so caching is safe.
 */
type ElectronApp = {
  isPackaged: boolean
  getPath: (name: string) => string
}

let cachedApp: ElectronApp | null | undefined = undefined
function getAppOrNull(): ElectronApp | null {
  if (cachedApp !== undefined) return cachedApp
  try {
    const localRequire = createRequire(import.meta.url)
    const mod = localRequire('electron') as { app?: ElectronApp }
    cachedApp = mod && typeof mod === 'object' && mod.app ? mod.app : null
  } catch {
    cachedApp = null
  }
  return cachedApp
}

/** Where the first-launch downloader writes. Always writable; safe to mkdir. */
export function getDownloadTargetDir(): string {
  const app = getAppOrNull()
  if (!app || typeof app.isPackaged !== 'boolean') {
    // Vitest / scripts without an electron app — match the dev behavior so
    // tooling that imports this module from a node context still works.
    return join(process.cwd(), 'models')
  }
  if (!app.isPackaged) return join(process.cwd(), 'models')
  return join(app.getPath('userData'), 'models')
}

/**
 * Ordered list of directories to look in when resolving a model file. First
 * hit wins. Callers should iterate this — do NOT cache the result; the
 * userData directory may not exist yet on first launch.
 */
export function getModelSearchDirs(): string[] {
  const app = getAppOrNull()
  if (!app || typeof app.isPackaged !== 'boolean') {
    return [join(process.cwd(), 'models')]
  }
  if (!app.isPackaged) return [join(process.cwd(), 'models')]
  return [join(app.getPath('userData'), 'models'), join(process.resourcesPath, 'models')]
}

/** Backward-compat: returns the *primary* search directory. New code should
 *  use `getModelSearchDirs()` so a model present in the legacy bundled
 *  location is still found post-upgrade. */
export function getModelsDir(): string {
  return getModelSearchDirs()[0]!
}

/**
 * Find a model file by exact basename across all search directories. Returns
 * the absolute path of the first match, or null if no directory contains it.
 */
export function resolveModelFile(basename: string): string | null {
  for (const dir of getModelSearchDirs()) {
    const candidate = join(dir, basename)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Find a model file by regex pattern (case-insensitive match against the
 * filename, not the full path). Used by services that auto-pick the first
 * GGUF matching a profile pattern — e.g. the embedder accepts any
 * `*embed*.gguf`. First directory wins; within a directory, first matching
 * file wins. Returns the absolute path or null.
 */
export function findModelByPattern(pattern: RegExp): string | null {
  for (const dir of getModelSearchDirs()) {
    let entries: string[] = []
    try {
      if (existsSync(dir)) entries = readdirSync(dir)
    } catch {
      continue
    }
    const ggufs = entries.filter((f) => f.toLowerCase().endsWith('.gguf'))
    const match = ggufs.find((f) => pattern.test(f))
    if (match) return join(dir, match)
  }
  return null
}

/**
 * List every `.gguf` filename visible across the search dirs, deduped (the
 * primary dir wins when a name collides). Used by LlamaService.discoverProfiles
 * to bind on-disk files to profiles by regex.
 */
export function listVisibleGgufs(): Array<{ name: string; absPath: string }> {
  const seen = new Map<string, string>()
  for (const dir of getModelSearchDirs()) {
    let entries: string[] = []
    try {
      if (existsSync(dir)) entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries) {
      if (!f.toLowerCase().endsWith('.gguf')) continue
      if (seen.has(f)) continue
      seen.set(f, join(dir, f))
    }
  }
  return Array.from(seen.entries()).map(([name, absPath]) => ({ name, absPath }))
}
