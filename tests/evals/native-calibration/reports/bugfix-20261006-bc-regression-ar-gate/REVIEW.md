# BC authority and time comparison gate: two incomplete answers

**AR01 and AR02 are strict NONPASS; AR07 passes the original key.** The first two accepted answers quote the requested values but omit the requested documentary priority explanations. AR01 also fails to visibly map its opaque filename captions to Kupfer and Silber. The original criteria remain unchanged. [Manual review](manual.json) separates faithful quotations/citations from incomplete answers.

| Case | Strict result                                                  | App time  | Native time | Within 180 seconds |
| ---- | -------------------------------------------------------------- | --------- | ----------- | ------------------ |
| AR01 | Nonpass: missing attribution and priority/approval explanation | 188.115 s | 177.332 s   | No                 |
| AR02 | Nonpass: missing priority/correction explanation               | 193.470 s | 176.023 s   | No                 |
| AR07 | Pass: compatible time/activity snapshots                       | 134.732 s | 117.342 s   | Yes                |

AR01 quotes 1180 and 1260 pixels faithfully with references1:1/2:2, but never names Kupfer/Silber or explains the missing documentary approval/precedence. Its generic uncertainty lead does not supply the requested reason. AR02 faithfully names Cedar610Hz and Birch650Hz and quotes the common test conditions with3:3, but omits the record's statement that neither entry has priority or correction status. Its two displayed records contain shared conditions and both values; the minimum-two-record rule therefore does not enforce distinct semantic alternatives or complete explanations. Neither answer invents a binding winner, global nonapproval, average or chronology. Their language and requested short single-sentence form pass; the omissions still fail the original key.

AR07 correctly declares compatibility and displays the complete original passages:23 unused vouchers at07:40UTC before distribution and9 at16:10UTC after distribution/returns, in the same T5 cabinet, with14:14/15:15. Those documented times and phases explain why the snapshots do not contradict. It invents no transaction counts or different location. German passes. There is no one-sentence restriction; the795-codepoint full-source display is not subject to the concise512-codepoint bound.

The group requested/attempted3, produced3 validated finals, and has1 strict pass,2 semantic nonpasses,0 parser rejections,0 timeouts and0 retries. With [BC's unchanged AB01 pass](../bugfix-20261006-bc-regression-gate/REVIEW.md), cumulative coverage is **4 attempted,4 validated finals,2 strict passes,2 semantic nonpasses and9 unattempted**. Two cases are both strict passes and within180seconds. No later group is authorized by this report. All three group cases finished within the300-second cap; native durations below180seconds do not repair the first two app-time performance misses.

All twenty original documents remained eligible; safe observed citation-stage metadata records **ten source identities per question**, including the required notes. Identity membership does not prove every fed passage's contents. The original fixtures and accepted quotations were independently reviewed. [Safe observations](observations.json) preserve exact finals, original criteria pins, timing and the cumulative four-case summary.

Exact accepted finals, preserved without rewriting:

### ar-fresh-01

```text
Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: “arf\-01\.md”: “Für den Bildschirmexport ist eine Breite von 1180 Pixeln vermerkt”; “arf\-02\.md”: “Für den Bildschirmexport ist eine Breite von 1260 Pixeln vermerkt”. [doc:1, chunk:1] [doc:2, chunk:2]
```

### ar-fresh-02

```text
The supplied excerpts do not establish a definitive answer: “arf\-03\.md”: “Both entries concern bench OC\-9, test cycle L3, at 21 C on 2052\-07\-14”; “arf\-03\.md”: “Entry Cedar specifies a 610 Hz calibration tone”, “Entry Birch specifies a 650 Hz calibration tone”. [doc:3, chunk:3]
```

### ar-fresh-07

```text
Die bereitgestellten Textstellen lassen sich miteinander vereinbaren. Die angeführten Quellenaussagen sind:

> \# Talvera Gutscheinschrank Frühzählung
>
> Am 2057\-09\-22 um 07\:40 UTC lagen im Schrank T5 des Talvera\-Büros 23 unbenutzte Besuchsgutscheine\. Gezählt wurde vor Beginn der Ausgabe\. Die Zahl beschreibt nur diesen Zeitpunkt und diesen Schrank; das Protokoll behauptet keinen über den Tag unveränderten Bestand\.

 [doc:14, chunk:14]

> \# Talvera Gutscheinschrank Spätzählung
>
> Am 2057\-09\-22 um 16\:10 UTC lagen im selben Schrank T5 des Talvera\-Büros 9 unbenutzte Besuchsgutscheine\. Diese Zählung erfolgte nach der Ausgabe und Rücknahme von Gutscheinen\. Es ist ein späterer Bestandsstand desselben Schranks, keine zweite Zählung zum frühen Zeitpunkt\.

 [doc:15, chunk:15]
```

## Collection and provenance

BC used typed-comparison-v28. AR01/02 selected excerpts/unresolved; AR07 selected the unchanged full/compatible route. Every case observed compact JSON, bounded128/main, effective2176, no fallback and independent request/capture/applied absence of the retired AY policy. Allocation was Q8/8192/14 on Vulkan throughout, six default threads and one GiB of default reserve. Combined bounded counters were308/309/214 tokens; SDK output meters separately reported306/307/212. Source-linked rendering can add full original passage text, so envelope response lengths are not final-answer lengths.

The declaration froze at **2026-10-06T16:34:31.660Z**. Whole-group postverification completed at **2026-10-06T16:44:30.205Z**, with423 source/112 compiled fingerprints and declared pins matched, no changed paths, treatment/defaults verified, disposed observer with no errors/drops/pending replies, clean captures and zero native/Playwright processes. Runner, cleanup and postverification all exited0 with normal wrapper return. requestCompleted=true records operational completion; safeToContinue=false and group productAcceptance=false remain explicit. Equality describes that closure, not later workspace changes.

- Build: 654e1a39943a5c5373feedef8bbcab0cd80c97a144ae4156c830b6f7e6fa7b5a.
- Candidate: 916dd9dd2f43289706c83fc0b3fcea51f5c9fab2f2a03b4e1d53b3c4fd8a65c8.
- Declaration: out/optimization-20261005/bc-regression-ar-gate-execution-declaration.json, SHA256 c688edac8e34a977e993e51cb4af16d9d67e439276a77277b9cb67c6cba95ea6.
- Postverification: out/optimization-20261005/bc-regression-ar-gate-postverify.json, SHA256 0c213ad9496ca62d6d0fed9fdbc2d4a39eddcc53ccda5fc13b132d743533a520.
- Exact accepted-final extraction: out/optimization-20261005/bc-ar-gate-accepted-finals.json, SHA256 1e7c30f794da2145a596289ffd3bad7235709d8715da29cacf0763648088d8bd.
- Safe source identities: out/optimization-20261005/bc-ar-gate-fed-source-metadata.json, SHA256 4c29000ef79fda0b5798742b5d415f691a4ce818682fab19d24da49eb53b8ba4.
- Local ignored [raw observations](raw.json), SHA256 543cd31173ecc2750ff5711962958624f7e7803d023f9d0cb5959567a1822abd; opaque bytes only were hashed for reporting.

This is known development evidence, not fresh validation or a claim that conflicting-source RAG is solved. The original key, cap and all prior failures remain unchanged. No private check, hidden thought, rejected envelope or partial final was read. There was no retry, answer repair, truncation or relaxed grading.
