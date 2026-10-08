import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearModelInvalid,
  isKnownInvalidModel,
  markModelInvalid,
} from '../../src/main/services/models/modelValidation'

let directory: string
let target: string
const entry = { id: 'test-model', sizeBytes: 8, sha256: 'a'.repeat(64) }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loklm-model-validation-'))
  target = join(directory, 'model.gguf')
  writeFileSync(target, 'original')
})
afterEach(() => {
  clearModelInvalid(target)
  rmSync(directory, { recursive: true, force: true })
})

describe('known model validation failures', () => {
  it('preserves a failed digest across a fresh module instance without changing the model', async () => {
    markModelInvalid(target, entry, statSync(target))
    vi.resetModules()
    const fresh = await import('../../src/main/services/models/modelValidation')
    expect(fresh.isKnownInvalidModel(target, entry, statSync(target))).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('original')
    const metadata = JSON.parse(readFileSync(`${target}.loklm-invalid.json`, 'utf8'))
    expect(Object.keys(metadata).sort()).toEqual([
      'expectedSha',
      'expectedSize',
      'file',
      'id',
      'version',
    ])
  })

  it('does not hide a same-size manual replacement behind stale validation metadata', () => {
    markModelInvalid(target, entry, statSync(target))
    const replacement = join(directory, 'replacement')
    writeFileSync(replacement, 'repaired')
    renameSync(replacement, target)
    expect(isKnownInvalidModel(target, entry, statSync(target))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('repaired')
  })

  it.each(['null', '{}', '{"version":1,"file":{}}', 'invalid json', 'x'.repeat(4097)])(
    'fails closed for malformed or oversized owned metadata (%#)',
    (metadata) => {
      writeFileSync(`${target}.loklm-invalid.json`, metadata)
      expect(isKnownInvalidModel(target, entry, statSync(target))).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('original')
    },
  )

  it('clears metadata after successful validation without changing model bytes', () => {
    markModelInvalid(target, entry, statSync(target))
    clearModelInvalid(target)
    expect(isKnownInvalidModel(target, entry, statSync(target))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('original')
  })
})
