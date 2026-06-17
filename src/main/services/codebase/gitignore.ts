import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ignore from 'ignore'

// .gitignore layering for codebase ingestion (ADR-0006). Sits on top of the
// always-on default deny-list (./ignore). When a synced codebase folder has a
// .gitignore we honor it (plus the repo-local .git/info/exclude) so build output,
// generated code, secrets, and binaries the project already declares ignored are
// never chunked or embedded. The absence of a .gitignore (loadGitignore → null) is
// the signal that the renderer should let the user pick which directories to index.
//
// Pattern matching is delegated to the `ignore` package, which implements the full
// gitignore spec (negation `!`, anchoring, `**`, dir-only `foo/`, comments). We do
// NOT hand-roll a matcher. Nested per-directory .gitignore files are a noted
// follow-up; v1 honors the root .gitignore + .git/info/exclude.

export interface GitignoreFilter {
  /** True when the root-relative path should be excluded. Pass `isDir` for a
   *  directory so dir-only patterns (`foo/`) match — lets the walk prune subtrees. */
  ignores(relPath: string, isDir?: boolean): boolean
}

function normalizeRel(relPath: string): string {
  // Forward slashes, strip a leading ./ or /, so paths are root-relative — the
  // `ignore` package throws on absolute paths and treats `./x` and `x` differently.
  return relPath.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

/** Builds a matcher from raw gitignore pattern text. Pure — no filesystem. */
export function makeGitignoreFilter(patternText: string): GitignoreFilter {
  const ig = ignore().add(patternText)
  return {
    ignores(relPath: string, isDir = false): boolean {
      const norm = normalizeRel(relPath)
      if (norm === '' || norm === '.') return false
      const p = isDir && !norm.endsWith('/') ? `${norm}/` : norm
      return ig.ignores(p)
    },
  }
}

/**
 * Loads a folder's `.gitignore` (plus the repo-local `.git/info/exclude`, same as
 * git) into a matcher. Returns `null` when the folder has no `.gitignore` — the
 * caller treats that as "ask the user which directories to index".
 */
export async function loadGitignore(root: string): Promise<GitignoreFilter | null> {
  let gitignoreText: string
  try {
    gitignoreText = await readFile(join(root, '.gitignore'), 'utf8')
  } catch {
    return null // no .gitignore → directory picker
  }
  let combined = gitignoreText
  try {
    const exclude = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')
    combined = `${combined}\n${exclude}`
  } catch {
    /* .git/info/exclude is optional */
  }
  return makeGitignoreFilter(combined)
}
