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
  'Local AI knowledge assistant with source citations — runs fully offline, encrypted on-device, no cloud APIs.'

const OVERVIEW =
  'LokLM is a free, open-source (MIT) desktop application that answers questions about your own documents — fully offline. The language model (a Qwen3.5 GGUF) runs locally through llama.cpp; retrieval is hybrid (BM25 keyword + BGE-M3 dense vectors) with reciprocal-rank fusion and a BGE reranker; all data is stored encrypted on-device. No cloud, no external AI APIs, no telemetry, no account. Every answer carries clickable citations back to the exact passage (PDF page or code line) in the source.'

const KEY_FACTS: string[] = [
  'License: MIT (open source), source available on GitHub.',
  'Platforms: Windows, macOS, and Linux desktop application (64-bit).',
  'Privacy: fully offline; no telemetry; no account; documents never leave the device.',
  'Security: AES-256-GCM encryption, Argon2id key derivation, per-workspace data keys; everything is encrypted at rest in the local app data folder, with an 18-word recovery phrase.',
  'Inference: Qwen3.5 GGUF models via llama.cpp; three editions at install — Lite (4B, ~3.6 GB, iGPU / 12 GB RAM), Standard (4B, ~4 GB), Pro (9B, ~7 GB); optional local Ollama backend; optional CUDA acceleration.',
  'Retrieval: hybrid BM25 + BGE-M3 dense embeddings, RRF fusion, BGE Reranker v2-M3; clickable citations to PDF page or code line.',
  'Formats: PDF (including scanned, via OCR), Word (DOCX), Markdown, text, HTML, JSON, and source code; folder sync for codebases.',
  'Also: local document translation (MADLAD-400, 400+ languages), audio transcription with speaker diarization (Whisper), and study/productivity tools (quizzes, summaries, writing assistant) — all on-device.',
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
