# Eval corpora

Größere, real-stämmige Korpora für RAG-Evals (haystack + ground-truth-text).
Anders als `sample-docs/` (handgeschriebene Mini-Docs) und `libraries/`
(synthetische Distractor-Docs) sind das echte Referenz-Texte aus externen,
lizenz-klaren Quellen — gedacht als realistischer Stand-in für das, was ein
LokLM-Nutzer tatsächlich lädt (Kiwix-ZIMs, Handbücher, Nachschlagewerke).

## `wikipedia-survival/` — offline-survival/referenz-wissen

Kuratierter Plaintext-Slice aus EN-Wikipedia, thematisch auf survival- und
practical-knowledge-themen gefiltert (erste hilfe, wasser/nahrung,
krankheit/hygiene, wildnis-navigation, wiederaufbau-technik). Spiegelt den
#1-Tier-1-datensatz der LokLM-zielgruppe (Kiwix Wikipedia ZIM), nur als
sauberer plaintext statt 110 GB ZIM.

- **Lizenz**: CC BY-SA 4.0 (Wikipedia contributors). License-konsistent mit dem
  schon committeten `xquad-de`-datensatz.
- **Bezug**: `prop=extracts&explaintext=1` der MediaWiki-action-API — kein OCR,
  kein PDF-parsing, kein HTML-müll. End-sektionen (References/External links/…)
  werden abgeschnitten.
- **Provenienz**: `manifest.json` + `chunks.json.source` halten pro artikel
  titel, pageid, URL und fetch-zeitpunkt fest (attribution).

### Dateien

```
wikipedia-survival/
  <docId>.txt        ein gesäuberter artikel-plaintext (docId = title-slug)
  chunks.json        { source, chunker, byTheme, articles, chunks[] }
  manifest.json      nur provenienz (source + byTheme + articles)
```

`chunks.json.chunks` ist der volle haystack (alle chunks aller artikel,
512/64-zeichen-fenster, `fixed-512-64`). Im fertigen dataset referenzieren die
fragen nur einen teil davon — der rest bleibt als distractor im korpus (gleiche
konvention wie `xquad-de`).

### Aktueller build → `datasets/wikipedia-survival-1255q-*.json`

|                                     |                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| artikel                             | 50 (10 je thema, `--max-articles 10`)                                                                  |
| chunks (haystack)                   | 2939                                                                                                   |
| fragen (focused, agent-verifiziert) | 1255                                                                                                   |
| referenzierte chunks / distractors  | 869 / 2070                                                                                             |
| themen                              | first-aid 192 , water-food 258 , disease-sanitation 267 , wilderness-navigation 251 , rebuild-tech 287 |

Generiert via multi-agent-workflow (1 generator-agent + 1 unabhängiger
adversarial-verifier pro chunk-batch, Opus). Über alle themen: 1322 kandidaten
generiert, 1255 nach verify behalten (~5 % verworfen). Jede frage ist
self-contained, faktisch und gegen ihren quell-chunk geprüft — die eval braucht
keine separate gold-antwort (der judge scored gegen den chunk-text selbst).

## Pipeline (regenerieren)

```bash
# 1. korpus bauen (alle themen, je max 10 artikel)
tsx tests/evals/synth/fetch-wikipedia-corpus.ts --max-articles 10

# 2. gute chunks sampeln + generierungs-batches schreiben
tsx tests/evals/synth/prep-gen-batches.ts --per-theme 200 --batch-size 15

# 3. fragen fabrizieren + adversarial verifizieren (multi-agent-workflow,
#    ein lauf pro thema — siehe index.json für die batch-pfade)

# 4. verifizierte JSONL + korpus → dataset.json
tsx tests/evals/synth/assemble-wiki-dataset.ts

# 5. stichprobe + integritäts-check
tsx tests/evals/synth/inspect-dataset.ts tests/evals/data/datasets/wikipedia-survival-<N>q-<stamp>.json
```

Schritt 3 ist der einzige nicht-deterministische schritt (LLM-agents). Die
fragen-generierung läuft als fan-out (ein agent pro chunk-batch) gefolgt von
einer unabhängigen adversarial-verify-stufe, die jede frage gegen ihren
quell-chunk prüft (grounded? self-contained? eindeutig?) und zweifelhaftes
verwirft. Output liegt in `tests/evals/data/staging/wiki-gen/<theme>/verified/`.
