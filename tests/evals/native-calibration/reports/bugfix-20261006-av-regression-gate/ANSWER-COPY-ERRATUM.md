# AV answer-copy encoding erratum

The blockquote labelled the complete final in [the original REVIEW](REVIEW.md) contains a report transcription error. Its accented characters were copied as mojibake. The UTF-8 decoded validated answer in the local raw observations and [safe observations](observations.json) is identical and correctly encoded.

The correct, complete validated final is:

> Aus den bereitgestellten Textstellen geht keine eindeutige Antwort hervor: Es gibt zwei Intervalle: Nord 14 Tage, Süd 19 Tage. Keine der Notizen hat eine Freigabeunterschrift oder Priorität gegenüber der anderen. [doc:1, chunk:1] [doc:2, chunk:2]

This is a reporting defect, not a model-language defect. It changes neither the original criteria nor the recorded AV judgment: strict format/precision nonpass, generated-language pass, product acceptance held, and twelve later cases unattempted. The two-sentence display and unsupported priority statement remain the reasons for nonpass. No model call, output repair, source edit or regrading occurred.

The original REVIEW, manual, observations and raw artifacts remain byte-for-byte unchanged. Only this separate erratum was added. The original blockquote is exactly reproducible by decoding the correct answer's UTF-8 bytes as Windows-1252; this identifies the copy-error pattern, not the unrecorded command that introduced it. The report generator reads/writes JSON with explicit UTF-8 and copies `queries[].answer` directly; it does not generate the REVIEW blockquote.

A read-only historical check compared 67 raw/query safe-final pairs. All 62 validated final strings matched exactly. The other five safe finals are intentionally null: three cancelled timeouts (AI AB02, AO reasoning09, AQ reasoning09) and two terminal errors (AQ completion300 reasoning09 and AR fresh02). They are not transcription mismatches. AT and AU complete-final blockquotes also match their raw answers. A heuristic mojibake scan of historical REVIEW/manual/observations files found only this AV blockquote; that scan is not a general encoding-proof claim. Current AW outputs were not opened.

To reproduce the primary check with explicit UTF-8, from this report directory:

```javascript
const fs = require('node:fs')
const read = (name) => fs.readFileSync(name, 'utf8')
const raw = JSON.parse(read('raw.json'))
const safe = JSON.parse(read('observations.json'))
const answer = raw.queries[0].answer
const quote = read('REVIEW.md')
  .split(/\r?\n/)
  .find((line) => line.startsWith('> '))
  .slice(2)
console.assert(answer === safe.queries[0].finalAnswer)
console.assert(quote !== answer)
const corrected = read('ANSWER-COPY-ERRATUM.md')
  .split(/\r?\n/)
  .find((line) => line.startsWith('> '))
  .slice(2)
console.assert(Buffer.from(corrected, 'utf8').equals(Buffer.from(answer, 'utf8')))
```

The raw artifact is local and ignored; the tracked safe observations preserve the correct final for repository review. Historical SHA256 hashes:

- `raw.json`: `76f86597b1df66986504a8b65068aa31e8b05172a8f1ee36965d75cebf2ce323`.
- `observations.json`: `cc6bb26cba7569facfe1f28ccbde51e478b7594eb6c7cfdc4acd7b5ca8de3658`.
- `manual.json`: `5d7b50fa22f63c4b2c3c242181d01e1b88ce4fd9a1601e382bd9ebb6ee9f285c`.
- `REVIEW.md`: `fbdb8fc051edada72093d2c43540a0ffdb809c4aa925581e64c03cc48bcbd835`.

Upcoming reports will insert final strings directly from explicit UTF-8 JSON reads, then verify both safe JSON and Markdown quoted strings against the raw validated answer before pinning. No private check, hidden thought, discarded envelope or rejected body is needed for this comparison.
