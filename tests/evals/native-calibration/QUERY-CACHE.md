# Query-vector cache

Bundled query embeddings are cached by default. Set `LOKLM_QUERY_EMBEDDING_CACHE=0` before starting the app to disable the cache for comparisons or diagnostics. External providers without a reliable cache identity bypass it.

The cache holds vectors only: at most 128 entries and 1 MiB of vector data, with at most 16 shared in-flight keys. It belongs to the current retrieval service and disappears on lock/logout or restart. Its key hashes the actual model path, file size/modification time, explicit load generation, model identity, exact task instruction, and the query after the embedder's existing normalization. Case remains significant. Explicit model reloads or model-file changes invalidate reuse; parking a model to free the GPU does not. Provider changes clear the cache. Native embedding cannot be interrupted, but canceled consumers detach and an abandoned result is not inserted.

Every request still searches current source data, fuses candidates, packs context, and generates a new answer. No retrieved documents, source text, answers, or private query text are retained in this cache. A cache hit does not imply that the answer is correct or unchanged. Diagnostic cache counters are emitted only through the existing opt-in retrieval trace, which itself already includes query text.

## Development timing evidence

The `dev-4k-candidate` run used a GTX 1050 Ti, a 4096-token context, 21 of 33 chat-model layers on GPU, and an experimental 768 MiB planner reserve. Twelve distinct development questions produced twelve misses. Two repeated questions produced cache hits, with identical retrieved chunk ordering and **no model switching** during either repeat:

| Case   | First total | Repeat total | First retrieval | Repeat retrieval |
| ------ | ----------: | -----------: | --------------: | ---------------: |
| dev-01 |    71.582 s |     35.023 s |         6.472 s |          0.006 s |
| dev-03 |    77.878 s |     51.919 s |         7.424 s |          0.009 s |

The work before native answer generation fell from approximately 45 seconds to 11–13 milliseconds because a resident chat model no longer had to be evicted to embed the repeated question. Native generation varied and was slower in both repeats, so end-to-end savings were smaller than the eliminated switching time. The wrong citation in dev-03 was repeated: caching is a latency optimization, not a quality correction.

These are two repetitions from a small synthetic development corpus, not an independent quality benchmark or a latency guarantee. Unique queries still require embedding, and larger or different models/hardware were not measured here. The cache uses host memory and does not change GPU residency, inference placement, reranker policy, or refusal thresholds.
