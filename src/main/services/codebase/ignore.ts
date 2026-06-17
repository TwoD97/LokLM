// Indexing ignore rules + code/doc track routing for codebase workspaces
// (ADR-0006). A deterministic default deny-list (the single highest-leverage
// thing for index quality + speed, per the Cursor research) plus a router that
// sorts each indexable file onto the CODE track (AST-aware chunks) or the
// DOC/INFO track (prose chunks) — the "index code and infos separately" goal.
//
// Deliberately dependency-free and pure so it is fully unit-testable. Full
// .gitignore / .lokignore layering is applied by the indexer on top of this
// baseline (a later commit); these are the always-on defaults.

/** Directory names that are never indexed, matched on any path segment. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  '.pnpm-store',
  'vendor',
  'dist',
  'build',
  'out',
  'output',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  'venv',
  '.venv',
  'env',
  'target', // rust / jvm
  '.gradle',
  'bin',
  'obj', // dotnet
  '.idea',
  '.vscode',
  '.vs',
  '.dart_tool',
  'Pods',
  'DerivedData',
])

/** File extensions (no dot) that are never indexed — binaries, media, archives. */
export const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  // binaries / objects
  'bin',
  'exe',
  'dll',
  'so',
  'dylib',
  'o',
  'a',
  'lib',
  'obj',
  'class',
  'pyc',
  'pyo',
  'wasm',
  // archives
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'jar',
  'war',
  // images / media
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'webp',
  'tiff',
  'svg',
  'psd',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  // fonts
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  // docs that aren't prose/code
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  // data blobs / models
  'sqlite',
  'db',
  'gguf',
  'onnx',
  'bin',
  'npy',
  'parquet',
  // maps / minified markers handled separately below
  'map',
])

/** Exact filenames (lowercased) that are never indexed — lockfiles, secrets. */
export const IGNORED_FILENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'cargo.lock',
  'go.sum',
  '.ds_store',
  'thumbs.db',
])

/** Default cap: files larger than this are skipped (generated/minified blobs). */
export const DEFAULT_MAX_INDEX_FILE_BYTES = 1_000_000

/** Prose/doc extensions → the DOC track (embedded with the general model). */
const DOC_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'mdx',
  'markdown',
  'rst',
  'adoc',
  'asciidoc',
  'txt',
  'text',
  'org',
])

/** Source-code extensions → the CODE track (AST-aware chunking). Superset of the
 *  classifier's language map plus markup/templating that benefits from code
 *  handling. */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'pyi',
  'rs',
  'go',
  'java',
  'kt',
  'kts',
  'scala',
  'rb',
  'php',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hh',
  'cs',
  'fs',
  'swift',
  'm',
  'mm',
  'dart',
  'ex',
  'exs',
  'erl',
  'clj',
  'hs',
  'ml',
  'lua',
  'r',
  'jl',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'vue',
  'svelte',
  // structured config worth searching as code
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'proto',
  'graphql',
  'gql',
])

export type IndexTrack = 'code' | 'doc' | 'skip'

function normalize(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.?\//, '')
}

function basename(relPath: string): string {
  const norm = normalize(relPath)
  const slash = norm.lastIndexOf('/')
  return slash === -1 ? norm : norm.slice(slash + 1)
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** True when any path segment is an ignored directory. */
export function isInIgnoredDir(relPath: string): boolean {
  const segs = normalize(relPath).split('/')
  // last segment is the filename; check directory segments only
  for (let i = 0; i < segs.length - 1; i++) {
    if (IGNORED_DIRS.has(segs[i]!)) return true
  }
  return false
}

/** True when the path is excluded by the always-on default deny-list (ignored
 *  dir, ignored extension, ignored exact filename, or minified asset). */
export function isPathIgnored(relPath: string): boolean {
  if (isInIgnoredDir(relPath)) return true
  const name = basename(relPath).toLowerCase()
  if (IGNORED_FILENAMES.has(name)) return true
  if (name.startsWith('.env')) return true // .env, .env.local, …
  if (name.endsWith('.min.js') || name.endsWith('.min.css')) return true
  if (name.endsWith('.lock')) return true
  const ext = extOf(name)
  if (ext && IGNORED_EXTENSIONS.has(ext)) return true
  return false
}

/** Routes a file to its indexing track. 'skip' for ignored/oversized/unknown
 *  files; 'code' for source; 'doc' for prose. `sizeBytes` omitted ⇒ size check
 *  skipped (caller will stat lazily). */
export function fileTrack(
  relPath: string,
  sizeBytes?: number,
  maxBytes: number = DEFAULT_MAX_INDEX_FILE_BYTES,
): IndexTrack {
  if (isPathIgnored(relPath)) return 'skip'
  if (sizeBytes != null && sizeBytes > maxBytes) return 'skip'
  const ext = extOf(basename(relPath))
  if (DOC_EXTENSIONS.has(ext)) return 'doc'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  return 'skip'
}

/** When a codebase folder has no .gitignore, the user picks which TOP-LEVEL
 *  directories to index (ADR-0006). A file directly at the folder root is always
 *  included; a file inside a subdirectory is included only when its first path
 *  segment is in `includeDirs`. An empty set means "no restriction" — index all
 *  (the gitignore/default layers still apply on top). */
export function isDirIncluded(relPath: string, includeDirs: ReadonlySet<string>): boolean {
  if (includeDirs.size === 0) return true
  const norm = normalize(relPath)
  const slash = norm.indexOf('/')
  if (slash === -1) return true // root-level file
  return includeDirs.has(norm.slice(0, slash))
}

/** Convenience predicate: should this file be indexed at all (either track)? */
export function shouldIndexFile(
  relPath: string,
  sizeBytes?: number,
  maxBytes: number = DEFAULT_MAX_INDEX_FILE_BYTES,
): boolean {
  return fileTrack(relPath, sizeBytes, maxBytes) !== 'skip'
}
