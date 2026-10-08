# BB first question: accepted final misses one required alternative

**AB01 is a strict NONPASS under the unchanged original grading key.** The model produced an accepted final with North's 14-day interval and its citation, but omitted South's required 19-day interval and local citation. Safe uncertainty and a correct included quotation do not satisfy the explicit request for both values.

Exact accepted final (188 codepoints, preserved without rewriting):

```text
Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: “abf\-north\.md”: “The service interval stated for the NP\-6 filters in campaign S8 is 14 days”. [doc:1, chunk:1]
```

The original German question explicitly asks for both intervals in one short sentence. The original North and South notes concern identical NP-6 filters/campaign S8 and carry the same issue date. Neither establishes a binding winner in the supplied notes. The included quotation matches the North fixture, and safe citation-stage metadata maps its displayed doc:1/chunk:1 reference to North. The same metadata includes South as doc:2/chunk:2; South's value and reference are absent from the answer. The documentary uncertainty does not invent global absence, precedence, chronology or a winner. The short single-sentence format passes. A German fixed lead plus a literal English source quote meets the existing language contract; that contract has not been relaxed. [Manual review](manual.json) separates these partial successes from failed completeness and citation coverage.

Requested 1, attempted 1, validated finals 1, strict passes 0, semantic nonpasses 1, parser rejections 0, timeouts 0 and retries 0. The thirteen-case plan has **twelve unattempted cases**, all held. [Safe observations](observations.json) preserve the exact final and unchanged question/key/source pins. All eight source identities are observed in persisted citation-stage metadata, including both required notes. The report reviews original fixtures and displayed coverage; the identity metadata does not itself establish every actual fed passage's contents.

The accepted final arrived at **139.408 seconds**, with **128.310 seconds** of native generation. Operational completion is below the 180-second threshold and 300-second collection cap, but strict-and-within-180 remains zero because the answer is incomplete. No causal latency comparison with earlier runs is claimed: BB used F16/8192/14 on Vulkan. Six default threads and one GiB of default VRAM reserve were observed.

BB uses typed-comparison-v27 with count-first source-aware excerpt budgets and a source allowance table. The fixed bounds remain 160 codepoints per fragment and 512 for the rendered final. Compact check+result JSON, excerpts mode, zero catalog units, no fallback, bounded 128/main and the 2176 combined allowance were observed. The removed AY policy was absent independently from request, capture and applied worker marker. Fixed counters record 128 thought tokens, two forced closing tokens and 109 constrained envelope tokens, or 239 combined; the SDK output meter separately reports 237. Grammar compilation took 41 ms; prompt fitting took 27 ms. ResponseChars=312 describes the envelope, not the 188-codepoint displayed final. No private check, hidden thought or rejected body was read.

The declaration froze at **2026-10-06T16:05:15.555Z**. Clean postverification completed at **2026-10-06T16:08:56.424Z**: all **423 source / 112 compiled** fingerprints and declared pins matched, no changed paths, treatment/defaults checks passed, observer disposed with zero errors/drops/pending replies, capture cleanup passed, and no native or Playwright process remained. Durable records preserve runner **0**, capture cleanup **0**, postverification **0** and normal wrapper return. requestCompleted=true is operational; safeToContinue=false and productAcceptance=false remain explicit. Equality describes this recorded closure, not later workspace changes.

- Frozen build: 07422e4bbaf11a28749f31cf14507e8c3bc26beb6cafaa8be0b2751a8b46f1f5.
- Candidate: 1584c90758fa1c79367656f8d73a9f06fd804be5df6ba0d0fa05ec83187e143a.
- Declaration: out/optimization-20261005/bb-regression-gate-execution-declaration.json, SHA256 7e63d69a55050027c65e79d881f4886cbc588a0944b5b6aafbc36503ebff50ed.
- Postverification: out/optimization-20261005/bb-regression-gate-postverify.json, SHA256 10b6cc9a1adb9d691ac4e5703b7ad13cd73d7245f5088456c06a8a6b61e93998.
- Accepted-final-only extraction: out/optimization-20261005/bb-gate-accepted-final.json, SHA256 34170fd1887afec06c2d5d6163bb4b68f79a1c9836fa36b25747fb55145b3f53.
- Safe fed-source identity metadata: out/optimization-20261005/bb-gate-fed-source-metadata.json, SHA256 c9dba08c8f48baef25dff406fe1cedbe810c05d332e97dda9b62b6b127988bce.
- Local ignored [raw observations](raw.json), SHA256 9d7c1fa2f73aa315a8993b6305956fba734b0b0a8075a2599ac857cfc74a085e; raw bytes were hashed without opening generated contents.
- [BA's render-bound rejection](../bugfix-20261006-ba-regression-gate/REVIEW.md), [AZ2's label rejection](../bugfix-20261006-az2-regression-gate/REVIEW.md) and every earlier outcome remain immutable.

This is known development evidence. The original key and thirteen-case plan are unchanged; no answer repair, bound increase, retry, weakened grading or follow-on authorization is introduced. Structural fit and exact quotation still do not guarantee complete comparison reasoning.
