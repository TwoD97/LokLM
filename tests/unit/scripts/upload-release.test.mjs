import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planUploads, runDryRun } from '../../../scripts/upload-release.mjs'

let work
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'loklm-upload-test-'))
  const rel = join(work, 'release')
  await mkdir(rel, { recursive: true })
  await writeFile(join(rel, 'payload-win-x64.tar.zst'), 'A')
  await writeFile(join(rel, 'payload-win-x64.tar.zst.sha256'), 'aaa')
  await writeFile(join(rel, 'cuda-win-x64.tar.zst'), 'B')
  await writeFile(join(rel, 'cuda-win-x64.tar.zst.sha256'), 'bbb')
  await writeFile(join(rel, 'payload-mac-arm64.tar.zst'), 'C')
  await writeFile(join(rel, 'payload-mac-arm64.tar.zst.sha256'), 'ccc')
})
afterAll(() => rm(work, { recursive: true, force: true }))

it('plans one PUT per artifact + sidecar per requested platform', async () => {
  const plans = await planUploads({
    releaseDir: join(work, 'release'),
    version: '0.3.0',
    zone: 'loklm-cdn',
    platforms: ['win-x64', 'mac-arm64'],
  })
  const paths = plans.map((p) => p.urlPath)
  expect(paths).toEqual([
    'v0.3.0/payload-win-x64.tar.zst',
    'v0.3.0/payload-win-x64.tar.zst.sha256',
    'v0.3.0/cuda-win-x64.tar.zst',
    'v0.3.0/cuda-win-x64.tar.zst.sha256',
    'v0.3.0/payload-mac-arm64.tar.zst',
    'v0.3.0/payload-mac-arm64.tar.zst.sha256',
  ])
})

it('dry-run never calls fetch', async () => {
  const fetchSpy = vi.fn()
  await runDryRun({
    releaseDir: join(work, 'release'),
    version: '0.3.0',
    zone: 'loklm-cdn',
    platforms: ['win-x64'],
    fetchImpl: fetchSpy,
  })
  expect(fetchSpy).not.toHaveBeenCalled()
})
