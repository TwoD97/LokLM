// Per-chunk language detection via eld (Efficient Language Detector, L DB).
// Used by the ingest pipeline to tag every chunk so the prompt formatter can
// inject a source-language hint into the Context block when chunks don't
// match the chat's response language. Schema bucket is 'de' | 'en' | 'other'
// (mig 0007) — we only differentiate the two response languages, everything
// else collapses so the prompt-side switch stays small.
//
// Why lazy import: `eld/large` static-imports a ~4.4 MB ngram file that
// allocates ~140 MB of RAM once loaded. The dynamic `import()` runs once on
// first detect call and pins the module — fine for ingest (one allocation
// per worker lifetime) but keeps test runs that never ingest free of the
// load cost. ESM caches the dynamic import so subsequent calls are sync.

export type ChunkLanguage = 'de' | 'en' | 'other'

/** Below this many characters eld's score is too noisy to trust — the L DB
 *  is tuned for tweet-length text (≥40 chars per the upstream readme) but
 *  marketing copy and TOC stubs sit in the 20–40 char range and routinely
 *  flip between languages run-to-run. Treat them as undetected. */
const MIN_CHARS_FOR_DETECTION = 40

type EldHandle = {
  detect: (text: string) => {
    language: string
    isReliable: () => boolean
  }
}

let eldHandle: EldHandle | null = null
let loadPromise: Promise<EldHandle> | null = null

async function getEld(): Promise<EldHandle> {
  if (eldHandle) return eldHandle
  if (!loadPromise) {
    loadPromise = (async () => {
      // Static entry — `eld/large` exposes the L ngram DB pre-loaded. The
      // dynamic-loader entry (`eld`) would require `await eld.load('large')`
      // which adds a redundant readiness step.
      const mod = (await import('eld/large')) as { eld: EldHandle }
      eldHandle = mod.eld
      return mod.eld
    })()
  }
  return loadPromise
}

/** Map eld's ISO-639-1 result to the schema's 3-bucket enum. */
function bucket(iso: string): ChunkLanguage {
  if (iso === 'de') return 'de'
  if (iso === 'en') return 'en'
  return 'other'
}

/** Detect the language of a single chunk's text. Returns null for chunks
 *  too short to score reliably OR when eld marks the result unreliable —
 *  the caller stores NULL in those cases so the prompt formatter skips
 *  the cross-language hint instead of guessing wrong. */
export async function detectChunkLanguage(text: string): Promise<ChunkLanguage | null> {
  const trimmed = text.trim()
  if (trimmed.length < MIN_CHARS_FOR_DETECTION) return null
  const eld = await getEld()
  const result = eld.detect(trimmed)
  if (!result.language || !result.isReliable()) return null
  return bucket(result.language)
}

/** Batch variant — detects every chunk's text in sequence and returns the
 *  parallel array of buckets. eld.detect is sub-millisecond per call, so
 *  even a 500-chunk book runs in <0.5 s end-to-end; no need for Promise.all
 *  fan-out (eld is synchronous after load and Promise.all just stacks JS
 *  microtasks). */
export async function detectChunkLanguages(
  texts: readonly string[],
): Promise<(ChunkLanguage | null)[]> {
  if (texts.length === 0) return []
  await getEld() // warm the module once before the loop
  const out: (ChunkLanguage | null)[] = []
  for (const text of texts) out.push(await detectChunkLanguage(text))
  return out
}
