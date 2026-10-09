// Repair the published 1.1.0 Mac/Linux binaries from exact upstream sources.
// Mac has wrong-arch/build-host paths; Linux has missing libs and a newer libc floor.
// Internal Whisper/GGML libraries are static; native Metal/Vulkan remains enabled.
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
import { verifyWhisperLinux } from './verify-whisper-linux.mjs'

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

// Jammy's headers lack required Vulkan extension types and it has no glslc package.
// Only headers/compiler are built here; the runtime loader remains the OS library.
// shaderc's three build dependencies exactly match its pinned upstream DEPS file.
export const WHISPER_LINUX_SOURCES = Object.freeze({
  vulkanHeadersRepository: 'https://github.com/KhronosGroup/Vulkan-Headers.git',
  vulkanHeadersCommit: '29f979ee5aa58b7b005f805ea8df7a855c39ff37', // v1.3.296
  shadercRepository: 'https://github.com/google/shaderc.git',
  shadercCommit: 'caa54d9779d5605aca4e1a0c0c962a3d8f4aeb31', // v2024.4
  shaderCompilerConcurrency: 4,
  shadercDependencies: Object.freeze([
    Object.freeze({
      name: 'glslang',
      variable: 'glslang_revision',
      repository: 'https://github.com/KhronosGroup/glslang.git',
      commit: 'a0995c49ebcaca2c6d3b03efbabf74f3843decdb',
    }),
    Object.freeze({
      name: 'spirv-tools',
      variable: 'spirv_tools_revision',
      repository: 'https://github.com/KhronosGroup/SPIRV-Tools.git',
      commit: '4d2f0b40bfe290dea6c6904dafdf7fd8328ba346',
    }),
    Object.freeze({
      name: 'spirv-headers',
      variable: 'spirv_headers_revision',
      repository: 'https://github.com/KhronosGroup/SPIRV-Headers.git',
      commit: '3f17b2af6784bfa2c5aa5dbb8e0e74a607dd8b3b',
    }),
  ]),
})

// A separate wrapper avoids upstream's cmake-js download/ABI assumptions and
// executable examples. Source implementation and static library targets remain
// upstream; only build/link configuration is supplied here.
export const WHISPER_MAC_CMAKE = `cmake_minimum_required(VERSION 3.19)
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
if(APPLE)
  set(GGML_METAL ON CACHE BOOL "" FORCE)
  set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)
  set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
else()
  set(GGML_METAL OFF CACHE BOOL "" FORCE)
  set(GGML_VULKAN ON CACHE BOOL "" FORCE)
endif()
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
if(APPLE)
  target_link_options(loklm_whisper PRIVATE "-undefined" "dynamic_lookup")
endif()
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

export function nativeBuildTarget(platform, arch) {
  if (platform === 'darwin') {
    nativeMacArchitecture(platform, arch)
    return `mac-${arch}`
  }
  if (platform === 'linux') {
    if (arch !== 'x64') throw new Error('Unsupported native Linux architecture')
    return 'linux-x64'
  }
  return null
}

export function linuxRuntimeIdentity(header) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(header.glibcVersionRuntime ?? ''))
    throw new Error('Whisper Linux source builds require a glibc runtime')
  return { glibcVersionRuntime: header.glibcVersionRuntime }
}

function within(root, target) {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function buildEnvironment() {
  const env = nativeLoadEnvironment()
  for (const key of Object.keys(env)) {
    if (
      /^GIT_|^CMAKE_|^LD_|^(?:CC|CXX|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|VULKAN_SDK|VK_SDK_PATH|CPATH|C_INCLUDE_PATH|CPLUS_INCLUDE_PATH|LIBRARY_PATH)$/.test(
        key,
      )
    )
      delete env[key]
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

export function verifyShadercDependencies(deps) {
  for (const { variable, commit } of WHISPER_LINUX_SOURCES.shadercDependencies) {
    const matches = [...deps.matchAll(new RegExp(`'${variable}':\\s*'([a-f0-9]{40})'`, 'g'))]
    if (matches.length !== 1 || matches[0][1] !== commit)
      throw new Error(`Unexpected pinned shaderc dependency: ${variable}`)
  }
}

export function limitShaderCompilerConcurrency(source) {
  const original = 'uint32_t N = 16;'
  if (source.split(original).length !== 2)
    throw new Error('Unexpected pinned Vulkan shader concurrency declaration')
  return source.replace(
    original,
    `uint32_t N = ${WHISPER_LINUX_SOURCES.shaderCompilerConcurrency};`,
  )
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

export function linuxCmakeArguments({
  wrapper,
  build,
  source,
  output,
  headers,
  addonApi,
  arch,
  vulkanHeaders,
  glslc,
  vulkanLibrary,
}) {
  nativeBuildTarget('linux', arch)
  return [
    '-S',
    wrapper,
    '-B',
    build,
    '-G',
    'Unix Makefiles',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
    '-DCMAKE_C_COMPILER=/usr/bin/gcc',
    '-DCMAKE_CXX_COMPILER=/usr/bin/g++',
    '-DCMAKE_C_FLAGS=-march=x86-64 -mtune=generic',
    '-DCMAKE_CXX_FLAGS=-march=x86-64 -mtune=generic',
    `-DWHISPER_SOURCE=${source}`,
    `-DWHISPER_OUTPUT=${output}`,
    `-DNODE_HEADERS=${headers}`,
    `-DNODE_ADDON_API=${addonApi}`,
    `-DVulkan_INCLUDE_DIR=${join(vulkanHeaders, 'include')}`,
    `-DVulkan_GLSLC_EXECUTABLE=${glslc}`,
    `-DVulkan_LIBRARY=${vulkanLibrary}`,
  ]
}

export function shadercCmakeArguments(source, build) {
  return [
    '-S',
    source,
    '-B',
    build,
    '-G',
    'Unix Makefiles',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
    '-DCMAKE_C_COMPILER=/usr/bin/gcc',
    '-DCMAKE_CXX_COMPILER=/usr/bin/g++',
    '-DPython_EXECUTABLE=/usr/bin/python3',
    '-DPython3_EXECUTABLE=/usr/bin/python3',
    '-DSHADERC_SKIP_TESTS=ON',
    '-DSHADERC_SKIP_EXAMPLES=ON',
    '-DSHADERC_SKIP_INSTALL=ON',
    '-DSHADERC_SKIP_COPYRIGHT_CHECK=ON',
    '-DSHADERC_ENABLE_WERROR_COMPILE=OFF',
    '-DSHADERC_ENABLE_WGSL_OUTPUT=OFF',
    '-DSPIRV_SKIP_TESTS=ON',
    '-DSPIRV_SKIP_EXECUTABLES=ON',
    '-DENABLE_GLSLANG_BINARIES=OFF',
    '-DGLSLANG_TESTS=OFF',
    '-DBUILD_SHARED_LIBS=OFF',
  ]
}

export async function checkLinuxPrerequisites({ run = command, resolvePath = realpath } = {}) {
  const packages = 'build-essential cmake git python3 libvulkan-dev binutils'
  try {
    for (const name of ['gcc', 'g++', 'make', 'cmake', 'git', 'python3', 'tar', 'readelf', 'ldd'])
      run(`/usr/bin/${name}`, ['--version'], { capture: true })
    return await resolvePath('/usr/lib/x86_64-linux-gnu/libvulkan.so')
  } catch (cause) {
    throw new Error(
      `Whisper Linux source build requires the Ubuntu 22.04 toolchain: ${packages}. Install these before pnpm install.`,
      { cause },
    )
  }
}

async function buildLinuxShaderCompiler(stage) {
  const vulkanHeaders = join(stage, 'vulkan-headers')
  await checkout(
    WHISPER_LINUX_SOURCES.vulkanHeadersRepository,
    WHISPER_LINUX_SOURCES.vulkanHeadersCommit,
    vulkanHeaders,
  )
  const shaderc = join(stage, 'shaderc')
  await checkout(
    WHISPER_LINUX_SOURCES.shadercRepository,
    WHISPER_LINUX_SOURCES.shadercCommit,
    shaderc,
  )
  verifyShadercDependencies(await readFile(join(shaderc, 'DEPS'), 'utf8'))
  for (const dep of WHISPER_LINUX_SOURCES.shadercDependencies)
    await checkout(dep.repository, dep.commit, join(shaderc, 'third_party', dep.name))
  const build = join(stage, 'shaderc-build')
  command('cmake', shadercCmakeArguments(shaderc, build))
  command('cmake', ['--build', build, '--target', 'glslc_exe', '--parallel', '2'], {
    timeout: 1_800_000,
  })
  const glslc = join(build, 'glslc/glslc')
  command(glslc, ['--version'])
  // Reject an unusable tool before upstream's stderr-only optional-feature probes.
  const probe = join(stage, 'shader-compiler-probe.comp')
  await writeFile(probe, '#version 450\nlayout(local_size_x = 1) in;\nvoid main() {}\n')
  command(glslc, [
    '--target-env=vulkan1.3',
    '-fshader-stage=compute',
    probe,
    '-o',
    join(stage, 'probe.spv'),
  ])
  return { vulkanHeaders, glslc, shaderc }
}

// Cache admission checks bytes and then executes the real package in a fresh
// process, including relocation. A marker or the directory name alone is never
// sufficient evidence of a usable native binding.
export async function verifyBuildCache(
  packageRoot,
  fingerprint,
  arch,
  { verify = verifyWhisperNative, platform = 'darwin' } = {},
) {
  try {
    const target = nativeBuildTarget(platform, arch)
    if (!target) return false
    const dir = join(packageRoot, 'dist', target)
    const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf8'))
    if (
      marker.inputFingerprint !== fingerprint ||
      marker.arch !== arch ||
      (platform === 'linux' && marker.platform !== 'linux')
    )
      return false
    const natives = (await readdir(dir)).filter((name) =>
      /\.(?:node|dylib|so(?:\..*)?)$/.test(name),
    )
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

export async function buildWhisperNative() {
  const platform = process.platform
  const targetName = nativeBuildTarget(platform, process.arch)
  if (!targetName) {
    console.log('Whisper native source build skipped outside macOS/Linux')
    return { skipped: true }
  }
  // Host builds may run on newer glibc; the separate CLI/release gate enforces
  // Ubuntu 22.04. Host cache identity prevents reusing a newer-host build on 22.04.
  const verify =
    platform === 'darwin'
      ? verifyWhisperNative
      : (root) => verifyWhisperLinux(root, { requireUbuntu2204: false })
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
    ...(platform === 'linux'
      ? {
          linuxSources: WHISPER_LINUX_SOURCES,
          runtime: linuxRuntimeIdentity(process.report.getReport().header),
        }
      : {}),
    platform,
    arch: process.arch,
    builderSha256: await sourceHash(THIS_FILE),
    validatorSha256: await sourceHash(
      join(
        ROOT,
        platform === 'darwin'
          ? 'scripts/verify-whisper-native.mjs'
          : 'scripts/verify-whisper-linux.mjs',
      ),
    ),
    ...(platform === 'linux'
      ? { loadEnvironmentSha256: await sourceHash(join(ROOT, 'scripts/verify-whisper-native.mjs')) }
      : {}),
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
    if (await verifyBuildCache(packageRoot, fingerprint, process.arch, { platform, verify })) {
      console.log(`Verified cached Whisper source build for ${targetName}`)
      return { cached: true }
    }
    // Detect missing OS tools before fetching any build sources; a verified cache
    // can still be used without the development compiler/header packages.
    const vulkanLibrary = platform === 'linux' ? await checkLinuxPrerequisites() : undefined
    console.log(`Building pinned Whisper sources natively for ${targetName}`)
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
    let linuxTools
    if (platform === 'linux') {
      const generator = join(source, 'ggml/src/ggml-vulkan/vulkan-shaders/vulkan-shaders-gen.cpp')
      await writeFile(generator, limitShaderCompilerConcurrency(await readFile(generator, 'utf8')))
      linuxTools = await buildLinuxShaderCompiler(stage)
    }
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
    const output = join(stagingPackage, 'dist', targetName)
    await mkdir(output, { recursive: true })
    await cp(join(packageRoot, 'package.json'), join(stagingPackage, 'package.json'))
    await cp(join(packageRoot, 'dist/js'), join(stagingPackage, 'dist/js'), { recursive: true })
    const build = join(stage, 'build')
    const commonArgs = {
      wrapper,
      build,
      source,
      output,
      headers,
      addonApi,
      arch: process.arch,
    }
    const cmakeArgs =
      platform === 'darwin'
        ? macCmakeArguments({
            ...commonArgs,
            clang: command('/usr/bin/xcrun', ['--find', 'clang'], { capture: true }).trim(),
            clangxx: command('/usr/bin/xcrun', ['--find', 'clang++'], { capture: true }).trim(),
          })
        : linuxCmakeArguments({ ...commonArgs, ...linuxTools, vulkanLibrary })
    command('cmake', cmakeArgs)
    command(
      'cmake',
      ['--build', build, '--config', 'Release', '--target', 'loklm_whisper', '--parallel', '2'],
      { timeout: platform === 'linux' ? 1_800_000 : 900_000 },
    )
    const binary = join(output, 'whisper.node')
    if (platform === 'darwin') {
      command('/usr/bin/codesign', ['--force', '--sign', '-', binary])
      command('/usr/bin/codesign', ['--verify', '--strict', binary])
    }
    const licenses = join(output, 'licenses')
    await mkdir(licenses)
    await cp(join(upstream, 'LICENSE'), join(licenses, 'whisper-node-addon.LICENSE'))
    await cp(join(source, 'LICENSE'), join(licenses, 'whisper.cpp.LICENSE'))
    await cp(join(addonApi, 'LICENSE.md'), join(licenses, 'node-addon-api.LICENSE.md'))
    if (linuxTools) {
      await cp(
        join(linuxTools.vulkanHeaders, 'LICENSE.md'),
        join(licenses, 'Vulkan-Headers.LICENSE.md'),
      )
      await cp(
        join(linuxTools.vulkanHeaders, 'LICENSES'),
        join(licenses, 'Vulkan-Headers-LICENSES'),
        { recursive: true },
      )
      await cp(join(linuxTools.shaderc, 'LICENSE'), join(licenses, 'shaderc.LICENSE'))
    }
    await writeFile(
      join(output, MARKER),
      JSON.stringify(
        {
          schemaVersion: 1,
          inputFingerprint: fingerprint,
          inputs,
          platform,
          arch: process.arch,
          binarySha256: sha256(await readFile(binary)),
          linkage:
            platform === 'darwin'
              ? 'static-whisper-ggml-embedded-metal'
              : 'static-whisper-ggml-system-vulkan',
          signing: platform === 'darwin' ? 'ad-hoc' : 'not-applicable',
        },
        null,
        2,
      ) + '\n',
    )
    await verify(stagingPackage)
    const target = join(packageRoot, 'dist', targetName)
    if (!within(packageRoot, await realpath(dirname(target))) || !within(packageRoot, stage))
      throw new Error('Whisper promotion path escapes package')
    await promoteWhisperDirectory(output, target, join(stage, 'previous-native'), () =>
      verify(packageRoot),
    )
    console.log(`Built and verified portable Whisper native binding for ${targetName}`)
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
  buildWhisperNative().catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
