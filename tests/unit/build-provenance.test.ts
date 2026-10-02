import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { inspectBuildProvenance } from '../e2e/helpers/buildProvenance'

const { runProvenanceBuild } = createRequire(import.meta.url)('../bench/build-provenance.cjs') as {
  runProvenanceBuild(root: string, build: () => Promise<void>): Promise<unknown>
}
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loklm-provenance-test-'))
  for (const dir of ['src', 'patches', 'out/main', 'out/preload', 'out/renderer'])
    await mkdir(join(root, dir), { recursive: true })
  for (const [path, text] of Object.entries({
    'src/app.ts': 'export const value = 1',
    'package.json': '{}',
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'patches/dep.patch': 'patch v1',
    'out/main/index.js': 'main v1',
    'out/preload/index.cjs': 'preload v1',
    'out/renderer/index.html': '<main>hello</main>',
    'out/renderer/style.css': 'body{}',
  }))
    await writeFile(join(root, path), text)
})
afterEach(async () => {
  const target = resolve(root)
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('loklm-provenance-test-')
  )
    throw new Error('Unsafe test cleanup path')
  await rm(target, { recursive: true, force: true })
})

describe('optional native build provenance', () => {
  it('marks missing provenance unknown and records exact source/output identity after a successful build', async () => {
    expect(await inspectBuildProvenance(root)).toEqual({
      status: 'unknown',
      reason: 'manifest-missing',
    })
    await runProvenanceBuild(root, async () => undefined)
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'matched',
      currentSourcesMatchBuild: true,
      changedCurrentSourcePaths: [],
    })
    const manifest = JSON.parse(await readFile(join(root, 'out/build-provenance.json'), 'utf8'))
    expect(Object.keys(manifest.sourceHashes)).toContain('patches/dep.patch')
    expect(Object.keys(manifest.compiledHashes)).toContain('out/renderer/style.css')
  })
  it('preserves runtime build identity when current source, lock and patch edits have not been built', async () => {
    await runProvenanceBuild(root, async () => undefined)
    await writeFile(join(root, 'src/app.ts'), 'unbuilt source')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'unbuilt lock')
    await writeFile(join(root, 'patches/dep.patch'), 'unbuilt patch')
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'matched',
      currentSourcesMatchBuild: false,
      changedCurrentSourcePaths: ['patches/dep.patch', 'pnpm-lock.yaml', 'src/app.ts'],
    })
  })
  it('rejects a stale manifest after renderer output is tampered with', async () => {
    await runProvenanceBuild(root, async () => undefined)
    await writeFile(join(root, 'out/renderer/style.css'), 'tampered')
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'unknown',
      reason: 'compiled-output-mismatch',
      changedCompiledPaths: ['out/renderer/style.css'],
    })
  })
  it('fails explicit build recording if an input changes during compilation', async () => {
    await expect(
      runProvenanceBuild(root, async () => {
        await writeFile(join(root, 'src/app.ts'), 'concurrent edit')
      }),
    ).rejects.toThrow(/changed during compilation/)
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'unknown',
      reason: 'manifest-missing',
    })
  })
  it('does not attest failed builds or ignore extra compiled output', async () => {
    await expect(
      runProvenanceBuild(root, async () => {
        throw new Error('compile failed')
      }),
    ).rejects.toThrow('compile failed')
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'unknown',
      reason: 'manifest-missing',
    })
    await runProvenanceBuild(root, async () => undefined)
    await writeFile(join(root, 'out/main/new-chunk.js'), 'unexpected')
    expect(await inspectBuildProvenance(root)).toMatchObject({
      status: 'unknown',
      reason: 'compiled-output-mismatch',
      changedCompiledPaths: ['out/main/new-chunk.js'],
    })
  })
})
