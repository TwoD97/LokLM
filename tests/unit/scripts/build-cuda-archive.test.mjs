import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { buildCudaArchive } from '../../../scripts/build-cuda-archive.mjs'

async function walk(dir, base, out = new Map()) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) await walk(full, base, out)
    else if (st.isFile())
      out.set(
        relative(base, full).replace(/\\/g, '/'),
        createHash('sha256').update(await readFile(full)).digest('hex'),
      )
  }
  return out
}

let work, cudaSrc, fakePayload, stripped
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'loklm-cuda-test-'))
  cudaSrc = join(work, 'cuda-src')
  await mkdir(join(cudaSrc, 'win-x64-cuda/bins'), { recursive: true })
  await mkdir(join(cudaSrc, 'win-x64-cuda-ext/bins'), { recursive: true })
  await writeFile(join(cudaSrc, 'win-x64-cuda/bins/llama.node'), 'cuda-binary')
  await writeFile(join(cudaSrc, 'win-x64-cuda-ext/bins/cublas.dll'), 'cublas-binary')

  fakePayload = join(work, 'full-payload')
  stripped = join(work, 'stripped-payload')
  const baseNode = 'win-unpacked/resources/app.asar.unpacked/node_modules/@node-llama-cpp'
  for (const variant of ['win-x64', 'win-x64-vulkan']) {
    await mkdir(join(fakePayload, baseNode, variant, 'bins'), { recursive: true })
    await mkdir(join(stripped, baseNode, variant, 'bins'), { recursive: true })
    await writeFile(join(fakePayload, baseNode, variant, 'bins/llama.node'), `${variant}-binary`)
    await writeFile(join(stripped, baseNode, variant, 'bins/llama.node'), `${variant}-binary`)
  }
  await mkdir(join(fakePayload, baseNode, 'win-x64-cuda/bins'), { recursive: true })
  await mkdir(join(fakePayload, baseNode, 'win-x64-cuda-ext/bins'), { recursive: true })
  await writeFile(join(fakePayload, baseNode, 'win-x64-cuda/bins/llama.node'), 'cuda-binary')
  await writeFile(join(fakePayload, baseNode, 'win-x64-cuda-ext/bins/cublas.dll'), 'cublas-binary')
})
afterAll(() => rm(work, { recursive: true, force: true }))

it('cuda archive extracted onto stripped payload reproduces full payload bit-for-bit', async () => {
  const out = join(work, 'cuda-win-x64.tar.zst')
  await buildCudaArchive({
    platform: 'win-x64',
    cudaSourceRoot: cudaSrc,
    payloadRoot: 'win-unpacked/resources/app.asar.unpacked/node_modules/@node-llama-cpp',
    outFile: out,
  })

  const tar = await import('tar-stream')
  const zstd = await import('@mongodb-js/zstd')
  const compressed = await readFile(out)
  const raw = await zstd.decompress(compressed)
  const extract = tar.extract()
  const writes = []
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const dest = join(stripped, header.name)
      writes.push(
        (async () => {
          await mkdir(join(dest, '..'), { recursive: true })
          const chunks = []
          for await (const c of stream) chunks.push(c)
          await writeFile(dest, Buffer.concat(chunks))
        })(),
      )
      stream.on('end', next)
    })
    extract.on('finish', resolve).on('error', reject)
    extract.end(raw)
  })
  await Promise.all(writes)

  const expectedTree = await walk(fakePayload, fakePayload)
  const actualTree = await walk(stripped, stripped)
  expect(Object.fromEntries(actualTree)).toEqual(Object.fromEntries(expectedTree))
})

it('rejects mac-* platform keys', async () => {
  await expect(
    buildCudaArchive({
      platform: 'mac-arm64',
      cudaSourceRoot: cudaSrc,
      payloadRoot: 'irrelevant',
      outFile: join(work, 'nope.tar.zst'),
    }),
  ).rejects.toThrow(/no cuda build target on mac/i)
})
