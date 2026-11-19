# Native constrained generation boundary

`loklm-inference::Model::generate_checked` consumes the immutable final
`ContextPlan`. It requires an admitted checked bundle, the matching language,
and the pinned Qwen3.5-4B profile. Missing catalogs, estimated overflow, other
generator profiles and mismatched language are errors; there is no fallback to
an unconstrained answer or a different source subset.

The final bundle supplies the system prompt, user prompt, ordered JSON schema
and parser/source catalog. The exact pinned ChatML tokenizer admission includes
the planned output allowance (2176 tokens at an 8192-token window) and the
larger of 192 tokens or ten percent of the window. It does not silently clip the
allowance to the old basic path's 2048 tokens. Content is still tokenized with
special-token recognition disabled, while trusted role delimiters are separate.

The pinned `llama-cpp-2 = 0.1.161` `common` feature exposes the C++ JSON Schema
compiler through its Rust API. Only the program-owned comparison schema reaches it; no arbitrary
schema, remote reference or user GBNF input is exposed. Grammar precedes greedy
selection. The binding's `sample()` already accepts the selected token, so the
old redundant `accept()` has been removed from the shared generation loop.
Source: [pinned binding API](https://docs.rs/llama-cpp-2/0.1.161/llama_cpp_2/sampling/struct.LlamaSampler.html).

Structured JSON stays buffered in a zeroizing string. No partial JSON, private
`check` field or generated thought is sent to the desktop stream. The prose
thinking filter and repetition heuristic do not rewrite JSON string values;
the original structured provider likewise preserves literal thinking tags.
Complete EOG, the token limit, a 1 MiB byte ceiling, UTF-8 decoding, cancellation
and final typed parsing are required. The decoder now preserves a leading BOM
and flushes at EOG, rejecting incomplete final Unicode instead of silently
dropping bytes. Typed parsing has its own tighter bounds and duplicate-key,
ordering, citation, source-span and rendering checks.

`CheckedGeneration` exposes only the parsed result and token counts. It does
**not** establish relevance, entailment, completeness, correct conflict
classification or governing authority. The original bounded private reasoning,
experimental evidence-assessment route and desktop routing remain integration
gates. The original default checked route is separate from that experiment and
also does not mechanically certify semantic truth. This method is not
yet wired into the desktop answer action; existing UI/model evidence describes
the basic streaming path at the recorded older source/artifact points.

## Dependency and provenance boundary

Generation is identified separately as
`qwen-chatml-gbnf-typed-comparison-v32-1`. The pinned inference engine/model and
embedding implementation are unchanged; the existing embedding fingerprint is
not silently replaced or used to trigger reindexing. This is not evidence of a
fresh embedding numerical or performance comparison.

The wrapper's new explicit `common` feature enables its Rust APIs. In this exact
crate version, the `llama-cpp-sys-2` dependency already enables its own default
`common` feature even when wrapper defaults are disabled; the C++ helper archive
was therefore already built. This is not a new whole-archive footprint cost.
That archive contains the schema converter and its JSON dependency, and also
builds HTTP/download helpers, which this app does
not invoke. The observed Windows CMake configuration has CUDA, server, tools,
examples, app and CURL disabled. OpenSSL is auto-detected by upstream, **not**
unconditionally disabled on Windows; it was not found in the validated build.
No listener, downloader or external source upload is exposed by this API.
Other-platform linkage and the complete distribution notice inventory still
require validation. See `native/THIRD_PARTY_NOTICES.md`.

## Manual testing

1. From the repository root, set the existing `LIBCLANG_PATH` build setting,
   `CARGO_BUILD_JOBS=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2` and
   `RUST_TEST_THREADS=2`. Run
   `cargo test --locked -p loklm-inference --manifest-path native/Cargo.toml`.
   Expect all 196 admitted original catalog schemas to compile and decoder,
   exact-budget, overflow, revocation and prose-guard tests to pass.
2. Build the explicit synthetic harness with
   `cargo build --locked --release -p loklm-inference --example checked --manifest-path native/Cargo.toml`.
   Run `native/target/release/examples/checked.exe grammar <Qwen4B.gguf>` against
   the existing canonical file. Expect hash validation, no tensor load, valid
   JSON acceptance and invalid source/outcome/envelope/EOG rejection. It also
   verifies grammar masking before greedy choice, and that the parser rejects
   active HTML even when grammar permits it inside a string.
3. Coordinate an idle model window and ensure at least 8 GiB available physical
   RAM before running the same executable with `generate <Qwen4B.gguf>`.
   It loads only its own CPU2 Qwen4B model, uses synthetic German/English facts
   and checks cited code answers, basic-stream preservation, mismatched language
   rejection, cancellation and session revocation during further requests.
   It prints synthetic parsed answers and counts,
   never the private raw JSON/check field. Allow CPU time; no GPU is used.
4. Keep prior desktop executable, UI and performance evidence separate. Do not
   infer UI checked-QA parity or a speed improvement from this harness.

The Qwen4B SHA is the existing local compatibility pin, not an upstream
authenticity attestation. No personal vault, original app or shared model
process is opened or changed by these tests.

## Recorded validation

Source `5c3de0b` passed the 47-test native suite and strict all-target Clippy.
Its release adapter passed the pinned-vocabulary checks and actual CPU2 DE/EN
Qwen4B answers, basic streaming, language mismatch, cancel and session revocation.
Exact executable/model hashes and outputs are in
[native-checked-generation.json](evidence/native-checked-generation.json).
The two structured answers used 731/754 actual input tokens and 88/93 output
tokens, respectively. Cancellation/revocation finished in 1305/1288 ms measured
from request entry, with the request sent after 150 ms. No private JSON was
published. These are synthetic smoke observations, not comparative latency data.
