import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function requireMacArchitectures(output, required) {
  const architectures = output.trim().split(/\s+/)
  if (!required.every((arch) => architectures.includes(arch))) {
    throw new Error(
      `Mach-O architectures ${architectures.join(',')} do not include ${required.join(',')}`,
    )
  }
}

async function addons(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await addons(path)))
    else if (entry.isFile() && entry.name.endsWith('.node')) found.push(path)
  }
  return found
}

export function isActiveMacAddon(path, arch) {
  const segments = path.replace(/\\/g, '/').split('/')
  const prebuild = segments.lastIndexOf('prebuilds')
  if (prebuild === -1) return true
  // node-gyp-build/prebuildify select this platform+architecture directory.
  // argon2 and sodium-native intentionally ship unused other-platform builds.
  const tuple = segments[prebuild + 1]
  if (/^(win32|linux|freebsd|android|ios)-/.test(tuple ?? '')) return false
  if (tuple?.startsWith('darwin-')) return tuple.slice('darwin-'.length).split('+').includes(arch)
  return true // Unknown layouts must pass inspection rather than silently skip.
}

export async function verifyMacApp(app, arch, { wizard = false, run = execFileSync } = {}) {
  if (!['arm64', 'x64', 'universal'].includes(arch)) throw new Error('Invalid Mac architecture')
  const required =
    arch === 'universal' ? ['arm64', 'x86_64'] : [arch === 'x64' ? 'x86_64' : 'arm64']
  const executable = wizard
    ? run(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleExecutable', join(app, 'Contents', 'Info.plist')],
        { encoding: 'utf8' },
      ).trim()
    : 'LokLM'
  if (!/^[A-Za-z0-9_. -]+$/.test(executable) || executable === '.' || executable === '..') {
    throw new Error('Invalid bundle executable name')
  }
  const binary = join(app, 'Contents', 'MacOS', executable)
  const paths = [binary]
  if (!wizard) {
    const native = await addons(join(app, 'Contents', 'Resources', 'app.asar.unpacked'))
    const active = native.filter((path) => isActiveMacAddon(path, arch))
    if (!active.some((path) => path.endsWith('better_sqlite3.node')))
      throw new Error('Packaged SQLite binding missing')
    paths.push(...active)
  }
  for (const path of paths)
    requireMacArchitectures(run('lipo', ['-archs', path], { encoding: 'utf8' }), required)
  console.log(`Verified ${paths.length} Mach-O binaries for ${arch}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyMacApp(process.argv[2], process.argv[3], {
    wizard: process.argv.includes('--wizard'),
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
