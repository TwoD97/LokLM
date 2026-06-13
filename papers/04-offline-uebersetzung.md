# Offline-Übersetzung: Sprach-Cliff der Ship-Modelle auf FLORES-200

**Kurzfassung** — Dieses paper misst, ab welcher sprache die geshippten Qwen3.5-modelle (2B/4B/9B , Q4*K_M) beim \_schreiben* in einer fremdsprache abreißen , und ob sich der zweite modell-download (Gemma-3-4B) als fallback lohnt. Datenbasis ist ein FLORES-200-devtest-lauf (`2026-06-13T11-05-30_04b318d_dirty`) mit 100 gestrideten sätzen je richtung über 17 sprachen , bewertet mit chrF++ ; COMET ist in diesem run nicht gelaufen , alle verdicts beruhen daher auf chrF++. Befund: der **standard-tier (Qwen3.5-4B) braucht keinen fallback** (keine sprache > 3 chrF hinter Gemma-Q6 , kein floor-breach) , der **lite-tier (Qwen3.5-2B) ist der cliff** (Gemma-Q6 schlägt ihn in 15 von 17 en→xx-richtungen um > 3 chrF , Serbisch fällt mit 24.0 unter den floor) , der **pro-tier (Qwen3.5-9B) ist top außer bei Serbisch** (31.6 , ein script-spezifischer ausreißer hinter dem eigenen 4B). Die verständnis-richtung (xx→en) ist über alle tiers unkritisch — das problem ist das schreiben , nicht das lesen. Caveats sind erheblich: COMET fehlt , nur 17 von 35 definierten sprachen sind gelaufen , dirty git-state , und eine totalMs-anomalie bei 2B/4B.

---

## 1 Einleitung / Motivation

LokLM beantwortet fragen lokal in der sprache des users und liest dokumente in
fremdsprachen. Beide fähigkeiten hängen davon ab , ob das jeweils geshippte
modell die zielsprache produktiv beherrscht. Übersetzung ist hier ein **proxy**:
wer einen FLORES-satz nicht nach ungarisch übersetzen kann , kann auch keine
RAG-antwort auf ungarisch formulieren (`tests/evals/translation/README.md`
Z. 16-18).

Die produktentscheidung dahinter ist konkret. Der installer liefert drei tiers
— lite / standard / pro = Qwen3.5 2B / 4B / 9B als Q4_K_M-buckets. Ein zweiter
~3 GB-download (Gemma-3-4B) als sprach-fallback ist nur dann gerechtfertigt ,
wenn das tier-modell in relevanten sprachen messbar abreißt. Dieses paper
beantwortet: **wo liegt der sprach-cliff je tier , und für welchen tier lohnt
der fallback-download?** Die verdict-logik dazu ist im harness als konstanten
hinterlegt (`tests/evals/translation/report.ts`) und wird in §2 / §4 exakt
wiedergegeben.

## 2 Aufbau & Methodik

### 2.1 Hardware

Mess-box (aus `env.json` des laufs): Intel i9-9900K , 16 cpu , 31.9 GB RAM ,
win32 release 10.0.26200 , node v22.15.1. Die ship-/baseline-modelle laufen mit
`placement: "auto"` (GPU) — auf dieser dev-box eine RTX 5090 (32 GB VRAM ;
`papers/_evidence/methodology.md` §2). **Wichtig**: GPU-läufe sind ein
qualitäts-/korrektheits-check , kein produktions-CPU-timing-benchmark. Die
`meanMs`/`totalMs` aus diesem run sind daher **nicht** als end-user-latenz zu
lesen (`tests/evals/translation/README.md` Z. 81-83).

### 2.2 Harness

- **Modell-betrieb**: GGUF wie geshippt (Q4_K_M , identisch zu den
  installer-buckets) , node-llama-cpp , `noThink: true` via thought-budget wie
  im produktions-chat-pfad , greedy-default-sampling , `contextSize: 4096`.
  Quelle: `tests/evals/translation/README.md` Z. 15-18 , `result.json`-header
  jeder config.
- **Lauf-struktur**: ein subprocess pro modell ; resume auf segment-ebene bei
  gleichem `--run-dir` (`README.md` Z. 25 , 32-33). Output unter
  `tests/evals/report/translation-runs/<stamp>_<sha>/` mit `summary.md`
  (matrix + verdicts) , `configs/<label>/result.json` (chrF++) und
  `per-question.jsonl` (einzelübersetzungen ; bewusst NICHT gelesen — zu groß).
- **Serbisch-prompt** trägt explizit "(Cyrillic script)" , weil die
  FLORES-referenz `srp_Cyrl` kyrillisch ist ; sonst schreibt ein kleines modell
  latein-serbisch und chrF++ wertet eine korrekte übersetzung als totalausfall
  (`README.md` Z. 84-86 , `languages.ts` Z. 16-20 , 57).

### 2.3 Metrik-Definitionen

Quelle der schwellen: `tests/evals/translation/report.ts` Z. 28-35 ;
faustregeln aus `README.md` Z. 43-45.

- **chrF++** (TS-eigenbau , sofort): char-n-gramm-F-score. Faustregel
  `< 30 kaputt` , `45+ solide` , deltas `ab ~3 punkten real`. **Nicht
  bit-identisch zu sacrebleu** (vereinfachte wort-tokenisierung in `chrf.ts`) —
  vergleiche INNERHALB des runs sind sauber , die absolutzahlen aber nicht
  direkt mit externen FLORES-tabellen vergleichbar (`README.md` Z. 78-80).
- **COMET** (`Unbabel/wmt22-comet-da` , neuronal , human-korreliert): in diesem
  run **NICHT gelaufen** — keine `comet-scores.json` in irgendeiner config , das
  summary bestätigt "COMET-pass fehlt noch". Alle verdicts beruhen daher auf
  chrF++ (`papers/_evidence/translation.md` §1 ; `summary.md` Z. 5 , 97).
- **Verdict-konstanten** (`report.ts`):

  | Konstante     | Wert | Bedeutung                                                 |
  | ------------- | ---: | --------------------------------------------------------- |
  | `COMET_DELTA` | 0.03 | baseline-vorsprung ab dem fallback gerechtfertigt (COMET) |
  | `CHRF_DELTA`  |    3 | dito für chrF++                                           |
  | `COMET_FLOOR` | 0.75 | absolut-floor "kaputt unabhängig vom vergleich" (COMET)   |
  | `CHRF_FLOOR`  |   30 | dito für chrF++                                           |

- **Verdict-logik**: pro ship-tier gegen die beste baseline (Gemma , **Q6
  bevorzugt**) in **en→xx**. Eine sprache zählt als fallback-fall , wenn die
  baseline um > `CHRF_DELTA` vorne liegt ; als kaputt , wenn das tier-modell
  unter `CHRF_FLOOR` fällt. Die logik prüft **nur en→xx** , nicht xx→en
  (`report.ts` Z. 9-13 , 214-251).

### 2.4 Konfigurationen / Modelle

Quelle: `pack.json` + `summary.md` Z. 9-15.

| Label         | Tier     | GGUF-Datei                     | Laufzeit (summary) | totalMs (result.json) |
| ------------- | -------- | ------------------------------ | -----------------: | --------------------: |
| qwen3.5-2b    | lite     | Qwen3.5-2B-Q4_K_M.gguf         |              0 min |                 733\* |
| qwen3.5-4b    | standard | Qwen3.5-4B-Q4_K_M.gguf         |              0 min |                 764\* |
| qwen3.5-9b    | pro      | Qwen3.5-9B-Q4_K_M.gguf         |             21 min |               1246914 |
| gemma-3-4b-q4 | baseline | gemma-3-4b-it-Q4_K_M.gguf      |             14 min |                822691 |
| gemma-3-4b-q6 | baseline | google_gemma-3-4b-it-Q6_K.gguf |             14 min |                837105 |

\* Die totalMs von 2B (733 ms) und 4B (764 ms) sind gegenüber 9B/Gemma
(≈14-21 min) bei identischem 3400-segment-workload implausibel niedrig —
vermutlich ein resume/skip-artefakt des wieder-aufgesetzten runs. Die
chrF-werte selbst sind vollständig (n=100 je richtung). Caveat , keine
erfindung (`papers/_evidence/translation.md` §2).

## 3 Datensatz

- **Quelle**: FLORES-200 **devtest** , mirror `haoranxu/FLORES-200` (ALMA-paper ,
  ungated). Der originale meta-tarball ist tot , FLORES+ ist token-gated
  (`tests/evals/translation/README.md` Z. 70-74 ; `languages.ts`).
- **Stichprobe**: 100 von 1012 devtest-sätzen pro richtung , deterministisch
  gestrided (gleiche indizes über alle sprachen + läufe) , `DEFAULT_SAMPLE_SIZE
= 100` (`languages.ts` Z. 90-103). Reicht für ±1-2 punkte am corpus-mittel —
  genau deshalb ist `CHRF_DELTA = 3` (`README.md` Z. 75-77).
- **Richtungen**: beide pro sprache — `en→xx` ("kann das modell in sprache X
  schreiben" , der LokLM-antwort-fall) und `xx→en` ("versteht das modell sprache
  X") (`languages.ts` Z. 74-81 , `README.md` Z. 11-13).
- **Sprach-achse**: `languages.ts` definiert 35 sprachen , im hier ausgewerteten
  run sind aber nur **17 sprachen** tatsächlich gelaufen (de fr it es pt nl pl cs
  hu ro bg el tr sr uk ru ar) — siehe §6.
- **Run-slice (`dataset.json`)**: `flores200-slice.json` , generator
  `haoranxu/FLORES-200` , generatedAt `2026-06-12T19:43:41Z` , **numQuestions
  3400** (= 17 sprachen × 100 sätze × 2 richtungen) , numChunks 17.
- **Lizenz**: FLORES-200 ist **CC BY-SA 4.0** ; der mirror folgt dem ALMA-paper
  (Xu et al.). Die ship-/baseline-modelle Qwen3.5 und Gemma-3 laufen unter ihren
  jeweiligen modell-lizenzen (siehe Referenzen).

## 4 Ergebnisse

> Alle zahlen wörtlich aus dem run
> `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/`.
> en→xx aus `result.json`-keys `en-<code>` / `summary.md` Z. 17-37 ; xx→en aus
> `<code>-en` / `summary.md` Z. 39-59. Bestwert je zeile **fett** (wie im
> summary). `per-question.jsonl` wurde nicht gelesen.

### 4.1 chrF++ — en→xx ("antwort-sprache des users" , LokLM-fall)

Quell-datei: `.../summary.md` Z. 17-37 , gegengeprüft an `configs/*/result.json`.

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

Volle dezimalstellen (aus `result.json` , wo genauer gebraucht): en-de 9B=59.74
/ 2b=52.13 / 4b=57.84 / q4=56.06 / q6=57.06 ; en-sr 2b=24.0 / 4b=45.59 /
9B=31.61 / q4=42.79 / q6=44.13 ; en-ar 4b=48.69 / 9B=48.72.

### 4.2 chrF++ — xx→en ("verständnis")

Quell-datei: `.../summary.md` Z. 39-59 , gegengeprüft an `configs/*/result.json`.

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

Volle dezimalstellen (aus `result.json`): pt-en 9B=67.85 / 4b=66.97 ; sr-en
9B=62.70 / 2b=56.35 ; ar-en 9B=61.44.

### 4.3 Verdicts (chrF++ , en→xx , vs gemma-3-4b-q6)

Wörtlich aus `summary.md` Z. 61-97. Threshold `CHRF_DELTA = 3` , floor
`CHRF_FLOOR = 30`.

**lite (qwen3.5-2b)** — fallback lohnt sich , baseline > 3 vorne bei **15
sprachen** (alle gelaufenen außer Spanisch und Niederländisch , deren delta mit
1.5 / 2.9 unter dem CHRF_DELTA von 3 bleibt). Deltas sind aus den tabellen-werten
gerechnet:

| Sprache            | qwen3.5-2b | gemma-q6 | delta |
| ------------------ | ---------: | -------: | ----: |
| Deutsch (de)       |       52.1 |     57.1 |   5.0 |
| Französisch (fr)   |       59.2 |     63.4 |   4.2 |
| Italienisch (it)   |       49.5 |     54.4 |   4.9 |
| Portugiesisch (pt) |       59.8 |     64.3 |   4.5 |
| Polnisch (pl)      |       36.4 |     45.0 |   8.6 |
| Tschechisch (cs)   |       40.5 |     47.2 |   6.7 |
| Ungarisch (hu)     |       35.5 |     41.0 |   5.5 |
| Rumänisch (ro)     |       46.6 |     55.7 |   9.1 |
| Bulgarisch (bg)    |       47.3 |     57.8 |  10.5 |
| Griechisch (el)    |       38.0 |     47.8 |   9.8 |
| Türkisch (tr)      |       36.1 |     48.6 |  12.5 |
| Serbisch (sr)      |       24.0 |     44.1 |  20.1 |
| Ukrainisch (uk)    |       43.2 |     48.8 |   5.6 |
| Russisch (ru)\*    |       46.0 |     49.1 |   3.1 |
| Arabisch (ar)      |       39.5 |     47.6 |   8.1 |

Alle deltas sind aus den tabellen-werten gerechnet (keine quelldatei-zahl ; das
summary listet nur die roh-werte). \* ru ist mit Δ3.1 der einzige grenzwertige
fall — knapp über CHRF_DELTA , also rausch-nah (vgl. §6). **Unterm floor (30) ,
quasi unbrauchbar (lite): Serbisch (sr) = 24.0** (`summary.md` Z. 83-85).

**standard (qwen3.5-4b)** — `summary.md` Z. 87-89 , wörtlich:

> kein fallback nötig: keine sprache mit delta > 3 , kein floor-breach.

**pro (qwen3.5-9b)** — `summary.md` Z. 91-96: fallback lohnt sich nur für
**Serbisch (sr): 31.6 vs 44.1 (baseline)** , delta 12.5. Kein floor-breach
(31.6 > 30). Der 9B-sr-einbruch ist ein bekannter ausreißer (script-/
cyrillic-effekt , `languages.ts` Z. 16-20) — das 4B macht sr mit 45.6 deutlich
besser als das 9B mit 31.6.

## 5 Diskussion / Befunde

Aus `papers/_evidence/translation.md` §5 , gestützt auf §4.1–4.3:

1. **standard (Qwen3.5-4B) braucht den Gemma-fallback nicht.** Über alle 17
   gelaufenen sprachen kein delta > 3 gegen Gemma-Q6 und kein floor-breach
   (`summary.md` Z. 87-89). Ein zweiter ~3 GB-download ist für den
   standard-tier durch diese evidenz **nicht** gerechtfertigt.
2. **lite (Qwen3.5-2B) ist der klare cliff-tier.** Gemma-Q6 schlägt es in 15 von
   17 en→xx-richtungen um > 3 chrF ; der einbruch wächst mit sprach-distanz /
   morphologie — am größten bei sr (Δ20.1) , tr (Δ12.5) , bg (Δ10.5) , el
   (Δ9.8) , ro (Δ9.1) , pl (Δ8.6) , ar (Δ8.1). Serbisch fällt unter den floor
   (24.0). → Für lite ist Gemma-3-4B als fallback-download am ehesten begründbar ,
   besonders für slawisch / cyrillisch / türkisch / arabisch / griechisch.
3. **pro (Qwen3.5-9B) ist top außer bei Serbisch.** Best-in-row in fast jeder
   richtung (en→xx und xx→en) ; einzige fallback-sprache ist sr (31.6) , wo das
   9B sogar hinter dem eigenen 4B (45.6) liegt — ein modell-/script-spezifischer
   ausreißer , kein genereller cliff.
4. **xx→en ist durchweg unkritisch.** Die verständnis-richtung liegt für alle
   tiers/sprachen klar über dem floor (niedrigster wert lite pl-en = 49.8) ; es
   gibt keinen verdict-block für xx→en , weil die verdict-logik nur en→xx prüft.
   Heißt: dokument-verständnis in sprache X ist auch im lite-tier robust — das
   problem ist das _schreiben_ in sprache X , nicht das lesen.
5. **Q6 ≈ Q4 bei Gemma** → der lite-cliff ist modell-bedingt , nicht
   quant-bedingt. Beispiele en→xx: en-pl Q4=45.03 / Q6=45.03 (identisch) ;
   en-de Q4=56.06 / Q6=57.06 ; en-bg Q4=56.34 / Q6=57.83 ; en-sr Q4=42.79 /
   Q6=44.13. Differenzen meist < 1.5 chrF , teils Q4 minimal vorn (de-en
   Q4=63.65 / Q6=62.24). → Der bereits im evals-pool liegende **Q4-bucket würde
   als fallback fast gleich gut tun** ; Q6 bringt keinen tier-entscheidenden
   vorteil (`gemma-3-4b-q4/result.json` + `gemma-3-4b-q6/result.json`).

**Verdict-zusammenfassung für die produktentscheidung**: fallback-download nur
für den **lite-tier** klar gerechtfertigt (15 sprachen , sr unter floor) ;
**standard** ohne fallback ausreichend ; **pro** nur für Serbisch — und dort wäre
ein script-fix oder das eigene 4B die billigere lösung als ein zweites modell.

## 6 Limitationen & Threats to Validity

Aus `papers/_evidence/translation.md` §6 + run-metadaten:

- **COMET fehlt komplett.** Kein neuronaler , human-korrelierter score in diesem
  run ; alle verdicts beruhen auf chrF++ (gröber). README/report markieren COMET
  als das empfohlene maß für die _finale_ fallback-entscheidung. Die zahlen oben
  sind als ranking-/cliff-indikator robust , nicht als absolute qualitätsaussage
  (`summary.md` Z. 5 , 97 ; `report.ts` Z. 143-148). **TODO: COMET-Lauf nötig**
  (siehe §7 für das kommando).
- **Nur 17 von 35 sprachen gelaufen.** `languages.ts` definiert 35 ; die 18
  nicht-gelaufenen sind ca/da/sv/no/fi/is/et/lt/lv/mk/fa/ur/he/hi/zh/ja/ko/vi ,
  und `dataset.json` hat numQuestions=3400 = 17 sprachen × 200 , alle 5
  `result.json` listen exakt dieselben 17 sprachen. **Keine evidenz** für die
  nicht-EU/asiatischen sprachen (zh/ja/ko , hi/fa/ur/he) und nordisch/baltischen —
  gerade dort wären kleine modelle vermutlich am schwächsten. **TODO: Lauf über die restlichen 18 sprachen
  nötig**.
- **chrF++ nicht bit-identisch zu sacrebleu** (vereinfachte wort-tokenisierung ,
  `chrf.ts`) — vergleiche INNERHALB des runs sauber , paper-zahlen nicht direkt
  mit externen FLORES-leaderboards vergleichbar (`README.md` Z. 78-80).
- **`meanMs`/`totalMs` ≠ end-user-latenz** (placement=GPU/auto auf RTX 5090).
  Nicht als CPU-latenz lesen ; CPU-zahlen bräuchten `--placement cpu`
  (`README.md` Z. 81-83). **TODO: CPU-timing-Lauf nötig** , falls latenz-aussagen
  gebraucht werden.
- **totalMs-anomalie** bei qwen 2b/4b (733/764 ms) — resume/skip-artefakt (§2.4) ;
  betrifft NICHT die chrF-werte (n=100 vollständig je richtung).
- **Stichprobe 100/1012** , ±1-2 punkte am corpus-mittel ; deltas < ~3 chrF sind
  rauschen (genau warum `CHRF_DELTA = 3`). Verdicts mit kleinem delta (z.B. lite
  ru Δ3.1) sind grenzwertig (`languages.ts` Z. 90-94 , `README.md` Z. 75-77).
- **Serbisch-9B-ausreißer**: trotz "(Cyrillic script)"-prompt fällt das 9B auf
  31.6 (hinter dem eigenen 4B=45.6). Mit COMET zu verifizieren , ob echte qualität
  oder metrik-artefakt (`languages.ts` Z. 16-20).
- **Dirty git-state**: der run-ordner trägt `_dirty` (git `04b318d` , branch
  `main` , dirty) — der lauf lief gegen einen nicht-committeten arbeitsstand , ist
  also nicht 1:1 als clean-baseline reproduzierbar (`env.json`).
- **Mirror-lücke**: sk/hr/sl/ga/mt (EU-amtssprachen) fehlen im
  `haoranxu/FLORES-200`-mirror — keine evidenz für diese trotz EU-relevanz ;
  ergänzung über `openlanguagedata/flores_plus` (HF-token) möglich
  (`README.md` Z. 70-74).

## 7 Reproduzierbarkeit

Exakte kommandos (aus `package.json` scripts + `tests/evals/translation/README.md`).

Modelle holen , slice bauen , lauf fahren:

```
pnpm models:translation          # ship-trio (2B/4B/9B) + gemma Q4/Q6 (~16 GB , skippt vorhandenes)
pnpm evals:translation:data      # FLORES-200-slice holen (~20 s)
pnpm evals:translation           # ein subprocess pro modell , output unter report/translation-runs/<stamp>_<sha>/
```

Smoke-test vor einem langen lauf (`README.md` Z. 35-39):

```
pnpm evals:translation -- --limit 3 --langs de,tr
```

Resume / engere stichprobe (`README.md` Z. 32-33 , 75-77):

```
pnpm evals:translation -- --run-dir <run-dir>     # fertige modelle skippen , angefangene auf segment-ebene fortsetzen
pnpm evals:translation:data -- --n 300            # engere stichprobe (300 statt 100 sätze/richtung)
```

COMET-pass nachziehen (das offene TODO aus §6 ; `README.md` Z. 49-55) — braucht
python 3.12 + cu128-torch wegen der 5090/Blackwell:

```
py -3.12 -m venv .venv-comet
.venv-comet\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv-comet\Scripts\pip install -r tests/evals/translation/comet/requirements.txt
.venv-comet\Scripts\python tests/evals/translation/comet/score_comet.py --run-dir <run-dir>
pnpm evals:translation:report -- --run-dir <run-dir>     # summary mit COMET neu bauen
```

Zugrundeliegende tsx-entry-points (package.json Z. 56-57 , 78):
`tsx tests/evals/translation/download-flores.ts` (data) ,
`tsx tests/evals/translation/run-pack.ts` (lauf) ,
`tsx tests/evals/translation/report.ts` (report) ,
`node scripts/download-models.mjs translation` (modelle).

Ausgewerteter run-ordner:
`tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/`.

## Referenzen

Quell-dateien (run + harness):

- `papers/_evidence/methodology.md` — gemeinsame eval-methodik (hardware , metrik-konventionen)
- `papers/_evidence/translation.md` — domänen-evidenz (alle chrF++-zahlen + verdicts dieses papers)
- `tests/evals/translation/README.md` — ablauf , scoring-stufen , grenzen
- `tests/evals/translation/languages.ts` — sprach-achse (35 definiert) , sample-strategie , serbisch-prompt
- `tests/evals/translation/report.ts` — verdict-konstanten (CHRF_DELTA/FLOOR , COMET_DELTA/FLOOR) + verdict-logik
- `tests/evals/translation/chrf.ts` — chrF++-implementierung (nicht sacrebleu-bit-identisch)
- `tests/evals/report/translation-runs/2026-06-13T11-05-30_04b318d_dirty/`
  — `summary.md` , `env.json` , `pack.json` , `dataset.json` ,
  `configs/{qwen3.5-2b,qwen3.5-4b,qwen3.5-9b,gemma-3-4b-q4,gemma-3-4b-q6}/result.json`

Externe datensätze & modelle (lizenz):

- **FLORES-200** (devtest) , mirror `haoranxu/FLORES-200` — **CC BY-SA 4.0** ;
  ALMA-paper (Xu et al.). Originaler meta-tarball tot , FLORES+ token-gated.
- **Qwen3.5 2B / 4B / 9B** (Q4_K_M , ship-buckets) — under-test ship-trio
  (lite / standard / pro) , lizenz gemäß Qwen-modellkarte.
- **Gemma-3-4B-it** (Q4_K_M + Q6_K) — fallback-baseline , Google Gemma terms of use.
- **COMET** `Unbabel/wmt22-comet-da` — empfohlene neuronale metrik (in diesem run
  nicht gelaufen) , Apache-2.0.
