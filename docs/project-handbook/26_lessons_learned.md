# Lessons Learned

Sachliche, belegbare Erkenntnisse aus ~9 Wochen Projektarbeit. Quellen: Laborberichte (`docs/work/laborberichte/*`), Abschluss-Dokus (`docs/work/ap-*-abschluss-doku.md`), Projektstatusbericht 2026-06-14, ADRs (`docs/adr/`).

---

## 26.1 Technische Erkenntnisse

### 26.1.1 Symptom ≠ Ursache (LockedError war ein veralteter Build)

Der gemeldete Fehler „Einstellungen nicht bedienbar" (`LockedError: locked` bei `settings:get`) sah nach einem Code-Bug aus. Systematische Drei-Schichten-Verfolgung (Renderer → IPC → Auth) und Mehrfach-Verifikation **widerlegten** die erste Hypothese: Der Schutzcode (Guard `if (!getAuth().isUnlocked()) return DEFAULT_SETTINGS`) existierte bereits seit Commit `9ea3245`. Tatsächliche Ursache: Die installierte App war **v0.2.9 (älter als der Fix)** — das `app.asar` enthielt den Guard nicht. **Lehre:** vor jedem Fix den real laufenden Build prüfen; Beleglage vor Reflex. (Laborbericht 2026-05-29.)

### 26.1.2 Span-Metriken sind chunker-unabhängig

Die Retrieval-Metrik wurde auf **Gold-Spans** (Zeichen-Offsets im Quelldokument) statt auf Gold-Chunk-IDs gegründet. Dadurch bleibt der Recall vergleichbar, auch wenn unterschiedliche Chunker verschieden schneiden. Konsequenz für die Matrix: Eine Mehr-Größen-Chunker-Achse *im selben Sweep* wäre wirkungslos (der Sweep re-chunkt nicht pro Config), der Chunk-Größen-Vergleich läuft korrekt als **separate Dataset-Läufe** über die chunker-unabhängige Span-Recall-Metrik. (`tests/evals/answer/matrix-manifest.ts`, AP-E.2.)

### 26.1.3 Modellgröße ≠ Antwortqualität bei gutem RAG

Bei sauberem Retrieval und belegpflichtiger Antwort liefern auch kleinere LLMs brauchbare Ergebnisse — die Antwortqualität hängt stärker an Retrieval/Beleg als an der reinen Parameterzahl. Genau das ist der Grund, die Matrix als **Embedder × Reranker × Chunker × LLM** aufzuspannen statt nur am LLM zu drehen.

> WARN zu verifizieren: Die quantitative Bestätigung dieser These steht aus, bis der AP-E.2-GPU-Sweep (Phase 2) gefahren und ausgewertet ist.

### 26.1.4 Spec ≠ aktueller Schema-Stand

Mehrfach wich der real implementierte Stand vom Ticket-/Spec-Wortlaut ab — und der Code war richtig: Die `text_search`-Spalte (§8.2) war durch einen GIN-Expression-Index (`idx_chunks_fts`, Migration 0006) ersetzt; der „PBKDF2-Wrapper" war bewusst durch **Argon2id** [6] ersetzt (ADR-0001). **Lehre:** Tests gegen das **heutige Äquivalent** schreiben und die Abweichung dokumentieren, nicht eine tote Spec nachbauen. (AP-T.2-/AP-T.1-Abschluss-Doku.)

### 26.1.5 Determinismus muss erzwungen werden

Reranking, Multi-Query, Recency-Boost und Whole-Doc-Fallback sind nicht-deterministisch. Reproduzierbare Korpus-Tests brauchten explizites Fixieren dieser Stellschrauben. Zusätzlich gemeldet: `searchChunks` ohne Tie-Break im `ORDER BY` → Cross-Session-Determinismus nicht garantiert. (AP-T.2.)

### 26.1.6 Echte Daten zeigen Daten-Defekte

Die Q&A-Generierung am LAP-Korpus brachte **Meta-Fragen und OCR-Artefakte** zutage; der Korpus musste auf einen UTF-8-Neuauszug umgestellt werden (440 → 8.865 korrekte Umlaute), bevor die Matrix-Läufe starten. **Lehre:** Korpus-Qualität vor Eval-Läufen prüfen — sonst misst man Extraktionsfehler statt Retrieval-Qualität. (Projektstatusbericht, AP-E.2.)

---

## 26.2 Projektmanagement-Erkenntnisse

### 26.2.1 Worktree-Isolation und Branch-Schutz

Getrennte Worktrees/Branches pro Arbeitspaket hielten Test-/Doku-Arbeit (Dominik) und Logik-/Release-Arbeit (Denys) sauber entkoppelt, auch bei parallelem Arbeiten an `main`. Hartregel **„auf `main` erst Branch, dann Edit"** verhinderte versehentliche Direkteingriffe in den Integrationsstand. Das **R5-versiegelte Hold-out** (AP-E1b, bewusst nicht gepusht) ist eine bewusste Isolation gegen den Echo-Chamber-Effekt — der Eval-Autor darf das Hold-out während der Entwicklung nicht sehen.

### 26.2.2 Personalausfall ist ein Projektrisiko, das man dokumentieren muss

Der partnerseitige Ausfall (KW 23) kippte den Gesamtstatus auf *kritisch*; nach Wiedereinstieg und beidseitiger Integration (AP-6/AP-9 gemerged, zwei Releases) wurde auf *planmäßig* zurückgestuft. **Lehre:** Statusbegründung im Bericht explizit machen (wer trägt was), statt nur das Ampelsymbol zu setzen. (Projektstatusbericht.)

### 26.2.3 „PR offen" ist nicht „fertig"

Mehrere Pakete (AP-T.1/T.2/E.1) sind code-fertig, hängen aber an der Review-/Merge-Freigabe. Die klare Status-Lesart („gemerged" vs. „PR offen" vs. „Branch" vs. „in Arbeit") verhindert Überschätzung des Fortschritts. **Lehre:** Definition-of-Done muss den Merge einschließen, nicht nur den grünen lokalen Lauf.

### 26.2.4 CI-Lücke früh benennen

Lange baute die CI nur die Website, keine Test-Suite — der §8.2-Test war nur lokal/HW-1 abgesichert. Erst AP-T.2 brachte den **ersten vitest-CI-Job**. **Lehre:** Eine fehlende CI-Test-Stufe ist eine stille Schuld; sie früh als offene Entscheidung markieren, nicht implizit hinnehmen.

---

## 26.3 Architektur-Erkenntnisse

### 26.3.1 Notwendigkeit eines Lizenz-Gates

Der Matrix-Lauf zieht fremde Embedder-/Reranker-/LLM-Gewichte. `evals:matrix-run` ist deshalb hinter ein **Lizenz-Validierungs-Gate** (`evals:licenses:check`) gehängt, das vor jedem Download/Run die Modell-Lizenzen prüft. **Lehre:** Modell-Lizenzen sind kein Nachgedanke — bei einer offline-/quellenverifizierenden App müssen sie maschinell durchgesetzt werden, bevor Gewichte ins System kommen. (`package.json`, `tests/evals/license/`.)

### 26.3.2 Memory-hard KDF statt schwacher Default-Wahl

Die bewusste Wahl **Argon2id** (Bitwarden-Profil `m=64 MiB, t=3, p=4`) statt PBKDF2 ist als ADR-0001 dokumentiert (PBKDF2 ist speicherarm, GPU-/ASIC-billig). Verschlüsselung als **Envelope-Schema** (AES-256-GCM [7], ADR-0002). **Lehre:** Sicherheitsentscheidungen als ADR festhalten — der Ticket-Wortlaut altert, die Begründung muss bleiben.

### 26.3.3 Sicherheitshärtung gehört in die Plattform, nicht in den Feature-Code

CSP, Renderer-Sandbox, Navigations-Guards, Electron-Fuses und mlock-geschützter Schlüsselspeicher wurden als eine zusammenhängende Härtungsschicht eingezogen (`04b318d`), nicht verstreut. **Lehre:** Plattform-Sicherheit als eigenes Paket behandeln.

### 26.3.4 Adaptive Modell-Residenz statt fixer Größe

Modell-Tiers (lite/medium/pro) + adaptive Residenz (ADR-0004) statt eines fixen Modells erlauben CPU-taugliche Pfade (z. B. Default 5 statt 10 Quizfragen auf CPU, aggressive CPU-Caps gegen Context-Overflow). **Lehre:** Bei lokaler Inferenz ist Hardware-Adaptivität ein Architektur-Merkmal, kein Detail.

---

## 26.4 KI-Unterstützung (Claude / Codex): Nutzen und Grenzen

**Nutzen:** Schnelles Aufsetzen von Test-Gerüsten, Validatoren (z. B. `eval-cases.test.ts` mit 386 Prüfungen), Boilerplate, Doku-Vorlagen und das Durcharbeiten großer Repos. Bei klar abgegrenzten, validator-getriebenen Aufgaben (jeder Beleg-Substring muss wörtlich im Chunk vorkommen) hoch wirksam, weil das Ergebnis maschinell prüfbar ist.

**Grenzen:** KI-Vorschläge folgen gern dem **Ticket-Wortlaut statt dem Code-Stand** (PBKDF2/`text_search`/`eval/cases.json`) — ohne menschliche Gegenprüfung hätte das tote Specs nachgebaut. Determinismus-Fallen (Rerank/Multi-Query) und Build-/Umgebungs-Ursachen (veralteter `app.asar`, fehlendes GGUF im Runner, Electron-Start in Playwright) erkennt erst die systematische Verifikation am realen System, nicht das Sprachmodell. **Lehre:** KI als Beschleuniger für prüfbare Arbeit; die Verifikation (Build, Lauf, Beleglage) bleibt menschlich.

---

## 26.5 Fehler, Umwege, und was beim nächsten Projekt anders wäre

Tabelle 26.1 fasst die zentralen Fehler und Umwege mit ihren Konsequenzen für das nächste Projekt zusammen.

**Tabelle 26.1:** Fehler, Umwege und Konsequenzen fürs Folgeprojekt.

| Beobachtung | Konsequenz fürs nächste Projekt |
|---|---|
| CI baute lange nur die Website | Test-CI-Stufe von Tag 1 als Pflicht-Gate, inkl. Modell-Strategie. |
| Playwright-E2E nie lauffähig (Electron-Start) | E2E-Tooling vor dem Aufschreiben von E2E-Fällen am Zielstack verifizieren. |
| Spec/Ticket-Wortlaut wich mehrfach vom Code ab | Pflichtenheft als lebendes Dokument pflegen; Abweichungen sofort per ADR/Ticket nachziehen. |
| Installer-Build lokal nicht möglich (Rust fehlt) | Build-Toolchain-Anforderungen früh klären und im Onboarding dokumentieren. |
| OCR-/UTF-8-Defekte erst bei der Eval entdeckt | Korpus-Qualitätsprüfung als eigener Schritt vor jeder Eval. |
| „PR offen" wurde anfangs wie „fertig" gelesen | DoD inklusive Merge; klare Status-Lesart von Anfang an. |
