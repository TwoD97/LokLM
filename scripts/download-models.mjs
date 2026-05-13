#!/usr/bin/env node
// Download the GGUFs that LokLM bundles, by tier. Skips files already on disk.
// Usage:
//   node scripts/download-models.mjs              # all tiers
//   node scripts/download-models.mjs lite         # just lite (4B + embedder)
//   node scripts/download-models.mjs medium       # 4B + 8B + embedder
//   node scripts/download-models.mjs pro          # all of the above + Nemotron-49B
//   node scripts/download-models.mjs embedder     # just the embedder
//
// Re-running is safe: existing files are skipped. If a similar file already
// matches the profile pattern (e.g. you renamed it), the script also skips.

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = resolve(__dirname, '..', 'models')

/**
 * Canonical bundle. `filename` is what the script writes; `skipPattern` is a
 * looser check so a manually-placed file (different repo / quantization /
 * filename casing) still counts as "already have one".
 */
const MODELS = [
  {
    tier: 'embedder',
    purpose: 'Embedder — Snowflake arctic-embed-l-v2.0 (Q8_0)',
    filename: 'snowflake-arctic-embed-l-v2.0-q8_0.gguf',
    url: 'https://huggingface.co/Casual-Autopsy/snowflake-arctic-embed-l-v2.0-gguf/resolve/main/snowflake-arctic-embed-l-v2.0-q8_0.gguf',
    sizeGB: 0.6,
    skipPattern: /embed/i,
  },
  {
    tier: 'embedder',
    purpose: 'Reranker — BGE reranker v2-m3 (Q4_K_M)',
    filename: 'bge-reranker-v2-m3-Q4_K_M.gguf',
    url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q4_K_M.gguf',
    sizeGB: 0.4,
    skipPattern: /reranker.*v2.*m3|bge-reranker/i,
  },
  {
    tier: 'lite',
    purpose: 'Lite LLM — Qwen3-4B (Q4_K_M)',
    filename: 'Qwen_Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /qwen3.*[-_]?4b/i,
  },
  {
    tier: 'medium',
    purpose: 'Medium LLM — Qwen3-8B (Q4_K_M)',
    filename: 'Qwen_Qwen3-8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf',
    sizeGB: 4.9,
    skipPattern: /qwen3.*[-_]?8b/i,
  },
  {
    tier: 'pro',
    purpose:
      'Pro LLM — NVIDIA Nemotron 3 Nano 30B-A3B (IQ4_XS, MoE — 3B active, fits 32 GB VRAM cleanly)',
    filename: 'Nemotron-3-Nano-30B-A3B-IQ4_XS.gguf',
    url: 'https://huggingface.co/unsloth/Nemotron-3-Nano-30B-A3B-GGUF/resolve/main/Nemotron-3-Nano-30B-A3B-IQ4_XS.gguf',
    sizeGB: 18.2,
    // Match the new Nano 30B but NOT the legacy Super-49B — they are
    // different models. The xl profile in LlamaService still recognises
    // the 49B if present, but `pnpm models:pro` should only download the
    // intended Nano now.
    skipPattern: /nemotron.*nano.*30b/i,
  },
]

// Tier hierarchy: each tier includes the tiers below it. Embedder is always
// included since every install needs it.
const TIER_INCLUDES = {
  embedder: ['embedder'],
  lite: ['embedder', 'lite'],
  medium: ['embedder', 'lite', 'medium'],
  pro: ['embedder', 'lite', 'medium', 'pro'],
  all: ['embedder', 'lite', 'medium', 'pro'],
}

// ---- main ------------------------------------------------------------------

const tierArg = (process.argv[2] ?? 'all').toLowerCase()
const want = TIER_INCLUDES[tierArg]
if (!want) {
  console.error(`Unknown tier: ${tierArg}`)
  console.error(`Valid tiers: ${Object.keys(TIER_INCLUDES).join(', ')}`)
  process.exit(2)
}

if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })

const queue = MODELS.filter((m) => want.includes(m.tier))
console.log(`LokLM model downloader — tier: ${tierArg}`)
console.log(`Target directory: ${MODELS_DIR}`)
console.log(`Models in this tier: ${queue.length}`)
console.log('')

let failures = 0
for (const m of queue) {
  try {
    await ensureModel(m)
  } catch (err) {
    failures++
    console.error(`  ✗ ${m.filename}: ${err.message}`)
  }
}

console.log('')
if (failures > 0) {
  console.error(`Done with ${failures} failure(s).`)
  process.exit(1)
}
console.log('All models present.')

// ---- helpers ---------------------------------------------------------------

async function ensureModel(m) {
  console.log(`▸ ${m.purpose}`)
  const target = join(MODELS_DIR, m.filename)

  if (existsSync(target)) {
    const sizeMB = statSync(target).size / (1024 * 1024)
    console.log(`  ✓ already present (${sizeMB.toFixed(0)} MB)`)
    return
  }

  // Loose skip: maybe the user has a same-purpose file under a different name
  // (different repo, quant, etc.). Honor it instead of silently re-downloading.
  const existing = findMatching(m.skipPattern, m.filename)
  if (existing) {
    console.log(`  ✓ found existing match: ${existing} — skipping download`)
    return
  }

  console.log(`  ⬇ downloading ${m.sizeGB} GB from ${shortHost(m.url)}`)
  await downloadWithProgress(m.url, target, m.sizeGB)
  console.log(`  ✓ saved to ${target}`)
}

function findMatching(pattern, exclude) {
  let entries = []
  try {
    entries = readdirSync(MODELS_DIR)
  } catch {
    return null
  }
  for (const f of entries) {
    if (f === exclude) continue
    if (!f.toLowerCase().endsWith('.gguf')) continue
    if (pattern.test(f)) return f
  }
  return null
}

async function downloadWithProgress(url, target, expectedGB) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  if (!res.body) {
    throw new Error('response had no body')
  }

  const total = Number(res.headers.get('content-length') ?? 0)
  // Stream to a temp file so a partial download (Ctrl-C, network drop) never
  // looks valid to the auto-discovery in EmbeddingService / LlamaService.
  const tmp = target + '.partial'
  if (existsSync(tmp)) unlinkSync(tmp)
  const out = createWriteStream(tmp)

  let received = 0
  let lastPrint = Date.now()
  try {
    for await (const chunk of res.body) {
      out.write(chunk)
      received += chunk.length
      const now = Date.now()
      if (now - lastPrint > 500) {
        printProgress(received, total, expectedGB)
        lastPrint = now
      }
    }
    printProgress(received, total, expectedGB)
    process.stdout.write('\n')
  } catch (err) {
    out.destroy()
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }

  await new Promise((r) => out.end(r))

  // Size sanity: if the response had Content-Length, require an exact match.
  // If not (chunked, no length), at least require >50% of the expected GB.
  const got = statSync(tmp).size
  if (total > 0 && got !== total) {
    unlinkSync(tmp)
    throw new Error(`size mismatch: got ${got} bytes, expected ${total}`)
  }
  if (total === 0 && got < expectedGB * 1024 * 1024 * 1024 * 0.5) {
    unlinkSync(tmp)
    throw new Error(`download too small: ${got} bytes`)
  }

  // Atomic rename only after full write.
  if (existsSync(target)) unlinkSync(target)
  // fs.renameSync would also work — keeping createWriteStream-friendly.
  const { renameSync } = await import('node:fs')
  renameSync(tmp, target)
}

function printProgress(received, total, expectedGB) {
  const mb = (received / (1024 * 1024)).toFixed(0)
  if (total > 0) {
    const pct = ((received / total) * 100).toFixed(1)
    const totalMB = (total / (1024 * 1024)).toFixed(0)
    process.stdout.write(`\r    ${pct}%  ${mb} / ${totalMB} MB    `)
  } else {
    const pct = ((received / (expectedGB * 1024 * 1024 * 1024)) * 100).toFixed(1)
    process.stdout.write(`\r    ~${pct}%  ${mb} MB downloaded    `)
  }
}

function shortHost(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
