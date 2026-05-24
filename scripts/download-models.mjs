#!/usr/bin/env node
// Download the GGUFs that LokLM bundles, by tier. Skips files already on disk.
// Usage:
//   node scripts/download-models.mjs              # all tiers (ship-bundle only)
//   node scripts/download-models.mjs lite         # just lite (4B + embedder)
//   node scripts/download-models.mjs medium       # 4B + 8B + embedder
//   node scripts/download-models.mjs pro          # all of the above + Nemotron-30B
//   node scripts/download-models.mjs embedder     # just the embedder
//   node scripts/download-models.mjs evals        # 10-model pool + Mistral-Small judge
//                                                 # for tests/evals/answer/model-pack.json
//
// Re-running is safe: existing files are skipped. If a similar file already
// matches the profile pattern (e.g. you renamed it), the script also skips.
//
// `evals` tier does NOT include `all` — these are eval-only , not shipped.

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
    purpose: 'Embedder — BGE-M3 (Q4_K_M)',
    filename: 'bge-m3-Q4_K_M.gguf',
    url: 'https://huggingface.co/lm-kit/bge-m3-gguf/resolve/main/bge-m3-Q4_K_M.gguf',
    sizeGB: 0.75,
    skipPattern: /bge[-_]?m3/i,
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

  // ---- evals tier ----------------------------------------------------------
  // For the 10-model RAG eval pack (tests/evals/answer/model-pack.json).
  // NOT shipped with the app. The pool covers Qwen / Llama / Phi / Gemma /
  // Mistral / Granite / Hermes / SmolLM3 across the <=4B and 7-14B tiers.
  // URLs are best-effort against HuggingFace repo names as of 2026-05 — if a
  // download 404s , the repo got renamed or the file moved , fix it here.

  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3-4B-Instruct-2507 (no-think variant , clean JSON)',
    filename: 'Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /qwen3.*4b.*instruct.*2507/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Llama-3.2-3B-Instruct',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeGB: 2.2,
    skipPattern: /llama.*3\.2.*3b.*instruct/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Phi-4-mini-instruct (3.8B)',
    filename: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /phi.*4.*mini/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Gemma-3-4B-it (best DE in 4B tier)',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf',
    sizeGB: 3.0,
    skipPattern: /gemma.*3.*4b.*it/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — SmolLM3-3B (outsider)',
    filename: 'HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/HuggingFaceTB_SmolLM3-3B-GGUF/resolve/main/HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
    sizeGB: 2.0,
    skipPattern: /smollm3.*3b/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3-14B (mid-tier flagship)',
    filename: 'Qwen_Qwen3-14B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q4_K_M.gguf',
    sizeGB: 9.0,
    // Excludes the 14B-Instruct-2507 if it ever lands here. Plain 14B for now.
    skipPattern: /qwen3.*14b/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Phi-4 14B (STEM reasoning , ACHTUNG: nur 16k ctx)',
    // bartowski/microsoft_phi-4-GGUF antwortete 2026-05 mit HTTP 401 (gated) ,
    // unsloth-mirror ist offen und identische gewichte. skipPattern matched
    // beide dateinamen damit ein vorhandener bartowski-download (falls user
    // schon HF-token gesetzt hat) nicht überschrieben wird.
    filename: 'phi-4-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf',
    sizeGB: 9.0,
    skipPattern: /(^microsoft_phi-4-Q|^phi-4-Q)/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Hermes-3-Llama-3.1-8B (outsider , steuerbar)',
    filename: 'Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    url: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    sizeGB: 5.0,
    skipPattern: /hermes.*3.*llama.*3\.1.*8b/i,
  },
  {
    tier: 'evals',
    purpose:
      'Eval judge — Mistral-Small-3.2-24B-Instruct-2506 (Q5_K_M , fixed judge fuer pack-run)',
    filename: 'mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q5_K_M.gguf',
    url: 'https://huggingface.co/bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF/resolve/main/mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q5_K_M.gguf',
    sizeGB: 17.0,
    skipPattern: /mistral.*small.*3\.2.*24b/i,
  },

  // ---- Qwen3.5 family (release Feb 2026) -----------------------------------
  // Natural experiment: 2B ist non-thinking-default , alle anderen
  // (4B/9B/27B/35B-A3B) haben thinking-on. Wenn 2B die größeren schlägt ,
  // ist thinking-mode der dominante faktor , nicht die größe. Bestätigt
  // die hypothese aus dem ersten 10-modell run wo Qwen3-4B-Instruct-2507
  // (no-think) Qwen3-8B/14B (thinking-on) deutlich geschlagen hat.

  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3.5-2B (small , NON-thinking default — kontroll-modell)',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    sizeGB: 1.5,
    skipPattern: /qwen3\.5.*2b/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3.5-4B Instruct (thinking-on default — direkt-vergleich zu Qwen3-4B-Instruct-2507)',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    sizeGB: 2.8,
    skipPattern: /qwen3\.5.*4b/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3.5-9B (base post-trained , thinking-on default — der benchmark-winner mit 27/28)',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    sizeGB: 5.7,
    skipPattern: /qwen3\.5.*9b/i,
  },
  {
    tier: 'evals',
    purpose: 'Eval pool — Qwen3.5-27B (dense , thinking-on default — passt knapp auf 5090 Q4)',
    filename: 'Qwen3.5-27B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf',
    sizeGB: 16.0,
    skipPattern: /qwen3\.5.*27b/i,
  },
  // Qwen3.5-35B-A3B (22 GB MoE) bewusst aus dem evals-tier rausgenommen:
  // disk-druck auf der E: , und A3B-MoE bringt voraussichtlich keinen
  // signifikanten lift gegenueber dem dense 27B in unserem RAG-eval.
  // Wenn du es doch testen willst , entry wieder einkommentieren und
  // `pnpm models:evals` erneut laufen lassen.
]

// Tier hierarchy: each tier includes the tiers below it. Embedder is always
// included since every install needs it. `evals` is OUT of the ship-bundle
// hierarchy — it pulls only the 10-model eval pool + judge , no ship-tier
// fallthrough , and `all` does not pull `evals`.
const TIER_INCLUDES = {
  embedder: ['embedder'],
  lite: ['embedder', 'lite'],
  medium: ['embedder', 'lite', 'medium'],
  pro: ['embedder', 'lite', 'medium', 'pro'],
  all: ['embedder', 'lite', 'medium', 'pro'],
  evals: ['embedder', 'evals'],
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
