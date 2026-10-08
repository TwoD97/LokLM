# AZ original gate: launcher failure before any question

**No RAG question or model inference ran.** The detached Windows PowerShell 5.1 child could not resolve Get-FileHash during preflight, before its exclusive child-start record and before Playwright launch. The original launch is consumed and was not retried. This is an orchestration failure, not a timeout, parser rejection or incorrect model answer.

The thirteen-case candidate has **zero QA attempts, zero validated finals and thirteen unattempted cases**. Only AB01 was scheduled for this first gate. [Safe observations](observations.json) retain an empty queries array and null final; [manual review](manual.json) marks that scheduled question unattempted. Reasoning, citations, format and response language have no assessable result. No successful latency or runtime-treatment observation is claimed.

The actual wrapper and runner exit codes are unavailable and remain null. No raw report, app log, child-start record, runner-result record, wrapper-result record or Playwright log exists for this launch. The preserved declaration froze at 2026-10-06T15:00:34.881Z; its original questions, corpora, criteria, 300-second collection cap, separate 180-second performance threshold, one-attempt rule and zero retries remain unchanged.

Separate recovery closed at **2026-10-06T15:02:49.831Z**. All declaration pins and the current source/build correspondence matched build 949deaa776207a9433487d9949064e2d21cb83dd4079822b41111680902541b1, with no changed paths. Capture verification found zero owned files; no native, Playwright or owned wrapper processes remained. Recovery launched no inference and did not retry the original launch. This clean recovery does not recover the missing exit codes or convert the launcher failure into a successful original run; requestCompleted and safeToContinue remain false.

The recorded investigation used a separate harmless hidden-shell probe. It reproduced the missing cmdlet when the Windows PowerShell 5.1 child inherited PowerShell 7 module search paths; a direct native-shell invocation found the cmdlet. These are shell-environment findings, not RAG findings. Any corrected successor needs its own declaration, host-consistency check and root grant; it cannot erase this original failure or silently reuse its attempt records.

- Candidate: df9aafed8c15b7986f7de7434b7cdee73baccb1a8f625aab16185c7982088252.
- Declaration: out/optimization-20261005/az-regression-gate-execution-declaration.json, SHA256 30f2c5902e6d413a67cc8a40fef63e97cc3dd987aebd8e92efafc337e0355a40.
- Closure: out/optimization-20261005/az-regression-gate-orchestration-closure.json, SHA256 6b3be166aa3af40b7d88e660f9a835e4897fbae51f3fe200ab200791cc7e5c6e.
- [AY's preceding timeout](../bugfix-20261006-ay-regression-gate/REVIEW.md), [AX's parser nonpass](../bugfix-20261006-ax-regression-gate/REVIEW.md) and all original grading criteria remain unchanged.

This report uses verified fixed orchestration metadata only. There is no answer quotation to recover, grade or repair. Missing outputs remain missing; actual exit status remains unknown. No source content, hidden thought, private check, rejected envelope or answer body was read for reporting.
