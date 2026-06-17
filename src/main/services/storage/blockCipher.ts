import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'

// Block-level AES-256-GCM for the per-workspace vector store (ADR-0005).
//
// Why blocks and not one big AES-GCM(file): the whole point of moving to a
// disk-resident ANN index is that a query touches only a handful of pages.
// Encrypting the file as one ciphertext would force a full decrypt on every
// open — exactly the "decrypt the whole vault each time" cost we are trying to
// shed. Page/block-level encryption decrypts only the blocks a read actually
// hits, the same trade SQLCipher makes for SQLite (per-page AES) and the only
// construction that keeps random-access ANN affordable at 100–500 M vectors.
//
// On-disk layout of one encrypted block:
//
//   nonce(12) │ tag(16) │ ciphertext(len == plaintext len, GCM is a stream cipher)
//
// - nonce: fresh 96-bit random per write. Blocks are rewritten in place as the
//   index mutates, so a deterministic counter nonce would risk (key, nonce)
//   reuse across rewrites of the same block index; a fresh random nonce per
//   write sidesteps that entirely. Birthday bound at 2^96 is irrelevant for a
//   single-user local store.
// - tag: GCM auth tag — tamper detection AND wrong-key detection, same as the
//   vault body in ADR-0002. No separate verifier.
// - AAD = fileId ‖ blockIndex(uint64 BE). Binds each block to its position in a
//   specific file so an attacker cannot relocate a block within the file or
//   swap blocks between two files (both encrypted under the same workspace key)
//   without the tag check failing. GCM gives confidentiality from the key and
//   positional integrity from the AAD.

export const BLOCK_PLAINTEXT_BYTES = 64 * 1024 // 64 KiB plaintext per block
export const NONCE_BYTES = 12
export const TAG_BYTES = 16
/** Fixed framing overhead a block adds on disk beyond its plaintext. */
export const BLOCK_OVERHEAD_BYTES = NONCE_BYTES + TAG_BYTES

const AES_ALGO = 'aes-256-gcm' as const

/** AAD for a block = utf8(fileId) ‖ uint64-BE(blockIndex). */
function blockAad(fileId: string, blockIndex: number): Buffer {
  const id = Buffer.from(fileId, 'utf8')
  const idx = Buffer.alloc(8)
  idx.writeBigUInt64BE(BigInt(blockIndex), 0)
  return Buffer.concat([id, idx])
}

/**
 * Encrypts one block. `key` is the 32-byte per-workspace data key (WDEK).
 * Returns nonce ‖ tag ‖ ciphertext. Pure — no I/O — so it is unit-testable in
 * isolation from the file layer.
 */
export function encryptBlock(
  key: Buffer,
  fileId: string,
  blockIndex: number,
  plaintext: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error(`WDEK must be 32 bytes, got ${key.length}`)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(AES_ALGO, key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(blockAad(fileId, blockIndex))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, tag, ct])
}

/**
 * Decrypts one stored block (nonce ‖ tag ‖ ciphertext). Throws on a tag
 * mismatch (tamper, wrong key, or a block read at the wrong index/file). The
 * throw — rather than a null return — matches how a corrupt page would surface
 * from a real storage engine; callers treat it as fatal for that block.
 */
export function decryptBlock(
  key: Buffer,
  fileId: string,
  blockIndex: number,
  stored: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error(`WDEK must be 32 bytes, got ${key.length}`)
  if (stored.length < BLOCK_OVERHEAD_BYTES) {
    throw new Error(`block ${fileId}#${blockIndex} too short (${stored.length} bytes)`)
  }
  const nonce = stored.subarray(0, NONCE_BYTES)
  const tag = stored.subarray(NONCE_BYTES, BLOCK_OVERHEAD_BYTES)
  const ct = stored.subarray(BLOCK_OVERHEAD_BYTES)
  const decipher = createDecipheriv(AES_ALGO, key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAAD(blockAad(fileId, blockIndex))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/** On-disk size of a full encrypted block (constant for every block but the
 *  last, which is shorter when the plaintext does not fill BLOCK_PLAINTEXT_BYTES). */
export const FULL_BLOCK_DISK_BYTES = BLOCK_OVERHEAD_BYTES + BLOCK_PLAINTEXT_BYTES

/**
 * A random-access, block-encrypted file.
 *
 * This is the seam the LanceDB ObjectStore adapter (see LanceWorkspaceStore)
 * will read and write through, so the engine's files land on disk encrypted
 * under the workspace key without the engine knowing. Here it is implemented
 * with plain `fs` positional reads/writes — correct and testable. The
 * memory-mapped fast path (decrypt-on-page-fault) is the performance follow-up
 * tracked in ADR-0005 §Folgearbeiten; functionally the API is identical.
 *
 * Every block stored on disk is a full FULL_BLOCK_DISK_BYTES frame except a
 * trailing partial block, so block N starts at byte N * FULL_BLOCK_DISK_BYTES
 * — fixed-stride addressing, no index needed.
 */
export class EncryptedBlockFile {
  private constructor(
    private readonly handle: fs.FileHandle,
    private readonly key: Buffer,
    private readonly fileId: string,
  ) {}

  /** Opens (creating if absent) an encrypted block file. `fileId` must be
   *  stable for the life of the file — it is bound into every block's AAD. */
  static async open(path: string, key: Buffer, fileId: string): Promise<EncryptedBlockFile> {
    const handle = await fs.open(path, 'a+', 0o600)
    return new EncryptedBlockFile(handle, key, fileId)
  }

  /** Reads and decrypts block `index`. Returns null past end-of-file. */
  async readBlock(index: number): Promise<Buffer | null> {
    const start = index * FULL_BLOCK_DISK_BYTES
    const frame = Buffer.alloc(FULL_BLOCK_DISK_BYTES)
    const { bytesRead } = await this.handle.read(frame, 0, FULL_BLOCK_DISK_BYTES, start)
    if (bytesRead === 0) return null
    return decryptBlock(this.key, this.fileId, index, frame.subarray(0, bytesRead))
  }

  /** Encrypts and writes block `index` at its fixed offset. `plaintext` must be
   *  at most BLOCK_PLAINTEXT_BYTES; only the final block may be shorter. */
  async writeBlock(index: number, plaintext: Buffer): Promise<void> {
    if (plaintext.length > BLOCK_PLAINTEXT_BYTES) {
      throw new Error(`block plaintext ${plaintext.length} > ${BLOCK_PLAINTEXT_BYTES}`)
    }
    const frame = encryptBlock(this.key, this.fileId, index, plaintext)
    await this.handle.write(frame, 0, frame.length, index * FULL_BLOCK_DISK_BYTES)
  }

  async sync(): Promise<void> {
    await this.handle.sync()
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}
