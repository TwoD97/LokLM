// Optional evaluation build wrapper. Normal pnpm build remains unchanged.
const { createHash } = require('node:crypto')
const { readFile, readdir, writeFile, rename } = require('node:fs/promises')
const { join, resolve, dirname } = require('node:path')
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')

const manifestRelativePath = 'out/build-provenance.json'
const inputRoots = ['src', 'patches', 'resources', 'public']
const outputRoots = ['out/main', 'out/preload', 'out/renderer']
const configName =
  /^(?:electron\.vite\.config\.[cm]?[jt]s|tsconfig.*\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs|\.env(?:\..+)?)$/u
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function walk(root, relative, paths, optional = false) {
  let entries
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true })
  } catch (error) {
    if (optional && error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`
    if (entry.isSymbolicLink())
      throw new Error(`Cannot establish provenance for symbolic link: ${path}`)
    if (entry.isDirectory()) await walk(root, path, paths)
    else if (entry.isFile()) paths.push(path)
  }
}

async function hashes(root, paths) {
  const result = {}
  // Bounded file descriptors; no source contents or environment values are stored.
  for (const path of [...new Set(paths)].sort())
    result[path] = sha(await readFile(join(root, path)))
  return result
}

async function collectBuildInputs(root = process.cwd()) {
  // The desktop repair catalog imports this installer manifest into its bundle.
  const paths = ['installer-wizard/model-manifest.json']
  for (const relative of inputRoots) await walk(root, relative, paths, relative !== 'src')
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isFile() && configName.test(entry.name)) paths.push(entry.name)
  return hashes(root, paths)
}

async function fingerprintOutputs(root = process.cwd()) {
  const paths = []
  for (const relative of outputRoots) {
    const before = paths.length
    await walk(root, relative, paths)
    if (paths.length === before) throw new Error(`Missing compiled files in ${relative}`)
  }
  return hashes(root, paths)
}

function changedPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .sort()
}

function hashMap(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash))
  )
}

async function verifyBuildProvenance(root = process.cwd()) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(root, manifestRelativePath), 'utf8'))
  } catch (error) {
    return {
      status: 'unknown',
      reason: error.code === 'ENOENT' ? 'manifest-missing' : 'manifest-unreadable',
    }
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'loklm-build-provenance' ||
    !hashMap(manifest.sourceHashes) ||
    !hashMap(manifest.compiledHashes)
  )
    return { status: 'unknown', reason: 'manifest-invalid' }
  let compiled
  try {
    compiled = await fingerprintOutputs(root)
  } catch {
    return { status: 'unknown', reason: 'compiled-output-unreadable' }
  }
  const changedCompiledPaths = changedPaths(manifest.compiledHashes, compiled)
  if (changedCompiledPaths.length)
    return { status: 'unknown', reason: 'compiled-output-mismatch', changedCompiledPaths }
  let currentInputs
  try {
    currentInputs = await collectBuildInputs(root)
  } catch {
    return { status: 'unknown', reason: 'current-inputs-unreadable' }
  }
  const changedCurrentSourcePaths = changedPaths(manifest.sourceHashes, currentInputs)
  return {
    status: 'matched',
    reason: 'compiled-output-matches-build-manifest',
    buildStartedAt: manifest.startedAt,
    buildCompletedAt: manifest.completedAt,
    sourceHashesAtBuild: manifest.sourceHashes,
    compiledHashesAtBuild: manifest.compiledHashes,
    toolchain: manifest.toolchain,
    currentSourcesMatchBuild: changedCurrentSourcePaths.length === 0,
    changedCurrentSourcePaths,
  }
}

async function runProvenanceBuild(root = process.cwd(), runBuild) {
  const startedAt = new Date().toISOString()
  const sourceHashes = await collectBuildInputs(root)
  const requireAtRoot = createRequire(join(root, 'package.json'))
  let toolchain = { node: process.version, electronVite: 'injected-test-build' }
  if (runBuild) await runBuild()
  else {
    const packagePath = requireAtRoot.resolve('electron-vite/package.json')
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
    toolchain = { node: process.version, electronVite: pkg.version }
    const cli = resolve(dirname(packagePath), pkg.bin['electron-vite'])
    await new Promise((resolveBuild, reject) => {
      const child = spawn(process.execPath, [cli, 'build'], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true,
        shell: false,
      })
      child.once('error', reject)
      child.once('exit', (code, signal) =>
        code === 0
          ? resolveBuild()
          : reject(new Error(`electron-vite build failed (${signal ?? code})`)),
      )
    })
  }
  const after = await collectBuildInputs(root)
  const changes = changedPaths(sourceHashes, after)
  if (changes.length)
    throw new Error(
      `Build inputs changed during compilation; no provenance recorded: ${changes.join(', ')}`,
    )
  const manifest = {
    schemaVersion: 1,
    kind: 'loklm-build-provenance',
    startedAt,
    completedAt: new Date().toISOString(),
    sourceHashes,
    compiledHashes: await fingerprintOutputs(root),
    toolchain,
    buildEnvironmentHashes: Object.fromEntries(
      Object.entries(process.env)
        .filter(
          ([key, value]) =>
            value !== undefined && /^(?:NODE_ENV$|(?:MAIN_|PRELOAD_|RENDERER_)?VITE_)/u.test(key),
        )
        .map(([key, value]) => [key, sha(value)]),
    ),
  }
  const destination = join(root, manifestRelativePath)
  const temporary = `${destination}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  await rename(temporary, destination)
  return manifest
}

module.exports = {
  collectBuildInputs,
  fingerprintOutputs,
  verifyBuildProvenance,
  runProvenanceBuild,
}

if (require.main === module) {
  const mode = process.argv[2] ?? '--build'
  const work =
    mode === '--verify' ? verifyBuildProvenance : mode === '--build' ? runProvenanceBuild : null
  if (!work) throw new Error('Use --build (default) or --verify from the project root')
  work()
    .then((result) =>
      console.log(
        JSON.stringify(
          mode === '--verify'
            ? result
            : {
                manifest: manifestRelativePath,
                inputFiles: Object.keys(result.sourceHashes).length,
                compiledFiles: Object.keys(result.compiledHashes).length,
              },
          null,
          2,
        ),
      ),
    )
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
