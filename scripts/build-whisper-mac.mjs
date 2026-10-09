// Repair the published 1.1.0 Mac binaries from their exact upstream sources.
// Both published Mac directories contain ARM64 files with build-host rpaths.
// This native-only build links Whisper/GGML statically and embeds Metal source.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { nativeLoadEnvironment, verifyWhisperNative } from './verify-whisper-native.mjs'

const require = createRequire(import.meta.url)
const THIS_FILE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(THIS_FILE), '..')
const MARKER = 'loklm-native-build.json'
const LOCK = '.loklm-whisper-build.lock'
const HEADER_LIMIT = 64 * 1024 * 1024
export const WHISPER_MAC_SOURCES = Object.freeze({
  addonRepository: 'https://github.com/Kutalia/whisper-node-addon.git',
  addonCommit: '038bd87945eb08e80a81564d3390e617be8371cc',
  whisperRepository: 'https://github.com/Kutalia/whisper.cpp.git',
  whisperCommit: 'c9eb98976aac43e76d396ca93a362153e0e33d29',
  nodeHeadersUrl: 'https://nodejs.org/dist/v24.20.0/node-v24.20.0-headers.tar.gz',
  nodeHeadersSha256: '7b2141e77e66ab23ead6b200c546afc5837136e3075d8a3ac5a67e540dcc59c1',
  nodeHeadersRoot: 'node-v24.20.0',
  nodeAddonApiVersion: '8.8.0',
  napiVersion: 4,
  deploymentTarget: '12.0',
})

// A separate wrapper avoids upstream's cmake-js download/ABI assumptions and
// executable examples. Source implementation and static library targets remain
// upstream; only build/link configuration is supplied here.
export const WHISPER_MAC_CMAKE = `cmake_minimum_required(VERSION 3.16)
project(loklm_whisper_native LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_SKIP_RPATH ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_USE_SYSTEM_GGML OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(WHISPER_COREML OFF CACHE BOOL "" FORCE)
set(WHISPER_OPENVINO OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(GGML_METAL ON CACHE BOOL "" FORCE)
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)
# The pinned BLAS and CPU Accelerate paths request macOS 13.3 LAPACK APIs.
# Retain the 12.0 floor using regular CPU kernels alongside Metal instead.
set(GGML_BLAS OFF CACHE BOOL "" FORCE)
set(GGML_ACCELERATE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
foreach(feature AVX AVX2 AVX512 AVX512_VBMI AVX512_VNNI AVX512_BF16 AMX_TILE AMX_INT8 AMX_BF16 FMA F16C)
  set(GGML_\${feature} OFF CACHE BOOL "" FORCE)
endforeach()
add_subdirectory("\${WHISPER_SOURCE}" whisper)
find_package(Threads REQUIRED)
add_library(loklm_whisper_common STATIC
  "\${WHISPER_SOURCE}/examples/common.cpp"
  "\${WHISPER_SOURCE}/examples/common-ggml.cpp"
  "\${WHISPER_SOURCE}/examples/common-whisper.cpp"
  "\${WHISPER_SOURCE}/examples/grammar-parser.cpp")
target_include_directories(loklm_whisper_common PUBLIC "\${WHISPER_SOURCE}/examples")
target_link_libraries(loklm_whisper_common PRIVATE whisper)
add_library(loklm_whisper MODULE "\${WHISPER_SOURCE}/examples/addon.node/addon.cpp")
set_target_properties(loklm_whisper PROPERTIES PREFIX "" SUFFIX ".node"
  OUTPUT_NAME whisper LIBRARY_OUTPUT_DIRECTORY "\${WHISPER_OUTPUT}")
target_compile_definitions(loklm_whisper PRIVATE NAPI_VERSION=4)
target_include_directories(loklm_whisper PRIVATE "\${NODE_HEADERS}" "\${NODE_ADDON_API}")
target_link_libraries(loklm_whisper PRIVATE loklm_whisper_common whisper Threads::Threads)
target_link_options(loklm_whisper PRIVATE "-undefined" "dynamic_lookup")
`

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sourceHash(path) {
  return sha256((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'))
}

async function removeOwnedStage(packageRoot, stage) {
  if (!within(packageRoot, stage) || !stage.startsWith(join(packageRoot, '.loklm-whisper-build-')))
    throw new Error('Refusing to remove an unowned Whisper build directory')
  await rm(stage, { recursive: true, force: true })
}

export function nativeMacArchitecture(platform, arch) {
  if (platform !== 'darwin') return null
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported native Mac architecture')
  return arch === 'x64' ? 'x86_64' : 'arm64'
}

function within(root, target) {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function buildEnvironment() {
  const env = nativeLoadEnvironment()
  for (const key of Object.keys(env)) {
    if (/^GIT_|^CMAKE_|^(?:CC|CXX|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS)$/.test(key)) delete env[key]
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '0',
  }
}

function command(program, args, { cwd, capture = false, timeout = 120_000 } = {}) {
  return execFileSync(program, args, {
    cwd,
    env: buildEnvironment(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout,
  })
}

async function checkout(repository, commit, destination) {
  await mkdir(destination, { recursive: true })
  const git = (args, capture = false) =>
    command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'init.templateDir=',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        ...args,
      ],
      { cwd: destination, capture },
    )
  git(['init', '--quiet'])
  git(['remote', 'add', 'origin', repository])
  git(['fetch', '--depth=1', '--no-tags', 'origin', commit])
  git(['checkout', '--detach', '--force', commit])
  if (git(['rev-parse', 'HEAD'], true).trim() !== commit) throw new Error('Source commit mismatch')
}

export function verifyWhisperGitlink(output) {
  if (output.trim() !== `160000 commit ${WHISPER_MAC_SOURCES.whisperCommit}\tdeps/whisper.cpp`)
    throw new Error('Pinned addon has an unexpected Whisper submodule')
}

export async function downloadVerifiedHeaders(destination, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(WHISPER_MAC_SOURCES.nodeHeadersUrl, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  })
  if (!response.ok || !response.body) throw new Error('Node headers download failed')
  if (Number(response.headers.get('content-length')) > HEADER_LIMIT)
    throw new Error('Node headers exceed size limit')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > HEADER_LIMIT) throw new Error('Node headers exceed size limit')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (sha256(bytes) !== WHISPER_MAC_SOURCES.nodeHeadersSha256)
    throw new Error('Node headers SHA256 mismatch')
  await writeFile(destination, bytes, { flag: 'wx' })
}

export function verifyHeaderArchiveEntries(names, verbose) {
  const entries = names.trim().split(/\r?\n/)
  const root = `${WHISPER_MAC_SOURCES.nodeHeadersRoot}/`
  if (
    !entries.length ||
    entries.some(
      (name) =>
        !name.startsWith(root) ||
        name.includes('\\') ||
        name.includes(':') ||
        name.includes('\0') ||
        name.split('/').includes('..') ||
        name.split('/').includes('.'),
    )
  )
    throw new Error('Unsafe Node headers archive path')
  const types = verbose.trim().split(/\r?\n/)
  if (types.length !== entries.length || types.some((line) => !['-', 'd'].includes(line[0])))
    throw new Error('Node headers archive contains links or special entries')
}

export function macCmakeArguments({
  wrapper,
  build,
  source,
  output,
  headers,
  addonApi,
  arch,
  clang,
  clangxx,
}) {
  const native = nativeMacArchitecture('darwin', arch)
  return [
    '-S',
    wrapper,
    '-B',
    build,
    '-G',
    'Unix Makefiles',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
    `-DCMAKE_OSX_ARCHITECTURES=${native}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${WHISPER_MAC_SOURCES.deploymentTarget}`,
    `-DCMAKE_C_COMPILER=${clang}`,
    `-DCMAKE_CXX_COMPILER=${clangxx}`,
    `-DWHISPER_SOURCE=${source}`,
    `-DWHISPER_OUTPUT=${output}`,
    `-DNODE_HEADERS=${headers}`,
    `-DNODE_ADDON_API=${addonApi}`,
  ]
}

// Cache admission checks bytes and then executes the real package in a fresh
// process, including relocation. A marker or the directory name alone is never
// sufficient evidence of a usable native binding.
export async function verifyBuildCache(
  packageRoot,
  fingerprint,
  arch,
  { verify = verifyWhisperNative } = {},
) {
  try {
    const dir = join(packageRoot, 'dist', `mac-${arch}`)
    const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf8'))
    if (marker.inputFingerprint !== fingerprint || marker.arch !== arch) return false
    const natives = (await readdir(dir)).filter((name) => /\.(?:node|dylib)$/.test(name))
    if (natives.length !== 1 || natives[0] !== 'whisper.node') return false
    const binary = join(dir, 'whisper.node')
    if (!(await lstat(binary)).isFile() || sha256(await readFile(binary)) !== marker.binarySha256)
      return false
    await verify(packageRoot)
    return true
  } catch {
    return false
  }
}

// Preserve the previous native directory until final installed-package
// verification succeeds. Failed rollback retains the owned backup for manual
// recovery instead of removing the only surviving previous payload.
export async function promoteWhisperDirectory(candidate, target, backup, verifyInstalled) {
  let hadPrevious = false
  try {
    await rename(target, backup)
    hadPrevious = true
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
      if (hadPrevious) await rename(backup, target)
    } catch (rollbackError) {
      const failure = new AggregateError(
        [error, rollbackError],
        'Whisper rollback failed; preserve the staging directory',
      )
      failure.preserveStage = true
      throw failure
    }
    throw error
  }
}

export async function buildWhisperMac() {
  if (!nativeMacArchitecture(process.platform, process.arch)) {
    console.log('Whisper native source build skipped outside macOS')
    return { skipped: true }
  }
  const packageRoot = await realpath(
    dirname(require.resolve('@kutalia/whisper-node-addon/package.json')),
  )
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (
    pkg.name !== '@kutalia/whisper-node-addon' ||
    pkg.version !== '1.1.0' ||
    pkg.main !== './dist/js/index.js'
  )
    throw new Error('Unexpected Whisper package identity')
  const caller = createRequire(join(packageRoot, 'package.json'))
  const addonApi = dirname(caller.resolve('node-addon-api/package.json'))
  const apiPkg = JSON.parse(await readFile(join(addonApi, 'package.json'), 'utf8'))
  if (apiPkg.version !== WHISPER_MAC_SOURCES.nodeAddonApiVersion)
    throw new Error('node-addon-api version changed; review the pinned native build')
  const apiHashes = {}
  for (const name of (await readdir(addonApi)).filter((name) => name.endsWith('.h')).sort())
    apiHashes[name] = sha256(await readFile(join(addonApi, name)))
  const inputs = {
    sources: WHISPER_MAC_SOURCES,
    arch: process.arch,
    builderSha256: await sourceHash(THIS_FILE),
    validatorSha256: await sourceHash(join(ROOT, 'scripts/verify-whisper-native.mjs')),
    loaderSha256: await sourceHash(join(packageRoot, 'dist/js/index.js')),
    addonApiHeaders: apiHashes,
  }
  const fingerprint = sha256(JSON.stringify(inputs))
  const lock = join(packageRoot, LOCK)
  try {
    await mkdir(lock)
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Whisper build lock already exists: ${lock}; ensure no build is running before recovering it`,
      )
    throw error
  }
  let stage
  let preserveStage = false
  async function performBuild() {
    if (await verifyBuildCache(packageRoot, fingerprint, process.arch)) {
      console.log(`Verified cached Whisper source build for ${process.arch}`)
      return { cached: true }
    }
    console.log(`Building pinned Whisper sources natively for ${process.arch}`)
    stage = await mkdtemp(join(packageRoot, '.loklm-whisper-build-'))
    const upstream = join(stage, 'upstream')
    await checkout(WHISPER_MAC_SOURCES.addonRepository, WHISPER_MAC_SOURCES.addonCommit, upstream)
    verifyWhisperGitlink(
      command('git', ['ls-tree', 'HEAD', 'deps/whisper.cpp'], { cwd: upstream, capture: true }),
    )
    const source = join(upstream, 'deps/whisper.cpp')
    await checkout(WHISPER_MAC_SOURCES.whisperRepository, WHISPER_MAC_SOURCES.whisperCommit, source)
    const gitlinks = command('git', ['ls-files', '--stage'], { cwd: source, capture: true })
    if (/^160000 /m.test(gitlinks)) throw new Error('Unexpected nested source submodule')
    const archive = join(stage, 'node-headers.tar.gz')
    await downloadVerifiedHeaders(archive)
    verifyHeaderArchiveEntries(
      command('/usr/bin/tar', ['-tzf', archive], { capture: true }),
      command('/usr/bin/tar', ['-tvzf', archive], { capture: true }),
    )
    const headersRoot = join(stage, 'headers')
    await mkdir(headersRoot)
    command('/usr/bin/tar', ['-xzf', archive, '-C', headersRoot, '--no-same-owner'])
    const headers = join(headersRoot, WHISPER_MAC_SOURCES.nodeHeadersRoot, 'include/node')
    await readFile(join(headers, 'node_api.h'))
    const wrapper = join(stage, 'wrapper')
    await mkdir(wrapper)
    await writeFile(join(wrapper, 'CMakeLists.txt'), WHISPER_MAC_CMAKE)
    const stagingPackage = join(stage, 'package')
    const output = join(stagingPackage, 'dist', `mac-${process.arch}`)
    await mkdir(output, { recursive: true })
    await cp(join(packageRoot, 'package.json'), join(stagingPackage, 'package.json'))
    await cp(join(packageRoot, 'dist/js'), join(stagingPackage, 'dist/js'), { recursive: true })
    const build = join(stage, 'build')
    const clang = command('/usr/bin/xcrun', ['--find', 'clang'], { capture: true }).trim()
    const clangxx = command('/usr/bin/xcrun', ['--find', 'clang++'], { capture: true }).trim()
    command(
      'cmake',
      macCmakeArguments({
        wrapper,
        build,
        source,
        output,
        headers,
        addonApi,
        arch: process.arch,
        clang,
        clangxx,
      }),
    )
    command(
      'cmake',
      ['--build', build, '--config', 'Release', '--target', 'loklm_whisper', '--parallel', '2'],
      { timeout: 900_000 },
    )
    const binary = join(output, 'whisper.node')
    command('/usr/bin/codesign', ['--force', '--sign', '-', binary])
    command('/usr/bin/codesign', ['--verify', '--strict', binary])
    const licenses = join(output, 'licenses')
    await mkdir(licenses)
    await cp(join(upstream, 'LICENSE'), join(licenses, 'whisper-node-addon.LICENSE'))
    await cp(join(source, 'LICENSE'), join(licenses, 'whisper.cpp.LICENSE'))
    await cp(join(addonApi, 'LICENSE.md'), join(licenses, 'node-addon-api.LICENSE.md'))
    await writeFile(
      join(output, MARKER),
      JSON.stringify(
        {
          schemaVersion: 1,
          inputFingerprint: fingerprint,
          inputs,
          arch: process.arch,
          binarySha256: sha256(await readFile(binary)),
          linkage: 'static-whisper-ggml-embedded-metal',
          signing: 'ad-hoc',
        },
        null,
        2,
      ) + '\n',
    )
    await verifyWhisperNative(stagingPackage)
    const target = join(packageRoot, 'dist', `mac-${process.arch}`)
    if (!within(packageRoot, await realpath(dirname(target))) || !within(packageRoot, stage))
      throw new Error('Whisper promotion path escapes package')
    await promoteWhisperDirectory(output, target, join(stage, 'previous-native'), () =>
      verifyWhisperNative(packageRoot),
    )
    console.log(`Built and verified portable Whisper native binding for ${process.arch}`)
    return { built: true }
  }
  let result
  let failure
  try {
    result = await performBuild()
  } catch (error) {
    failure = error
    preserveStage = error.preserveStage === true
    if (preserveStage) console.error(`Preserved Whisper recovery files: ${stage}`)
  } finally {
    if (!preserveStage) {
      try {
        if (stage) await removeOwnedStage(packageRoot, stage)
        await rmdir(lock)
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError([failure, cleanupError], 'Whisper build and cleanup failed')
          : cleanupError
      }
    }
  }
  if (failure) throw failure
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  buildWhisperMac().catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
