# Matched prompt/context diagnostic, 2026-10-05

Twelve of twelve fixed calls completed, without transport failures. The unchanged compiled E worker used 8192 tokens, F16 KV, 14/33 GPU layers, Vulkan on GTX 1050 Ti, six inference threads and 1 GiB padding. Startup took 42.599 seconds. The same loaded model remained resident for every cell; no retrieval, embedding, reranking or model handoff occurred during the calls.

The full-system/full-context deadline answer reproduced the previous E failure word for word. All recursive main/preload hashes remained unchanged. Build provenance is matched to E, while currentSourcesMatchBuild=false: current source bug fixes were deliberately not built or executed here.

## Outcome

| Known DEV case       | Full / all | Compact / all | Full / oracle pair | Compact / oracle pair |
| -------------------- | ---------- | ------------- | ------------------ | --------------------- |
| Unresolved deadlines | fail       | partial       | fail               | pass                  |
| Equivalent durations | fail       | fail          | fail               | fail                  |
| Approved current fee | partial    | pass          | partial            | pass                  |

Only the compact system combined with the oracle source pair produced safe unresolved deadlines. Shortening the system alone omitted the required uncertainty; reducing context alone invented a rule that the earlier draft remained valid. None of the four variants recognized that 1.5 minutes equals 90 seconds. All four chose the correct approved fee, but the two full-system answers attached the explicit continuation-until-resolution clause to the proposal passage instead of the policy passage; these remain partial under the existing strict passage-attribution standard.

This does not justify shipping the compact prompt as a complete fix, or using gold-pair filtering as a production mechanism. It identifies an interaction worth investigating for authority questions, and a unit-equivalence failure that survives both tested changes. Correct marker membership did not establish correct reasoning or clause-level attribution.

## Controls and limits

- Original question, response language, IDs, source bytes, metadata, and packed-hit order were preserved from citation events in the real E runs; final citation lists were not mistaken for all supplied evidence. Full contexts contain nine deadline passages or ten passages for the other topics.
- Pair contexts retained every originally supplied chunk from the two required documents, in the original order. This is an oracle diagnostic, not a measured retriever improvement.
- Full prompts reproduce the recorded effective depth: standard for the original FULL deadline run, concise for the LITE reserved runs. Compact prompts are generic EN/DE instructions, contain no entity names or reference answers, and use the unchanged buildPrompt framing.
- Same compiled llm.ask path: resetChatHistory and current-system reapplication before every call; no hidden conversational history. noThink=true, installed sampler default temperature=0, output limit2048, repeat window256/penalty1.1/frequency0.15, timeout180seconds, no grammar, no repetitions or outcome-dependent retries.
- One observation per cell on three already-known DEV questions; fixed arm order rotates by topic. Timing includes system synchronization and benefits from an already resident model and potentially reusable prefix state. Historical runs had adaptive KV differences and model handoffs. Neither timing nor quality is a broad or causal model benchmark.
- The native worker's visible response text is retained; thought text is not recorded. These diagnostics exercise generation without renderer/provider postprocessing; the historical full/full reproduction provides one fidelity check, not proof that every app workflow is covered.

## Provenance and files

- Plan: out/optimization-20261005/matched-prompt-plan-v2.json, SHA256 dc4501043a198e0d27c82bec48f84c6ef68c51eea0fc99810018d8679e05b529.
- Compiled worker SHA256 e3e6613fdb19697f47c98e13c182e2e42aa2723b9995cc4cce8fe7a6f92e0453.
- Model SHA256 00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4.
- raw.json retains all twelve answers, token-stream text, exact prompts/hits, timings and logs; manual.json retains per-cell semantic and citation notes.
- Prepared with tests/evals/native-calibration/matchedPrompt20261005.ts; executed with tests/bench/matched-prompt-20261005.cjs. Five focused planner regression tests passed. Prior frozen fixtures and reports were not modified.

## Retained raw evidence

Ignored raw artifact: out/optimization-20261005/matched-prompt-native/raw.json

SHA256: 42348cc14696d47de02e76314ea472faac76df5fa5ba8441d59b2e93187619e2

All twelve outcomes are retained in the adjacent manual.json. Both independent reviewers agreed on the distinctions above. No production prompt or experimental guard was enabled by this diagnostic.

## Unmeasured follow-up hypothesis

The source-only instruction may be clearer if it explicitly permits ordinary arithmetic and standard unit conversions as derivations, while still prohibiting invented document facts. This is a generic hypothesis, not a demonstrated fix: the earlier bounded-thought diagnostic recognized the conversion but still asserted disagreement. No follow-up calls were run here.
