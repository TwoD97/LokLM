# LokLM — Evaluierungs-Papers

Konsolidierung der über das Projekt verstreuten Eval-Arbeit zu eigenständigen ,
zitierfähigen Papers. Jedes Paper ist auf reale Läufe geerdet (run-dirs unter
`tests/evals/report/` , die committeten Datensätze , die Evidence-Dateien in
[`_evidence/`](./_evidence/)) — **keine erfundenen Zahlen** ; offene Messungen
sind im Text als „TODO: Lauf nötig" markiert.

Alle Papers wurden gegen ihre Evidence-Quellen adversarial fact-gecheckt (jede
Kennzahl muss auf eine Quell-Datei zurückführbar sein).

## Die Papers

| #   | Paper                                                          | Worum's geht                                                        | Headline-Ergebnis                                                                                                                                                       |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | [Retrieval-Pipeline](./01-retrieval-pipeline.md)               | Embedder (bge-m3) + Reranker (bge-reranker-v2-m3) + Top-K-Grid      | Reranker hebt recall@1 **0.552 → 0.844** auf dem großen Wikipedia-Haystack ; auf kleinen sauberen Pools hilft er inkonsistent                                           |
| 02  | [Adaptive Top-K](./02-adaptive-topk.md)                        | `classifyQueryBreadth`-Heuristik (focused→3 , broad→8 , summary→12) | Summary-Coverage fast verdoppelt: recall_req@12 **0.236 → 0.468** (k=3→k=12 , +98 %)                                                                                    |
| 03  | [LLM-Modellvergleich](./03-llm-modellvergleich.md)             | Lokale Antwortgenerierung , LLM-as-Judge , 3- + 15-Modell-Sweep     | Größer ≠ besser: Qwen3-8B gewinnt den 3-Modell-Vergleich (composite **2.243**) ; qwen3.5-4b den 15-Modell-Sweep (**1.798**) → Default `DEFAULT_TOP_K=3` , Qwen3-8B full |
| 04  | [Offline-Übersetzung](./04-offline-uebersetzung.md)            | FLORES-200 , chrF++/COMET , Ship-Trio vs Gemma-Fallback             | Wo lohnt der zweite Modell-Download (Gemma-3-4B) als Sprach-Fallback , und für welchen Tier                                                                             |
| 05  | [Wikipedia-Survival-Korpus](./05-wikipedia-survival-korpus.md) | Agent-generierte , verifizierte RAG-Eval-Daten als Methode          | 1255 geerdete focused-Fragen / 2939-chunk-Haystack aus 1322 Kandidaten (~5 % verworfen) ; recall@1 **0.844** (reranked) belegt Diskriminierung                          |

## Geteilter Kontext

Alle Läufe stammen von einer Box: **Intel i9-9900K (16 threads , 31.9 GB RAM) +
RTX 5090 (32 GB VRAM)**. Die Eval-Säule ist bewusst von der Test-Pyramide
getrennt: sie misst nicht Korrektheit (pass/fail) , sondern _Qualität_ einer
probabilistischen Pipeline und liefert Zahlen (recall@k , MRR , nDCG , chrF++) ,
die Configs vergleichen. Die gemeinsame Methodik — Hardware , Harness/run-dir-
Provenienz , Metrik-Definitionen , LLM-as-Judge (correctness/groundedness/
helpfulness , composite `2·judge + recall@5 − 0.5·TTFT_sec`) , Chunker
`fixed-512-64` , Datensatz-Familie — ist in [`_evidence/methodology.md`](./_evidence/methodology.md)
gesammelt und wird von jedem Paper als Methodik-Quelle zitiert.

## `_evidence/` — Provenienz

Pro Eval-Domäne eine strukturierte Evidence-Datei mit den **exakten** Zahlen +
ihrer Quell-Datei. Die Papers zitieren ausschließlich diese (plus die direkt
referenzierten run-dirs). Reihenfolge der Quellen-Vertrauenswürdigkeit:
kuratierte Reports (`report/*.md`) > run-dir-Aggregate (`summary.md`/`ranking.md`/
`result.json`) > Code-Definitionen. `per-question.jsonl` wurde bewusst nicht
gelesen (zu groß).

## Bekannte offene Läufe (über alle Papers)

- **Faithful-CPU-Timings.** Mehrere Läufe nutzten GPU-placement (Qualitäts-Check) ;
  end-user-relevante CPU-TTFT braucht separate `evals:sweep --no-llm`-Läufe.
- **COMET-Scores** für die Übersetzungs-Eval (chrF++ liegt vor , COMET ist optional/empfohlen).
- **n=100-Wiederholung** knapper Modell-Rangfolgen (aktuell n=25/30 , Margins ~0.01–0.03).
- **Judge-Pass für Adaptive-TopK** (scheiterte an VRAM ; 75 Antworten liegen ungejudged vor).
- **git-state.** Viele Vergleichs-run-dirs sind `_dirty` ; ein clean re-run vor Zitation empfohlen.

## Format / Kompilieren

Markdown (rendert überall , gut diff-bar). Nach PDF z.B. via pandoc:

```bash
pandoc papers/05-wikipedia-survival-korpus.md -o 05.pdf --pdf-engine=xelatex -V lang=de
```
