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
//   node scripts/download-models.mjs translation  # ship-trio + gemma Q4/Q6 for
//                                                 # tests/evals/translation/
//
// Re-running is safe: existing files are skipped. If a similar file already
// matches the profile pattern (e.g. you renamed it), the script also skips.
//
// `evals` / `translation` tiers do NOT include `all` — eval-only , not shipped.
// `tier` may be a string or an array when a file belongs to several pools.

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
    tier: ['evals', 'matrix'],
    purpose: 'Eval pool — Qwen3-4B-Instruct-2507 (no-think variant , clean JSON)',
    filename: 'Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /qwen3.*4b.*instruct.*2507/i,
  },
  {
    tier: ['evals', 'matrix-risk'],
    purpose: 'Eval pool — Llama-3.2-3B-Instruct',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeGB: 2.2,
    skipPattern: /llama.*3\.2.*3b.*instruct/i,
  },
  {
    tier: ['evals', 'matrix'],
    purpose: 'Eval pool — Phi-4-mini-instruct (3.8B)',
    filename: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /phi.*4.*mini/i,
  },
  {
    tier: ['evals', 'translation', 'matrix-risk'],
    purpose: 'Eval pool — Gemma-3-4B-it (best DE in 4B tier)',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf',
    sizeGB: 3.0,
    // Q4 only — der Q6-eintrag unten hat sein eigenes pattern , sonst
    // blockt ein vorhandenes Q4-file den Q6-download.
    skipPattern: /gemma.*3.*4b.*it.*Q4/i,
  },
  {
    tier: 'translation',
    purpose: 'Translation-Eval — Gemma-3-4B-it Q6_K (fallback-kandidat für schwache sprachen)',
    filename: 'google_gemma-3-4b-it-Q6_K.gguf',
    url: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q6_K.gguf',
    sizeGB: 3.3,
    skipPattern: /gemma.*3.*4b.*it.*Q6/i,
  },
  {
    tier: ['evals', 'matrix'],
    purpose: 'Eval pool — SmolLM3-3B (outsider)',
    filename: 'HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/HuggingFaceTB_SmolLM3-3B-GGUF/resolve/main/HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
    sizeGB: 2.0,
    skipPattern: /smollm3.*3b/i,
  },
  {
    tier: ['evals', 'matrix'],
    purpose: 'Eval pool — Qwen3-14B (mid-tier flagship)',
    filename: 'Qwen_Qwen3-14B-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q4_K_M.gguf',
    sizeGB: 9.0,
    // Excludes the 14B-Instruct-2507 if it ever lands here. Plain 14B for now.
    skipPattern: /qwen3.*14b/i,
  },
  {
    tier: ['evals', 'matrix'],
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
    tier: ['evals', 'matrix-risk'],
    purpose: 'Eval pool — Hermes-3-Llama-3.1-8B (outsider , steuerbar)',
    filename: 'Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    url: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    sizeGB: 5.0,
    skipPattern: /hermes.*3.*llama.*3\.1.*8b/i,
  },
  {
    tier: ['evals', 'matrix'],
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
    tier: ['evals', 'translation', 'matrix'],
    purpose: 'Eval pool — Qwen3.5-2B (small , NON-thinking default — kontroll-modell)',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    sizeGB: 1.5,
    skipPattern: /qwen3\.5.*2b/i,
  },
  {
    tier: ['evals', 'translation', 'matrix'],
    purpose:
      'Eval pool — Qwen3.5-4B Instruct (thinking-on default — direkt-vergleich zu Qwen3-4B-Instruct-2507)',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    sizeGB: 2.8,
    skipPattern: /qwen3\.5.*4b/i,
  },
  {
    tier: ['evals', 'translation', 'matrix'],
    purpose:
      'Eval pool — Qwen3.5-9B (base post-trained , thinking-on default — der benchmark-winner mit 27/28)',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    sizeGB: 5.7,
    skipPattern: /qwen3\.5.*9b/i,
  },
  {
    tier: ['evals', 'matrix'],
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

  // ---- matrix tier (AP-E.2 full RAG matrix) --------------------------------
  // New embedders / reranker / LLMs for the cartesian matrix eval. All GGUF
  // URLs HEAD-verified (real, ungated) 2026-06-14. Combined with the embedder
  // + evals tiers via TIER_INCLUDES.matrix below.
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — multilingual-e5-large (Q8_0, 1024d ; needs query:/passage: prefixes)',
    filename: 'multilingual-e5-large-q8_0.gguf',
    url: 'https://huggingface.co/soichisumi/multilingual-e5-large-Q8_0-GGUF/resolve/main/multilingual-e5-large-q8_0.gguf',
    sizeGB: 0.6,
    skipPattern: /multilingual-e5-large/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — snowflake-arctic-embed-l-v2.0 (Q4_K_M, 1024d ; set batch >= ctx)',
    filename: 'snowflake-arctic-embed-l-v2.0-q4_k_m.gguf',
    url: 'https://huggingface.co/Casual-Autopsy/snowflake-arctic-embed-l-v2.0-gguf/resolve/main/snowflake-arctic-embed-l-v2.0-q4_k_m.gguf',
    sizeGB: 0.44,
    skipPattern: /arctic-embed-l-v2/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — Qwen3-Embedding-0.6B (Q8_0, 1024d, last-token pooling)',
    filename: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf',
    sizeGB: 0.64,
    skipPattern: /qwen3-embedding-0\.6b/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — Qwen3-Embedding-4B (Q4_K_M, 2560d, last-token pooling)',
    filename: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF/resolve/main/Qwen3-Embedding-4B-Q4_K_M.gguf',
    sizeGB: 2.5,
    skipPattern: /qwen3-embedding-4b/i,
  },
  {
    tier: 'matrix-risk',
    purpose: 'Matrix embedder — EmbeddingGemma-300m (Q8_0, 768d, on-device)',
    filename: 'embeddinggemma-300M-Q8_0.gguf',
    url: 'https://huggingface.co/unsloth/embeddinggemma-300m-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf',
    sizeGB: 0.33,
    skipPattern: /embeddinggemma-300m/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — granite-embedding-278m-multilingual (Q4_K_M, 768d)',
    filename: 'granite-embedding-278m-multilingual-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/granite-embedding-278m-multilingual-GGUF/resolve/main/granite-embedding-278m-multilingual-Q4_K_M.gguf',
    sizeGB: 0.22,
    skipPattern: /granite-embedding-278m/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — multilingual-e5-base (Q8_0, MIT ; query:/passage: prefixes)',
    filename: 'multilingual-e5-base-q8_0.gguf',
    url: 'https://huggingface.co/cstr/multilingual-e5-base-GGUF/resolve/main/multilingual-e5-base-q8_0.gguf',
    sizeGB: 0.3,
    skipPattern: /multilingual-e5-base/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix embedder — nomic-embed-text-v2-moe (Q4_K_M, Apache-2.0 ; search_query:/search_document: prefixes)',
    filename: 'nomic-embed-text-v2-moe.Q4_K_M.gguf',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF/resolve/main/nomic-embed-text-v2-moe.Q4_K_M.gguf',
    sizeGB: 0.5,
    skipPattern: /nomic-embed-text-v2/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix reranker — bge-reranker-base (F16, MIT ; cross-encoder rankAll)',
    filename: 'bge-reranker-base-F16.gguf',
    url: 'https://huggingface.co/sinjab/bge-reranker-base-F16-GGUF/resolve/main/bge-reranker-base-F16.gguf',
    sizeGB: 1.1,
    skipPattern: /bge-reranker-base/i,
  },
  {
    tier: 'matrix-risk',
    purpose: 'Matrix reranker — jina-reranker-v2-base-multilingual (Q4_K_M, cross-encoder ; mainline-converted)',
    filename: 'jina-reranker-v2-base-multilingual-q4_k_m.gguf',
    url: 'https://huggingface.co/minhtd14/jina-reranker-v2-base-multilingual-Q4_K_M-GGUF/resolve/main/jina-reranker-v2-base-multilingual-q4_k_m.gguf',
    sizeGB: 0.22,
    skipPattern: /jina-reranker-v2/i,
  },
  {
    tier: 'matrix-risk',
    purpose: 'Matrix LLM — Gemma 4 E4B-it (Q4_K_M ; needs llama.cpp >= 2026-04)',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    sizeGB: 4.98,
    skipPattern: /gemma-4-e4b/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix LLM — Ministral-3-14B-Instruct-2512 (Q4_K_M ; arch mistral3, needs llama.cpp >= 2025-12)',
    filename: 'mistralai_Ministral-3-14B-Instruct-2512-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/mistralai_Ministral-3-14B-Instruct-2512-GGUF/resolve/main/mistralai_Ministral-3-14B-Instruct-2512-Q4_K_M.gguf',
    sizeGB: 8.24,
    skipPattern: /ministral-3-14b/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix LLM — EuroLLM-9B-Instruct (Q4_K_M ; EU-multilingual)',
    filename: 'EuroLLM-9B-Instruct-Q4_K_M.gguf',
    url: 'https://huggingface.co/bartowski/EuroLLM-9B-Instruct-GGUF/resolve/main/EuroLLM-9B-Instruct-Q4_K_M.gguf',
    sizeGB: 5.58,
    skipPattern: /eurollm-9b/i,
  },
  {
    tier: 'matrix',
    purpose: 'Matrix LLM — Granite 4.1-3b (Q4_K_M ; substitute for non-existent granite-4.1-tiny)',
    filename: 'granite-4.1-3b-Q4_K_M.gguf',
    url: 'https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/resolve/main/granite-4.1-3b-Q4_K_M.gguf',
    sizeGB: 2.0,
    skipPattern: /granite-4\.1-3b/i,
  },

  // ---- matrix-risk tier ----------------------------------------------------
  // GGUFs EXIST but are BROKEN in mainline llama.cpp / node-llama-cpp. Download
  // ONLY to smoke-test with a patched build ; do NOT use in a real matrix run
  // without first verifying non-zero scores / correct stopping locally.
  {
    tier: 'matrix-risk',
    purpose: 'RISK reranker — Qwen3-Reranker-0.6B (Q8_0 ; near-zero scores in mainline rankAll)',
    filename: 'qwen3-reranker-0.6b-q8_0.gguf',
    url: 'https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/main/qwen3-reranker-0.6b-q8_0.gguf',
    sizeGB: 0.64,
    skipPattern: /qwen3-reranker/i,
  },
  {
    tier: 'matrix-risk',
    purpose: 'RISK LLM — Teuken-7B-instruct-v0.6 (Q4_K_M ; mainline tokenizer breaks EOS </s>)',
    filename: 'Teuken-7B-instruct-v0.6.Q4_K_M.gguf',
    url: 'https://huggingface.co/mradermacher/Teuken-7B-instruct-v0.6-GGUF/resolve/main/Teuken-7B-instruct-v0.6.Q4_K_M.gguf',
    sizeGB: 5.02,
    skipPattern: /teuken-7b/i,
  },
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
  // translation-eval braucht keinen embedder — nur die 5 LLMs aus dem pack.
  translation: ['translation'],
  matrix: ['embedder', 'matrix'],
  'matrix-risk': ['matrix-risk'],
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

const queue = MODELS.filter((m) =>
  (Array.isArray(m.tier) ? m.tier : [m.tier]).some((t) => want.includes(t)),
)
console.log(`LokLM model downloader — tier: ${tierArg}`)
console.log(`Target directory: ${MODELS_DIR}`)
console.log(`Models in this tier: ${queue.length}`)
console.log('')

if (process.argv.includes('--dry-run')) {
  console.log('DRY RUN — no downloads. HEAD pre-flight per URL:')
  console.log('')
  let totalGB = 0
  for (const m of queue) {
    totalGB += m.sizeGB ?? 0
    let status
    try {
      const res = await fetch(m.url, { method: 'HEAD', redirect: 'follow' })
      const len = res.headers.get('content-length')
      const gb = len ? `${(Number(len) / 1e9).toFixed(2)} GB` : 'size?'
      status = `${res.status} ${res.ok ? 'OK' : 'FAIL'} (${gb})`
    } catch (err) {
      status = `ERR ${err.message}`
    }
    console.log(`  [${status}] ${m.filename}  (~${m.sizeGB ?? '?'} GB declared)`)
    console.log(`      ${m.url}`)
  }
  console.log('')
  console.log(`Total declared: ~${totalGB.toFixed(1)} GB across ${queue.length} models.`)
  process.exit(0)
}

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
