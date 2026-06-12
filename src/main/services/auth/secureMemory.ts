import { createRequire } from 'node:module'

// Secure allocation for key material ( DEK , KEKs ). sodium_malloc gives us
// three things a plain Buffer can't :
//   - the region is mlock'd ( VirtualLock on Windows ) , so the key is never
//     written to swap / pagefile — without this the at-rest encryption can be
//     defeated by reading the pagefile after the app closed
//   - guard pages on both sides + a canary , so a heap overrun in native code
//     faults instead of silently reading the key
//   - the allocation is wiped by libsodium when it's freed
//
// What this does NOT do : stop a same-user process from ReadProcessMemory'ing
// us. That's an OS trust boundary no desktop app can opt out of ; the threat
// model here is swap persistence and heap-spray adjacency , not a debugger.
//
// Loaded via createRequire ( sodium-native is CJS ) inside a try so a missing
// or broken prebuild degrades to plain Buffers + fill(0) instead of taking
// the whole auth stack down. The fallback keeps the existing zeroing
// semantics , it just loses the mlock guarantee.

interface SodiumNative {
  sodium_malloc(size: number): Buffer
  sodium_memzero(buf: Buffer): void
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

/** True when keys actually live in guarded , swap-pinned memory. */
export function isHardened(): boolean {
  return sodium !== null
}

/** Allocate a key-sized buffer in guarded + mlock'd memory ( plain Buffer
 *  when sodium-native is unavailable ). Keep these small — a few hundred
 *  bytes of locked memory total , nowhere near RLIMIT_MEMLOCK. */
export function secureAlloc(size: number): Buffer {
  return sodium ? sodium.sodium_malloc(size) : Buffer.alloc(size)
}

/** Wipe a buffer in place. sodium_memzero can't be optimised away ; the
 *  fill(0) fallback is fine for Buffers ( external memory , writes are
 *  observable , V8 can't elide them ). */
export function secureWipe(buf: Buffer): void {
  if (sodium) sodium.sodium_memzero(buf)
  else buf.fill(0)
}

/** Move secret bytes out of an unpinned Buffer : copy into secure memory ,
 *  wipe the source. Use on anything produced by randomBytes / argon2 /
 *  decipher output that is about to live longer than a few statements. */
export function intoSecure(src: Buffer): Buffer {
  const out = secureAlloc(src.length)
  src.copy(out)
  secureWipe(src)
  return out
}
