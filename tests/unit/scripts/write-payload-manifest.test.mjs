import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePayloadManifest } from '../../../scripts/write-payload-manifest.mjs'

let work
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'loklm-manifest-test-'))
  const rel = join(work, 'release')
  await mkdir(rel, { recursive: true })
  await writeFile(join(rel, 'payload-win-x64.tar.zst'), 'A'.repeat(100))
  await writeFile(join(rel, 'payload-win-x64.tar.zst.sha256'), 'deadbeef\n')
  await writeFile(join(rel, 'cuda-win-x64.tar.zst'), 'B'.repeat(50))
  await writeFile(join(rel, 'cuda-win-x64.tar.zst.sha256'), 'cafef00d\n')
  await writeFile(join(rel, 'payload-mac-arm64.tar.zst'), 'C'.repeat(30))
  await writeFile(join(rel, 'payload-mac-arm64.tar.zst.sha256'), '1234abcd\n')
})
afterAll(() => rm(work, { recursive: true, force: true }))

it('emits real hashes for available archives + zero placeholders for missing', async () => {
  const out = join(work, 'payload-manifest.json')
  await writePayloadManifest({
    releaseDir: join(work, 'release'),
    outFile: out,
    version: '0.3.0',
    baseUrl: 'https://cdn.loklm.test/v0.3.0',
  })
  const json = JSON.parse(await readFile(out, 'utf8'))
  expect(json.version).toBe('0.3.0')

  // Real hashes for archives present on disk.
  expect(json.platforms['win-x64'].payload.sha256).toBe('deadbeef')
  expect(json.platforms['win-x64'].payload.sizeBytes).toBe(100)
  expect(json.platforms['win-x64'].cuda.sha256).toBe('cafef00d')
  expect(json.platforms['mac-arm64'].payload.sha256).toBe('1234abcd')

  // Mac never has a cuda field ( neither real nor placeholder ) — the
  // platform-block shape encodes the "no cuda on mac" invariant for the
  // Rust reader's typed Option<CudaEntry>.
  expect(json.platforms['mac-arm64']).not.toHaveProperty('cuda')
  expect(json.platforms['mac-x64']).not.toHaveProperty('cuda')

  // Always-4-platforms invariant : ensures the Rust unit tests still
  // find their target platform when a local build only produced one
  // platform's archives. linux-x64 + mac-x64 should be zeroed-out
  // placeholders here.
  const zero = '0000000000000000000000000000000000000000000000000000000000000000'
  expect(json.platforms['linux-x64'].payload.sha256).toBe(zero)
  expect(json.platforms['linux-x64'].cuda.sha256).toBe(zero)
  expect(json.platforms['mac-x64'].payload.sha256).toBe(zero)
})
