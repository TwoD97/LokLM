# OPEN_QUESTIONS_FOR_TEAM

Gezielte Rückfragen, die vor der gebundenen Handbuch-Abgabe durch das Team zu klären sind.
Jede Frage benennt das betroffene Kapitel/AP, warum sie wichtig ist, wer sie beantworten
kann und ihre Priorität. Stand: **2026-06-14**.

## Legende

- **Prio:** `hoch` = abgabekritisch (blockiert belastbare Aussage) · `mittel` = vor
  Abgabe zu klären · `niedrig` = kosmetisch/optional.
- **Wer:** D = Dominik Furlan (Doku/Tests/UI/Eval) · P = Denys Tudosa (Projekt-Owner,
  Chunking/Auth/RAG/Installer) · PAG = Projektauftraggeber/Betreuung · Team = beide.

## 1. Eval-Matrix & Zielerreichung (abgabekritisch)

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q1 | Ist der AP-E.2 Phase-2-GPU-Sweep (Embedder × Reranker × Chunker × LLM) bereits gefahren? Wenn ja: wann, mit welchem Scope, wo liegen die Ergebnisse? **Antwort 2026-06-14:** Phase-2-Sweep noch nicht gefahren (in Vorbereitung). | 05, 11, 15, 17, 22, 24, 25 | Erst danach sind die gemessenen Zielwerte (Recall@5, Citation Accuracy, Refusal Rate) und der Abgabe-Laborbericht belastbar. | D | hoch |
| Q2 | Wie lautet die **endgültige** Matrix-Zellenzahl des Abgabe-Laufs? Code-Stand ergibt 8 × 3 × 1 × 15 = **360**; Design-Skizze nannte ~399. | 02, 17, 22, 23 | Die Zahl steht in mehreren Kapiteln und muss konsistent dem real gefahrenen Lauf entsprechen. | D / Team | hoch |
| Q3 | Sind die LAP-Kennzahlen **~90 Dokumente / 2.322 Chunks / 163 DE-Fragen (148 answerable + 15 refusal)** aus dem final gebauten Dataset bestätigt? (Korpus ist gitignored, Zahlen aus Projektangabe.) | 11, 15, 17, 24 | Mehrfach zitierte Kennzahlen ohne committeten Beleg; vor Abgabe aus `lap-dataset.json` nachzuzählen. | D | hoch |
| Q4 | Wird das Pflichtenheft-Abnahmeziel (Refusal Rate ≥ 75 %, Citation Accuracy ≥ 85 %) erreicht? | 05 | Kern-Abnahmekriterium; aktuell „Messung offen". | D / PAG | hoch |

## 2. Projektmanagement: Kanban (Vikunja) & Wiki (Outline)

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q5 | Kann der **Kanban-/Outline-Detailverlauf** als Export/Screenshot für die Abgabe bereitgestellt werden (Spalten-Historie, Sprints, Labels, Outline-Seitenhierarchie)? | 08, 10, 25 | Board/Wiki sind extern (`<PRIVATE_DOMAIN>`) und aus dem Repo nicht rekonstruierbar; für eine vollständige Chronik nötig. | Team | hoch |
| Q6 | Wie lauten die **exakten Vikunja-Task-Nummern** je AP — insbesondere die noch leere Task-Nr. für AP-E.1? (Bekannt/erwähnt: AP-T.1 → Task 30, M3-Auth → Task 17.) | 08, 10, 25 | Abschluss-Dokus verweisen auf Tasks; eine Nr. ist offen, ein Querverweis war zeitweise falsch (`/tasks/18` statt `/17`). | D | mittel |
| Q7 | Gab es im Projektverlauf eine **Patt-Entscheidung** mit Hinzuziehung einer außenstehenden Person (Lastenheft §13)? | 07 | Im Handbuch als offene Frage markiert; falls eingetreten, zu dokumentieren. | Team | niedrig |
| Q8 | Existierte eine **formale Prioritätsskala** auf dem Board (Hoch/Mittel/Niedrig je Karte)? | 08, 10 | Im Repo kein Beleg; Priorisierung bisher nur über Meilensteine/Gates abgeleitet. | Team | niedrig |

## 3. Partner-AP-Details (Domäne Denys)

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q9 | Stimmt die aus Commits/PRs/Releases **rekonstruierte AP-Benennung** der Partner-Pakete (Auth-Fundament, Provider-Abstraktion, Installer-Pivots, Transkription, QA-Routing, Translator-Sidecar) mit den realen Vikunja-/Outline-Tickets überein? | 10, 11 | Partner-APs tragen im Repo nicht immer eine formale AP-ID; Benennung ist abgeleitet. | P | mittel |
| Q10 | Welche Teile von **ADR-0004 (Adaptive Modell-Residency, PROPOSED)** sind bereits gebaut? Die `src/main/services/placement/*`-Dateien sind im ADR als „geplant, neu" markiert. | 13, 14, 20, 21 | Bestimmt, ob das Feature als „geplant" oder „teilweise umgesetzt" darzustellen ist. | P | mittel |
| Q11 | Kann eine prüfbare Aufstellung der **Electron-Härtung** (genaue Fuses-/CSP-Konfiguration aus Build-Konfig + Window-Erzeugung) beigesteuert werden? | 21 | Derzeit aus dem Statusbericht zusammengefasst, nicht aus der Build-Konfig verifiziert (Partner-Domäne). | P | mittel |
| Q12 | ✅ **Beantwortet 2026-06-14:** Eine maschinelle Zählung über `ipcMain.handle(` in `src/main/index.ts` ergibt **exakt 105 Handler**. (Ursprünglich: Wie viele **IPC-Handler** existieren tatsächlich (Richtwert ~105)? Eine maschinelle Zählung war nicht durchgeführt.) | 13 | Konkrete Zahl im Handbuch als „zu verifizieren" markiert. | P | niedrig |

## 4. Versionen, Releases & Benennung

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q13 | Wird **v0.4.2** noch als Git-Tag gesetzt? Es existiert als Release-Commit (`783ca4b`, 14.06.), aber nicht als Tag; höchster Tag ist v0.4.1. | 02, 09 | Der Auftrag nennt einen Release-Bereich bis v0.4.2; das Handbuch muss Commit vs. Tag korrekt unterscheiden. | P / Team | mittel |
| Q14 | ✅ **Beantwortet 2026-06-14:** Verbindlich ist **Denys** (Lasten-/Pflichtenheft); die Projektstatusberichte verwenden abweichend „Denis". Das Handbuch wurde durchgängig auf „Denys Tudosa" umgestellt. (Ursprünglich: Welche **Schreibweise des Projekt-Owner-Vornamens** ist verbindlich — „Denys" oder „Denis"?) | 00, 07 | Vor der gedruckten Abgabe muss die Form einheitlich und korrekt sein. | Team | mittel |
| Q15 | Welche Rolle hat der Branch **`development`** im täglichen Fluss (Vorintegrationsstand vs. abgelegt)? | 09 | Im Handbuch als plausible Einordnung markiert, nicht eindeutig aus dem Repo ableitbar. | P | niedrig |

## 5. Lizenz- & Compliance-Bestätigungen

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q16 | Ist die **License-Registry** (`verifiedAt: 2026-06-14`) vor der finalen Abgabe gegen die `licenseUrl`-Quellen erneut zu prüfen und `verifiedAt` zu aktualisieren? | 18, 22 | Modell-Lizenzen können bei neuen Releases driften (z. B. Gemma-Terms-Überlagerung trotz „apache-2.0"-Tag). | D / Team | mittel |
| Q17 | Sind alle in der Default-Matrix zugelassenen **15 LLMs / 8 Embedder / 2 Reranker** weiterhin OSI-permissiv und lauffähig (GGUF vorhanden, llama.cpp-Reranking-Support)? | 17, 18 | Lizenz **und** technische Lauffähigkeit müssen stimmen; einzelne Caveats sind notiert. | D / P | mittel |
| Q18 | Ist die **MIT-Lizenz** des Projekts und die Dependency-Lizenzlage (`docs/licenses.md`, keine Copyleft-Dependency in der Distribution) final bestätigt? | 18 | Abgabe-relevante Lizenz-Zusicherung. | Team | niedrig |

## 6. Pflichtenheft-Zielerreichung & Abnahme

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q19 | Wurde der **Usability-Test mit 3 Erstnutzern** (Z-5, „erster Chat ≤ 30 min") durchgeführt und protokolliert? **Antwort 2026-06-14:** Usability-Test noch nicht durchgeführt/protokolliert. | 05 | Soll-Anforderung/Abnahme; im Repo nicht als abgeschlossen belegt. | D / Team | mittel |
| Q20 | Liegt der **Multi-Hardware-Matrix-Bericht** (AP-T.4, ≥ 3 von 4 Konfigurationen) vor? | 05, 19 | Abnahmekriterium; bisher offen. | D | mittel |
| Q21 | Sind die **M-Szenarien M3/M4/M8–M11** mittlerweile durchgeführt und protokolliert (nicht nur als Anleitung angelegt)? | 19 | DoD verlangt mindestens einen dokumentierten Durchlauf vor Abgabe. | D | mittel |
| Q22 | ✅ **Beantwortet 2026-06-14:** Audio-Transkription und Quiz gelten als **bewusste Scope-Erweiterung über den Mindestumfang** (kein zugesicherter v1-Mindest-Liefergegenstand; Lastenheft §10 grenzt Transkription ab). (Ursprünglich: Gelten **Audio-Transkription und Quiz** als zugesicherte v1-Liefergegenstände oder als bewusste Scope-Erweiterung?) | 03, 06 | Beeinflusst, wie die Abgabe gegen das Lastenheft (§10 grenzt Transkription ab) gewertet wird. | Team / PAG | mittel |
| Q23 | Sollen **macOS-Release-Payloads** publiziert werden, oder bleibt macOS „Build-Pipeline vorhanden, kein zugesicherter v1-Liefergegenstand"? | 06, 24 | Plattform-Abgrenzung; aktuell ehrlich als nicht-publiziert geführt. | P / Team | mittel |

## 7. Betrieb & Auslieferung

| # | Frage | Betrifft | Warum wichtig | Wer | Prio |
| --- | --- | --- | --- | --- | --- |
| Q24 | Welche **Auto-Update-Strategie** wird gewählt (Velopack vs. electron-updater, Update-Server-Hosting, Rollback)? | 24, 25 | Offene Team-/PAG-Entscheidung; betriebliche Härtung. | Team / PAG | mittel |
| Q25 | Wird ein **EV-Code-Signing-Zertifikat** beschafft (SmartScreen-Warnung)? Budget-/Beschaffungsfrage. | 21, 22, 25 | UX-Hürde bei Windows-Auslieferung. | PAG / Team | mittel |
| Q26 | Wurden die **Live-RunPod-/AWS-/S3-Keys** in der lokalen `.env` rotiert, bevor das Repo breiter geteilt wird? (Empfehlung, siehe Sensitivdaten-Checkliste.) | 20, 21 | Sicherheitsmaßnahme; Keys sind nicht auf GitHub, aber lokal vorhanden. | Team | hoch |

## Hinweis

Diese Liste ist die konsolidierte Sicht aller `WARN`-Marker und „Offene Fragen" aus den
Kapiteln 00–28. Beantwortete Punkte sollten direkt im jeweiligen Kapitel eingepflegt und
hier abgehakt werden; insbesondere die `hoch`-Fragen (Q1–Q5, Q26) sind vor der gebundenen
Abgabe zu schließen.
