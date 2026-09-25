# Source attribution on the local 4B model

The original frozen calibration found correct arithmetic paired with the wrong supplied passage, and an unresolved conflict presented as definitive. The later conflict regression is separate development evidence. Those results do not imply retrieval failed: the decisive passages were present. This note proposes bounded generation/presentation experiments, not a new accuracy claim or an entailment model for the 4 GB GPU.

## Three primary sources and transfer limits

1. [ALCE: Enabling Large Language Models to Generate Text with Citations](https://arxiv.org/html/2305.14627v2), sections 3.3 and 5.1, separates answer correctness from citation completeness and relevance. Its evaluation uses entailment models and human assessment, not just valid source IDs. Compressing passages into summaries/snippets sometimes improved answer correctness while reducing citation quality; assigning citations after generation also performed poorly. This argues against silently attaching a plausible passage to an already written answer. Its models, English benchmark tasks, and retrieval corpus differ from LokLM's quantized bilingual 4B configuration; the paper's scores are not predicted local gains.
2. [GopherCite: Teaching language models to support answers with verified quotes](https://arxiv.org/html/2203.11147v1), sections 2.1 and 5 and appendix J, explicitly separates mechanically checking that a quote comes from its claimed source from judging whether it supports the answer. Constrained decoding enforced verbatim quotation; human preference training evaluated support. The main system was a trained 280B model with additional sampling/ranking machinery. Its results do not establish that a JSON prompt on an untuned 4B model will be accurate, fast, or calibrated. Even accurately quoted evidence can be false or insufficient.
3. [Attribute First, then Generate](https://arxiv.org/html/2403.17104v2), sections 3-5, selects source spans, plans sentences, then generates from those selections. Its focused attributions reduced human verification effort. Attribution accuracy did not improve uniformly across tasks. The prompted version used Gemini-Pro; smaller models were separately fine-tuned, and the pipeline had multiple stages. The transferable hypothesis is to select concrete evidence before a claim, not to expect the paper's results from extra instructions or to copy its multi-call pipeline onto a slow local GPU.

## Current implementation boundary

- `prompt.ts:340` renders each passage as a source marker plus title/location, followed by the unchanged body. The canonical marker is distant from the last row of a long table or paragraph.
- `contextBudget.ts:35` and `prompt.ts:127` estimate the full rendered input and retain whole passages. Presentation changes must use the same rendering for cost and generation.
- `QAService.ts:497` emits the supplied passage set before streaming the answer. That set is not a claim-level support verdict. `LlamaService.ts:889` forwards filtered generation without quote/source entailment validation.
- `modelsWorker.ts:734` caches grammars assuming a few reusable schemas. Only utility `generateRaw` currently supports JSON grammar; ordinary `llmAsk` does not. Grammar compilation failure falls back to unconstrained output, making application-side validation essential.

## Experiment 1: lossless closing source markers

Implemented behind **`LOKLM_SOURCE_MARKER_FOOTERS=1`**, default **off**. The same helper now renders a passage for `hitTokenCost` and `buildPrompt`. After the complete, unchanged source body it appends:

```text
End of passage: [doc:1, chunk:11]
```

German uses `Ende der Passage`. When the separate citation-alias experiment is explicitly active, both boundaries use that passage's existing alias; no alias is invented and the alias default remains off. Headers retain their title, section/page location, and language tag. Pinned sources, history, retrieved-source order, question text, literal source markers, table bytes, code, and whitespace are preserved.

The hypothesis is that repeating the source identity beside the completed evidence reduces accidental association with a sibling paragraph or the next source. It is a presentation experiment, not a proven method from the papers. It requires no extra model, embedding, or generation call and performs no output citation rewriting. Additional framing consumes input tokens and can displace a lower-ranked passage in a full context; record supplied IDs and prompt size in every comparison. Matching IDs still do not establish claim support, and the footer cannot detect or fully explain a conflict by itself.

Validation before native evaluation: 18 new tests cover the exact default prompt, strict opt-in, byte-preserved mixed source bodies, pinned/history ordering, both languages, aliases and canonical fallback, passage-budget boundaries, and complete 4K/8K prompt estimates. Together with existing prompt/context/alias suites, **127 tests passed**. Scoped ESLint and the Node-project no-emit TypeScript check passed. No build or GPU run was performed by this agent. Keep the flag off until independently reviewed native comparisons justify promotion.

## Experiment 2: evidence-first structured output, only if needed

A later bounded prototype could generate one response containing two to four short evidence records before a short answer. Each record carries its canonical source ID and an exact quote; an outcome field distinguishes an answer, unresolved disagreement, and insufficient evidence. The application checks schema, source membership in this turn's exact supplied chunks, and quote occurrence inside the claimed chunk. For an unresolved outcome, require at least two distinct source records before rendering the conflicting alternatives. Preserve a quote in its original source language even when the answer is translated.

These checks prove source membership and copying only. They do not prove that the quote answers the question, that all relevant alternatives were included, that an approval sentence resolves this conflict, or that the answer follows from the quotes. Do not infer approval from an isolated keyword or display a confidence score. Never repair a failed quote by searching for another source and silently changing the citation. A failed extraction should remain an explicit extraction failure with inspectable sources, not a fabricated supported answer.

Use a stable JSON schema plus runtime source checks. A per-question enum of all source IDs/quotes would create new entries in the current unbounded grammar cache; that needs a separate bounded-cache design before use. A syntax grammar does not guarantee quote membership. A single call avoids another model handoff, but emitting quotes and JSON before an answer adds output tokens and delays the first visible answer. On this host generation already takes tens of seconds for short answers, so that overhead is material. Distinguish first evidence, first answer, and terminal latency; cancellation must work during the evidence prefix. Do not turn the prefix into unlabelled hidden waiting or automatically retry indefinitely. This second experiment is not implemented or enabled.

## Evaluation boundary

Test closing markers alone first, using the same compiled candidate with the flag off/on and unchanged resource settings. Review exact input-passage attribution, both conflict alternatives, explicit authority, false refusals, table units, code answers, and source-order reversals. Record output length, first visible answer, completion, supplied passage set, and allocation behavior. Valid markers or matched quotes are mechanical checks; an independent reader must still grade relevance, completeness, and entailment. Previously inspected held-out examples can become regression cases, but cannot be reused as untouched held-out evidence.
