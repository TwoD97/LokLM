import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ignore, { type Ignore } from 'ignore'

// .gitignore layering for codebase ingestion (ADR-0006). Sits on top of the
// always-on default deny-list (./ignore). When a synced codebase folder uses
// .gitignore we honor it — build output, generated code, secrets, and binaries
// the project already declares ignored are never chunked or embedded. Pattern
// matching is delegated to the `ignore` package (full gitignore spec: negation
// `!`, anchoring, `**`, dir-only `foo/`, comments) — we do NOT hand-roll it.
//
// Nested support: each directory may carry its own .gitignore, scoped to that
// subtree, and git applies the LAST matching pattern across the shallow→deep
// chain (so a deeper rule, including a re-include `!`, overrides a shallower
// one). The walk loads each directory's .gitignore as it descends and evaluates
// against the accumulated stack (see isGitignored). The repo root additionally
// folds in .git/info/exclude, same as git.

export interface GitignoreFilter {
  /** True when the root-relative path should be excluded. Pass `isDir` for a
   *  directory so dir-only patterns (`foo/`) match — lets the walk prune subtrees. */
  ignores(relPath: string, isDir?: boolean): boolean
}

/** One directory's compiled .gitignore in the nested chain. `base` is the
 *  directory's path relative to the walk root (forward slashes, '' for the root). */
export interface GitignoreLayer {
  base: string
  ig: Ignore
}

function normalizeRel(relPath: string): string {
  // Forward slashes, strip a leading ./ or /, so paths are root-relative — the
  // `ignore` package throws on absolute paths and treats `./x` and `x` differently.
  return relPath.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

function withDirSlash(norm: string, isDir: boolean): string {
  return isDir && !norm.endsWith('/') ? `${norm}/` : norm
}

function filterFromIgnore(ig: Ignore): GitignoreFilter {
  return {
    ignores(relPath: string, isDir = false): boolean {
      const norm = normalizeRel(relPath)
      if (norm === '' || norm === '.') return false
      return ig.ignores(withDirSlash(norm, isDir))
    },
  }
}

/** Builds a matcher from raw gitignore pattern text. Pure — no filesystem. */
export function makeGitignoreFilter(patternText: string): GitignoreFilter {
  return filterFromIgnore(ignore().add(patternText))
}

/**
 * Reads one directory's `.gitignore` into an `Ignore`, or `null` when absent.
 * For the repo root (`isRoot`), also folds in `.git/info/exclude` (git does too).
 */
export async function loadDirIgnore(absDir: string, isRoot: boolean): Promise<Ignore | null> {
  let text: string | null = null
  try {
    text = await readFile(join(absDir, '.gitignore'), 'utf8')
  } catch {
    /* no .gitignore here */
  }
  if (isRoot) {
    try {
      const exclude = await readFile(join(absDir, '.git', 'info', 'exclude'), 'utf8')
      text = `${text ?? ''}\n${exclude}`
    } catch {
      /* .git/info/exclude is optional */
    }
  }
  return text == null ? null : ignore().add(text)
}

/**
 * git-precedence decision across a shallow→deep stack of directory .gitignores.
 * The last layer that matches `relPath` wins (an explicit re-include `!` in a
 * deeper layer overrides a shallower exclude). `layers` must be ordered
 * shallowest-first. `relPath` is relative to the walk root.
 */
export function isGitignored(
  layers: readonly GitignoreLayer[],
  relPath: string,
  isDir = false,
): boolean {
  const norm = normalizeRel(relPath)
  if (norm === '' || norm === '.') return false
  const p = withDirSlash(norm, isDir)
  let ignored = false
  for (const layer of layers) {
    // Only layers whose directory contains the path have an opinion. Paths are
    // tested relative to the layer's own directory (how its patterns are written).
    let sub: string
    if (layer.base === '') {
      sub = p
    } else if (p.startsWith(`${layer.base}/`)) {
      sub = p.slice(layer.base.length + 1)
    } else {
      continue
    }
    if (sub === '') continue
    const res = layer.ig.test(sub)
    if (res.ignored) ignored = true
    else if (res.unignored) ignored = false
  }
  return ignored
}

/**
 * Loads a folder's `.gitignore` (plus the repo-local `.git/info/exclude`) into a
 * single matcher. Returns `null` when the folder has no `.gitignore` — the caller
 * treats that as "ask the user which directories to index". (Nested .gitignores
 * are handled separately during the walk via loadDirIgnore + isGitignored.)
 */
export async function loadGitignore(root: string): Promise<GitignoreFilter | null> {
  const ig = await loadDirIgnore(root, true)
  // Distinguish "no .gitignore" (→ picker) from "root has only .git/info/exclude":
  // the picker trigger keys off the .gitignore file specifically.
  let hasGitignoreFile = true
  try {
    await readFile(join(root, '.gitignore'), 'utf8')
  } catch {
    hasGitignoreFile = false
  }
  if (!hasGitignoreFile || ig == null) return null
  return filterFromIgnore(ig)
}
