import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { provisionModel, runtimeModels } from '../../../scripts/lib/model-provisioning.mjs'

let root
const content = Buffer.from('a verified model fixture')
const model = {
  filename: 'test.gguf',
  sizeBytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
  url: 'https://example.invalid/model',
}
let options
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loklm-model-test-'))
  options = {
    modelsDir: root,
    searchDirs: [],
    fetchImpl: vi.fn(async () => new globalThis.Response(content)),
  }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runtime model provisioning', () => {
  it('uses independent manifest tiers without a separate translation model', () => {
    for (const tier of ['lite', 'standard', 'pro']) {
      const models = runtimeModels(tier)
      expect(models.filter((m) => m.role === 'llm')).toHaveLength(1)
      expect(models.some((m) => m.role === 'translation')).toBe(false)
      expect(models.some((m) => m.role === 'whisper')).toBe(true)
    }
    expect(runtimeModels('lite').find((m) => m.role === 'llm').filename).toContain('4B')
    expect(runtimeModels('standard').find((m) => m.role === 'embedder').filename).toContain(
      'Qwen3-Embedding',
    )
    expect(runtimeModels('medium')).toEqual(runtimeModels('standard'))
    expect(() => runtimeModels('bad-tier')).toThrow('Unknown')
  })
  it('downloads and verifies once, then skips an intact file', async () => {
    expect(await provisionModel(model, options)).toBe('downloaded and verified')
    expect(await readFile(join(root, model.filename))).toEqual(content)
    expect(await provisionModel(model, options)).toBe('present')
    expect(options.fetchImpl).toHaveBeenCalledOnce()
  })
  it('replaces a same-size corrupt file using a verified installed model', async () => {
    const installed = join(root, 'installed')
    await mkdir(installed)
    await writeFile(join(installed, model.filename), content)
    await writeFile(join(root, model.filename), Buffer.alloc(content.length))
    expect(await provisionModel(model, { ...options, searchDirs: [installed] })).toBe(
      'copied from installed LokLM',
    )
    expect(await readFile(join(root, model.filename))).toEqual(content)
    expect(options.fetchImpl).not.toHaveBeenCalled()
  })
  it('resumes an interrupted download at its byte offset', async () => {
    await writeFile(join(root, `${model.filename}.partial`), content.subarray(0, 5))
    options.fetchImpl.mockResolvedValue(
      new globalThis.Response(content.subarray(5), {
        status: 206,
        headers: { 'Content-Range': `bytes 5-${content.length - 1}/${content.length}` },
      }),
    )
    await provisionModel(model, options)
    expect(options.fetchImpl).toHaveBeenCalledWith(
      model.url,
      expect.objectContaining({ headers: { Range: 'bytes=5-' } }),
    )
    expect(await readFile(join(root, model.filename))).toEqual(content)
  })
  it('overwrites a partial file when the server ignores Range', async () => {
    await writeFile(join(root, `${model.filename}.partial`), content.subarray(0, 5))
    await provisionModel(model, options)
    expect(await readFile(join(root, model.filename))).toEqual(content)
  })
  it('rejects mismatched ranges and corrupt downloads without publishing', async () => {
    options.fetchImpl.mockResolvedValueOnce(
      new globalThis.Response(content, {
        status: 206,
        headers: { 'Content-Range': `bytes 1-${content.length}/${content.length}` },
      }),
    )
    await expect(provisionModel(model, options)).rejects.toThrow('range')
    options.fetchImpl.mockResolvedValueOnce(new globalThis.Response(Buffer.alloc(content.length)))
    await expect(provisionModel(model, options)).rejects.toThrow('verification')
    await expect(readFile(join(root, model.filename))).rejects.toThrow()
    await expect(readFile(join(root, `${model.filename}.partial`))).rejects.toThrow()
  })
  it('publishes a completed verified partial and rejects escaping filenames', async () => {
    await writeFile(join(root, `${model.filename}.partial`), content)
    expect(await provisionModel(model, options)).toBe('resumed')
    await expect(
      provisionModel({ ...model, filename: '../outside.gguf' }, options),
    ).rejects.toThrow('escapes')
    expect(options.fetchImpl).not.toHaveBeenCalled()
  })
})
