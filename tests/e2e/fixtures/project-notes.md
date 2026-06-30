# Project Notes — Local RAG Assistant

Short working notes for the demo workspace.

## Goal

Answer questions strictly from the imported documents, with a clickable citation
back to the exact source passage. No cloud calls; everything runs on-device.

## Retrieval pipeline

1. **Hybrid search** — BM25 keyword match + dense BGE-M3 embeddings.
2. **Fusion** — reciprocal-rank fusion (RRF) merges the two rankings.
3. **Rerank** — a cross-encoder re-scores the fused candidates by relevance.
4. **Pack & answer** — top passages go to the local LLM, which answers and cites.

## Open questions

- How many passages should a single answer cite before it feels noisy?
- Tune the relevance floor so a one-line definition still gets fed in full.
- Keep follow-up questions ("what's the difference?") anchored to prior turns.

## Glossary

- **Chunk** — a small, individually retrievable slice of a document.
- **Citation** — a `[doc, passage]` reference rendered as a clickable pill.
- **Vault** — an encrypted, per-workspace store; data never leaves the device.
