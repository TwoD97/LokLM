# BD first question: unsupported approval and priority claim

**AB01 is a strict and product NONPASS under the unchanged original grading key.** Both requested intervals and their citations are present, but the generated phrase “beide ohne Freigabe oder Vorrang” asserts absent approval or priority. The notes establish only missing approval signatures and priority statements. The fixed uncertainty lead does not justify that stronger claim.

Exact accepted final (192 codepoints, preserved without rewriting):

```text
Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: Nord: 14 Tage, Süd: 19 Tage, beide ohne Freigabe oder Vorrang, daher unentschieden. [doc:1, chunk:1] [doc:2, chunk:2]
```

The sealed original key explicitly rejects: “Asserting no approval ever occurred, neither note has approval, or no binding interval exists anywhere; absence is documentary only”. That rule predates this output and has not changed. The North note says it contains no approval signature and no statement establishing priority over South; the South note states the equivalent documentary limitation. The accepted answer omits that documentary qualification and predicates “ohne Freigabe oder Vorrang” of both notes. “Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor” scopes the uncertainty, but cannot turn the later unsupported status assertion into a source-supported fact.

The following separate checks pass: North14/South19 days and their mapping; both value-bearing citations; no binding winner selected; German; one brief sentence; and completion under180 seconds. The question supplies the NP-6/campaignS8 scope, which the concise answer does not change. [Manual review](manual.json) preserves these partial successes without treating them as full acceptance. The source-support check fails for the authority clause, and strict-and-within180 remains zero.

Requested1, attempted1, validated finals1, strict passes0, semantic nonpasses1, parser rejections0, timeouts0 and retries0. **Twelve of the original thirteen cases remain unattempted and held.** All eight source identities are observed in persisted citation-stage metadata, including North as doc:1/chunk:1 and South as doc:2/chunk:2. The original public fixtures were reviewed; identity metadata alone does not prove every actual fed passage's contents. [Safe observations](observations.json) preserve these limits and the exact unchanged question/key/source pins.

The final arrived at **135.732 seconds**, including **124.977 seconds** of native generation, within the180-second performance threshold and300-second collection cap. Q8/8192/14 on Vulkan, six default threads and one GiB default VRAM reserve were observed. This single run does not establish a causal speed improvement.

BD uses typed-comparison-v29: one generated summary body, canonical references and a program-rendered uncertainty lead. Its body allowance reserves the fixed512-codepoint complete display bound; generated prose reports no exact-source spans or derivations. The checked mode was summary, zero catalog units, no fallback, compact JSON and the unchanged2176 combined allowance with128 bounded thought tokens. Fixed counters record128 thought tokens, two forced closing tokens and111 constrained-envelope tokens, or241 combined; the SDK separately reports239 output tokens. Grammar compilation took7ms and prompt fitting21ms. ResponseChars=312 describes the envelope, not the192-codepoint final. Private checks and hidden thoughts were not inspected.

The declaration froze at **2026-10-06T17:04:03.088Z**. Whole clean postverification completed at **2026-10-06T17:07:38.801Z**: all **422 source /112 compiled** fingerprints and declared pins matched, no changed paths, worker defaults and treatment checks passed, and the removed AY generation policy was absent from request, capture and applied-worker marker. The observer was disposed with zero errors/drops/pending replies; capture cleanup passed and no native or Playwright process remained. Durable records preserve runner **0**, capture cleanup **0**, postverification **0**, and normal wrapper return. requestCompleted=true is operational; safeToContinue=false and productAcceptance=false remain explicit. Equality describes that recorded closure, not later workspace changes.

- Build: 4ee7c27c48b9f5ce1144dc5a1b86980ecdee0081f0a755c375e59a334c085976.
- Candidate: e5918de9ea6c98f6cfc21b194a2e191066641aba94296b0bb9624388c7de2b7c.
- Declaration: out/optimization-20261005/bd-regression-gate-execution-declaration.json, SHA256 c9bda8638a3bfa76bfba1174464f0748c1c4056ff0f8da9a096958f2aaee3975.
- Postverification: out/optimization-20261005/bd-regression-gate-postverify.json, SHA256 e6cf0763b38402d71ecb18ac7b12260c8c311bbf631920f74f3baca22d39448b.
- Accepted-final-only extraction: out/optimization-20261005/bd-gate-accepted-final.json, SHA256 c4540e59c07dcc8cd030b1534f9b6b8145127b0c3e185360dc104ac458e6e76e.
- Safe source identity metadata: out/optimization-20261005/bd-gate-fed-source-metadata.json, SHA256 90a2dd80f3a7d7aa3f0698690900c24390b0a3994bc71f727c958fe0dd05a190.
- Local ignored [raw observations](raw.json), SHA256 053b6916a7f592910566fb31f48ca745e4084c68ea49883fc8ffe8a0aa4f26c2; only opaque bytes were hashed.
- [BC's incomplete AR answers](../bugfix-20261006-bc-regression-ar-gate/REVIEW.md) and every earlier result remain immutable.

This is known development evidence. The separately authored fresh set remains sealed and unattempted; this report did not open its contents, and root reports that it remains unopened there. No semantic weakening, answer repair, retry or successor execution grant is introduced. The checklist, grammar, source IDs and uncertainty framing do not prove documentary scope or entailment.
