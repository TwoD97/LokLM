import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedBlockFile, BLOCK_PLAINTEXT_BYTES } from '@main/services/storage/blockCipher'
import { writeAll } from '@main/services/storage/fileIo'

let directory: string | undefined
afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('encrypted positional file I/O', () => {
  it('replaces a block in place and keeps adjacent blocks across reopening', async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'loklm-blocks-'))
    const path = join(directory, 'fixture')
    const key = Buffer.alloc(32, 42)
    const first = Buffer.alloc(BLOCK_PLAINTEXT_BYTES, 1)
    const second = Buffer.alloc(BLOCK_PLAINTEXT_BYTES, 2)
    const replacement = Buffer.alloc(BLOCK_PLAINTEXT_BYTES, 3)
    const file = await EncryptedBlockFile.open(path, key, 'fixture')
    let initial!: Stats
    try {
      await file.writeBlock(0, first)
      await file.writeBlock(1, second)
      initial = await fs.stat(path)
      await file.writeBlock(0, replacement)
      expect(await file.readBlock(0)).toEqual(replacement)
      expect(await file.readBlock(1)).toEqual(second)
      expect((await fs.stat(path)).size).toBe(initial.size)
    } finally {
      await file.close()
    }
    const reopened = await EncryptedBlockFile.open(path, key, 'fixture')
    try {
      expect(await reopened.readBlock(0)).toEqual(replacement)
      expect(await reopened.readBlock(1)).toEqual(second)
      expect(await reopened.readBlock(2)).toBeNull()
    } finally {
      await reopened.close()
    }
  })

  it('rejects a zero-byte write instead of spinning forever', async () => {
    const file = { write: async () => ({ bytesWritten: 0 }) } as unknown as fs.FileHandle
    await expect(writeAll(file, Buffer.from('payload'), 0)).rejects.toThrow('made no progress')
  })

  it('shrinks the final block without leaving unauthenticated trailing ciphertext', async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'loklm-blocks-'))
    const path = join(directory, 'fixture')
    const file = await EncryptedBlockFile.open(path, Buffer.alloc(32, 42), 'fixture')
    try {
      const first = Buffer.alloc(BLOCK_PLAINTEXT_BYTES, 1)
      await file.writeBlock(0, first)
      await file.writeBlock(1, Buffer.alloc(BLOCK_PLAINTEXT_BYTES, 2))
      await expect(file.writeBlock(0, Buffer.from('short'))).rejects.toThrow('Only the final')
      expect(await file.readBlock(0)).toEqual(first)
      for (const replacement of [Buffer.from('short final block'), Buffer.from('tiny')]) {
        await file.writeBlock(1, replacement)
        expect(await file.readBlock(0)).toEqual(first)
        expect(await file.readBlock(1)).toEqual(replacement)
        expect(await file.readBlock(2)).toBeNull()
      }
    } finally {
      await file.close()
    }
  })
})
