import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { releaseVersion, publicReleaseBase } from '../../../scripts/release-preflight.mjs'
import {
  artifactGroups,
  stampGroup,
  verifyReleaseArtifacts,
  sidecarDigest,
  publishArtifacts,
  verifyMacArchives,
} from '../../../scripts/release-artifacts.mjs'
import {
  requireMacArchitectures,
  verifyMacApp,
  isActiveMacAddon,
} from '../../../scripts/verify-mac-architecture.mjs'
import { verifyDownload } from '../../../scripts/verify-release-downloads.mjs'
import { writePayloadManifest } from '../../../scripts/write-payload-manifest.mjs'
import { probe, verdictForProbe } from '../../../scripts/verify-manifests.mjs'

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'loklm-release-'))
  dirs.push(dir)
  return dir
}
const identity = {
  version: '0.7.1',
  baseUrl: 'https://downloads.example/v0.7.1',
  sourceSha: 'a'.repeat(40),
}
async function releaseFixture() {
  const dir = await temp()
  for (const [group, names] of Object.entries(artifactGroups)) {
    for (const name of names) await writeFile(join(dir, name), `fixture ${name}`)
    await stampGroup(dir, group)
  }
  for (const name of ['windows', 'linux', 'macos']) {
    await writePayloadManifest({
      releaseDir: dir,
      outFile: join(dir, `manifest-${name}.json`),
      ...identity,
    })
  }
  return dir
}

describe('release preflight', () => {
  const config = { eventName: 'push', ref: 'refs/tags/v0.7.1', packageVersion: '0.7.1' }
  it('matches the tag and dispatch to package metadata', () => {
    expect(releaseVersion(config)).toBe('0.7.1')
    expect(
      releaseVersion({ ...config, eventName: 'workflow_dispatch', requestedVersion: '0.7.1' }),
    ).toBe('0.7.1')
  })
  it.each(['0.7.0', '0.7.1-rc.1', '01.7.1', '0.7.1/../x', '0.7.1\nother=x', '0.7.1; echo x'])(
    'rejects mismatched or unsafe version %j',
    (version) => {
      expect(() => releaseVersion({ ...config, ref: `refs/tags/v${version}` })).toThrow()
    },
  )
  it('rejects branch pushes and partial releases', () => {
    expect(() => releaseVersion({ ...config, ref: 'refs/heads/main' })).toThrow()
    expect(() => releaseVersion({ ...config, platforms: 'windows' })).toThrow(/Partial/)
  })
  it('validates HTTPS public URLs without credential/query leakage', () => {
    expect(publicReleaseBase('https://downloads.example/installers/', '0.7.1')).toBe(
      'https://downloads.example/installers/v0.7.1',
    )
    for (const base of [
      'http://x.test',
      'https://user:password@x.test',
      'https://x.test?token=secret',
      'https://x.test/#fragment',
    ]) {
      expect(() => publicReleaseBase(base, '0.7.1')).toThrow()
    }
  })
})

describe('complete immutable release artifacts', () => {
  it('requires both unchanged Mac archives before a universal wizard can be built', async () => {
    const dir = await releaseFixture()
    await expect(verifyMacArchives(dir)).resolves.toBeUndefined()
    await writeFile(join(dir, 'payload-mac-x64.tar.zst'), 'changed architecture payload')
    await expect(verifyMacArchives(dir)).rejects.toThrow(/checksum/)
    await rm(join(dir, 'payload-mac-x64.tar.zst'))
    await expect(verifyMacArchives(dir)).rejects.toThrow()
  })
  it('verifies every artifact and the exact manifests baked into each wizard', async () => {
    const dir = await releaseFixture()
    const index = await verifyReleaseArtifacts(dir, identity)
    expect(index.artifacts).toHaveLength(10)
    expect(new Set(index.artifacts.map((a) => a.filename)).size).toBe(10)
    expect(index).toMatchObject(identity)
  })
  it('fails if one platform is missing or an artifact changes after stamping', async () => {
    const dir = await releaseFixture()
    await writeFile(join(dir, 'LokLM-mac.dmg'), 'changed')
    await expect(verifyReleaseArtifacts(dir, identity)).rejects.toThrow(/checksum/)
    await rm(join(dir, 'LokLM-mac.dmg'))
    await expect(verifyReleaseArtifacts(dir, identity)).rejects.toThrow()
  })
  it.each(['version', 'baseUrl', 'sha256', 'sizeBytes', 'filename'])(
    'rejects stale baked %s',
    async (field) => {
      const dir = await releaseFixture()
      const path = join(dir, 'manifest-macos.json')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      if (field === 'version' || field === 'baseUrl') manifest[field] = 'wrong'
      else manifest.platforms['mac-x64'].payload[field] = field === 'sizeBytes' ? 0 : 'wrong'
      await writeFile(path, JSON.stringify(manifest))
      await expect(verifyReleaseArtifacts(dir, identity)).rejects.toThrow(/manifest/)
    },
  )
  it('requires valid checksum sidecar identities', () => {
    const hash = 'b'.repeat(64)
    expect(sidecarDigest(`${hash}  payload.tar.zst\n`, 'payload.tar.zst')).toBe(hash)
    expect(() => sidecarDigest(`${hash}  other`, 'payload.tar.zst')).toThrow()
    expect(() => sidecarDigest('deadbeef', 'payload.tar.zst')).toThrow()
  })
  it('refuses any existing prefix or unavailable listing without writes', async () => {
    const dir = await releaseFixture()
    const index = await verifyReleaseArtifacts(dir, identity)
    for (const run of [
      vi.fn(() => '{"key":"old"}\n'),
      vi.fn(() => {
        throw new Error('network/auth')
      }),
    ]) {
      await expect(publishArtifacts(dir, index, run)).rejects.toThrow()
      expect(run).toHaveBeenCalledTimes(1)
      expect(run.mock.calls[0][1].slice(0, 3)).toEqual(['ls', '--json', '--recursive'])
    }
  })
  it('uploads only all allowlisted files and index after an empty successful listing', async () => {
    const dir = await releaseFixture()
    const index = await verifyReleaseArtifacts(dir, identity)
    const run = vi.fn(() => '')
    await publishArtifacts(dir, index, run)
    expect(run).toHaveBeenCalledTimes(22)
    expect(run.mock.calls.slice(1).every((call) => call[1][0] === 'cp')).toBe(true)
  })
  it('propagates upload failure and never proceeds to later files', async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => {
        throw new Error('upload failed')
      })
    await expect(
      publishArtifacts(
        'unused',
        { version: identity.version, artifacts: [{ filename: 'LokLM-x64.exe' }] },
        run,
      ),
    ).rejects.toThrow(/upload failed/)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('native Mac payload and universal wizard verification', () => {
  it.each(['arm64', 'x64'])(
    'selects only the known %s node-llama-cpp prebuilt package layout',
    (arch) => {
      const root = '/app/node_modules/@node-llama-cpp'
      for (const [name, selected] of [
        ['mac-arm64-metal', arch === 'arm64'],
        ['mac-x64', arch === 'x64'],
      ]) {
        const path = `${root}/${name}/bins/${name}/llama-addon.node`
        expect(isActiveMacAddon(path, arch)).toBe(selected)
        expect(isActiveMacAddon(path.replaceAll('/', '\\'), arch)).toBe(selected)
        expect(isActiveMacAddon(path, 'universal')).toBe(true)
        expect(isActiveMacAddon(`${root}/${name}/unknown/llama-addon.node`, arch)).toBe(true)
        expect(isActiveMacAddon(`${root}/${name}/bins/${name}/other.node`, arch)).toBe(true)
      }
      expect(isActiveMacAddon(`${root}/mac-x64/bins/mac-arm64-metal/llama-addon.node`, arch)).toBe(
        true,
      )
      expect(isActiveMacAddon(`${root}/unknown/prebuilds/linux-x64/addon.node`, arch)).toBe(true)
      expect(
        isActiveMacAddon('/app/node-llama-cpp/bins/mac-arm64-metal/llama-addon.node', arch),
      ).toBe(true)
    },
  )

  it.each(['arm64', 'x64'])(
    'checks the active %s llama binding and still rejects a wrong-architecture active binary',
    async (arch) => {
      const dir = await temp()
      const unpacked = join(dir, 'Contents', 'Resources', 'app.asar.unpacked')
      const paths = new Map()
      for (const name of ['mac-arm64-metal', 'mac-x64']) {
        const folder = join(unpacked, 'node_modules', '@node-llama-cpp', name, 'bins', name)
        await mkdir(folder, { recursive: true })
        const path = join(folder, 'llama-addon.node')
        await writeFile(path, 'fixture')
        paths.set(name, path)
      }
      const sqlite = join(unpacked, 'better_sqlite3.node')
      await writeFile(sqlite, 'fixture')
      const selected = paths.get(arch === 'arm64' ? 'mac-arm64-metal' : 'mac-x64')
      const expectedArch = arch === 'x64' ? 'x86_64' : 'arm64'
      const run = vi.fn((_command, args) => {
        if ([...paths.values()].includes(args[1]) && args[1] !== selected)
          throw new Error('Inactive binding must not be inspected')
        return expectedArch
      })
      await expect(verifyMacApp(dir, arch, { run })).resolves.toBeUndefined()
      expect(run.mock.calls.map((call) => call[1][1]).sort()).toEqual(
        [join(dir, 'Contents', 'MacOS', 'LokLM'), sqlite, selected].sort(),
      )
      run.mockImplementation((_command, args) =>
        args[1] === selected ? (arch === 'arm64' ? 'x86_64' : 'arm64') : expectedArch,
      )
      await expect(verifyMacApp(dir, arch, { run })).rejects.toThrow(
        `Invalid packaged Mac binary ${selected}: Mach-O architectures`,
      )
      run.mockImplementation((_command, args) =>
        args[1] === selected ? expectedArch : 'arm64 x86_64',
      )
      await expect(verifyMacApp(dir, 'universal', { run })).rejects.toThrow(
        `Invalid packaged Mac binary ${selected}: Mach-O architectures`,
      )
    },
  )

  it.each(['arm64', 'x64'])(
    'selects only %s Whisper assets from its known multi-platform dist layout',
    (arch) => {
      const root = '/app/node_modules/@kutalia/whisper-node-addon/dist'
      expect(isActiveMacAddon(`${root}/linux-x64/whisper.node`, arch)).toBe(false)
      expect(isActiveMacAddon(`${root}/win32-x64/whisper.node`, arch)).toBe(false)
      expect(isActiveMacAddon(`${root}/mac-${arch}/whisper.node`, arch)).toBe(true)
      expect(
        isActiveMacAddon(`${root}/mac-${arch === 'arm64' ? 'x64' : 'arm64'}/whisper.node`, arch),
      ).toBe(false)
      expect(isActiveMacAddon(`${root}/unknown/whisper.node`, arch)).toBe(true)
      expect(isActiveMacAddon('/app/node_modules/other/dist/linux-x64/addon.node', arch)).toBe(true)
    },
  )

  it.each(['arm64', 'x64'])(
    'inspects the active %s Whisper binary and SQLite but not inactive foreign assets',
    async (arch) => {
      const dir = await temp()
      const unpacked = join(dir, 'Contents', 'Resources', 'app.asar.unpacked')
      const whisper = join(unpacked, 'node_modules', '@kutalia', 'whisper-node-addon', 'dist')
      for (const tuple of ['linux-x64', 'win32-x64', 'mac-arm64', 'mac-x64']) {
        await mkdir(join(whisper, tuple), { recursive: true })
        await writeFile(join(whisper, tuple, 'whisper.node'), 'fixture')
      }
      await writeFile(join(unpacked, 'better_sqlite3.node'), 'fixture')
      const selected = join(whisper, `mac-${arch}`, 'whisper.node')
      const expectedArch = arch === 'x64' ? 'x86_64' : 'arm64'
      const run = vi.fn((_command, args) => {
        if (args[1].startsWith(whisper) && args[1] !== selected)
          throw new Error('Foreign asset cannot be inspected with lipo')
        return expectedArch
      })
      await expect(verifyMacApp(dir, arch, { run })).resolves.toBeUndefined()
      expect(run.mock.calls.map((call) => call[1][1]).sort()).toEqual(
        [
          join(dir, 'Contents', 'MacOS', 'LokLM'),
          join(unpacked, 'better_sqlite3.node'),
          selected,
        ].sort(),
      )
      run.mockImplementation((_command, args) =>
        args[1] === selected ? (arch === 'arm64' ? 'x86_64' : 'arm64') : expectedArch,
      )
      await expect(verifyMacApp(dir, arch, { run })).rejects.toThrow(
        `Invalid packaged Mac binary ${selected}: Mach-O architectures`,
      )
    },
  )

  it('distinguishes selected bindings from inactive multi-platform prebuilds', () => {
    expect(isActiveMacAddon('/app/argon2/prebuilds/darwin-arm64/argon2.node', 'arm64')).toBe(true)
    expect(isActiveMacAddon('/app/argon2/prebuilds/darwin-x64/argon2.node', 'arm64')).toBe(false)
    expect(isActiveMacAddon('/app/sodium-native/prebuilds/win32-x64/sodium.node', 'x64')).toBe(
      false,
    )
    expect(isActiveMacAddon('/app/native/prebuilds/darwin-x64+arm64/addon.node', 'x64')).toBe(true)
    expect(isActiveMacAddon('/app/better-sqlite3/build/Release/better_sqlite3.node', 'arm64')).toBe(
      true,
    )
  })
  it('checks the executable declared by the actual wizard bundle', async () => {
    const run = vi.fn().mockReturnValueOnce('loklm\n').mockReturnValueOnce('arm64 x86_64\n')
    await expect(
      verifyMacApp('fixture.app', 'universal', { wizard: true, run }),
    ).resolves.toBeUndefined()
    expect(run.mock.calls[0][0]).toBe('/usr/libexec/PlistBuddy')
    expect(run.mock.calls[1][1][1]).toContain(join('Contents', 'MacOS', 'loklm'))
  })
  it('rejects a host-only wizard and a wrong-architecture addon', () => {
    expect(() => requireMacArchitectures('arm64', ['arm64', 'x86_64'])).toThrow()
    expect(() => requireMacArchitectures('x86_64 arm64', ['arm64', 'x86_64'])).not.toThrow()
    expect(() => requireMacArchitectures('arm64', ['x86_64'])).toThrow()
  })
  it('inspects the app binary and every unpacked native binding, requiring SQLite', async () => {
    const dir = await temp()
    const unpacked = join(dir, 'Contents', 'Resources', 'app.asar.unpacked')
    await mkdir(unpacked, { recursive: true })
    await writeFile(join(unpacked, 'better_sqlite3.node'), 'fixture')
    await writeFile(join(unpacked, 'other.node'), 'fixture')
    const run = vi.fn((_command, args) => (args[1].endsWith('other.node') ? 'x86_64' : 'arm64'))
    await expect(verifyMacApp(dir, 'arm64', { run })).rejects.toThrow(/architectures/)
    await rm(join(unpacked, 'better_sqlite3.node'))
    await mkdir(join(unpacked, 'prebuilds', 'win32-x64'), { recursive: true })
    await writeFile(
      join(unpacked, 'prebuilds', 'win32-x64', 'better_sqlite3.node'),
      'foreign fixture',
    )
    await expect(verifyMacApp(dir, 'arm64', { run })).rejects.toThrow(/SQLite/)
  })
})

describe('public release verification', () => {
  const bytes = Buffer.from('public bytes')
  const artifact = {
    filename: 'LokLM-x64.exe',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  it('requires a usable response and finite content size in strict release probes', () => {
    for (const totalSize of [null, NaN, Infinity, -1, 0]) {
      expect(verdictForProbe({ status: 200, totalSize, expectedSize: 100, strict: true }).ok).toBe(
        false,
      )
    }
    expect(
      verdictForProbe({ status: 304, totalSize: 100, expectedSize: 100, strict: true }).ok,
    ).toBe(false)
    expect(
      verdictForProbe({ status: 200, totalSize: 100, expectedSize: 100, strict: true }).ok,
    ).toBe(true)
  })
  it('checks exact downloaded bytes, rejecting HTTP/size/digest failures', async () => {
    await expect(
      verifyDownload('https://example.test/app', artifact, async () => new Response(bytes)),
    ).resolves.toBeUndefined()
    for (const response of [
      new Response('missing', { status: 404 }),
      new Response('bad'),
      new Response('x'.repeat(bytes.length)),
      new Response('x'.repeat(bytes.length + 1)),
    ]) {
      await expect(
        verifyDownload('https://example.test/app', artifact, async () => response),
      ).rejects.toThrow()
    }
  })
  it('probes a missing HEAD length with a range GET and cancels the body', async () => {
    const cancel = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce({
        status: 206,
        headers: new Headers({ 'content-range': 'bytes 0-0/1024', 'content-length': '1' }),
        body: { cancel },
      })
    expect(await probe('https://example.test/model', fetcher)).toEqual({
      status: 200,
      totalSize: 1024,
    })
    expect(fetcher.mock.calls[1][1].headers.Range).toBe('bytes=0-0')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
