# Native GPU padding calibration

Evidence is from the installed `node-llama-cpp` 3.21.1 source, inspected without loading a backend. No GPU experiments were performed by the source-review agent.

## What the reserve means

`getVramState()` reports backend free/used/total memory before the configurable padding. Its implementation calls `getBalancedVramState`; that function computes `free = max(0, total - used)` and additionally accounts for wired unified memory when applicable. The API documentation explicitly says configurable padding is not reflected in this public result.

**Vulkan accounting qualification, confirmed by the native candidate:** this public value is not necessarily physical whole-device free VRAM. The installed addon forwards `ggml_backend_dev_memory`. The pinned llama.cpp v0.4.0 Vulkan implementation sums device-local heap sizes for total, but computes free from `heapBudget - heapUsage`. Those fields describe a changing process allocation budget and estimated process usage. The candidate reports 4218 MiB total and about 1198 MiB free just after chat context creation, while the nearest subsequent whole-device sample reports only 446 MiB physically free. Do not treat the two telemetry sources as interchangeable or infer that 768 MiB padding guarantees 768 MiB of physical headroom. [Pinned Vulkan implementation](https://raw.githubusercontent.com/ggml-org/llama.cpp/v0.4.0/ggml/src/ggml-vulkan/ggml-vulkan.cpp), [Khronos budget semantics](https://docs.vulkan.org/refpages/latest/refpages/source/VkPhysicalDeviceMemoryBudgetPropertiesEXT.html).

The internal `MemoryOrchestrator.getMemoryState()` subtracts padding once and subtracts any active allocation reservations. Those reservations protect allocations in progress; the model loader releases its temporary reservation after native initialization. They are not permanently subtracted on top of an already loaded model's observed memory use.

There is a second, deliberate margin for the layer configuration LokLM uses: `gpuLayers: { fitContext: { contextSize } }`. The library's resolver subtracts **another 0.5 times the configured padding**. Ignoring transient reservations/caps, this means:

```text
layer-fit budget = max(0, public free VRAM - 1.5 * padding)
later context allocation budget = max(0, current public free VRAM - padding)
```

This is additive conservative accounting, not two physical allocations and not padding already removed from public free VRAM. The extra 0.5 applies to object-form `fitContext`; explicit numeric layer retries and auxiliary models using `gpuLayers: 'max'` do not take that same branch.

On a 4 GiB GPU, LokLM's unchanged default padding is 1024 MiB. The installed library's own default code would be 8% of total VRAM, approximately 327.7 MiB on that card. Its implementation caps at 1.6 GiB although the declaration comment still says 1.2 GB; the cap discrepancy does not affect this 4 GiB example. The app deliberately supplies its own value.

| Configured padding | Additional fit-context reserve | Total margin during initial layer fit | Extra layer-fit budget versus baseline |
| ------------------ | -----------------------------: | ------------------------------------: | -------------------------------------: |
| 1024 MiB           |                        512 MiB |                              1536 MiB |                                  0 MiB |
| 768 MiB            |                        384 MiB |                              1152 MiB |                                384 MiB |
| 512 MiB            |                        256 MiB |                               768 MiB |                                768 MiB |

These are budget differences, not predictions of layer counts or speed. If **pre-load public free memory** were exactly 1.6 GiB, these initial fitting budgets would be about 102, 486, and 870 MiB respectively. An observed fifteen-layer allocation cannot be explained from that one number alone: check whether the reading denotes used memory, a post-load snapshot, or a different backend/device. Do not compare OS totals and library free memory taken at different phases as if they were the same measurement.

## Separate application planner

`ResourcePlanner.refresh()` reads the unpadded public value. On Windows, its context/profile heuristic then subtracts a 2 GiB desktop headroom plus a 1 GiB runtime estimate before estimating available weight/KV space. This can be especially conservative on a 4 GiB card. It is separate from the native layer fitter: the reduced number is not passed into `getLlama` as another free-VRAM deduction. The planner influences target context and initial KV choice; the library independently fits actual GPU layers against its own padded snapshot. Changing both at once would confound the calibration, so this pass leaves that policy intact.

The planner updates its cached resource object in place. Telemetry stored for later comparison should copy the scalar snapshot at capture time, not retain a mutable reference that a later refresh may overwrite.

## Implemented calibration gate

`LOKLM_VRAM_PADDING_MIB` accepts decimal integers from 512 through 1229 inclusive. Missing/empty values retain the previous `min(1.2 GiB, max(1 GiB, 10% of total))` default. Invalid values log a warning and use that default. Every backend initialization logs the actual `llama.vramPaddingSize` and whether the environment override was applied.

The backend is cached: start a fresh worker/application process for every padding value. The override affects the shared backend's embedding and chat allocations. It does not change model placement, context targets, KV retry order, retry count, reranker policy, or residency serialization. CPU-only backend results and zero-GPU-layer chat allocations remain rejected. Lower padding is an experiment, not a guarantee of stability.

## Controlled sweep and telemetry

1. Keep the same model file/hash, quantization, GPU/device/backend, driver, requested context, prompt, retrieval settings, query subset/order, and generation budget. Run the 1024 MiB baseline and 768 MiB candidate at 4096 requested context first. Compare 8192 context separately after stability; do not mix context and padding effects.
2. Capture exact bytes from `getVramState`: total, free, used, and unifiedSize; configured/actual padding; backend and device name; available system RAM. Capture before weights, after weights/context, and around embedding-to-chat transitions. Retain external background GPU usage and process-memory observations when available.
3. Record actual GPU layers/total layers, resolved context, KV type, load/reload duration, offload/context retries, errors, worker exits, first-token time, total latency, generated tokens, and truncation/cancellation outcomes. Include cold transitions separately from already resident chat calls.
4. Sample free VRAM during prompt prefill and decoding, not only after model load. A model that fits at rest can fail under runtime scratch or compositor pressure. Record minimum observed free memory and the sampling interval; do not label a coarse sample an exact peak.
5. Advance to 512 MiB only if 768 MiB is stable and still worth investigating. Stop/escalate back to a larger reserve after allocation failures, driver resets, worker crashes, repeated fallback, or desktop disruption. Keep library memory-safety checks enabled and retain exclusive residency; do not force maximum chat GPU layers to mask a failed fit.
6. Assess quality and citations on development, including the full dev set for the final candidate. Open the frozen held-out answers only after selecting the candidate. Partial GPU offload may still be CPU-limited; more GPU layers are useful only if measured latency improves without reliability or answer-quality regression.

## Primary local references

- `node_modules/node-llama-cpp/package.json`: installed version 3.21.1.
- `node_modules/node-llama-cpp/dist/bindings/getLlama.d.ts:106`: public padding contract.
- `node_modules/node-llama-cpp/dist/bindings/getLlama.js:30`: actual library default.
- `node_modules/node-llama-cpp/dist/bindings/Llama.js:245`: public VRAM probe; `:700` balances unified memory.
- `node_modules/node-llama-cpp/dist/bindings/utils/MemoryOrchestrator.js:47`: padding subtraction; `:54` temporary reservation subtraction.
- `node_modules/node-llama-cpp/dist/gguf/insights/utils/resolveModelGpuLayersOption.js:7`: additional fraction; `:92` object-form context-fit deduction.
- `node_modules/node-llama-cpp/dist/evaluator/LlamaModel/LlamaModel.js:577`: temporary model allocation reservation; `:623` release after load.
- `src/main/services/embeddings/ResourcePlanner.ts:57`: Windows headroom; `:340` unpadded probe; `:393` separate context budget.
- `src/main/services/workers/modelMemory.ts`: bounded padding helper and unchanged `allocateChat` GPU requirement.
- `src/main/services/workers/modelsWorker.ts`: backend gate and actual padding log.

Validation: 19 pure padding tests plus 3 existing allocator tests passed. No real-model stability claim follows from those tests.
