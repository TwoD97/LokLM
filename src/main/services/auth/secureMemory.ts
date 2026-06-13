import { createRequire } from 'node:module'

// Swap-pinning for key material ( DEK , KEKs ). The guarantee we actually need
// from libsodium is mlock ( VirtualLock on Windows ) : the key's pages are never
// written to swap / pagefile , so the at-rest encryption can't be defeated by
// reading the pagefile after the app closed. We pin plain Buffers with
// sodium_mlock and zero them with sodium_memzero.
//
// We deliberately do NOT use sodium_malloc ( the guarded allocator with guard
// pages + canary ). Electron 42 ships Node 24 / V8 14.8 , whose memory sandbox
// forbids external ArrayBuffers — exactly what sodium_malloc hands back ( a
// Buffer over libsodium's own guarded allocation ) — so the native call just
// returns undefined there. It works under a standalone Node 22 , which is why
// this only bit in the packaged app. There is no runtime flag to re-enable
// external buffers and 5.1.0 is the latest sodium-native , so guard pages are
// off the table without downgrading Electron ( and its Chromium ). mlock /
// memzero operate on caller-owned Buffers and are unaffected. Losing the
// guarded allocator costs us guard-page adjacency protection against native
// heap overruns ; it keeps the swap-persistence guarantee , which is the real
// threat. Revisit if V8 ever allows external buffers again.
//
// What this does NOT do : stop a same-user process from ReadProcessMemory'ing
// us. That's an OS trust boundary no desktop app can opt out of.
//
// Loaded via createRequire ( sodium-native is CJS ) inside a try , and the mlock
// path is probed at load , so a missing / broken prebuild or a zero
// RLIMIT_MEMLOCK degrades to plain Buffers + fill(0) instead of taking the auth
// stack down. The fallback keeps the zeroing semantics , it just loses the
// mlock guarantee.

interface SodiumNative {
  sodium_memzero(buf: Buffer): void
  sodium_mlock(buf: Buffer): void
  sodium_munlock(buf: Buffer): void
}

const require = createRequire(import.meta.url)

let sodium: SodiumNative | null = null
try {
  sodium = require('sodium-native') as SodiumNative
} catch (err) {
  console.warn(
    `[secureMemory] sodium-native unavailable , key buffers will not be mlock'd : ` +
      `${err instanceof Error ? err.message : String(err)}`,
  )
}

// Loading the module doesn't mean the native calls work in this runtime ( see
// the Node 24 note above ) , and mlock can also fail on a zero RLIMIT_MEMLOCK.
// Probe once against a throwaway page , then trust the result.
let canMlock = false
if (sodium) {
  try {
    const probe = Buffer.alloc(1)
    sodium.sodium_mlock(probe)
    sodium.sodium_munlock(probe)
    canMlock = true
  } catch (err) {
    console.warn(
      `[secureMemory] sodium_mlock unavailable , key buffers will not be pinned : ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// Buffers we successfully pinned , so secureWipe only ever munlocks a page it
// actually locked.
const pinned = new WeakSet<Buffer>()

/** True when keys actually live in swap-pinned memory. */
export function isHardened(): boolean {
  return canMlock
}

/** Allocate a key-sized buffer , mlock'd when possible ( plain Buffer otherwise ).
 *  Keep these small — a few pages of locked memory total , nowhere near
 *  RLIMIT_MEMLOCK. */
export function secureAlloc(size: number): Buffer {
  const buf = Buffer.alloc(size)
  if (canMlock) {
    try {
      sodium!.sodium_mlock(buf)
      pinned.add(buf)
    } catch {
      // over the lock quota — leave this one unpinned rather than fail the alloc.
    }
  }
  return buf
}

/** Wipe a buffer in place , then unpin it if we'd locked it. sodium_memzero
 *  can't be optimised away ; the fill(0) fallback is fine for Buffers ( external
 *  memory , writes are observable , V8 can't elide them ). */
export function secureWipe(buf: Buffer): void {
  if (sodium) sodium.sodium_memzero(buf)
  else buf.fill(0)
  if (canMlock && pinned.has(buf)) {
    pinned.delete(buf)
    try {
      sodium!.sodium_munlock(buf)
    } catch {
      // already zeroed above ; nothing more to do.
    }
  }
}

/** Move secret bytes out of an unpinned Buffer : copy into pinned memory ,
 *  wipe the source. Use on anything produced by randomBytes / argon2 /
 *  decipher output that is about to live longer than a few statements. */
export function intoSecure(src: Buffer): Buffer {
  const out = secureAlloc(src.length)
  src.copy(out)
  secureWipe(src)
  return out
}
