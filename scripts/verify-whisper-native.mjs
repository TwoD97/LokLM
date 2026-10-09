// Verify the actual selected Mac binding, including relocation outside the
// dependency/build tree. No models or transcription requests are needed.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { lstat, readdir, readFile, realpath, cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function within(root, path) {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function parseMacDependencies(output) {
  const dependencies = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.endsWith(':')) continue
    const match = /^(.+) \(compatibility version [^,]+, current version [^)]+\)$/.exec(line)
    if (!match) throw new Error(`Unrecognized otool dependency: ${line}`)
    dependencies.push(match[1])
  }
  return [...new Set(dependencies)]
}

export function parseMacRpaths(output) {
  const commands = output.split(/Load command \d+/)
  return commands.flatMap((command) => {
    if (!/^\s*cmd LC_RPATH\s*$/m.test(command)) return []
    const match = /^\s*path (.+) \(offset \d+\)\s*$/m.exec(command)
    if (!match) throw new Error('Malformed LC_RPATH load command')
    return [match[1]]
  })
}

export function nativeLoadEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) =>
        typeof value === 'string' &&
        !key.startsWith('DYLD_') &&
        !['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
    ),
  )
}

async function localTarget(activeDir, binary, name) {
  if (name !== '@loader_path' && !name.startsWith('@loader_path/'))
    throw new Error(`Nonportable native search path: ${name}`)
  const target = resolve(dirname(binary), name.slice('@loader_path'.length).replace(/^\//, ''))
  if (!within(activeDir, target)) throw new Error(`Native path escapes the active package: ${name}`)
  return target
}

export async function verifyWhisperBinaryMetadata(
  binary,
  activeDir,
  arch,
  { run = execFileSync } = {},
) {
  activeDir = await realpath(activeDir)
  binary = await realpath(binary)
  if (!within(activeDir, binary)) throw new Error('Native binary escapes the active package')
  const expected = arch === 'x64' ? 'x86_64' : arch
  if (!['arm64', 'x86_64'].includes(expected)) throw new Error('Unsupported Mac architecture')
  const architectures = run('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/)
  if (!architectures.includes(expected))
    throw new Error(`Native binary ${binary} does not contain ${expected}`)
  const dependencies = parseMacDependencies(run('otool', ['-L', binary], { encoding: 'utf8' }))
  const rpaths = parseMacRpaths(run('otool', ['-l', binary], { encoding: 'utf8' }))
  const searchPaths = []
  for (const rpath of rpaths) searchPaths.push(await localTarget(activeDir, binary, rpath))
  for (const dependency of dependencies) {
    if (
      (dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/')) &&
      !dependency.split('/').includes('..')
    )
      continue
    let candidates
    if (dependency.startsWith('@loader_path/'))
      candidates = [await localTarget(activeDir, binary, dependency)]
    else if (dependency.startsWith('@rpath/'))
      candidates = searchPaths.map((path) => resolve(path, dependency.slice('@rpath/'.length)))
    else throw new Error(`Nonportable native dependency: ${dependency}`)
    let found = false
    for (const candidate of candidates) {
      if (!within(activeDir, candidate)) throw new Error(`Native dependency escapes: ${dependency}`)
      try {
        const actual = await realpath(candidate)
        if (!within(activeDir, actual))
          throw new Error(`Native dependency symlink escapes: ${dependency}`)
        if ((await lstat(actual)).isFile()) found = true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    if (!found) throw new Error(`Native dependency is not packaged: ${dependency}`)
  }
  return { binary, architectures, dependencies, rpaths }
}

export async function copyWhisperForRelocation(packageRoot, target, arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported Mac architecture')
  await mkdir(join(target, 'dist'), { recursive: true })
  await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))
  await cp(join(packageRoot, 'dist', 'js'), join(target, 'dist', 'js'), {
    recursive: true,
    dereference: true,
  })
  await cp(join(packageRoot, 'dist', `mac-${arch}`), join(target, 'dist', `mac-${arch}`), {
    recursive: true,
    dereference: true,
  })
}

export function verifyWhisperPackageLoad(packageRoot, { run = execFileSync } = {}) {
  run(
    process.execPath,
    [
      '-e',
      "const addon = require(process.argv[1]); if (typeof addon.transcribe !== 'function') throw new Error('Native transcription export missing'); console.log('Native transcription package loaded on ' + process.platform + '/' + process.arch)",
      packageRoot,
    ],
    { cwd: packageRoot, env: nativeLoadEnvironment(), stdio: 'inherit', timeout: 30_000 },
  )
}

export async function verifyWhisperNative(packageRoot, { relocate = true } = {}) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
    throw new Error('Verify Whisper on a native Mac runner')
  const root = await realpath(packageRoot)
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (
    pkg.name !== '@kutalia/whisper-node-addon' ||
    pkg.version !== '1.1.0' ||
    pkg.main !== './dist/js/index.js'
  )
    throw new Error('Unexpected native transcription package identity')
  const activeDir = await realpath(join(root, 'dist', `mac-${process.arch}`))
  if (!within(root, activeDir)) throw new Error('Active Whisper directory escapes package')
  const entries = await readdir(activeDir, { withFileTypes: true })
  const binaries = entries.filter((entry) => /\.(?:node|dylib)$/.test(entry.name))
  if (!binaries.some((entry) => entry.name === 'whisper.node'))
    throw new Error('Active Whisper binding missing')
  for (const entry of binaries) {
    const binary = await realpath(join(activeDir, entry.name))
    if (!within(activeDir, binary)) throw new Error('Whisper binary symlink escapes package')
    if (!(await lstat(binary)).isFile()) throw new Error('Whisper native entry is not a file')
    await verifyWhisperBinaryMetadata(binary, activeDir, process.arch)
  }
  verifyWhisperPackageLoad(root)
  if (relocate) {
    const scratch = await mkdtemp(
      join(process.env.RUNNER_TEMP || tmpdir(), 'loklm-whisper-relocated-'),
    )
    try {
      await copyWhisperForRelocation(root, scratch, process.arch)
      // Re-run architecture/link checks on the copy as well as requiring it.
      await verifyWhisperNative(scratch, { relocate: false })
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  console.log(
    `Verified ${binaries.length} Whisper native files for ${process.arch}; relocated=${relocate}`,
  )
  return { architecture: process.arch, nativeFiles: binaries.length, relocated: relocate }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--package-root')) {
    console.error('Usage: node scripts/verify-whisper-native.mjs [--package-root <directory>]')
    process.exitCode = 1
  } else {
    const root = args[1] || dirname(require.resolve('@kutalia/whisper-node-addon/package.json'))
    verifyWhisperNative(root).catch((error) => {
      console.error(error.stack || error.message)
      process.exitCode = 1
    })
  }
}
