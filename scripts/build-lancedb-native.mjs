// LanceDB 0.30.0 omits its Intel Mac prebuild. Compile that exact SDK version;
// keep the published JavaScript, default features and database format unchanged.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_FILE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(THIS_FILE), '..')
const require = createRequire(import.meta.url)
const BINARY = 'lancedb.darwin-x64.node'
const MARKER = 'loklm-lancedb-build.json'
const LICENSE = 'loklm-lancedb-native.LICENSE'
export const LANCEDB_SOURCE = Object.freeze({
  repository: 'https://github.com/lancedb/lancedb.git',
  commit: 'a5288de8d14ff0dfbf42a69c5e2a557b06ebfb6b',
  version: '0.30.0',
  rust: '1.94.0',
  target: 'x86_64-apple-darwin',
  deploymentTarget: '12.0',
  lockSha256: '3201e0782defcbde264a7cfd65d686ef799317531f018ace57815ab51686a42a',
  normalizedLockSha256: 'd69f33bdcee8f15dd8025cb2aa7b73dbf8064fb7b0a32bae2d998446d361b995',
  loaderSha256: '70812924f24335253f4f918f9bbeb7d0c9767bbc1ad974376861784701e5674e',
})
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const textHash = async (path) => sha256((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'))
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function within(root, path) {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
export function needsLancedbBuild(platform, arch) {
  return platform === 'darwin' && arch === 'x64'
}

// The release commit changed only these workspace versions without refreshing
// its lock. Do not re-resolve registry dependencies to accommodate this drift.
export function normalizeWorkspaceVersions(lock) {
  for (const [name, from, to] of [
    ['lancedb', '0.30.0-beta.1', '0.30.0'],
    ['lancedb-nodejs', '0.30.0-beta.1', '0.30.0'],
    ['lancedb-python', '0.33.0-beta.1', '0.33.0'],
  ]) {
    const before = `[[package]]\nname = "${name}"\nversion = "${from}"\n`
    if (lock.split(before).length !== 2) throw new Error(`Unexpected workspace lock entry: ${name}`)
    lock = lock.replace(before, `[[package]]\nname = "${name}"\nversion = "${to}"\n`)
  }
  return lock
}
export function normalizeLancedbLock(bytes) {
  if (sha256(bytes) !== LANCEDB_SOURCE.lockSha256)
    throw new Error('LanceDB source lock SHA256 mismatch')
  const normalized = normalizeWorkspaceVersions(bytes.toString('utf8'))
  if (sha256(normalized) !== LANCEDB_SOURCE.normalizedLockSha256)
    throw new Error('LanceDB normalized lock SHA256 mismatch')
  return normalized
}

export function lancedbBuildEnvironment(env = process.env) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) =>
        typeof value === 'string' &&
        !/^(?:DYLD_|LD_|NAPI_RS_|GIT_|CMAKE_|CARGO_(?!HOME$))/.test(key) &&
        ![
          'NODE_PATH',
          'NODE_OPTIONS',
          'ELECTRON_RUN_AS_NODE',
          'RUSTFLAGS',
          'RUSTC',
          'RUSTC_WRAPPER',
          'RUSTC_WORKSPACE_WRAPPER',
          'RUSTUP_TOOLCHAIN',
          'CC',
          'CXX',
          'CFLAGS',
          'CXXFLAGS',
          'CPPFLAGS',
          'LDFLAGS',
          'CPATH',
          'LIBRARY_PATH',
          'MACOSX_DEPLOYMENT_TARGET',
          'SDKROOT',
        ].includes(key),
    ),
  )
  return {
    ...clean,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_COUNT: '0',
    GIT_TERMINAL_PROMPT: '0',
    CARGO_BUILD_JOBS: '2',
    CARGO_INCREMENTAL: '0',
    MACOSX_DEPLOYMENT_TARGET: LANCEDB_SOURCE.deploymentTarget,
  }
}
function command(program, args, { cwd, capture = false, timeout = 120_000, env = {} } = {}) {
  return execFileSync(program, args, {
    cwd,
    env: { ...lancedbBuildEnvironment(), ...env },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout,
  })
}
export function lancedbCargoArguments(source, target) {
  return [
    `+${LANCEDB_SOURCE.rust}`,
    'build',
    '--locked',
    '--release',
    '--jobs',
    '2',
    '--manifest-path',
    join(source, 'nodejs/Cargo.toml'),
    '--target',
    LANCEDB_SOURCE.target,
    '--target-dir',
    target,
  ]
}
export function checkLancedbPrerequisites(run = command) {
  try {
    const versions = {}
    for (const [name, program, args] of [
      ['rustc', 'rustc', [`+${LANCEDB_SOURCE.rust}`, '--version']],
      ['cargo', 'cargo', [`+${LANCEDB_SOURCE.rust}`, '--version']],
      ['protoc', 'protoc', ['--version']],
      ['cmake', 'cmake', ['--version']],
      ['clang', '/usr/bin/xcrun', ['clang', '--version']],
      ['sdk', '/usr/bin/xcrun', ['--show-sdk-version']],
      ['git', 'git', ['--version']],
    ])
      versions[name] = run(program, args, { capture: true }).trim()
    if (!versions.rustc.startsWith(`rustc ${LANCEDB_SOURCE.rust} `))
      throw new Error('Wrong Rust version')
    return versions
  } catch (cause) {
    throw new Error(
      `LanceDB Intel Mac build requires Rust ${LANCEDB_SOURCE.rust}, Xcode command-line tools, CMake, Git and protoc (brew install protobuf).`,
      { cause },
    )
  }
}

async function prepareSource(cache) {
  const source = join(cache, `source-${LANCEDB_SOURCE.commit}`)
  const git = (args, capture = false) =>
    command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'init.templateDir=',
        '-c',
        'core.autocrlf=false',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        ...args,
      ],
      { cwd: source, capture },
    )
  let present = true
  try {
    await lstat(source)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    present = false
  }
  if (!present) {
    await mkdir(source)
    git(['init', '--quiet'])
    git(['fetch', '--depth=1', '--no-tags', LANCEDB_SOURCE.repository, LANCEDB_SOURCE.commit])
    git(['checkout', '--detach', LANCEDB_SOURCE.commit])
  }
  if (
    (await realpath(source)) !== source ||
    git(['rev-parse', 'HEAD'], true).trim() !== LANCEDB_SOURCE.commit
  )
    throw new Error('Unexpected LanceDB source checkout')
  const changes = git(['status', '--porcelain', '--untracked-files=all'], true).trim()
  if (changes !== '' && changes !== 'M Cargo.lock')
    throw new Error('LanceDB cached source has unexpected changes')
  const lockPath = join(source, 'Cargo.lock')
  const lock = await readFile(lockPath)
  if (sha256(lock) === LANCEDB_SOURCE.lockSha256)
    await writeFile(lockPath, normalizeLancedbLock(lock))
  else if (sha256(lock) !== LANCEDB_SOURCE.normalizedLockSha256)
    throw new Error('LanceDB cached lock differs from the pinned graph')
  return source
}

export async function verifyLancedbCache(cache, fingerprint, verifyBinary) {
  try {
    const marker = JSON.parse(await readFile(join(cache, MARKER), 'utf8'))
    const binary = join(cache, BINARY)
    if (
      marker.schemaVersion !== 1 ||
      marker.inputFingerprint !== fingerprint ||
      marker.target !== LANCEDB_SOURCE.target ||
      !(await lstat(binary)).isFile() ||
      (await fileHash(binary)) !== marker.binarySha256
    )
      return false
    await verifyBinary(binary)
    return true
  } catch {
    return false
  }
}

// The previous directory remains available until the installed package passes.
// Interrupted builds may leave the owned lock/backup for manual recovery.
export async function promoteLancedbDirectory(candidate, target, backup, verifyInstalled) {
  let previous = false
  try {
    await rename(target, backup)
    previous = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let installed = false
  try {
    await rename(candidate, target)
    installed = true
    await verifyInstalled()
  } catch (error) {
    try {
      if (installed) await rename(target, candidate)
      if (previous) await rename(backup, target)
    } catch (rollbackError) {
      const failure = new AggregateError(
        [error, rollbackError],
        'LanceDB rollback failed; preserve staging directory',
      )
      failure.preserveStage = true
      throw failure
    }
    throw error
  }
}

export function createLancedbStage(packageRoot) {
  // Relocation must not recurse into a child of its own source package. A
  // sibling also keeps the dist rename on the package's filesystem.
  return mkdtemp(join(dirname(packageRoot), '.loklm-lancedb-build-'))
}

async function removeLancedbStage(packageRoot, stage) {
  if (
    !within(dirname(packageRoot), stage) ||
    !stage.startsWith(join(dirname(packageRoot), '.loklm-lancedb-build-'))
  )
    throw new Error('Refusing to remove an unowned LanceDB staging directory')
  await rm(stage, { recursive: true, force: true })
}

async function packageInputs(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (
    pkg.name !== '@lancedb/lancedb' ||
    pkg.version !== LANCEDB_SOURCE.version ||
    pkg.main !== 'dist/index.js'
  )
    throw new Error('Unexpected LanceDB JavaScript package identity')
  if ((await fileHash(join(root, 'dist/native.js'))) !== LANCEDB_SOURCE.loaderSha256)
    throw new Error('LanceDB loader differs from the pinned published package')
  const hashes = { 'package.json': await fileHash(join(root, 'package.json')) }
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if ([BINARY, MARKER, LICENSE].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile())
        hashes[relative(root, path).split(sep).join('/')] = await fileHash(path)
      else throw new Error('LanceDB package input contains a link or special file')
    }
  }
  await walk(join(root, 'dist'))
  return hashes
}

export async function buildLancedbNative() {
  if (!needsLancedbBuild(process.platform, process.arch)) {
    console.log('LanceDB source build skipped outside native Intel macOS')
    return { skipped: true }
  }
  const { copyLancedbForRelocation, verifyLancedbNative } =
    await import('./verify-lancedb-native.mjs')
  const packageRoot = await realpath(dirname(dirname(require.resolve('@lancedb/lancedb'))))
  const dist = join(packageRoot, 'dist')
  if ((await realpath(dist)) !== dist)
    throw new Error('LanceDB dist must be a real package directory')
  const inputs = {
    source: LANCEDB_SOURCE,
    toolchain: checkLancedbPrerequisites(),
    builderSha256: await textHash(THIS_FILE),
    validatorSha256: await textHash(join(ROOT, 'scripts/verify-lancedb-native.mjs')),
    sharedValidatorSha256: await textHash(join(ROOT, 'scripts/verify-whisper-native.mjs')),
    packageFiles: await packageInputs(packageRoot),
  }
  const fingerprint = sha256(JSON.stringify(inputs))
  const cache = join(ROOT, 'out/native-lancedb')
  await mkdir(cache, { recursive: true })
  if ((await realpath(cache)) !== cache)
    throw new Error('LanceDB build cache must not be redirected')
  const lock = join(cache, '.build-lock')
  try {
    await mkdir(lock)
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`LanceDB build lock exists: ${lock}; check the prior build before recovery`)
    throw error
  }
  let stage,
    failure,
    preserveStage = false,
    result
  try {
    stage = await createLancedbStage(packageRoot)
    const stagedPackage = join(stage, 'package')
    await copyLancedbForRelocation(packageRoot, stagedPackage)
    const binary = join(stagedPackage, 'dist', BINARY)
    const artifact = join(cache, 'artifacts', fingerprint)
    const cached = await verifyLancedbCache(artifact, fingerprint, async (candidate) => {
      await cp(candidate, binary)
      await verifyLancedbNative(stagedPackage)
    })
    if (!cached) {
      console.log('Building exact LanceDB 0.30.0 sources for Intel macOS')
      const source = await prepareSource(cache)
      const target = join(cache, 'target', fingerprint)
      command('cargo', lancedbCargoArguments(source, target), { cwd: source, timeout: 6_600_000 })
      await cp(join(target, LANCEDB_SOURCE.target, 'release/liblancedb_nodejs.dylib'), binary)
      command('/usr/bin/codesign', ['--force', '--sign', '-', binary])
      command('/usr/bin/codesign', ['--verify', '--strict', binary])
      await cp(join(source, 'LICENSE'), join(stagedPackage, 'dist', LICENSE))
      await verifyLancedbNative(stagedPackage)
    } else {
      await cp(join(artifact, LICENSE), join(stagedPackage, 'dist', LICENSE))
    }
    const marker =
      JSON.stringify(
        {
          schemaVersion: 1,
          inputFingerprint: fingerprint,
          inputs,
          target: LANCEDB_SOURCE.target,
          binarySha256: await fileHash(binary),
        },
        null,
        2,
      ) + '\n'
    await writeFile(join(stagedPackage, 'dist', MARKER), marker)
    await promoteLancedbDirectory(
      join(stagedPackage, 'dist'),
      dist,
      join(stage, 'previous-dist'),
      () => verifyLancedbNative(packageRoot),
    )
    if (!cached) {
      const artifacts = join(cache, 'artifacts')
      await mkdir(artifacts, { recursive: true })
      const fresh = await mkdtemp(join(artifacts, '.candidate-'))
      const previousCache = join(artifacts, `.previous-${fingerprint}`)
      let cacheRecovery = false
      try {
        await cp(join(dist, BINARY), join(fresh, BINARY))
        await cp(join(dist, LICENSE), join(fresh, LICENSE))
        await writeFile(join(fresh, MARKER), marker)
        await promoteLancedbDirectory(fresh, artifact, previousCache, async () => {})
        await rm(previousCache, { recursive: true, force: true })
      } catch (error) {
        cacheRecovery = error.preserveStage === true
        throw error
      } finally {
        if (!cacheRecovery && within(artifacts, fresh))
          await rm(fresh, { recursive: true, force: true })
      }
    }
    console.log(
      `Verified ${cached ? 'cached' : 'built'} LanceDB native Intel binding and relocated database operations`,
    )
    result = { cached, built: !cached }
  } catch (error) {
    failure = error
    preserveStage = error.preserveStage === true
  } finally {
    if (!preserveStage) {
      try {
        if (stage) await removeLancedbStage(packageRoot, stage)
        await rmdir(lock)
      } catch (error) {
        failure = failure
          ? new AggregateError([failure, error], 'LanceDB build and cleanup failed')
          : error
      }
    } else console.error(`Preserved LanceDB recovery files: ${stage}`)
  }
  if (failure) throw failure
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  buildLancedbNative().catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
