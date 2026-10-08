# AV first known gate: language pass, strict format/precision nonpass

**AB01 is a strict partial/nonpass under the unchanged original key.** The generated prose is now German, so the prospectively declared response-language requirement passes. Correct values and local citations are retained, but the answer uses two sentences instead of one and adds an unsupported categorical priority statement. Product acceptance and the twelve later cases remain held.

Requested 1, attempted 1, validated final 1, strict passes 0, semantic/format partials 1, parser nonpasses 0, timeouts 0 and retries 0. App completion was **150.900 seconds** (native 140.317 seconds), within both the prospective 300-second cap and separate 180-second threshold. Adaptive runtime checks passed independently of content quality. Across the candidate's thirteen-case plan, one case is completed and twelve are unattempted.

[Safe observations](observations.json) preserve the exact validated final, supplied source order and allowlisted counters. [Manual review](manual.json) records correctness, format, language and runtime dimensions separately.

The complete final is:

> Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: Es gibt zwei Intervalle: Nord 14 Tage, SÃ¼d 19 Tage. Keine der Notizen hat eine Freigabeunterschrift oder PrioritÃ¤t gegenÃ¼ber der anderen. [doc:1, chunk:1] [doc:2, chunk:2]

Actual supplied North 1:1 states 14 days and South 2:2 states 19 days for the same NP-6 filters and campaign S8. Both canonical references attach to the coherent comparison paragraph. The evidence-scoped fixed lead does not choose a governing winner, claim both conflicting values apply, or assert that no binding value exists. The note-specific statement that approval signatures are absent is explicitly supported and is not an invented denial of approval events.

The full display nevertheless contains two complete sentences: one ends after **“Süd 19 Tage.”**, followed by **“Keine der Notizen …”**. The original question and sealed key explicitly require one short sentence. A single line and a bounded summary field do not establish sentence-count compliance; no new word limit or grading criterion is introduced here.

The second sentence also says that neither note has **“Priorität gegenüber der anderen.”** Each source instead states that it contains no statement establishing priority. That documentary absence does not establish that priority does not exist. The opening uncertainty lead does not make this later unqualified assertion a faithful description of the source's narrower claim. This precision issue is separate from the correctly stated absence of approval signatures, the correct values/references, and the supported overall uncertainty outcome.

The fixed lead and synthesized body are German. The prospective generated-language product requirement therefore passes; canonical IDs remain unchanged. There are no U-labels or irrelevant appendices. The body is synthesized, not an exact quotation or verified source span. [AU's original-key pass with a separate English-summary language failure](../bugfix-20261006-au-regression-gate/REVIEW.md) remains unchanged and is not retroactively regraded.

All eight original documents were eligible and actually fed. The original fixture/key/seal hashes match. Parser normalization adds one blank line after each heading while preserving all source body lines; both required value-bearing passages were actually supplied. No fixture, question, key or answer was repaired. Evaluation settings remain `rerank=false`, `multiQuery=false`, `routing=false`, `wholeDocFallback=true`, `CONTINUE_ERRORS=0`, 300 seconds per case, one attempt and zero retries; these overrides are disclosed rather than called all defaults.

Observed runtime was v23/check+result, summary mode with zero units and null fallback, comparison/unresolved outcome, active bounded128/main, effective allowance2176, compact JSON with zero external structural line breaks, no fallback, Q8/8192/14 on Vulkan, six threads and 1 GiB reserve. It recorded128 thought tokens, two forced closing tokens and131 constrained envelope tokens (261 combined), ending normally. Counters do not expose hidden text or equal final-answer length. The capture stores summary field types and bounded syntax counts, not generation text or IDs.

Declaration frozen **2026-10-06T09:31:29.771Z**. All recorded source/compiled/model/input pins matched at closure with `changedPaths=[]`; request/treatment/defaults/capture/cleanup checks passed. The observer was disposed without errors or pending replies. No owned native/Playwright processes or captures remained. `safeToContinue=false` and no follow-on authorization are retained. These provenance claims concern the recorded historical closure, not any later workspace state.

- Frozen build: `be4c52596cacfd6cb171221add68df00079cb0820ccbb90484b0ed8a8c39f567`.
- Declaration: `out/optimization-20261005/av-regression-gate-execution-declaration.json`, SHA256 `d22e3f619c7982d4f764a1b8f3e2d14297ee550204ec4a5fc21728a6a1c98a38`.
- Postverification: `out/optimization-20261005/av-regression-gate-postverify.json`, SHA256 `d593255df5509a82441d2f19448238b73ca10597f21b428fccbe6cbd4b294276`.
- Local ignored [raw observations](raw.json), SHA256 `76f86597b1df66986504a8b65068aa31e8b05172a8f1ee36965d75cebf2ce323`.
- [AT's prior failure](../bugfix-20261006-at-regression-gate/REVIEW.md), [AS's known aggregate](../bugfix-20261006-as-known-summary/REVIEW.md) and [AR's original fresh5/8](../bugfix-20261006-ar-fresh-validation-summary/REVIEW.md) remain immutable.

This is one known DEV observation, not fresh generalization evidence or a causal quality/latency result. Reporting used only the validated final, original sources/key and safe counters; no private thoughts/check, discarded envelope or rejected prose was inspected. No model call, production edit or fixture/key change was made for this review.
