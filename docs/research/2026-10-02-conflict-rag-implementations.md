# Conflict-aware RAG: implementation review, 2026-10-02

## Decision

For LokLM's existing Qwen3.5-4B/node-llama-cpp runtime, the strongest bounded
experiment is an **evidence-first, structured pass using the already-resident
chat model**, followed by deterministic validation of source IDs and verbatim
spans. Keep competing evidence visible. Do not introduce a new inference
framework, a second resident verifier, or source-credibility weights.

This is an implementation recommendation, not a measured quality improvement.
No downloaded research code was executed, no model was downloaded, and no GPU
benchmark was run for this review. Repository files were inspected at the
revisions below. The paired papers/datasets review belongs in the companion
research note.

A crucial distinction: proving that one passage supports an answer does not
prove that another supplied passage does not contradict it. Checking citation
membership or exact text is useful, but neither check establishes approval,
authority, applicability, or the absence of competing evidence.

## What existing projects actually implement

| Project and inspected revision                                                                                                                                                                        | Mechanism and cost                                                                                                                                                                                                                                             | Relevance to LokLM                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LangGraph local adaptive RAG](https://github.com/langchain-ai/langgraph/blob/157a06dda988d85afeb8751ff27b35ab3f4f8bf4/examples/rag/langgraph_adaptive_rag_local.ipynb), MIT                          | Local Ollama JSON grader runs once per retrieved document; a generated answer then receives groundedness and question-answering grades. Failed grades lead to regeneration or query rewriting/retrieval. The example is explicitly archived.                   | Borrow bounded state transitions, not its full loop. For N documents this adds N relevance calls and up to two answer-grade calls before retries. It does not prove authority-aware conflict resolution. Its graph includes a regeneration cycle, so a product implementation needs an explicit small retry budget. |
| [LlamaIndex FaithfulnessEvaluator](https://github.com/run-llama/llama_index/blob/962940ddc079cc21701d28d1237c84c82a7c5164/llama-index-core/llama_index/core/evaluation/faithfulness.py), MIT          | Tests an answer against contexts through a summary/refine query. Its prompt accepts support from any context; a positive result remains positive during refinement.                                                                                            | This is directly insufficient as a conflict gate: selecting one supported but contested value can pass. Useful offline for a different question—unsupported generation.                                                                                                                                             |
| [LlamaIndex CitationQueryEngine](https://github.com/run-llama/llama_index/blob/962940ddc079cc21701d28d1237c84c82a7c5164/llama-index-core/llama_index/core/query_engine/citation_query_engine.py), MIT | Splits retrieved nodes into smaller numbered citation nodes, then uses citation-aware answer/refine prompts.                                                                                                                                                   | Citation presentation and granularity, not attribution verification. LokLM already has canonical chunk IDs. Replacing them with another numbering scheme is not evidence that conflicts improve.                                                                                                                    |
| [Haystack FaithfulnessEvaluator](https://github.com/deepset-ai/haystack/blob/9f31fb4b0ef318c51a6fa8ad30321336d99e2cb8/haystack/components/evaluators/faithfulness.py), Apache-2.0                     | One evaluator prompt asks a configured LLM to split the generated answer into statements and score each against the contexts; the component averages those scores. Default generator is remote unless replaced.                                                | Useful offline statement-level diagnostics. It grades statements that were produced, not contradictions that were omitted. No direct approval/supersession policy.                                                                                                                                                  |
| [Ragas Faithfulness and HHEM variant](https://github.com/explodinggradients/ragas/blob/298b68274234c060deacab3cf5fb52aa3a20e885/src/ragas/metrics/_faithfulness.py), Apache-2.0                       | Faithfulness calls an LLM to extract statements and another prompt to judge them. HHEM retains the first LLM call but replaces the second stage with a separate Transformers classifier over context/statement pairs. The implementation defaults HHEM to CPU. | Useful evaluation decomposition, but two extra inference stages and no source-conflict completeness guarantee. The CPU-default classifier conflicts with this app's intended GPU inference workflow; merely installing it does not integrate GPU task swapping.                                                     |
| [ARES](https://github.com/stanford-futuredata/ARES/blob/c7c9018a755faf8347c4da415632bae1593ef104/README.md), Apache-2.0                                                                               | Synthetic training examples, adapted judges/classifiers, and prediction-powered evaluation using labeled validation examples. The current guide requests at least 50 human-labeled examples, preferably several hundred.                                       | An offline measurement approach, not a turnkey per-answer conflict resolver. Its calibrated evaluation discipline is useful; training/inference dependencies and labeling cost do not fit this bounded app change.                                                                                                  |
| [Original CRAG implementation](https://github.com/HuskyInSalt/CRAG/blob/de7c2961ae624a1483a138c5798e1f6d0c4fb0e0/scripts/CRAG_Inference.py), no root license identified in inspected tree             | A trained T5 relevance evaluator assigns retrieval confidence. The inference script selects internal, external or combined prepared knowledge and invokes a separate vLLM generator.                                                                           | It addresses unreliable retrieval, not two already-retrieved, relevant drafts with incompatible values. A relevant passage is not necessarily authoritative. Extra evaluator/runtime and web preparation would add complexity. Do not copy code without first resolving its licensing.                              |
| [Original Self-RAG](https://github.com/AkariAsai/self-rag/tree/1fcdc420e48f50a7d7ab1ece5494221b93252e99), MIT code                                                                                    | Trains critic/generator behavior around special reflection tokens and uses segment-wise search; released examples use specialized 7B/13B models and vLLM.                                                                                                      | These learned tokens are not a prompting feature of our unmodified Qwen model. Porting the framework is a model/training/runtime project, not a small conflict fix. Code licensing does not replace model-weight licensing.                                                                                         |

The licenses above were checked against repository metadata and license files,
not inferred from the word “open” in a README. Relevant primary license files:
[LangGraph](https://github.com/langchain-ai/langgraph/blob/157a06dda988d85afeb8751ff27b35ab3f4f8bf4/LICENSE),
[LlamaIndex](https://github.com/run-llama/llama_index/blob/962940ddc079cc21701d28d1237c84c82a7c5164/LICENSE),
[Haystack](https://github.com/deepset-ai/haystack/blob/9f31fb4b0ef318c51a6fa8ad30321336d99e2cb8/LICENSE),
[Ragas](https://github.com/explodinggradients/ragas/blob/298b68274234c060deacab3cf5fb52aa3a20e885/LICENSE),
[ARES](https://github.com/stanford-futuredata/ARES/blob/c7c9018a755faf8347c4da415632bae1593ef104/LICENSE),
[Self-RAG](https://github.com/AkariAsai/self-rag/blob/1fcdc420e48f50a7d7ab1ece5494221b93252e99/LICENSE).

## Newer conflict-specific repositories: useful parts and limits

### rag-conflict-eval

Inspected revision `6abc5bf3933146744fd78d090a7de7430594ebab`,
[MIT](https://github.com/Lawson-Darrow/rag-conflict-eval/blob/6abc5bf3933146744fd78d090a7de7430594ebab/LICENSE).
Its coarse detector first asks for each source's value for the question's answer
slot, then classifies divergence, temporal supersession or no material issue.
There is one model call and at most one JSON repair. The parser validates the
label, but does not independently establish that extracted claims or source
dates appear in source text. A numeric confidence comes from the model and is
thresholded afterward. [Detector source](https://github.com/Lawson-Darrow/rag-conflict-eval/blob/6abc5bf3933146744fd78d090a7de7430594ebab/src/rag_conflict_eval/coarse.py).

The answer-slot/per-source organization is useful. Its temporal prompt allows
dates/version/status to imply supersession, which is weaker than LokLM's needed
rule: a later unapproved draft must not automatically replace an earlier draft.
Do not copy that policy or a confidence threshold. The project itself calls the
behavior rater pre-alpha and not human-validated; its diagnostic status is more
appropriate than treating it as an autonomous release gate.
[Prompts](https://github.com/Lawson-Darrow/rag-conflict-eval/blob/6abc5bf3933146744fd78d090a7de7430594ebab/src/rag_conflict_eval/prompts/templates.py),
[project limitations](https://github.com/Lawson-Darrow/rag-conflict-eval/blob/6abc5bf3933146744fd78d090a7de7430594ebab/README.md).

### agentic-rag-verified-citations

Inspected revision `87d5c96c9fa314fdc2c1a527c57f26bd60a54686`,
[MIT](https://github.com/deepeshgupta12/agentic-rag-verified-citations/blob/87d5c96c9fa314fdc2c1a527c57f26bd60a54686/LICENSE).
Useful principle: validate each cited ID against immutable evidence, then render
from validated structured records rather than trusting unrestricted synthesis.
However, its deterministic support test is content-word overlap (default 0.45)
plus checks for normalized figures/dates. This is a rejection heuristic, not
semantic entailment. Shared words can hide wrong negation, actors, periods or
scope. Its code explicitly acknowledges this narrower contract.
[Grounding implementation](https://github.com/deepeshgupta12/agentic-rag-verified-citations/blob/87d5c96c9fa314fdc2c1a527c57f26bd60a54686/ragverify/grounding.py).

Cross-source detection compares sentence pairs using overlap and normalized
values/polarity, with a bounded pair count. This is cheaper than a second model,
but short sentences, German morphology, equivalent dates, negation and differing
business scopes need separate testing. A normal pair of different-period figures
is not automatically a contradiction.
[Contradiction implementation](https://github.com/deepeshgupta12/agentic-rag-verified-citations/blob/87d5c96c9fa314fdc2c1a527c57f26bd60a54686/ragverify/contradiction.py).

Its resolution layer weights corroboration, source authority, recency and
specificity and still reports both sides. Do not bring these weights into
private workspace documents: labels, repetition and a later date do not grant
approval. The orchestrator also runs a multi-stage retrieval/draft/verify loop
and may repair synthesis; that whole pipeline would add multiple serialized
generations here.
[Resolution](https://github.com/deepeshgupta12/agentic-rag-verified-citations/blob/87d5c96c9fa314fdc2c1a527c57f26bd60a54686/ragverify/resolution.py),
[orchestrator](https://github.com/deepeshgupta12/agentic-rag-verified-citations/blob/87d5c96c9fa314fdc2c1a527c57f26bd60a54686/ragverify/orchestrator.py).

### C3-RAG

Inspected revision `09c468dbe526b4cc0500f94e29c5bb2d66796738`,
[MIT](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/LICENSE).
The pipeline initializes a sentence encoder, learned credibility graph, NLI
model and a separate causal generator. Configuration defaults to an 8B bfloat16
generator. NLI evaluates both directions for every document pair, so N documents
produce N(N−1) pair classifications; truncation is 512 tokens per pair. This is
not compatible with the existing one-active-task 4 GB deployment without a new
runtime/resource plan.
[Pipeline](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/c3rag/pipeline.py),
[NLI](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/c3rag/cea/contradiction.py),
[configuration](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/configs/default.yaml).

Two concrete evaluation cautions: callers must explicitly load trained graph
weights after initialization; construction alone does not do so. Also,
`evaluate()` uses substring membership for correctness, making an empty
abstained answer count as correct against any reference. The decoder can return
that empty answer when its entropy threshold fires. These are source-inspection
findings, not model benchmark results. Its reported metrics should not be used
as evidence to adopt this implementation unchanged.
[Evaluator path](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/c3rag/pipeline.py),
[decoder](https://github.com/gymlll/C3-RAG/blob/09c468dbe526b4cc0500f94e29c5bb2d66796738/c3rag/ugd/decoding.py).

## Small verifier models are a different tradeoff

[MiniCheck](https://github.com/Liyan06/MiniCheck) checks document/sentence
support. Its code is Apache-2.0; inspected small Flan-T5-Large and DeBERTa-v3-Large
model cards advertise MIT licenses. The 770M Flan-T5 model still requires a
separate inference implementation and GPU scheduling; a pairwise support result
does not settle conflicts across all sources. The 7B variant has separate
commercial-use terms, so do not transfer the small-model/code license to it.
[Small model card](https://huggingface.co/lytang/MiniCheck-Flan-T5-Large),
[runtime selection](https://github.com/Liyan06/MiniCheck/blob/main/minicheck/minicheck.py).

[HHEM-2.1-Open](https://huggingface.co/vectara/hallucination_evaluation_model)
is Apache-2.0, uses a separate Transformers/custom-code model, and scores
premise/hypothesis support. Its public card identifies English; multilingual
support including German is described for the separate commercial version.
Do not assume the open checkpoint has validated German conflict behavior.
Neither verifier was loaded or benchmarked here. Both are more plausible as
future separately calibrated offline evaluators than immediate resident app
dependencies.

## Existing LokLM integration surface

The audit below refers to the clean `40fe513` starting tree; later experiments
must record their own source and compiled hashes.

1. `QAService.ts:450–533` collects pinned chunks, captures one provider, calls
   `prepareContext()` after retrieval, and packs against actual capacity. The
   audit belongs after evidence is available and before user-visible answer
   tokens. Preserve the no-evidence path's zero model-load behavior.
2. `providers/types.ts:16–39` already exposes raw generation with JSON schema,
   task-specific system prompt, token limit, completion requirement, abort
   signal and planned context. No new Python service is necessary.
3. `modelsWorker.ts:575` skips the extra utility context on GPUs of 6 GiB or less.
   On this 4 GB card raw generation uses the loaded chat model/main context;
   it does not introduce another resident model. `llmGenerateRaw` saves/restores
   chat history, resets its sequence and patches the task prompt. The added pass
   still costs prefill/generation and may lose useful main-context KV reuse.
4. `ModelsWorkerClient.ts:335–356` routes foreground raw generation through the
   existing chat gate and cancels optional title work. Worker FIFO, cancellation
   and session retirement already apply. A concurrent indexing task can still
   force a later capacity change; preserve the existing preparation/shrink guard.
5. `workers/contextBudget.ts` has public-wrapper exact token counting for a
   **shrunk** context. It is not an unconditional exact check of every unchanged
   window. Audit prompt/system/schema instructions, evidence and output reserve
   therefore need their own conservative budget; answer packing alone is not
   an audit budget. Raw calls retain their explicit output cap.
6. `QAService.ts:534–635` currently publishes citations then streams answer tokens.
   A verifier after generation cannot retract text users already saw. Either
   audit first, or buffer a candidate before any answer-token publication. A
   final deterministic conflict response must keep terminal/persisted text and
   citation events consistent and honor cancellation.

### Sampling and structured output

Installed node-llama-cpp is **3.21.1**. `LlamaChatSession.js` and `LlamaChat.js`
forward an omitted temperature; `LlamaContext.js:1142,1794` resolves it to **0**.
Bundled chat is therefore already greedy at this setting; explicit utility
`temperature: 0` is not a new determinism improvement. Both current chat and
default raw generations enforce zero thought-token budget in the worker. A
`/no_think` text instruction alone is not the runtime control.

The current grammar API supports enums, bounded arrays and bounded strings.
Use enums for valid evidence IDs and independently validate every returned
record. Grammar limits output structure, not truth. The official guide also
requires describing the intended format in the prompt and bounding generation.
[node-llama-cpp grammar documentation](https://node-llama-cpp.withcat.ai/guide/grammar).

Ollama raw generation currently ignores `jsonSchema` and `noThink`. Its comment
claiming no applicable API hook is stale: the official `/api/generate` supports
`format` with a JSON schema and a model-dependent `think` option. Provider parity
can be added narrowly if needed, but it must preserve compatibility/error handling
and still run semantic validation. Some models cannot disable reasoning; use the
capability contract rather than promise all providers obey the same budget.
[Ollama generate API](https://docs.ollama.com/api/generate),
[thinking controls](https://docs.ollama.com/capabilities/thinking).

### Bounded implementation follow-up, 08:11 UTC

The source changes following this audit address two prerequisites without
changing the evidence experiment's default or adding a model/runtime:

- Ollama raw generation forwards `jsonSchema` through `format` and maps an
  explicitly provided `noThink` to `think`. Omitted controls preserve the model's
  default. HTTP 400/422 remains a client error with capability guidance; there
  is no silent retry after dropping the requested constraints. Inline error
  events, a stream without a terminal `done`, and empty complete/structured
  results fail rather than returning a successful partial assessment.
- Every explicit `plannedContextTokens` request now checks the native wrapper's
  exact input count plus the requested output and existing native margin,
  including unchanged or larger contexts. Measurement failure fails closed.
  Calls without a bounded-context contract retain their existing behavior.
  Utility routing counts a hypothetical fresh history with the actual per-call
  system prompt, without modifying either live session; insufficient or unknown
  utility capacity selects the already resident main context.

The fixed QA packing margin and native ten-percent margin are not identical;
near-capacity estimated plans can now produce a safe fit error instead of an
implicit context shift. This remains an admission/budget alignment concern for
the caller, not permission to remove evidence silently.

Validation at this point: eight scoped provider/context/worker test files,
**135 tests passed**; node TypeScript and forced scoped ESLint passed. These
are mocked/runtime-unit checks, not a native quality or performance result.
The ongoing native baseline still uses the frozen pre-change compiled app.

## Minimal bounded experiment

Use one batch over the exact supplied evidence rather than one model call per
source. Each record should retain a known source/chunk ID, the exact supporting
span, the question's requested value, relevant entity/period/scope, and a separate
span for any approval or supersession claim. Treat all source bodies as data.
Avoid a numeric self-confidence field; it is not a calibrated probability.

Code can reliably enforce JSON shape and bounds, known IDs, record uniqueness,
verbatim span membership, and whether every required source received a record
or explicit “not relevant/unknown” outcome. It cannot establish semantic scope
or authority merely because a quoted word occurs somewhere. In particular,
the word “approved” can appear in a negation or in a different project's record.
Keep that distinction in both implementation names and UI copy.

The product policy remains: preserve unresolved competing evidence; accept a
single winner only when applicable authority or supersession is actually
established. Later timestamps, repetition, a confident source title, a model
confidence number and retrieval rank are not approval. If a bounded extractor
cannot account for all relevant competing evidence, do not relabel the ordinary
answer as verified.

| Candidate path                                                        | Extra inference and main limitation                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict source-ID/span checks only                                     | No extra model; prevents fabricated provenance but not wrong semantics.                                                                                        |
| One batched evidence pass before normal answer                        | One extra raw generation, no second resident model; measure added prefill/output latency and extraction omissions.                                             |
| Evidence pass followed by deterministic unresolved-evidence rendering | Can replace the normal generation for that route; copied spans preserve provenance, but correct conflict/applicability classification still needs measurement. |
| Draft → model judge → optional regenerated answer                     | One or two extra generations and delayed streaming; the same model can repeat the same error.                                                                  |
| Per-document model grading or all-pairs NLI                           | N or N(N−1) classifications and extra model/runtime costs; unsuitable as the first 4 GB experiment.                                                            |

Do not silently truncate evidence to make the audit fit. If adding a compact
evidence record to the final prompt, include it in the same budget used for
actual rendering; otherwise the second pass can invalidate the previously safe
context plan. No model reload/embedding pass should be introduced between audit
and answer solely for verification.

Minimum evaluation axes: unresolved versus explicitly superseded sources;
approval negation; different periods/entities that only look contradictory;
equivalent units/dates; an absent requested fact; duplicate and reversed source
order; multilingual EN/DE; long-context packing that loses one side; unsupported
IDs/spans; malformed/truncated JSON; abort and vault lock during the added pass.
Measure false conflict/refusal as well as false definitive answers. Reuse neither
fixture-specific entities nor expected values in production prompts.

## Reproducibility and limits

Primary source copies used only for reading are under ignored
`out/research-20261002/`. GitHub revision hashes above pin inspected code. Model
metadata checked: MiniCheck-Flan-T5-Large `96eafd01cee2d16cf81aaa2fb226b14f422a37b3`,
MiniCheck-DeBERTa-v3-Large `2f2d01a54fa022a7ffadb76260e1ea8bc88c82bb`, HHEM
`8e4a2e6e96c708cc76c2344f7e4757df2515292c`. No third-party package was installed.
This review does not establish that Qwen3.5-4B can perform the proposed extraction
reliably; the native experiments must decide that separately.

## Baseline retrieval and resource follow-up, 08:23 UTC

The frozen `authority-20261002-baseline-dev` trace exposed a concrete query
decomposition bug. DEV01's generic trailing instruction, “Briefly explain the
evidence.”, became an independent lexical and dense search variant. On the
actual question alone, the two relevant ledger passages ranked first/second in
both arms: BM25 12.238 each versus 1.737 next, dense 0.844/0.843 versus 0.339 next.
The instruction-only dense arm instead put sensor passages first/second and
the ledger passages fourteenth/fifteenth. Equal RRF votes then put the sensor
passages ahead; both required ledgers remained present at ranks three/five.

Recomputing the unchanged RRF formula over only the actual-question arms gives
both ledgers 0.032522 and first/second positions (chunk ID breaks their tie).
This is a trace replay, not another native inference or answer-quality result.
A narrowly anchored EN/DE presentation-tail fix now removes generic requests
for evidence/reasoning explanations from retrieval variants. Subject-bearing
requests such as “Explain the evidence for another contract”, mixed substantive
clauses and standalone requests remain. Generation still sees the original
user message. Four focused files / **115 tests passed**, scoped lint clean.

The ten-passage count is intentional app configuration: `main/index.ts` injects
the user's `retrieval.topK`, whose default is ten, before QA's adaptive fallback.
Lean retrieval reduces extra model work and candidate pool size, not this cap.
Without reranking, any lexical hit bypasses the cosine-only relevance floor;
all fifteen DEV01 passages had some lexical match, including scores near
0.000001, so none were floored out. Rank fusion deliberately does not preserve
the BM25/cosine magnitude gap. Fixing the instruction vote is supported by this
trace; lowering topK or introducing a new confidence cutoff is not established
by it and could remove a competing source.

The same baseline recorded 616 resource samples: free system RAM ranged from
0.77 to 8.16 GiB (mean 3.33 GiB); its minimum was 825,036,800 bytes at 08:08:46 UTC
during DEV07. A later read-only process snapshot showed `vmmemWSL` using an
8.49 GiB working set. No process was stopped or reconfigured. The app used an
8192-token window, 14 of 33 layers on GPU, six inference threads and 1 GiB native
VRAM padding. Partial GPU offload still depends on CPU/RAM performance.

DEV01–06 took 80–156 seconds total, with 34–50 seconds to first answer text;
DEV07 reached the 180-second harness limit after 159.6 seconds in native
generation and 214 evaluated output tokens. Memory pressure is a material
timing confound, not proof of page-fault activity without relevant counters.
A second evidence pass adds prefill/output work on this machine and must be
measured, not presented as a latency improvement merely because it is bounded.

## Structured-output first-token investigation

The first native evidence-order probe returned otherwise JSON-shaped output
without its opening brace. The raw worker result was preserved; neither the
probe nor a parser repaired it. Independently, its selected spans described
document metadata rather than the requested values, so fixing syntax alone
cannot establish useful evidence extraction.

Installed node-llama-cpp 3.21.1 provides a concrete mechanism matching the missing
token: `QwenChatWrapper.js:99` auto-opens a thought segment for its 3.5 variation;
`LlamaChat.js:143–156` opens it before generation, while `LlamaChat.js:199–218`
records a generated token before checking segment budgets. The budget handler
then closes the segment at zero. Finally, `LlamaChatSession.js:306–308` excludes
segment objects from `responseText`. With a JSON grammar, its first accepted
brace can therefore belong to a hidden thought segment while the grammar moves
on. A zero thought-token budget is insufficient to prevent this first-token
classification in that version.

The bounded fix resolves the actual model's wrapper and changes only an
auto-thinking Qwen 3.5 wrapper to the public `thoughts: 'discourage'` mode,
preserving its variation and thought-history option. That mode supplies a closed
empty thought prefix before answer generation. Other model families and already
explicit wrapper modes remain unchanged. The normal zero thought budget remains
in place; an explicit raw `noThink: false` still omits that hard-zero budget and
allows model-initiated reasoning, but no longer forces an opening thought segment.
No private fields, output concatenation or JSON repair are used.
[Public Qwen wrapper API](https://node-llama-cpp.withcat.ai/api/classes/QwenChatWrapper).

The first checks passed **53 scoped tests**, including actual installed Qwen
wrapper context rendering and worker/session mocks for JSON/ordinary first
tokens, explicit reasoning permission, context routing and cancellation; Node
TypeScript and scoped lint passed. The subsequent root-run native B probe,
`out/optimization-20261002/evidence-order-candidate-b/raw.json`, preserved the
opening brace in both selected observations (authority DEV01 and DEV03) and
returned complete JSON. This addresses the observed syntax symptom; it does
not establish general extraction or conflict-resolution quality. Its timing
comparison with A was not a controlled performance experiment.

## Follow-up output and grammar lifetime review

The evidence schema varies with source IDs, unlike the small fixed set used by
quizzes. The worker grammar cache now retains only the 16 most recently used
schemas. All compilation calls already share the native FIFO, so identical
queued requests reuse the first completed compilation; failures are not cached.
Installed `LlamaGrammar` exposes no public disposal method. Its native
`AddonGrammar` stores the grammar source and addon reference, with temporary
parse state freed during construction. Eviction drops the strong reference;
normal ObjectWrap collection releases the remaining handle. This does not
allocate or dispose an additional model or context.

`LlamaService.generateRaw` now preserves structured response text instead of
applying the global `<think>…</think>` regex inside JSON values. Ordinary text
utility responses keep their existing filter. Four focused files / **60 tests
passed**, including cache recency/eviction, queued compilation reuse, failure
retry, literal JSON values, late cancellation and native context guards. Node
TypeScript and forced scoped ESLint also passed. These changes follow native B
and require a distinct compiled snapshot for subsequent native results.

This is a service-level preservation guarantee, not an end-to-end native one.
In installed 3.21.1, `LlamaChat.js:941–959` constructs a segment handler even
when a grammar is active, and its token detectors are not JSON-aware. Qwen's
thought prefix contains a special token plus an actual newline; ordinary text
tokens spelling the tag and JSON-escaped `\\n` do not inherently form that
prefix. However, normal detokenization uses `specialTokens=false`
(`LlamaModel.js:298–325`), so a sampled control token may lose its printable
spelling before the service sees `responseText`. Source inspection alone did
not establish the actual model/tokenizer behavior.

The root-run C control subsequently forced an exact JSON `quote` enum for
three values: ordinary source text, `<think>draft</think>`, and paired tags
surrounding newlines and “not approved”. All three decoded values matched the
input exactly, with intact JSON and no native errors. It used Qwen3.5-4B,
8192 tokens, f16 KV, 14 GPU layers, temperature zero, `noThink:true` and a
128-token output cap. No output was repaired. The immutable raw artifact and
independent review are under `out/optimization-20261002/literal-json-c/`.

This is three observed controls, not a guarantee for arbitrary token sequences,
models or explicit reasoning mode. The native probe calls the worker directly;
the service preservation and late-cancellation behavior are established by the
separate focused unit tests. These checks compose at the returned-string
boundary, but are not a full application QA/quiz end-to-end test. An enum also
removes semantic extraction from the task: success says nothing about finding
the right evidence or resolving conflicting claims. Control generation times
were 6.780, 10.103 and 11.787 seconds; no broader speed claim follows.

The installed grammar remains active during all ordinary generated tokens
(`LlamaChat.js:1959–1969`), independently of thought-segment state. Raising the
thought budget or restoring auto-open is therefore not a proven way to obtain
free-form reasoning followed by constrained JSON: grammar-valid JSON could
again enter hidden segments. Any reasoning-first approach needs a separate,
bounded design and native quality/latency validation.

## Remote streaming completion follow-up

The review found a separate existing bug in Ollama chat: EOF without the API's
terminal `done` record returned accumulated text as a successful answer. The
provider now rejects missing completion and inline error records. A transient
failure before any response text keeps the existing registry fallback policy;
after response text has been produced it becomes non-retryable, preventing a
second model from being joined to a partial answer. HTTP 400/422 configuration
failures are not retried, and cancellation is checked through the final event.

Root also fixed QA's error path to drain accepted queued text before publishing
the error, with cancellation checks between every yield. That preserves the
partial answer's durable failed status without flushing private text on lock
or cancellation. The provider, registry and chat-turn composition tests plus
QA's queue-race tests passed: **six files / 73 tests**, Node TypeScript and scoped
lint clean. These are mocked protocol/lifecycle regressions; no additional
external server or native model run is claimed.

## Final E native evidence lifecycle

The opt-in `tests/e2e/evidence-assessment-lifecycle.spec.ts` passed on the frozen
E application build at 11:27:45 UTC. It uses a disposable vault, two synthetic
source documents, the experimental assessment flag, and a separately selected
Full profile. All resident checkpoints reported the same Qwen3.5-4B model,
8192-token context and 14 GPU layers. This is lifecycle coverage, not another
matched answer-quality comparison.

After the actual native assessment had started, ordinary Stop completed in
5.568 seconds, emitted one cancelled terminal without answer tokens, and
persisted the interruption with its already-retrieved source metadata. The
next ordinary chat turn answered correctly with a citation. A second assessment
was interrupted by vault lock in 2.249 seconds: its push terminal contained no
private content, its retired IPC invocation rejected as locked, and only the
user message remained stored. A fresh worker after unlock answered correctly;
old listeners received no late content or duplicate terminals. Compiled main,
worker, shared-chunk and preload hashes were unchanged, and cleanup left no
Electron processes. Evidence: `out/optimization-20261002/evidence-lifecycle-e-1125/`.

Two earlier attempts are retained at `evidence-lifecycle-e-1119/` and
`evidence-lifecycle-e-1123/`. They exposed test mistakes rather than application
failures: ordinary Stop deliberately preserves retrieved-source metadata
(`chatTurn.ts` / `reconcileCitations`), and persisted citation records use
`chunkId` while live events use `chunk_id`. The final test asserts the exact
source identities and maintains the stronger empty-content contract on lock.

## Bounded thinking diagnostic over observed failures

After the lifecycle run, a separate out-only script used the installed public
node-llama-cpp API directly, without the application or SQLite. It selected
Qwen3.5 `thoughts: 'auto'`, a 128-token thought budget, 512 total output tokens,
temperature zero, one 8192-token F16 context, 14 Vulkan GPU layers, six threads
and a 1 GiB VRAM reserve. Model loading took 15.056 seconds. No hidden thought
text was saved: the artifact contains final `responseText`, token counts and
stop reasons. Both requests stopped normally with `eogToken`.

This was a combined diagnostic, **not a matched reasoning-only comparison**:
the input used complete required source pairs and a short generic evidence
prompt, rather than production retrieval and its full prompt. The two controls
had already failed in observed native runs and were therefore development
controls, not fresh validation. The three-case prepared plan remains intact;
the pump-count case was explicitly unrequested because of the time limit.

| Observed control                                 | Result                                                                                                                                                                 | Generation | Evaluated output tokens |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: | ----------------------: |
| Original held-out 10, unresolved draft deadlines | Kept both dates, cited both sources, and did not invent approval or supersession; failed the requested ISO date format.                                                |   97.726 s |                     210 |
| Reserved 05, equivalent duration units           | Still failed: opened by saying the records disagree, then acknowledged that 1.5 minutes equals 90 seconds, and treated absent supersession as unresolved disagreement. |  112.801 s |                     260 |

Evidence and exact prompts/configuration/hashes:
`out/optimization-20261002/thinking-diagnostic-1128/raw.json`, prepared by
`thinking-diagnostic.cjs` and `thinking-diagnostic-plan.json` in the same parent
directory. Cleanup completed with no owned Node or Electron process remaining.
A separate matched nonthinking script/plan was prepared but **not executed**
because the remaining window before the native deadline was too short. These
results do not justify enabling reasoning or the evidence assessment by default;
the compatible-unit failure remains, and the apparent authority improvement
cannot be attributed to reasoning alone.
