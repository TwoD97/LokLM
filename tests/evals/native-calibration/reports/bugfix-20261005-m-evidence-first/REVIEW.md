# M: exact evidence, incorrect current rule

**The one-case diagnostic produced a parser-valid but factually incorrect answer.** For the requested date 2031-06-01, it states that members may borrow three drills and five saws, with both records citing base-rule passage 3:3. The supplied approved amendment 4:4 increased the drill limit to four from 2031-05-15. The correct current limits are four drills and five saws. This is a material applicability/authority error, not merely citation formatting or quotation mismatch.

M changed only the out-of-production diagnostic: answered-record grammar properties and required fields now place `evidence` before `text`, the inline example follows that order, and one general instruction says to copy source words into evidence first and exclude metadata/serialized objects. The comparison branch, 120-character check bound, output allowance, original full prompt body, model, sampler and source catalog remain L's. This is an **ordering plus clarification grouped treatment**, not a pure order experiment. The original L script, plan and observations were preserved.

The model selected two quotations:

> Mitglieder dürfen höchstens 3 Bohrmaschinen gleichzeitig leihen.

> Mitglieder dürfen höchstens 5 Sägen gleichzeitig leihen.

Both are exact, uniquely anchored statements in the original base rule. Their source identities are therefore derived correctly. However, the first statement no longer supplies the current drill limit for the requested date, because the later approved amendment was also supplied. The final answer ignores that counterevidence. Exact source membership and correctly attached citations are not proof of applicability, completeness or semantic faithfulness to all relevant evidence.

The plan was separately frozen at 2026-10-05T16:46:39.939Z in `out/optimization-20261005/m-evidence-first-plan.json`. Production remained the frozen L build: manifest `bf6cd36b9af2b617a9a7b71991532045e79d52b20bfc37602f645ffb3ff51533`. Prompt body and eleven recorded supplied passages/order were unchanged; the full original corpus had eighteen documents. Reconstructed prompt estimate increased from 2675 to 2723 because of the declared clarification. System SHA-256: `1e04e9365159715bc01c4e1fa7b4577907a3df8d19106bd34d6a185d7f2858ec`; schema SHA-256: `d26e41036db246c57766d77ffba692237ab17ee114f2d63e111644a55cb07340`.

The direct SDK replay held Vulkan, 8192 context, f16 KV, fourteen GPU layers, six threads, batch 254 and 1 GiB reserve. It retained temperature 0, no thinking budget, disabled repetition penalty, 2176 output tokens, one 180-second generation deadline and zero retries. Native generation completed in 112.097 seconds with `stopGenerationTrigger`, 2488 input tokens and 202 output tokens. The public-wrapper preflight count was 2489. The parser accepted both quotes and emitted the validated final answer, allowing the semantic failure to be assessed directly. No check, hidden reasoning, raw envelope or rejected answer prose was saved/read.

The owned process exited 0, source/build fingerprints remained unchanged, and GPU was released immediately. A completed request is not a successful factual result. The shorter output/time cannot be sold as a useful quality or latency improvement when the governing value is wrong. No production change, follow-up retry, source repair or additional native call was made.

This remains one known DEV diagnostic with direct allocation and no retrieval/model handoff; it is neither a fresh evaluation nor an end-to-end performance result. The valid quotations address L's observed wrapper-contamination failure in this replay, while revealing the independent source-selection limitation. The original L failure and every J/K outcome remain unchanged. Local generated plan/raw artifacts are under `out/optimization-20261005/`.

Raw SHA-256: `b35536657c9c72c6fac698e620d97397c57b59335534cef99f2592dfa251e166`. Frozen plan SHA-256: `d54f88c32492e39de5ccd27894678c6750043368dd212325666231117d1bd8a1`.
