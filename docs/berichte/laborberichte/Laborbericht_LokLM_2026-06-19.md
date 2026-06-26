# Laborbericht — LokLM

|                          |                                                                               |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Datum**                | 19.06.2026                                                                    |
| **Bearbeiter**           | Dominik Furlan                                                                |
| **Rolle**                | UI/UX · Tests · Dokumentation                                                 |
| **Projekt**              | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation                   |
| **Sprint / Meilenstein** | Sprint 7 (15.06.–19.06.) · Schwerpunkt **Evaluations-Finalisierung (AP-E.2)** |
| **Software-Stand**       | v0.5.3 (main) · Handbuch v0.1 → **v0.9-Korrekturfassung** auf `dom/doku`      |

---

## 1. Tagesziele

1. AP-E.2 abschließen: den über mehrere Tage auf RunPod gerechneten **315-Zellen-Matrix-Lauf**
   auswerten, die Sieger-Konfiguration bestimmen und die Ergebnisse von RunPod-S3 ziehen und
   belegt sichern.
2. **Code-Embedder-Evaluation** gegen den eigenen LokLM-Quelltext auswerten (Embedder-Ranking).
3. Modell-Pack bereinigen: fehlerhafte/schwache Modelle aus der Default-Matrix nehmen
   (Stabilitäts- und Lizenz-/OSI-Gate).
4. Projekthandbuch von v0.1 auf eine review-/druckfertige **v0.9-Korrekturfassung** heben und die
   finalen Eval-Zahlen belegt einpflegen.

---

## 2. Durchgeführte Arbeiten

### 2.1 AP-E.2 — LAP-Matrix-Eval finalisiert

- Lauf gegen das **LAP-Korpus** (90 Dokumente / 2.322 Chunks / **163 deutsche Fragen** je Zelle),
  Pack `loklm-matrix-llms-osi-15`, Dataset `lap-dataset.json`. Berechnung über mehrere Tage auf
  RunPod (GPU), Auswertung am 19.06.
- **315 erfolgreiche Konfigurationen** (Embedder- × Reranker- × LLM-Achse); **ein** Strang
  fehlgeschlagen (`qwen3.5-27b`, Signal 139 / SIGSEGV) → 14 von 15 LLMs auswertbar.
- **Sieger (Composite):** `arctic-l-v2` + **kein Reranker** + `qwen3-4b-instruct` —
  Composite **2,677**, Judge-Groundedness **0,960**, **Recall@5 0,828**, TTFT p50 141 ms,
  Volltext p50 1.658 ms.
- Ergebnisse von RunPod-S3 gezogen und als Beleg **B1** ins Handbuch eingepflegt
  (Tab. 17.7 / 5.5 / Kap. 24).

### 2.2 Code-Embedder-Evaluation (eigener Quelltext)

- **251 docstring→Funktion-Paare** aus LokLMs `src/`; 5 Embedder, kein Reranker.
- **Ranking:** `nomic-embed-code` top (**0,908@5**) > `qwen3-emb-0.6b` ≈ `jina-v2-code` (0,875)
  > `arctic-l-v2` (0,783) > `bge-m3` (0,456).
- **Befund:** `bge-m3` **kollabiert auf Quelltext** (0,456 gegenüber 0,843 auf Prosa) — ein für
  Prosa starker Embedder ist nicht automatisch code-tauglich.
- Der Lauf terminierte credit-bedingt bei rund **68/80** Konfigurationen; das **Embedder-Ranking
  war zu dem Zeitpunkt bereits stabil/final**, lokales Backup gesichert.

### 2.3 Modell-Pack bereinigt (Stabilitäts-/Lizenz-Gate)

- Aus der Default-Matrix entfernt und ins **Risk-Pack** verschoben: `e5-large` (schwächster
  Embedder, Recall 0,460), `qwen3.5-27b` (SIGSEGV), `e5-base` (GGUF-Architektur nicht unterstützt).
- Stand: **27 Default-OSI-Modelle + 2 Risk**; Commit `3ff1e3a`, gebündelt in der v0.5.3-Veröffentlichung
  (`09ff691`, 18.06.).

### 2.4 Projekthandbuch v0.1 → v0.9-Korrekturfassung

- 29 Kapitel auf den aktuellen **v0.5.3-Stand** gebracht; finale Eval-Zahlen belegt eingepflegt
  (B1: Recall@5 0,828), Projektverlauf/Entscheidungs-Evolution (Kap. 23.4) ergänzt.
- 32-Kapitel-Review (ø **4,4/5**); Marker-Glyphen handbuchweit auf `WARN` vereinheitlicht;
  Reviewer-Leitfaden ergänzt; Versions-Bump 0.1 → 0.9 mit IEEE-`[n]`-Verweisen.
- 7 Commits: `4d1a878`, `890ebd5`, `90a38b1`, `56da0ce`, `c3f2f3a`, `5014352`, `85ab9f6`.

### 2.5 Schlüsselentscheidungen & Ehrlichkeit

- **No-Reranker als Default:** Der Reranker hebt zwar Recall@5 (0,877 statt 0,828), kostet aber
  spürbar Latenz (TTFT 331 statt 141 ms) und verbessert den Gesamt-Composite **nicht** → no-reranker
  bleibt Produktiv-Default.
- **Refusal/Z-3/Z-4 nicht aus der Matrix ableitbar:** Im Handbuch **ehrlich als offen markiert**,
  statt Vollständigkeit vorzutäuschen.

---

## 3. Ergebnisse (Überblick)

| Ziel                  | Ergebnis                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| AP-E.2 Matrix-Lauf    | ✅ 315 Zellen ausgewertet; Sieger `arctic-l-v2` · no-reranker · `qwen3-4b-instruct` (R@5 0,828, Judge 0,960) |
| Code-Embedder-Eval    | ✅ Embedder-Ranking final; `nomic-embed-code` top (0,908@5)                                                  |
| Modell-Pack bereinigt | ✅ 3 Modelle ins Risk-Pack (`e5-large`, `qwen3.5-27b`, `e5-base`)                                            |
| Handbuch-Reife        | ✅ v0.1 → v0.9-Korrekturfassung (review-/druckfertig), Eval-Belege eingepflegt                               |

---

## 4. Probleme & Erkenntnisse

- **Fehlerhafte Modelle offen dokumentiert:** `qwen3.5-27b` brach mit Signal 139 (SIGSEGV) ab,
  `e5-base` ist als GGUF-Architektur nicht unterstützt — beide aus der Matrix genommen und **belegt
  vermerkt**, statt den Ausfall zu kaschieren.
- **Prosa-Embedder ≠ Code-Embedder:** `bge-m3` kollabiert auf Quelltext (0,456 vs. 0,843 auf Prosa).
  Für Code-Retrieval ist ein dedizierter Code-Embedder (`nomic-embed-code` / `jina-v2-code`) nötig.
- **Reranker bringt auf diesem Korpus kaum Nutzen** (Recall +0,05, aber Latenz↑, Composite↓) →
  no-reranker als Default.
- **RunPod-Läufe sind credit-/zeitbegrenzt:** Der Code-Embedder-Lauf terminierte vorzeitig — das
  Embedder-Ranking war jedoch bereits stabil. Konsequenz: Sharding/Resumability für künftige Sweeps.

---

## 5. Offene Punkte / Nächste Schritte

- **Review-Freigabe** der Handbuch-v0.9-Korrekturfassung; danach **v1.0-Audit** (`RELEASE_AUDIT`).
- **Refusal-/Citation-Metriken (Z-3/Z-4)** gesondert erheben — nicht aus der Retrieval-Matrix
  ableitbar.
- **Code-Embedder-Lauf** bei Bedarf auf 80/80 vervollständigen (Ranking bereits final).
- **Sieger-Konfiguration** im Produktiv-Wizard gegenprobieren.
- **An Denys** (Logik-Domäne): Run-Pack-Sharding/Resumability für künftige RunPod-Sweeps.

---

## 6. Artefakte / Nachweise

- **Eval-Artefakte:** `docs/superpowers/eval-artifacts/lap-ranking.md`, `lap-summary.md`,
  `lap-summary.json` (315-Zeilen-Ranking, Run `2026-06-14T22-01-49`).
- **Sieger-Zeile (Rang 1):** `m_c512_norr_arctic-l-v2@qwen3-4b-instruct` —
  Composite 2,677 · Judge 0,960 · Recall@5 0,828.
- **Eval-/Release-Commits:** `3ff1e3a` (Pack-Trim), `09ff691` (Release v0.5.3, 18.06.);
  PRs #31 / #32 / #44.
- **Handbuch-Commits (`dom/doku`):** `4d1a878`, `890ebd5`, `90a38b1`, `56da0ce`, `c3f2f3a`,
  `5014352`, `85ab9f6`.
- **RunPod:** Network-Volume persistent (~130 GB Modelle), Code-Eval resumierbar; S3-Backup gesichert.
- **Vikunja:** Task AP-E.2 (RAG-Matrix-Evaluation).
