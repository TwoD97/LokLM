import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const artifactGroups = Object.freeze({
  windows: ['LokLM-x64.exe', 'payload-win-x64.tar.zst', 'cuda-win-x64.tar.zst'],
  linux: [
    'LokLM-Setup-linux-x64.run',
    'LokLM-Setup-linux-x64.deb',
    'payload-linux-x64.tar.zst',
    'cuda-linux-x64.tar.zst',
  ],
  'mac-arm64': ['payload-mac-arm64.tar.zst'],
  'mac-x64': ['payload-mac-x64.tar.zst'],
  macos: ['LokLM-mac.dmg'],
})

async function digest(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.size <= 0)
    throw new Error(`Missing/nonregular/empty artifact: ${path}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { sha256: hash.digest('hex'), sizeBytes: info.size }
}

export function sidecarDigest(value, filename) {
  const match = value.trim().match(/^([a-fA-F0-9]{64})(?:[ \t]+\*?([^\r\n]+))?$/)
  if (!match || (match[2] && match[2] !== filename))
    throw new Error(`Invalid checksum sidecar: ${filename}`)
  return match[1].toLowerCase()
}

export async function stampGroup(dir, group) {
  const names = artifactGroups[group]
  if (!names) throw new Error('Unknown artifact group')
  for (const filename of names) {
    const { sha256 } = await digest(join(dir, filename))
    // Bare digests are also consumed by the existing wizard manifest writer.
    await writeFile(join(dir, `${filename}.sha256`), `${sha256}\n`)
  }
}

export async function verifyMacArchives(dir) {
  for (const arch of ['arm64', 'x64']) {
    const filename = `payload-mac-${arch}.tar.zst`
    const actual = await digest(join(dir, filename))
    const expected = sidecarDigest(
      await readFile(join(dir, `${filename}.sha256`), 'utf8'),
      filename,
    )
    if (actual.sha256 !== expected) throw new Error(`Mac archive checksum mismatch: ${arch}`)
  }
}

export async function verifyReleaseArtifacts(dir, { version, baseUrl, sourceSha }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Invalid source commit')
  const artifacts = []
  for (const filename of Object.values(artifactGroups).flat()) {
    const observed = await digest(join(dir, filename))
    const expected = sidecarDigest(
      await readFile(join(dir, `${filename}.sha256`), 'utf8'),
      filename,
    )
    if (expected !== observed.sha256) throw new Error(`Artifact checksum mismatch: ${filename}`)
    artifacts.push({ filename, ...observed })
  }
  // Validate the exact manifests captured BEFORE each wizard was compiled.
  for (const [name, platforms] of Object.entries({
    windows: ['win-x64'],
    linux: ['linux-x64'],
    macos: ['mac-arm64', 'mac-x64'],
  })) {
    const manifest = JSON.parse(await readFile(join(dir, `manifest-${name}.json`), 'utf8'))
    if (manifest.version !== version || manifest.baseUrl !== baseUrl)
      throw new Error(`Wrong baked manifest identity: ${name}`)
    for (const platform of platforms) {
      for (const kind of platform.startsWith('mac-') ? ['payload'] : ['payload', 'cuda']) {
        const baked = manifest.platforms?.[platform]?.[kind]
        const filename = `${kind}-${platform}.tar.zst`
        const actual = artifacts.find((item) => item.filename === filename)
        if (
          baked?.filename !== filename ||
          baked.sha256 !== actual.sha256 ||
          baked.sizeBytes !== actual.sizeBytes
        ) {
          throw new Error(`Baked manifest mismatch: ${platform}/${kind}`)
        }
      }
    }
  }
  return { version, baseUrl, sourceSha, artifacts }
}

// A version prefix is never reused, even after a partial upload. Failed uploads
// remain unadvertised; use a new patch version rather than invalidating installers
// that have already baked these URLs and digests. Global workflow concurrency
// serializes this repository's publisher; storage access must remain exclusive.
export function requireEmptyListing(output) {
  if (output.trim()) throw new Error('Release prefix already contains objects; refusing overwrite')
}

export async function publishArtifacts(dir, index, run = execFileSync) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(index.version))
    throw new Error('Invalid version')
  const destination = `s3target/loklm-installers/v${index.version}/`
  // A failed list command throws, including authentication/network failures.
  requireEmptyListing(run('mc', ['ls', '--json', '--recursive', destination], { encoding: 'utf8' }))
  for (const { filename } of index.artifacts) {
    if (!Object.values(artifactGroups).flat().includes(filename))
      throw new Error('Unexpected artifact')
    for (const suffix of ['', '.sha256'])
      run('mc', ['cp', join(dir, filename + suffix), destination], { stdio: 'inherit' })
  }
  run('mc', ['cp', join(dir, 'release-index.json'), destination], { stdio: 'inherit' })
}

async function main() {
  const [command, argument] = process.argv.slice(2)
  const dir = resolve('release')
  if (command === 'stamp') return stampGroup(dir, argument)
  const index = await verifyReleaseArtifacts(dir, {
    version: process.env.RELEASE_VERSION,
    baseUrl: process.env.LOKLM_PAYLOAD_BASE_URL,
    sourceSha: process.env.GITHUB_SHA,
  })
  await writeFile(join(dir, 'release-index.json'), JSON.stringify(index, null, 2) + '\n')
  if (command === 'publish') await publishArtifacts(dir, index)
  else if (command !== 'verify') throw new Error('Expected stamp, verify or publish')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
