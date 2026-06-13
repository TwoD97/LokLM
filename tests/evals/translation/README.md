# translation-eval — wo ist der sprach-cliff der ship-modelle?

beantwortet die frage: ist quantisiertes Qwen3.5 in sprache X schlecht genug
dass sich ein zweiter modell-download (Gemma-3-4B als fallback) lohnt — und
für welchen tier (lite/standard/pro)?

getestet wird übersetzung auf FLORES-200 devtest (35 sprachen , alle
verfügbaren EU-amts-sprachen + nordisch/baltisch + größte community-/welt-
sprachen) , in beiden richtungen:

- **en→xx** — kann das modell in sprache X _schreiben_. das ist der LokLM-fall:
  user fragt auf polnisch , antwort soll polnisch sein.
- **xx→en** — _versteht_ das modell sprache X (dokumente in X im korpus).

modelle laufen exakt wie geshippt: dieselben GGUF-files (Q4_K_M , identisch
zu den installer-buckets) , node-llama-cpp , noThink via thought-budget wie
im produktions-chat-pfad. übersetzung ist ein proxy — wer FLORES-sätze nicht
nach ungarisch kann , kann auch keine RAG-antwort auf ungarisch.

## ablauf

```
pnpm models:translation        # ship-trio + gemma Q4/Q6 (~16 GB , skippt vorhandenes)
pnpm evals:translation:data    # FLORES-slice holen (~20 s , 35×100 satzpaare)
pnpm evals:translation         # der eigentliche lauf , ein subprocess pro modell
```

output liegt unter `tests/evals/report/translation-runs/<stamp>_<sha>/`:
`summary.md` (matrix + verdicts) , `configs/<label>/per-question.jsonl`
(jede übersetzung einzeln , für die fehleranalyse) , `result.json` (chrF++).

resume wie beim answer-pack: gleicher `--run-dir` nochmal starten , fertige
modelle werden geskippt , angefangene auf segment-ebene fortgesetzt.

smoke-test vor einem langen lauf:

```
pnpm evals:translation -- --limit 3 --langs de,tr
```

## scoring — zwei stufen

1. **chrF++** (eingebaut , TS , sofort): char-n-gramm-F-score. gut genug um
   modelle im selben lauf zu ranken und totalausfälle zu sehen. faustregel:
   < 30 kaputt , 45+ solide , deltas ab ~3 punkten real.
2. **COMET** (`Unbabel/wmt22-comet-da` , optional aber empfohlen): neuronale
   metrik , korreliert deutlich besser mit human judgment. braucht python:

```
py -3.12 -m venv .venv-comet
.venv-comet\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv-comet\Scripts\pip install -r tests/evals/translation/comet/requirements.txt
.venv-comet\Scripts\python tests/evals/translation/comet/score_comet.py --run-dir <run-dir>
pnpm evals:translation:report -- --run-dir <run-dir>     # summary mit COMET neu bauen
```

(cu128-torch wegen der 5090/Blackwell. `--cpu` geht auch , dauert halt.)

## verdicts lesen

`summary.md` hat pro ship-tier einen block "vs gemma-baseline": sprachen wo
gemma um mehr als den threshold vorne liegt (COMET 0.03 / chrF 3 — in
`report.ts` als konstanten , mit begründung) → fallback lohnt sich für die.
sprachen unterm absolut-floor sind unabhängig vom vergleich unbrauchbar.
gemma läuft in Q4 (schon im evals-pool) UND Q6 (der download-kandidat) —
wenn Q6≈Q4 ist der cliff modell-bedingt , nicht quant-bedingt.

## grenzen / bewusste entscheidungen

- **quelle** ist der mirror `haoranxu/FLORES-200` (ALMA-paper , ungated) —
  der originale meta-tarball ist tot , FLORES+ ist token-gated. der mirror
  hat kein sk/hr/sl ; wer die braucht: slice aus
  `openlanguagedata/flores_plus` (HF-token) im selben format ergänzen ,
  `languages.ts` erweitern.
- **stichprobe**: 100 von 1012 devtest-sätzen , deterministisch gestrided
  (gleiche indizes für alle sprachen + läufe). reicht für ±1-2 punkte am
  corpus-mittel ; `--n 300` in `evals:translation:data` wenn's enger sein soll.
- **chrF++ ist nicht bit-identisch zu sacrebleu** (wort-tokenisierung
  vereinfacht , siehe `chrf.ts`). vergleiche INNERHALB eines runs sind sauber ,
  paper-zahlen nicht direkt — dafür COMET nehmen.
- **placement default auto (GPU)**: quality ist placement-unabhängig , nur
  timings nicht — die `meanMs` aus diesem lauf also nicht als end-user-latenz
  verkaufen. wer CPU-zahlen will: `--placement cpu`.
- serbisch wird mit "(Cyrillic script)" gepromptet weil die FLORES-referenz
  kyrillisch ist — sonst schreibt ein kleines modell latein-serbisch und die
  metrik wertet eine korrekte übersetzung als totalausfall.
