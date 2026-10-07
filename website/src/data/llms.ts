// Generated LLM-discovery index (Answer.AI llms.txt spec). Derived from the
// cluster topology + content collection so it never drifts from the real
// routes. `llms.txt` is the concise map; `llms-full.txt` (see the route) is the
// full-text corpus for retrieval.
import { personas, pillars, pillarUrl, personaUrl } from './cluster'
import { faqKeys } from './faq'
import { t } from '../i18n/ui'

export interface LlmsPost {
  title: string
  description: string
  url: string
  lang: 'de' | 'en'
  date?: string
}

export interface LlmsFullPost extends LlmsPost {
  body: string
}

const SUMMARY =
  'Local AI knowledge assistant with source citations and encrypted storage — works offline with bundled models; optional external Ollama requires explicit consent.'

const OVERVIEW =
  'LokLM is a free, open-source (MIT) desktop application for questions about your own documents. With the bundled models, it works offline after model download: Qwen3.5 GGUF inference through llama.cpp, hybrid BM25 and dense-vector retrieval, reciprocal-rank fusion and optional reranking. The local vault is encrypted, with no telemetry or cloud account. Users can optionally select Ollama for individual AI functions; an external server requires explicit consent and receives the content it processes. Clickable citations open referenced passages (PDF page or code line) for checking, but do not guarantee that the source supports the answer.'

const KEY_FACTS: string[] = [
  'License: MIT (open source), source available on GitHub.',
  'Platforms: Windows, macOS, and Linux desktop application (64-bit).',
  'Privacy: bundled models process document contents on-device; no telemetry or cloud account. Optional external Ollama sends content to the explicitly approved destination for the selected functions, including chat, embeddings, reranking and translation.',
  'Security: encrypted vault and workspace databases, Argon2id key derivation, AES-256-GCM vault encryption, per-workspace keys and an 18-word recovery phrase. Vector storage is encrypted by default, with a local plaintext working directory while open; users can choose permanently unencrypted vectors for non-sensitive collections. Imported original files remain unchanged outside the vault.',
  'Inference: Qwen3.5 GGUF models via llama.cpp; three editions at install — Lite (4B, ~3.6 GB, iGPU / 12 GB RAM), Standard (4B, ~4 GB), Pro (9B, ~7 GB). These are download sizes, not VRAM requirements. Bundled inference requires a supported GPU; CPU-only inference is disabled, but partial GPU/CPU offload is supported. Fit and speed depend on model, context and free memory. Small GPUs swap chat and embedding models as needed. Ollama is optional, locally or on an explicitly approved external server; CUDA acceleration is optional.',
  'Retrieval: hybrid BM25 + dense embeddings (BGE-M3 for Lite, Qwen3-Embedding for Standard/Pro), RRF fusion, optional BGE Reranker v2-M3; Auto skips reranking on small GPUs. Clickable source citations open the referenced PDF page or code line. Citation membership is checked, not claim entailment; answers may be wrong or overlook conflicting sources.',
  'Formats: PDF (including scanned, via OCR), Word (DOCX), Markdown, text, HTML, JSON, and source code; folder sync for codebases.',
  'Also: document translation with the selected language model, local audio transcription with speaker diarization (Whisper), and study/productivity tools (quizzes, summaries, writing assistant). These functions keep content on-device when using the bundled models; selected external Ollama functions send their input to the approved server.',
  'Best for: questions whose answer is in your own files. Not optimised for open-domain knowledge without context.',
  'Built by Denys Tudosa.',
]

export function buildLlmsTxt(siteUrl: string, posts: LlmsPost[] = []): string {
  const base = siteUrl.replace(/\/$/, '')
  const lines: string[] = []

  lines.push('# LokLM')
  lines.push('')
  lines.push(`> ${SUMMARY}`)
  lines.push('')
  lines.push(OVERVIEW)
  lines.push('')
  lines.push(`Site: ${base}`)
  lines.push('')

  lines.push('## Key facts')
  for (const f of KEY_FACTS) lines.push(`- ${f}`)
  lines.push('')

  lines.push('## Pillars')
  for (const p of pillars) {
    lines.push(`- [${p.key} (DE)](${base}${pillarUrl(p.key, 'de')})`)
    lines.push(`- [${p.key} (EN)](${base}${pillarUrl(p.key, 'en')})`)
  }
  lines.push('')

  lines.push('## Use cases')
  for (const p of personas) {
    lines.push(`- [${p.key} (DE)](${base}${personaUrl(p.key, 'de')})`)
    lines.push(`- [${p.key} (EN)](${base}${personaUrl(p.key, 'en')})`)
  }
  lines.push('')

  lines.push('## Blog')
  lines.push(`- [Blog (DE)](${base}/blog)`)
  lines.push(`- [Blog (EN)](${base}/en/blog)`)
  lines.push(`- [RSS (DE)](${base}/blog/rss.xml)`)
  lines.push(`- [RSS (EN)](${base}/en/blog/rss.xml)`)
  for (const post of posts) {
    // each post also has a plain-markdown mirror at <url>.md for clean ingestion
    lines.push(
      `- [${post.title} (${post.lang.toUpperCase()})](${post.url}.md) — ${post.description}`,
    )
  }
  lines.push('')

  lines.push('## FAQ')
  for (const { q, a } of faqKeys) {
    lines.push(`### ${t('en', q)}`)
    lines.push(t('en', a))
    lines.push('')
  }

  lines.push('## Project')
  lines.push('- [GitHub](https://github.com/TwoD97/LokLM)')
  lines.push(`- [Full-text corpus](${base}/llms-full.txt)`)
  lines.push(`- [Privacy (DE)](${base}/privacy)`)
  lines.push(`- [Privacy (EN)](${base}/en/privacy)`)

  return lines.join('\n') + '\n'
}

// Full-text corpus: the concise map plus the complete body of every post, so a
// model can ingest the whole site in one fetch.
export function buildLlmsFullTxt(siteUrl: string, posts: LlmsFullPost[] = []): string {
  const base = siteUrl.replace(/\/$/, '')
  const lines: string[] = []

  lines.push('# LokLM — full content')
  lines.push('')
  lines.push(`> ${SUMMARY}`)
  lines.push('')
  lines.push(OVERVIEW)
  lines.push('')
  lines.push(`Site: ${base}`)
  lines.push('')
  lines.push('## Key facts')
  for (const f of KEY_FACTS) lines.push(`- ${f}`)
  lines.push('')

  for (const post of posts) {
    lines.push('---')
    lines.push('')
    lines.push(`# ${post.title}`)
    lines.push('')
    lines.push(`Language: ${post.lang} · Source: ${post.url}`)
    lines.push('')
    lines.push(`> ${post.description}`)
    lines.push('')
    lines.push(post.body.trim())
    lines.push('')
  }

  return lines.join('\n') + '\n'
}
