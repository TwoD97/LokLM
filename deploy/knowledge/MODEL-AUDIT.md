# Canonical LokLM model and method audit

Audited checkout: `TwoD97/LokLM` at
`4651557a3567631d3a84a33c3e78e4f3032d718d`, v0.7.4 code. The old Notebook LoLM
clone is not an input. Shared desktop core commits `b59c1d4` and `8b189ac`
are integrated here without enabling desktop/vault-storage features.
The later shared `e40721e` helper supplies exact UTF-16 reranker passage limits;
session revocation and prompt-newline fixes are also integrated from that owner.

Source authority: `src/main/services/models/manifest.ts`,
`installer-wizard/model-manifest.json`, `models/paths.ts`,
`llm/LlamaService.ts`, `embeddings/EmbeddingService.ts`,
`codebase/codeEmbedder.ts`, `documents/{chunker,chunkOptions,parser}.ts`,
`retrieval/{RetrievalService,RerankerService}.ts`, and bundled/Ollama providers.
These are paths under `src/main/services` unless stated otherwise.

## Selected profiles

| Profile | Embedding GGUF | Dimensions | Query instructions |
|---|---|---|---|
| Lite | bge-m3-Q4_K_M.gguf | 1024, L2 | No artificial prefix |
| Standard / Pro | Qwen3-Embedding-0.6B-Q8_0.gguf | 1024, L2 | Original LokLM document `Instruct` / `Query` template |

The document instruction is `Given a question, retrieve the document passage
that best answers it.` The same instruction applies to German and English
questions; it is not translated or replaced by a new embedding model. The shared
core also preserves the original codebase instruction, but this file daemon's
v1 endpoint indexes prose Markdown and does not claim codebase router parity.
Passages use the shared whitespace cleanup and 6,000-character limit. The Rust
port counts Unicode scalars instead of JS UTF-16 units; this deliberate boundary
is versioned, rather than silently treated as byte-compatible.

| Artifact | SHA-256 | Local bytes | License |
|---|---|---:|---|
| BGE-M3 Q4_K_M | `e251234fcb7d050991a6be491952f485bf5c641dd10c3272dc1301fd281ad50f` | 437778592 | MIT |
| Qwen3-Embedding-0.6B Q8_0 | `06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439` | 639150592 | Apache-2.0 |
| BGE reranker v2-m3 Q4_K_M | `e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673` | 438376864 | Apache-2.0 |
| Qwen3.5-4B Q4_K_M | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | 2740937888 | Apache-2.0 |

Hashes/sizes above were measured read-only from the canonical model cache.
The first three match actual source pins. **The 4B installer manifest has null
SHA-256** (an xetHash is not a SHA-256); the measured 4B hash is an explicit local
compatibility pin, not a claim of authenticated upstream provenance. Lite and
Standard currently select this 4B generator in the actual installer manifest.
Pro selects Qwen3.5-9B Q4_K_M with manifest SHA
`03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`;
that 9B generator is not implemented/tested by the basic answer overlay.

Upstream model cards:
[BGE-M3](https://huggingface.co/BAAI/bge-m3),
[Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B),
[BGE reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3),
[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B).
Weights stay outside Git/images. Keep the corresponding model license/notices
with your mounted cache and retain provenance when transferring it.

## Runtime and identity

Dedicated model service: official MIT-licensed llama.cpp `b12359` CPU Linux
archive, SHA-256
`0bc1f091e8916102b6d8f2cf944233a620e90a0f856c72d0ce41150c65c2e72e`.
The Dockerfile verifies the archive; entrypoint verifies each GGUF before loading.
Pinned [server API documentation](https://github.com/ggml-org/llama.cpp/blob/b12359/tools/server/README.md).
The server is a narrow native C/C++ inference dependency, not an all-Rust claim.
No Ollama/voice session is autodiscovered or repurposed.

Embedding identity contains weight SHA, dimensions, shared instruction/version,
normalization, task type and runtime revision. Current Standard +
`llama.cpp-b12359` fingerprint is
`9899f70458e9a04e8ed6912e24f3e002e05d670cae06985c172f456b9c0a2164`.
The client verifies the server catalog alias, response alias, vector count,
ordering, finite values, dimension and L2 normalization. The alias is a deployment
contract backed by the entrypoint's local file hash check, not remote attestation.
Provider configuration is administrator-only and must target a trusted private
server. The code never accepts a client-supplied model endpoint.

## Shared method coverage and explicit deviations

| Method | Implementation / boundary |
|---|---|
| Markdown/pages chunker | Desktop-owned pure core, headings/fences/setext/table headers, 2000/200 scalar budgeting; version `loklm-rust-scalar-v1` |
| Dense retrieval | Official LanceDB 0.41.0 cosine; strict model table namespace; SQLite exact reference path in small default development build |
| Lexical retrieval | SQLite FTS5 unicode61 OR-prefix query, scoped before retrieval; no claim of original Lance tokenization equivalence |
| Fusion | Shared `fuse_rrf`, k=60, one vote/list, merge before cap |
| Reranking | Pinned BGE model, shared original 2800-UTF-16-unit passage cap without splitting a scalar; raw HTTP logits converted once with the original node-llama-cpp sigmoid; fail-closed on provider failure |
| Source selection | Round-robin diversity, primary per-source cap 6, short documents <=8 chunks, otherwise +/-1 neighbour; bounded expansion |
| Citations | Original file UUID/path/headings + deterministic content anchor; request-local numeric aliases only when building shared QA prompts |
| Exact source-quote provenance | Shared `source_quote` module integrated with original TS fixture tests (24 anchors/contexts, 11 catalogs); available for checked-QA integration, not automatically applied to generated answers |
| Bilingual QA | Exact shared core templates, budgets plus server tokenizer check, identity validation; no unchecked streamed output |

Not yet parity: original title/language/recency/short-hit boosts and no-reranker
cosine floor, parser support beyond Markdown, the desktop's soft rerank fallback,
full checked-answer/entailment/comparison/alias/router flows, pinned history and
complete codebase QA. No claim that RRF alone replaces those methods. These are
release gates for a full desktop-equivalent knowledge agent, not hidden changes
to LokLM's default model family.

The actual b12359 `/v1/rerank` smoke returned raw logits (including negative
values), unlike the original `node-llama-cpp` `LlamaRankingContext.rankAll`
output. The daemon applies `1 / (1 + exp(-logit))` at this transport boundary.
The reranker fingerprint versions both this score-domain contract and the
UTF-16 passage limit; regenerate its alias after upgrading. This does not change
embedding identity or require source re-embedding. These normalized scores are
ranking weights, not calibrated probabilities or evidence of entailment.
