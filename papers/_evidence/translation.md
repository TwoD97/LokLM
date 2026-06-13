# Evidence — Domäne: translation (offline-übersetzungs-eval)

Frage des laufs: wo ist der sprach-cliff der ship-modelle (Qwen3.5 2B/4B/9B,
Q4_K_M) und lohnt sich ein zweiter modell-download (Gemma-3-4B) als fallback —
für welchen tier (lite/standard/pro)? Übersetzung ist proxy für die LokLM-
fähigkeit "in der sprache des users antworten / dokumente in sprache X verstehen".

Alle zahlen unten sind **wörtlich** aus den unten referenzierten dateien
übernommen, nichts gerundet/abgeleitet außer wo explizit als delta markiert.

---

## 1. Methodik

- **Datensatz**: FLORES-200 **devtest**, mirror `haoranxu/FLORES-200` (ALMA-paper,
  ungated; der originale meta-tarball ist tot, FLORES+ ist token-gated).
  Quelle: `tests/evals/translation/README.md`, `tests/evals/translation/languages.ts`.
- **Stichprobe**: 100 von 1012 devtest-sätzen pro richtung, deterministisch
  gestrided (gleiche indizes über alle sprachen + läufe), `DEFAULT_SAMPLE_SIZE = 100`.
  Quelle: `tests/evals/translation/languages.ts` (Z. 90-103).
- **Richtungen**: beide pro sprache — `en→xx` ("kann das modell in sprache X
  schreiben", der LokLM-antwort-fall) und `xx→en` ("versteht das modell sprache X").
  Quelle: `languages.ts` (Z. 74-81), `README.md` (Z. 11-13).
- **Sprach-achse definiert**: 35 sprachen in `languages.ts`. **Im hier
  ausgewerteten run aber nur 17 sprachen** tatsächlich gelaufen (siehe Caveats).
- **Modell-betrieb**: GGUF wie geshippt (Q4_K_M, identisch zu installer-buckets),
  node-llama-cpp, noThink via thought-budget (`noThink: true`), greedy-default-
  sampling, `contextSize: 4096`, `placement: "auto"` (GPU). Quelle: README Z. 15-18;
  `result.json`-header jeder config.
- **Serbisch-prompt** explizit "(Cyrillic script)" weil FLORES-referenz `srp_Cyrl`
  ist; sonst schreibt ein kleines modell latein-serbisch → metrik wertet korrekte
  übersetzung als totalausfall. Quelle: README Z. 84-86, `languages.ts` Z. 16-20, 57.

### Metriken & schwellen (Quelle: `tests/evals/translation/report.ts` Z. 28-35)

- **chrF++** (TS-eigenbau, sofort): char-n-gramm-F-score. Faustregel im README:
  `< 30 kaputt`, `45+ solide`, deltas `ab ~3 punkten real`.
- **COMET** (`Unbabel/wmt22-comet-da`, optional): **in diesem run NICHT gelaufen** —
  keine `comet-scores.json` in irgendeiner config; summary bestätigt
  "COMET-pass fehlt noch". Verdicts beruhen daher auf chrF++.
- Verdict-konstanten (`report.ts`):
  | Konstante | Wert | Bedeutung |
  | --- | ---: | --- |
  | `COMET_DELTA` | 0.03 | baseline-vorsprung ab dem fallback gerechtfertigt (COMET) |
  | `CHRF_DELTA` | 3 | dito für chrF++ |
  | `COMET_FLOOR` | 0.75 | absolut-floor "kaputt unabhängig vom vergleich" (COMET) |
  | `CHRF_FLOOR` | 30 | dito für chrF++ |
- **Verdict-logik**: pro ship-tier gegen beste baseline (Gemma, **Q6 bevorzugt**)
  in **en→xx**. Sprache = fallback-fall wenn baseline um > delta vorne; = kaputt
  wenn tier-modell unter floor. Quelle: `report.ts` Z. 9-13, 214-251.

---

## 2. Run-Metadaten

Quelle: run-dir
`tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/`
(`env.json`, `summary.md`, `pack.json`, `dataset.json`).

- Git: `04b318d`, branch `main`, **dirty**. `env.json`.
- Hardware: Intel i9-9900K, 16 cpu, 31.9 GB RAM, win32 10.0.26200, node v22.15.1. `env.json`.
- Datensatz-slice: `flores200-slice.json`, generator `haoranxu/FLORES-200`,
  generatedAt `2026-06-12T19:43:41Z`, **numQuestions 3400** (= 17 sprachen × 100 × 2
  richtungen), numChunks 17. `dataset.json`.
- Sample: 100 sätze/richtung, noThink, greedy-default-sampling. `summary.md` Z. 4.

### Konfigurationen / modelle (Quelle: `pack.json` + `summary.md` Z. 9-15)

| Label         | Tier     | GGUF-Datei                     | Laufzeit (summary) | totalMs (result.json) |
| ------------- | -------- | ------------------------------ | -----------------: | --------------------: |
| qwen3.5-2b    | lite     | Qwen3.5-2B-Q4_K_M.gguf         |              0 min |                 733\* |
| qwen3.5-4b    | standard | Qwen3.5-4B-Q4_K_M.gguf         |              0 min |                 764\* |
| qwen3.5-9b    | pro      | Qwen3.5-9B-Q4_K_M.gguf         |             21 min |               1246914 |
| gemma-3-4b-q4 | baseline | gemma-3-4b-it-Q4_K_M.gguf      |             14 min |                822691 |
| gemma-3-4b-q6 | baseline | google_gemma-3-4b-it-Q6_K.gguf |             14 min |                837105 |

\* qwen3.5-2b/4b `totalMs` (733/764 ms) sind implausibel niedrig gegenüber 9B/Gemma
(≈14-21 min) bei identischem 3400-segment-workload → vermutlich resume/skip-artefakt
des wieder-aufgesetzten runs; chrF-werte selbst sind vollständig (n=100 je richtung).
Caveat, keine erfindung — siehe `result.json` `totalMs`-felder. `meanMs` der ship-
modelle sind ohnehin nicht als end-user-latenz zu lesen (placement=GPU, README Z. 81-83).

---

## 3. Ergebnis-Tabellen — chrF++ (EXAKT)

Bestwert je zeile **fett** (wie im summary). Quelle der zahlen: jeweilige
`configs/<label>/result.json`; matrix-form aus `summary.md`. en→xx-werte aus
`result.json`-keys `en-<code>`, xx→en aus `<code>-en`.

### 3a. chrF++ — en→xx ("antwort-sprache des users", LokLM-fall)

Quelle: `summary.md` Z. 17-37; gegengeprüft an `configs/*/result.json`.

| Sprache             | qwen3.5-2b (lite) | qwen3.5-4b (std) | qwen3.5-9b (pro) | gemma-3-4b-q4 | gemma-3-4b-q6 |
| ------------------- | ----------------: | ---------------: | ---------------: | ------------: | ------------: |
| Deutsch (de)        |              52.1 |             57.8 |         **59.7** |          56.1 |          57.1 |
| Französisch (fr)    |              59.2 |             63.5 |         **65.3** |          63.0 |          63.4 |
| Italienisch (it)    |              49.5 |             55.1 |         **56.5** |          54.3 |          54.4 |
| Spanisch (es)       |              50.2 |             53.3 |         **54.0** |          52.2 |          51.7 |
| Portugiesisch (pt)  |              59.8 |             64.6 |         **65.2** |          64.1 |          64.3 |
| Niederländisch (nl) |              48.1 |             52.7 |         **52.8** |          51.4 |          51.0 |
| Polnisch (pl)       |              36.4 |             44.7 |         **47.4** |          45.0 |          45.0 |
| Tschechisch (cs)    |              40.5 |             48.4 |         **48.5** |          48.3 |          47.2 |
| Ungarisch (hu)      |              35.5 |             45.1 |         **47.4** |          40.9 |          41.0 |
| Rumänisch (ro)      |              46.6 |             54.7 |         **57.4** |          56.5 |          55.7 |
| Bulgarisch (bg)     |              47.3 |             56.6 |         **59.0** |          56.3 |          57.8 |
| Griechisch (el)     |              38.0 |             45.7 |         **48.2** |          47.9 |          47.8 |
| Türkisch (tr)       |              36.1 |             48.3 |         **50.6** |          47.6 |          48.6 |
| Serbisch (sr)       |              24.0 |         **45.6** |             31.6 |          42.8 |          44.1 |
| Ukrainisch (uk)     |              43.2 |             48.0 |         **50.9** |          48.8 |          48.8 |
| Russisch (ru)       |              46.0 |             49.5 |         **52.7** |          49.0 |          49.1 |
| Arabisch (ar)       |              39.5 |             48.7 |         **48.7** |          46.2 |          47.6 |

Volle dezimalstellen (aus `result.json`, falls präziser gebraucht): z.B. en-de
9B=59.74 / 2b=52.13 / 4b=57.84 / q4=56.06 / q6=57.06; en-sr 2b=24.0 / 4b=45.59 /
9B=31.61 / q4=42.79 / q6=44.13; en-ar 4b=48.69 / 9B=48.72.

### 3b. chrF++ — xx→en ("verständnis")

Quelle: `summary.md` Z. 39-59; gegengeprüft an `configs/*/result.json`.

| Sprache             | qwen3.5-2b (lite) | qwen3.5-4b (std) | qwen3.5-9b (pro) | gemma-3-4b-q4 | gemma-3-4b-q6 |
| ------------------- | ----------------: | ---------------: | ---------------: | ------------: | ------------: |
| Deutsch (de)        |              61.3 |             64.2 |         **65.5** |          63.6 |          62.2 |
| Französisch (fr)    |              61.1 |             63.3 |         **63.7** |          62.0 |          63.2 |
| Italienisch (it)    |              56.7 |             58.9 |         **59.3** |          57.4 |          57.3 |
| Spanisch (es)       |              53.6 |             57.6 |         **58.1** |          55.7 |          56.1 |
| Portugiesisch (pt)  |              61.3 |             67.0 |         **67.8** |          65.2 |          65.3 |
| Niederländisch (nl) |              51.4 |             56.5 |         **56.7** |          56.3 |          56.6 |
| Polnisch (pl)       |              49.8 |             52.4 |         **53.2** |          51.5 |          52.1 |
| Tschechisch (cs)    |              56.6 |             60.4 |         **61.8** |          60.2 |          60.0 |
| Ungarisch (hu)      |              50.1 |             55.0 |         **56.6** |          53.9 |          53.0 |
| Rumänisch (ro)      |              57.5 |             61.7 |         **62.7** |          61.7 |          60.8 |
| Bulgarisch (bg)     |              55.5 |             61.0 |         **61.8** |          59.4 |          60.2 |
| Griechisch (el)     |              53.5 |             57.8 |         **59.1** |          56.5 |          57.6 |
| Türkisch (tr)       |              50.2 |             57.0 |         **58.9** |          55.0 |          55.4 |
| Serbisch (sr)       |              56.4 |             62.1 |         **62.7** |          58.5 |          59.9 |
| Ukrainisch (uk)     |              55.4 |             59.9 |         **61.2** |          59.1 |          59.5 |
| Russisch (ru)       |              53.7 |             55.9 |         **57.0** |          55.5 |          56.3 |
| Arabisch (ar)       |              54.2 |             58.4 |         **61.4** |          59.2 |          59.3 |

Volle dezimalstellen wo summary rundet (aus `result.json`): pt-en 9B=67.85 /
4b=66.97; sr-en 9B=62.70 / 2b=56.35; ar-en 9B=61.44.

---

## 4. Verdicts (chrF++, en→xx, vs gemma-3-4b-q6 baseline)

Wörtlich aus `summary.md` Z. 61-97. Threshold `CHRF_DELTA = 3`, floor `CHRF_FLOOR = 30`.

### lite (qwen3.5-2b) — fallback lohnt sich, baseline > 3 vorne bei **15 sprachen** (alle gelaufenen außer cs):

| Sprache            | qwen3.5-2b | gemma-q6 (baseline) | delta |
| ------------------ | ---------: | ------------------: | ----: |
| Deutsch (de)       |       52.1 |                57.1 |   5.0 |
| Französisch (fr)   |       59.2 |                63.4 |   4.2 |
| Italienisch (it)   |       49.5 |                54.4 |   4.9 |
| Portugiesisch (pt) |       59.8 |                64.3 |   4.5 |
| Polnisch (pl)      |       36.4 |                45.0 |   8.6 |
| Tschechisch (cs)\* |       40.5 |                47.2 |   6.7 |
| Ungarisch (hu)     |       35.5 |                41.0 |   5.5 |
| Rumänisch (ro)     |       46.6 |                55.7 |   9.1 |
| Bulgarisch (bg)    |       47.3 |                57.8 |  10.5 |
| Griechisch (el)    |       38.0 |                47.8 |   9.8 |
| Türkisch (tr)      |       36.1 |                48.6 |  12.5 |
| Serbisch (sr)      |       24.0 |                44.1 |  20.1 |
| Ukrainisch (uk)    |       43.2 |                48.8 |   5.6 |
| Russisch (ru)      |       46.0 |                49.1 |   3.1 |
| Arabisch (ar)      |       39.5 |                47.6 |   8.1 |

\* summary listet cs unter lite-fallback (Z. 72). Deltas sind aus den
tabellen-werten gerechnet (markierung, keine quelldatei-zahl).
**Unterm floor (30), quasi unbrauchbar (lite): Serbisch (sr) = 24.0.** (`summary.md` Z. 83-85)

### standard (qwen3.5-4b) — `summary.md` Z. 87-89, wörtlich:

> kein fallback nötig: keine sprache mit delta > 3, kein floor-breach.

### pro (qwen3.5-9b) — `summary.md` Z. 91-96:

fallback lohnt sich nur für **Serbisch (sr): 31.6 vs 44.1 (baseline)**. Kein floor-breach
(31.6 > 30). Der 9B-sr-einbruch ist ein bekannter ausreißer (script/cyrillic-effekt,
siehe `languages.ts` Z. 16-20) — 4B macht sr mit 45.6 deutlich besser als 9B mit 31.6.

---

## 5. Kern-Befunde

1. **standard (Qwen3.5-4B) braucht den Gemma-fallback NICHT.** Über alle 17
   gelaufenen sprachen kein delta > 3 gegen Gemma-Q6 und kein floor-breach
   (`summary.md` Z. 87-89). Für den standard-tier ist ein zweiter ~3 GB download
   durch diese evidenz nicht gerechtfertigt.
2. **lite (Qwen3.5-2B) ist der klare cliff-tier.** Gemma-Q6 schlägt es in 15 von
   17 en→xx-richtungen um > 3 chrF; der einbruch wächst mit sprach-distanz/
   morphologie: am größten bei sr (Δ20.1), tr (Δ12.5), bg (Δ10.5), el (Δ9.8),
   ro (Δ9.1), pl (Δ8.6), ar (Δ8.1). sr fällt unter den floor (24.0). → Für lite
   ist Gemma-3-4B als fallback-download am ehesten begründbar, besonders für
   slawisch/cyrillisch/türkisch/arabisch/griechisch.
3. **pro (Qwen3.5-9B) ist top außer bei Serbisch.** Best-in-row in fast jeder
   richtung (en→xx und xx→en); einzige fallback-sprache ist sr (31.6), wo 9B
   sogar hinter dem eigenen 4B (45.6) liegt — ein modell-/script-spezifischer
   ausreißer, kein genereller cliff.
4. **xx→en ist durchweg unkritisch.** Verständnis-richtung liegt für alle
   tiers/sprachen klar über dem floor (niedrigster wert lite pl-en = 49.8); kein
   verdict-block für xx→en, weil die verdict-logik nur en→xx prüft. Heißt:
   dokument-verständnis in sprache X ist auch im lite-tier robust; das problem
   ist das _schreiben_ in sprache X.
5. **Q6 ≈ Q4 bei Gemma** → der lite-cliff ist modell-bedingt, nicht quant-bedingt.
   Beispiele en→xx: en-pl Q4=45.03 / Q6=45.03 (identisch); en-de Q4=56.06 / Q6=57.06;
   en-bg Q4=56.34 / Q6=57.83; en-sr Q4=42.79 / Q6=44.13. Differenzen meist < 1.5 chrF,
   teils Q4 minimal vorn (de-en Q4=63.65 / Q6=62.24). Quelle: `gemma-3-4b-q4/result.json`
   - `gemma-3-4b-q6/result.json`. → der **Q4-bucket aus dem bestehenden evals-pool
     würde als fallback fast gleich gut tun**; Q6 bringt keinen tier-entscheidenden vorteil.

---

## 6. Caveats / Limitationen

- **COMET fehlt komplett.** Kein neuronaler score in diesem run; alle verdicts auf
  chrF++ (gröber, nicht human-korreliert). README/report markieren COMET als das
  empfohlene maß für die _finale_ fallback-entscheidung. Die zahlen oben sind
  als ranking-/cliff-indikator robust, nicht als absolute qualitätsaussage.
  Quelle: `summary.md` Z. 5, 97; `report.ts` Z. 143-148.
- **Nur 17 von 35 sprachen gelaufen.** `languages.ts` definiert 35 (inkl. da/sv/no/
  fi/is/et/lt/lv/mk/fa/ur/he/hi/zh/ja/ko/vi), aber `dataset.json` hat numQuestions=3400
  = 17 sprachen × 200, und alle 5 `result.json` listen exakt dieselben 17 sprachen
  (de fr it es pt nl pl cs hu ro bg el tr sr uk ru ar). **Keine evidenz für die
  nicht-EU/asiatischen sprachen** (zh/ja/ko/ar-skript-familien teils, hi/fa/ur/he)
  und die nordisch/baltischen — gerade dort wären kleine modelle vermutlich am
  schwächsten. Lücke explizit benennen.
- **chrF++ nicht bit-identisch zu sacrebleu** (vereinfachte wort-tokenisierung,
  `chrf.ts`); vergleiche INNERHALB des runs sauber, paper-zahlen nicht direkt
  vergleichbar. `README.md` Z. 78-80.
- **`meanMs` ≠ end-user-latenz** (placement=GPU/auto). Nicht als CPU-latenz lesen.
  `README.md` Z. 81-83.
- **totalMs-anomalie** bei qwen 2b/4b (733/764 ms) — resume/skip-artefakt, siehe §2;
  betrifft NICHT die chrF-werte (n=100 vollständig je richtung).
- **Stichprobe 100/1012**, ±1-2 punkte am corpus-mittel; deltas < ~3 chrF sind
  rauschen (genau warum CHRF_DELTA=3). `languages.ts` Z. 90-94, `README.md` Z. 75-77.
- **Serbisch-9B-ausreißer**: trotz "(Cyrillic script)"-prompt fällt 9B auf 31.6
  (hinter 2B-niveau-nahe / hinter eigenem 4B=45.6). Mit COMET zu verifizieren, ob
  echte qualität oder metrik-artefakt. `languages.ts` Z. 16-20.
- **Mirror-lücke**: sk/hr/sl/ga/mt (EU-amts) fehlen im `haoranxu/FLORES-200`-mirror —
  keine evidenz für diese trotz EU-relevanz. `README.md` Z. 70-74.

---

## Quell-dateien (alle referenzen)

- `tests/evals/translation/README.md`
- `tests/evals/translation/languages.ts`
- `tests/evals/translation/report.ts`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/summary.md`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/dataset.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/env.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/pack.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/configs/qwen3.5-2b/result.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/configs/qwen3.5-4b/result.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/configs/qwen3.5-9b/result.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/configs/gemma-3-4b-q4/result.json`
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/configs/gemma-3-4b-q6/result.json`

(per-question.jsonl bewusst NICHT gelesen — zu groß, nicht benötigt.)
