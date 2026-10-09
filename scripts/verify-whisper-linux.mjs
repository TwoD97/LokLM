// Validate the native Linux package without a model or GPU request. The real
// Ubuntu 22.04 loader remains the release gate. The CLI always enforces that
// ABI floor; a developer source build may explicitly validate its current host
// instead, without disabling package, linkage, load or relocation validation.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeLoadEnvironment } from './verify-whisper-native.mjs'

const require = createRequire(import.meta.url)
const SYSTEM_LIBRARIES = new Set([
  'libc.so.6',
  'libm.so.6',
  'libstdc++.so.6',
  'libgcc_s.so.1',
  'libvulkan.so.1',
  'libpthread.so.0',
  'libdl.so.2',
  'librt.so.1',
  'ld-linux-x86-64.so.2',
])
const ABI_LIMITS = { GLIBC: [2, 35], GLIBCXX: [3, 4, 30], CXXABI: [1, 3, 13], GCC: [12, 0, 0] }

function within(root, path) {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function linuxLoadEnvironment(env = process.env) {
  const clean = nativeLoadEnvironment(env)
  for (const key of Object.keys(clean))
    if (key.startsWith('LD_') || key === 'GLIBC_TUNABLES') delete clean[key]
  return { ...clean, LC_ALL: 'C', LANG: 'C' }
}

export function assertLinuxX64Elf(bytes) {
  if (
    bytes.length < 64 ||
    bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    bytes.readUInt16LE(16) !== 3 ||
    bytes.readUInt16LE(18) !== 62 ||
    bytes.readUInt32LE(20) !== 1
  )
    throw new Error('Whisper binding must be an ELF64 little-endian x86-64 shared object')
}

export function parseLinuxNeeded(output) {
  if (!/Dynamic section at offset .+ contains \d+ entries:/.test(output))
    throw new Error('Missing ELF dynamic section')
  if (/\((?:RPATH|RUNPATH|FILTER|AUXILIARY)\)/.test(output))
    throw new Error('Whisper must not depend on an ELF search path or library filter')
  const names = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('(NEEDED)')) continue
    const match = /\(NEEDED\)\s+Shared library: \[([^\]]+)\]\s*$/.exec(line)
    if (!match || !SYSTEM_LIBRARIES.has(match[1]))
      throw new Error(`Non-system or malformed ELF dependency: ${line.trim()}`)
    names.push(match[1])
  }
  if (!names.includes('libvulkan.so.1')) throw new Error('Whisper Vulkan linkage is missing')
  return [...new Set(names)]
}

function newerThan(value, limit) {
  for (let i = 0; i < Math.max(value.length, limit.length); i++) {
    if ((value[i] ?? 0) !== (limit[i] ?? 0)) return (value[i] ?? 0) > (limit[i] ?? 0)
  }
  return false
}

export function verifyLinuxAbiVersions(output, { requireUbuntu2204 = true } = {}) {
  if (typeof requireUbuntu2204 !== 'boolean') throw new Error('Invalid Ubuntu ABI policy')
  if (!output.includes('Version needs section')) throw new Error('Missing ELF version requirements')
  const versions = []
  let needs = false
  for (const line of output.split(/\r?\n/)) {
    if (/^Version \w+ section/.test(line)) needs = line.startsWith('Version needs section')
    if (!needs || !line.includes('Name:')) continue
    const name = /\bName:\s+(\S+)/.exec(line)?.[1]
    const match = /^(GLIBC|GLIBCXX|CXXABI|GCC)_(\d+(?:\.\d+)*)$/.exec(name ?? '')
    if (
      !match ||
      (requireUbuntu2204 && newerThan(match[2].split('.').map(Number), ABI_LIMITS[match[1]]))
    )
      throw new Error(`ELF ABI exceeds or is outside the Ubuntu 22.04 contract: ${name}`)
    versions.push(name)
  }
  if (!versions.length) throw new Error('Empty ELF version requirements')
  return [...new Set(versions)]
}

export function parseLinuxResolvedLibraries(output) {
  const libraries = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^linux-vdso\.so\.1 \(0x[\da-f]+\)$/.test(line)) continue
    const linked = /^(\S+) => (\/\S+) \(0x[\da-f]+\)$/.exec(line)
    const loader = /^(\/\S*\/ld-linux-x86-64\.so\.2) \(0x[\da-f]+\)$/.exec(line)
    const name = linked?.[1] ?? (loader ? 'ld-linux-x86-64.so.2' : null)
    const path = linked?.[2] ?? loader?.[1]
    if (!name || !path || !SYSTEM_LIBRARIES.has(name))
      throw new Error(`Missing or unexpected resolved native library: ${line}`)
    libraries.push({ name, path })
  }
  if (!libraries.length) throw new Error('No resolved native libraries')
  return libraries
}

export function isSystemLinuxLibraryPath(path) {
  return (
    posix.isAbsolute(path) &&
    posix.normalize(path) === path &&
    ['/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/'].some((prefix) => path.startsWith(prefix))
  )
}

export async function verifyLinuxResolvedLibraries(
  output,
  needed,
  { resolvePath = realpath, stat = lstat } = {},
) {
  const libraries = parseLinuxResolvedLibraries(output)
  for (const name of needed)
    if (!libraries.some((library) => library.name === name))
      throw new Error(`Required native library was not resolved: ${name}`)
  for (const library of libraries) {
    if (!isSystemLinuxLibraryPath(library.path))
      throw new Error(`Native library resolved outside the system: ${library.path}`)
    const actual = await resolvePath(library.path)
    if (!isSystemLinuxLibraryPath(actual) || !(await stat(actual)).isFile())
      throw new Error(`Native library target is not a system file: ${library.path}`)
  }
  return libraries
}

function run(program, args, { cwd, capture = true } = {}) {
  return execFileSync(program, args, {
    cwd,
    env: linuxLoadEnvironment(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout: 30_000,
  })
}

export function verifyLinuxPackageLoad(packageRoot, { execute = run } = {}) {
  execute(
    process.execPath,
    [
      '-e',
      "const addon = require(process.argv[1]); if (typeof addon.transcribe !== 'function') throw new Error('Native transcription export missing'); console.log('Native transcription package loaded on ' + process.platform + '/' + process.arch)",
      packageRoot,
    ],
    { cwd: packageRoot, capture: false },
  )
}

export async function copyWhisperLinuxForRelocation(packageRoot, target) {
  await mkdir(join(target, 'dist'), { recursive: true })
  await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))
  for (const part of ['js', 'linux-x64'])
    await cp(join(packageRoot, 'dist', part), join(target, 'dist', part), {
      recursive: true,
      dereference: true,
    })
}

export async function verifyNoBundledSharedLibraries(dir, active = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in static Whisper runtime')
    if (entry.isDirectory()) await verifyNoBundledSharedLibraries(path, active)
    else if (!entry.isFile() || /\.so(?:\.|$)|\.dylib$|\.node$/.test(entry.name)) {
      if (entry.isFile() && path === join(active, 'whisper.node')) continue
      throw new Error(`Unexpected bundled native library: ${entry.name}`)
    }
  }
}

export async function verifyWhisperLinux(
  packageRoot,
  { relocate = true, requireUbuntu2204 = true } = {},
) {
  if (typeof requireUbuntu2204 !== 'boolean') throw new Error('Invalid Ubuntu ABI policy')
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Verify Whisper on a native Linux x64 runner')
  const root = await realpath(packageRoot)
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (
    pkg.name !== '@kutalia/whisper-node-addon' ||
    pkg.version !== '1.1.0' ||
    pkg.main !== './dist/js/index.js'
  )
    throw new Error('Unexpected native transcription package identity')
  const active = await realpath(join(root, 'dist', 'linux-x64'))
  if (!within(root, active)) throw new Error('Active Whisper directory escapes package')
  await verifyNoBundledSharedLibraries(active)
  const binary = join(active, 'whisper.node')
  if (!(await lstat(binary)).isFile())
    throw new Error('Active Whisper binding is not a regular file')
  assertLinuxX64Elf(await readFile(binary))
  const needed = parseLinuxNeeded(run('readelf', ['--dynamic', '--wide', binary]))
  const versions = verifyLinuxAbiVersions(run('readelf', ['--version-info', '--wide', binary]), {
    requireUbuntu2204,
  })
  const libraries = await verifyLinuxResolvedLibraries(run('ldd', [binary]), needed)
  verifyLinuxPackageLoad(root)
  if (relocate) {
    const scratch = await mkdtemp(
      join(process.env.RUNNER_TEMP || tmpdir(), 'loklm-whisper-linux-relocated-'),
    )
    try {
      await copyWhisperLinuxForRelocation(root, scratch)
      await verifyWhisperLinux(scratch, { relocate: false, requireUbuntu2204 })
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  console.log(
    `Verified Linux x64 Whisper ELF, system linkage and package load; relocated=${relocate}, Ubuntu22.04=${requireUbuntu2204}`,
  )
  return {
    architecture: 'x64',
    needed,
    versions,
    libraries,
    relocated: relocate,
    requireUbuntu2204,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--package-root')) {
    console.error('Usage: node scripts/verify-whisper-linux.mjs [--package-root <directory>]')
    process.exitCode = 1
  } else {
    const root = args[1] || dirname(require.resolve('@kutalia/whisper-node-addon/package.json'))
    verifyWhisperLinux(root).catch((error) => {
      console.error(error.stack || error.message)
      process.exitCode = 1
    })
  }
}
