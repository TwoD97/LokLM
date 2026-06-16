import { promises as fs } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import {
  encryptBlock,
  decryptBlock,
  BLOCK_PLAINTEXT_BYTES,
  BLOCK_OVERHEAD_BYTES,
} from './blockCipher'

// Decrypt-on-open / encrypt-on-close for one workspace's files (ADR-0005 §3, Q3).
//
// LanceDB OSS exposes no JS hook to encrypt its file I/O, so instead of
// encrypting *inside* the engine we encrypt the workspace's files **at rest** and
// materialise a plaintext working copy only while the workspace is open:
//
//   <root>/workspaces/ws-<id>/
//     enc/            ← at-rest: every file as a stream of AES-256-GCM blocks
//     work/           ← runtime: plaintext, 0700, wiped on close
//
// Only the active workspace is ever decrypted, so the cost is bounded by one
// workspace (typically a few GB) rather than the whole 100–500 GB corpus — the
// exact pain the single-vault model had. The trade (accepted, Q3): while open,
// the files are plaintext in `work/`; at rest everything is encrypted.
//
// Per-file at-rest format:
//   MAGIC "LWSF1\0\0\0" (8) │ blockSize uint32 BE (4) │ originalSize uint64 BE (8)
//   then ceil(originalSize/blockSize) frames, each = nonce(12) ‖ tag(16) ‖ ct.
// AAD per block = relPath ‖ blockIndex (blockCipher binds both), so a block
// cannot be moved between files or positions without failing its GCM tag.

const FILE_MAGIC = Buffer.from('LWSF1\0\0\0') // 8 bytes
const FILE_HEADER_BYTES = FILE_MAGIC.length + 4 + 8 // magic + blockSize + originalSize

/** POSIX-style relative path, stable across platforms — bound into each block's
 *  AAD, so it must serialise identically on every OS. */
function toRelId(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function rec(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) await rec(abs)
      else if (e.isFile()) out.push(abs)
    }
  }
  await rec(root)
  return out
}

/** Encrypts `srcAbs` → `dstAbs`, streaming block by block (no full-file buffer).
 *  `relId` is the file's AAD identity (its path relative to the work root). */
async function encryptFileTo(
  wdek: Buffer,
  srcAbs: string,
  dstAbs: string,
  relId: string,
): Promise<void> {
  const src = await fs.open(srcAbs, 'r')
  try {
    const { size } = await src.stat()
    await fs.mkdir(dirname(dstAbs), { recursive: true })
    const dst = await fs.open(dstAbs, 'w', 0o600)
    try {
      const header = Buffer.alloc(FILE_HEADER_BYTES)
      FILE_MAGIC.copy(header, 0)
      header.writeUInt32BE(BLOCK_PLAINTEXT_BYTES, FILE_MAGIC.length)
      header.writeBigUInt64BE(BigInt(size), FILE_MAGIC.length + 4)
      await dst.write(header, 0, header.length, 0)

      const buf = Buffer.alloc(BLOCK_PLAINTEXT_BYTES)
      let offset = 0
      let blockIndex = 0
      let dstPos = header.length
      while (offset < size) {
        const want = Math.min(BLOCK_PLAINTEXT_BYTES, size - offset)
        const { bytesRead } = await src.read(buf, 0, want, offset)
        const frame = encryptBlock(wdek, relId, blockIndex, buf.subarray(0, bytesRead))
        await dst.write(frame, 0, frame.length, dstPos)
        dstPos += frame.length
        offset += bytesRead
        blockIndex += 1
      }
      await dst.sync()
    } finally {
      await dst.close()
    }
  } finally {
    await src.close()
  }
}

/** Decrypts `srcAbs` (at-rest format) → `dstAbs` plaintext. Throws on tamper /
 *  wrong key (the GCM tag check), matching how a corrupt page would surface. */
async function decryptFileTo(
  wdek: Buffer,
  srcAbs: string,
  dstAbs: string,
  relId: string,
): Promise<void> {
  const src = await fs.open(srcAbs, 'r')
  try {
    const header = Buffer.alloc(FILE_HEADER_BYTES)
    await src.read(header, 0, FILE_HEADER_BYTES, 0)
    if (!header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      throw new Error(`not a LokLM workspace file: ${relId}`)
    }
    const blockSize = header.readUInt32BE(FILE_MAGIC.length)
    const originalSize = Number(header.readBigUInt64BE(FILE_MAGIC.length + 4))
    await fs.mkdir(dirname(dstAbs), { recursive: true })
    const dst = await fs.open(dstAbs, 'w', 0o600)
    try {
      let remaining = originalSize
      let blockIndex = 0
      let srcPos = FILE_HEADER_BYTES
      let dstPos = 0
      while (remaining > 0) {
        const ptLen = Math.min(blockSize, remaining)
        const frameLen = BLOCK_OVERHEAD_BYTES + ptLen
        const frame = Buffer.alloc(frameLen)
        await src.read(frame, 0, frameLen, srcPos)
        const pt = decryptBlock(wdek, relId, blockIndex, frame)
        await dst.write(pt, 0, pt.length, dstPos)
        srcPos += frameLen
        dstPos += pt.length
        remaining -= ptLen
        blockIndex += 1
      }
      await dst.sync()
    } finally {
      await dst.close()
    }
  } finally {
    await src.close()
  }
}

interface FileStat {
  mtimeMs: number
  size: number
}

/**
 * Manages one workspace's encrypted-at-rest directory and its plaintext working
 * copy. Lifecycle: `open()` decrypts enc/ → work/, the caller (LanceWorkspace
 * Store) operates on `workDir`, `persist()` re-encrypts changed files, `close()`
 * wipes the plaintext copy.
 */
export class EncryptedWorkspaceDir {
  readonly encDir: string
  readonly workDir: string
  private readonly wdek: Buffer
  /** Snapshot of work/ files as last seen (after open or persist), for delta
   *  re-encryption. relId → {mtimeMs,size}. */
  private snapshot = new Map<string, FileStat>()
  private opened = false

  constructor(baseDir: string, wdek: Buffer) {
    if (wdek.length !== 32) throw new Error('EncryptedWorkspaceDir needs a 32-byte WDEK')
    this.encDir = join(baseDir, 'enc')
    this.workDir = join(baseDir, 'work')
    this.wdek = wdek
  }

  /** Decrypts the at-rest tree into a fresh plaintext working dir and returns
   *  its path. Idempotent guard: throws if already open. */
  async open(): Promise<string> {
    if (this.opened) throw new Error('workspace dir already open')
    // Start from a clean work dir — a leftover from a crashed session must not
    // shadow the authoritative enc/ contents.
    await fs.rm(this.workDir, { recursive: true, force: true })
    await fs.mkdir(this.workDir, { recursive: true, mode: 0o700 })
    for (const encAbs of await walkFiles(this.encDir)) {
      const relId = toRelId(this.encDir, encAbs)
      const dstAbs = join(this.workDir, relId)
      await decryptFileTo(this.wdek, encAbs, dstAbs, relId)
    }
    await this.snapshotWorkDir()
    this.opened = true
    return this.workDir
  }

  /** Re-encrypts new/changed work/ files into enc/ and drops enc/ files whose
   *  plaintext no longer exists. Cheap when little changed (Lance fragments are
   *  immutable, so a write adds files rather than rewriting them). */
  async persist(): Promise<void> {
    if (!this.opened) throw new Error('persist before open')
    const current = await walkFiles(this.workDir)
    const seen = new Set<string>()
    for (const abs of current) {
      const relId = toRelId(this.workDir, abs)
      seen.add(relId)
      const st = await fs.stat(abs)
      const prev = this.snapshot.get(relId)
      if (!prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size) {
        await encryptFileTo(this.wdek, abs, join(this.encDir, relId), relId)
        this.snapshot.set(relId, { mtimeMs: st.mtimeMs, size: st.size })
      }
    }
    // Drop at-rest files whose plaintext was deleted (e.g. Lance compaction).
    for (const relId of [...this.snapshot.keys()]) {
      if (!seen.has(relId)) {
        await fs.rm(join(this.encDir, relId), { force: true })
        this.snapshot.delete(relId)
      }
    }
  }

  /** Persists (unless `discard`) then wipes the plaintext working dir. */
  async close(opts: { discard?: boolean } = {}): Promise<void> {
    if (!this.opened) return
    try {
      if (!opts.discard) await this.persist()
    } finally {
      await fs.rm(this.workDir, { recursive: true, force: true })
      this.snapshot.clear()
      this.opened = false
    }
  }

  /** Absolute path inside the working dir (e.g. the Lance dataset root). */
  path(...sub: string[]): string {
    return join(this.workDir, ...sub)
  }

  private async snapshotWorkDir(): Promise<void> {
    this.snapshot.clear()
    for (const abs of await walkFiles(this.workDir)) {
      const st = await fs.stat(abs)
      this.snapshot.set(toRelId(this.workDir, abs), { mtimeMs: st.mtimeMs, size: st.size })
    }
  }
}
