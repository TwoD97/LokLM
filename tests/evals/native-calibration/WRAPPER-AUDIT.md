# Qwen no-thinking path: local implementation audit

Inspected on 2026-09-24 against installed `node-llama-cpp@3.21.1` and
`models/Qwen3.5-4B-Q4_K_M.gguf`. This audit read GGUF metadata and executed only
the JavaScript chat-template resolver. It did not initialize a llama backend,
load model tensors, or run GPU inference. No wrapper/default changes were made.

The metadata reports architecture `qwen35`, model name `Qwen3.5-4B`, and a
template that emits `<think>\n` when `enable_thinking` is explicitly true, or
an empty closed thinking block otherwise. Resolving that metadata without a
native tokenizer returned `QwenChatWrapper`, variation `3.5`, `thoughts: auto`,
and `segments.thought.openOnResponseStart: true`. This is a metadata-only
resolver result, not a captured runtime-session assertion. An explicitly
constructed Jinja wrapper with `reasoning: false` rendered the empty closed
block; its default `reasoning: true` enables the opening behavior.

LokLM passes `budgets: { thoughtTokens: 0 }` on the chat `noThink` path. The
installed library forwards that value unchanged. Its generation loop can
open a thought segment at response start and perform checkpoint/setup work
before checking the budget inside the token-evaluation loop. The budget
handler closes an open thought segment when its count is greater than or
equal to zero and requests a rerender. Thus a zero budget is enforced, but
does not prove that all thought-related setup or initial evaluation work is
avoided. It does **not** establish that a long hidden reasoning stream caused
the dev-07 latency spike.

The existing `onTextChunk` callback and returned plain response exclude
segmented thought content. Short visible text therefore does not measure all
evaluated tokens. The next trace should compare native token-meter deltas,
time to first non-whitespace callback, visible callback totals, prompt size,
and model-switch timing. Token-meter output counts positions evaluated with
logits, not simply the visible answer's tokenization. If attribution remains
unclear, `onResponseChunk` can count tokens by segment type while discarding
all segment text. Actual wrapper settings and `sequence.needsCheckpoints`
are also accessible through public session getters.

Local primary references (line numbers from the inspected installation):

- `src/main/services/workers/modelsWorker.ts`, `llmAsk`: passes zero thought
  budget and streams only `onTextChunk`; `llmGenerateRaw` uses the same budget.
- `node_modules/node-llama-cpp/dist/chatWrappers/QwenChatWrapper.js:17,96`:
  default `thoughts: auto` and variation 3.5's `openOnResponseStart` setting.
- `node_modules/node-llama-cpp/dist/chatWrappers/generic/JinjaTemplateChatWrapper.js:76,500`:
  default reasoning setting and `enable_thinking` rendering parameter.
- `node_modules/node-llama-cpp/dist/chatWrappers/utils/resolveChatWrapper.js:136`:
  metadata-template equivalence checks select a specialized wrapper.
- `node_modules/node-llama-cpp/dist/evaluator/LlamaChatSession/LlamaChatSession.js:75,80,178`:
  public wrapper/sequence getters and thought-budget forwarding.
- `node_modules/node-llama-cpp/dist/evaluator/LlamaChat/LlamaChat.js:143,183,216,2200`:
  initial thought opening/checkpoint path, evaluation loop, budget check, and
  segment closure/rerender.
- `node_modules/node-llama-cpp/dist/evaluator/LlamaChat/LlamaChat.js:2611,2647`:
  ordinary text callbacks versus separate segmented response callbacks.
- `node_modules/node-llama-cpp/dist/evaluator/LlamaContext/LlamaContext.js:329,1373,1411`:
  token-meter accounting, checkpoint RAM storage, and checkpoint requirement
  for hybrid/recurrent models. These mechanisms are not a measured diagnosis
  of this run's latency.

Reproduction: call `readGgufFileInfo` with `readTensorInfo: false`, filesystem
source, and tokenizer vocabulary/merges ignored; pass the resulting file info
and filename to `resolveChatWrapper`. Neither `getLlama` nor model loading is
required. Runtime metrics must be collected before considering a wrapper
experiment.
