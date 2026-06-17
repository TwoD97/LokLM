// Codebase classification (ADR-0006). Given the relative paths of a synced
// folder, decide whether it is a source-code project (→ workspace type
// 'codebase') and what its primary language / ecosystems are. Pure and
// deterministic so it is cheap to run on every folder sync and easy to unit-test.
//
// Strategy mirrors GitHub Linguist's pragmatics without its full classifier:
//   1. ecosystem MARKER FILES (package.json, Cargo.toml, go.mod, …) are the
//      strongest signal — their presence almost always means "this is a project".
//   2. otherwise fall back to the share of recognised CODE files in the tree.
// Vendored/generated dirs are excluded by the caller's ignore rules before this
// runs (see ./ignore), so the ratio reflects first-party code.

/** marker filename (lowercased) → ecosystem tag. */
const MARKER_FILES: Record<string, string> = {
  'package.json': 'node',
  'tsconfig.json': 'node',
  'deno.json': 'deno',
  'deno.jsonc': 'deno',
  'cargo.toml': 'rust',
  'go.mod': 'go',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'setup.py': 'python',
  pipfile: 'python',
  'pom.xml': 'jvm',
  'build.gradle': 'jvm',
  'build.gradle.kts': 'jvm',
  'build.sbt': 'scala',
  gemfile: 'ruby',
  'composer.json': 'php',
  'cmakelists.txt': 'cpp',
  makefile: 'c',
  'mix.exs': 'elixir',
  'pubspec.yaml': 'dart',
  'project.clj': 'clojure',
  'dune-project': 'ocaml',
}

/** marker by extension (lowercased, no dot) → ecosystem. */
const MARKER_EXTENSIONS: Record<string, string> = {
  csproj: 'dotnet',
  sln: 'dotnet',
  fsproj: 'dotnet',
  xcodeproj: 'apple',
}

/** code file extension (lowercased, no dot) → language label. */
const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  pyi: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  rb: 'Ruby',
  php: 'PHP',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  cs: 'C#',
  fs: 'F#',
  swift: 'Swift',
  m: 'Objective-C',
  mm: 'Objective-C++',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  clj: 'Clojure',
  hs: 'Haskell',
  ml: 'OCaml',
  lua: 'Lua',
  r: 'R',
  jl: 'Julia',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  vue: 'Vue',
  svelte: 'Svelte',
}

export interface LanguageCount {
  language: string
  files: number
}

export interface CodebaseClassification {
  /** True ⇒ the folder should be treated as a 'codebase' workspace. */
  isCodebase: boolean
  /** Most-common code language, or null when no code files were found. */
  primaryLanguage: string | null
  /** Per-language code-file counts, descending. */
  languages: LanguageCount[]
  /** Ecosystem tags from matched marker files (e.g. ['node','rust']). */
  ecosystems: string[]
  /** The marker filenames that matched (relative paths), for diagnostics/UI. */
  markers: string[]
  /** Fraction of non-ignored files that are recognised code (0..1). */
  codeFileRatio: number
}

// Heuristic thresholds. Marker files alone are decisive; absent those, require a
// meaningful body of code so a docs folder with one stray script isn't a codebase.
const MIN_CODE_FILES_NO_MARKER = 5
const MIN_CODE_RATIO_NO_MARKER = 0.5

function basename(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  return slash === -1 ? norm : norm.slice(slash + 1)
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Classifies a folder from the relative paths it contains. `relPaths` should
 * already be filtered by the ignore rules (no node_modules/.git/etc.) so the
 * ratio reflects first-party source.
 */
export function classifyCodebase(relPaths: string[]): CodebaseClassification {
  const ecosystems = new Set<string>()
  const markers: string[] = []
  const langCounts = new Map<string, number>()
  let codeFiles = 0

  for (const rel of relPaths) {
    const name = basename(rel).toLowerCase()
    const ext = extOf(name)

    const markerEco = MARKER_FILES[name] ?? (ext ? MARKER_EXTENSIONS[ext] : undefined)
    if (markerEco) {
      ecosystems.add(markerEco)
      markers.push(rel)
    }

    const lang = ext ? CODE_EXTENSIONS[ext] : undefined
    if (lang) {
      codeFiles += 1
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
    }
  }

  const totalFiles = relPaths.length
  const codeFileRatio = totalFiles === 0 ? 0 : codeFiles / totalFiles
  const languages = [...langCounts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language))

  const isCodebase =
    markers.length > 0 ||
    (codeFiles >= MIN_CODE_FILES_NO_MARKER && codeFileRatio >= MIN_CODE_RATIO_NO_MARKER)

  return {
    isCodebase,
    primaryLanguage: languages[0]?.language ?? null,
    languages,
    ecosystems: [...ecosystems].sort(),
    markers,
    codeFileRatio,
  }
}
