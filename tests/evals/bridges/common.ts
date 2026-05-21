// Shared helpers for the three eval bridges (Embedder, Llm, Reranker). The
// per-bridge resolveXPath() functions used to duplicate the same
//   env-override → canonical file → readdir scan (filter + sort)
// pattern with just the file glob differing. That's the entire surface we
// share here. Bridge subclasses still own the role-specific stuff (loadModel
// arg shape, context type, scoring API).

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_MODELS_DIR = join(process.cwd(), 'models')

/** Three-way GPU placement: cpu = explicitly disable, gpu = explicitly enable,
 *  auto = let node-llama-cpp pick the best available backend. The eval keeps
 *  this knob external so a sweep can compare placements without rebuilding. */
export type Placement = 'cpu' | 'gpu' | 'auto'

/** Map our high-level placement onto the value node-llama-cpp's getLlama
 *  expects: `false` to force CPU, `'auto'` for both gpu and auto (the lib
 *  itself does the actual backend selection inside `'auto'`). */
export function placementToGpu(p: Placement): false | 'auto' {
  return p === 'cpu' ? false : 'auto'
}

export interface ResolveModelPathOpts {
  /** env-var name that, if set and pointing at an existing file, wins. */
  envVar: string
  /** preferred file inside REPO_MODELS_DIR. If present, returned as-is. */
  canonicalFilename: string
  /** regex any .gguf in the dir must match to be considered a candidate. */
  include: RegExp
  /** regexes that disqualify a candidate (e.g. an LLM file matching `embed`
   *  in its name is still an LLM, not an embedder). Matched against the
   *  filename only, not the full path. */
  exclude?: RegExp[]
}

/** Three-step model resolver shared by all three bridges:
 *    1. env override (LOKLM_EMBEDDER_PATH / LOKLM_LLM_PATH / LOKLM_RERANKER_PATH)
 *       — wins unconditionally when the path exists, lets a CLI sweep across
 *       different files without touching code.
 *    2. canonical filename in models/ (e.g. bge-m3-Q4_K_M.gguf). Most users
 *       have exactly this one and the readdir scan never runs.
 *    3. scan models/ for any *.gguf matching `include` and not matching
 *       `exclude`, sorted alphabetically. The sort gives stable picks across
 *       filesystems (NTFS returns ordered; POSIX doesn't). */
export function resolveModelPath(opts: ResolveModelPathOpts): string | null {
  const env = process.env[opts.envVar]
  if (env && existsSync(env)) return env
  const canonical = join(REPO_MODELS_DIR, opts.canonicalFilename)
  if (existsSync(canonical)) return canonical
  if (!existsSync(REPO_MODELS_DIR)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(REPO_MODELS_DIR)
  } catch {
    return null
  }
  const exclude = opts.exclude ?? []
  const candidates = entries
    .filter((f) => f.toLowerCase().endsWith('.gguf'))
    .filter((f) => opts.include.test(f))
    .filter((f) => !exclude.some((re) => re.test(f)))
    .sort()
  if (candidates.length === 0) return null
  return join(REPO_MODELS_DIR, candidates[0]!)
}

/** Type-guard for the node-llama-cpp handle types that expose `dispose()`. */
export function hasDispose(o: unknown): o is { dispose: () => Promise<void> | void } {
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof (o as { dispose?: unknown }).dispose === 'function'
  )
}

/** Best-effort dispose of a node-llama-cpp handle. Swallows all errors —
 *  the bridges all run dispose during unload, where any throw would just
 *  bubble up and prevent the next bridge from disposing. */
export async function safeDispose(o: unknown): Promise<void> {
  if (!hasDispose(o)) return
  try {
    await o.dispose()
  } catch {
    /* best-effort */
  }
}
