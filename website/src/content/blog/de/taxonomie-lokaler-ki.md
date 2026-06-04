---
title: 'Eine Taxonomie "lokaler KI": Inferenz, Retrieval, Training'
description: 'Was alles "lokal" sein kann an einer KI — drei Etappen einer Pipeline, drei Mal die Frage "wo läuft das eigentlich?". Eine Referenz, auf die andere Artikel der Reihe zurückverweisen.'
lang: 'de'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
tags: ['lokale-ki', 'architektur', 'datenschutz']
---

In der Diskussion über KI-Werkzeuge wird das Wort _"lokal"_ oft so verwendet, als bedeute es eine einzige Sache. Tatsächlich beschreibt eine moderne KI-Anwendung drei verschiedene Etappen, die jede für sich lokal oder entfernt laufen kann. Wer die drei nicht auseinanderhält, vergleicht Produkte, die in unterschiedlichen Achsen unterschiedlich sind, mit einem einzigen Begriff.

Dieser Artikel ist die Referenz, auf die andere Artikel der Reihe verweisen. Er definiert die drei Etappen knapp und zeigt, welche Konstellationen in der Praxis existieren.

## Die drei Etappen

Eine KI-Anwendung, die auf eigene Dokumente angewandt wird (Retrieval Augmented Generation, RAG[^1]), durchläuft drei trennbare Schritte:

### 1. Training

Hier wird das Sprachmodell auf großen Textcorpora trainiert. Das ist die rechen- und datenintensivste Etappe. Sie passiert einmal pro Modellversion, bei den Modell-Anbietern (Meta, Mistral, Microsoft, Alibaba, etc.), in deren Rechenzentren. Für den Endanwender ist Training in nahezu allen Fällen **nicht-lokal** — selbst Open-Weight-Modelle werden zentral trainiert und dann als Datei freigegeben.

Ausnahmen: Fine-Tuning kann lokal stattfinden (LoRA, QLoRA[^2]), wenn ein Anwender ein bestehendes Modell auf eigene Texte spezialisiert. Volltrainings von Grund auf sind für Endanwender wirtschaftlich nicht realistisch.

### 2. Retrieval und Indexierung

Wenn KI auf eigene Dokumente angewandt werden soll, müssen diese Dokumente in einem durchsuchbaren Index liegen. Texte werden in Chunks zerlegt, jeder Chunk wird durch ein Embedding-Modell zu einem numerischen Vektor; diese Vektoren landen in einer Datenbank. Bei der Anfrage wird die Frage selbst zu einem Vektor; das System sucht im Index die ähnlichsten Chunks.

Diese Etappe **kann** lokal sein. Sie kann auch in der Cloud sein. Die Wahl ist eine Architektur-Entscheidung des Werkzeug-Anbieters und betrifft direkt, wo die Embeddings der Anwender-Dokumente liegen.

### 3. Inferenz

Der Schritt, der den meisten als "die KI" gilt: das Modell erzeugt aus Frage + Kontext eine Antwort. Auch diese Etappe **kann** lokal oder entfernt laufen. Lokale Inferenz wird typischerweise mit Werkzeugen wie `llama.cpp`, `ollama` oder `vLLM` umgesetzt; entfernte Inferenz über eine API zu OpenAI, Anthropic, Google, oder Self-Hosted-Endpoints.

## Die Konstellationen in der Praxis

Drei Etappen, zwei mögliche Orte (lokal/entfernt) je Etappe. Theoretisch ergäben sich acht Kombinationen; praktisch sieht man fünf Konstellationen — wobei A und B dasselbe Lokalitäts-Profil teilen und sich nur in der Architektur unterscheiden:

| #   | Training              | Retrieval/Index | Inferenz  | Beispiel-Typ                                                                                             |
| --- | --------------------- | --------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| A   | entfernt              | entfernt        | entfernt  | Klassisches Cloud-LLM (Web-Chat-Werkzeuge) — die häufigste Konstellation                                 |
| B   | entfernt              | entfernt        | entfernt  | ↳ Variante von A: Cloud-RAG mit Drittanbieter-Vector-DB — für den Endanwender identisch                  |
| C   | entfernt              | **lokal**       | entfernt  | "Hybrid": Index lokal, Inferenz Cloud — selten, weil die Daten zur Inferenz trotzdem das Gerät verlassen |
| D   | entfernt              | **lokal**       | **lokal** | On-Device RAG mit Open-Weight-Modell — z. B. LokLM                                                       |
| E   | **lokal** (Fine-Tune) | **lokal**       | **lokal** | Spezialisiertes lokales System — eher Forschung/Enterprise                                               |

Konstellation C ist instruktiv: ein lokaler Index erzeugt keinen Privacy-Vorteil, wenn die Anfrage samt gefundener Chunks für die Inferenz an eine Cloud-API geht. Die Daten verlassen das Gerät trotzdem. _"Lokal"_ in einem Teil der Pipeline ist nicht _"lokal"_ als Ganzes.

## Warum die Unterscheidung Privacy-Folgen hat

Pro Etappe entscheidet sich, **wo die Daten dieses Nutzers anfallen**.

- **Training**: hier sind nicht die Daten des Endanwenders gemeint, sondern die Trainings-Daten. Solange der Anwender keine Daten zum Training freigibt, ist Training-Lokalität für seine Privacy zweitrangig. Relevant wird sie, wenn ein Anbieter Nutzer-Eingaben in zukünftige Trainingsläufe aufnimmt — eine Konstellation, die in den AGB vieler Cloud-Anbieter geregelt ist (oft per opt-out).
- **Retrieval/Index**: hier liegen die Daten des Anwenders selbst, in Form von Embeddings und Original-Chunks. Wenn der Index in der Cloud ist, sind die Anwender-Dokumente in der Cloud — auch wenn keine "echte" Inferenz dort stattfindet.
- **Inferenz**: hier wird die einzelne Anfrage verarbeitet. Wenn die Inferenz remote läuft, geht **jede Anfrage** an einen externen Server — inklusive der Chunks, die das lokale Retrieval ggf. ausgewählt hat.

Die [DSGVO-Pflichten](/blog/dsgvo-und-llm-datenexport), die in einem früheren Artikel der Reihe besprochen wurden, greifen an jeder dieser drei Stellen unterschiedlich. Drittlandtransfer entsteht in Etappe 2 oder 3, sobald Daten ein Drittland erreichen. Auftragsverarbeitung entsteht ebenfalls je Etappe.

## Wo LokLM sich auf den Achsen positioniert

LokLM gehört zu Konstellation D: Training extern (Modell wird heruntergeladen), Retrieval und Inferenz lokal. Der Index liegt als SQLite-Datei im Anwendungs-Datenverzeichnis; die Inferenz läuft über `llama.cpp`. Es existiert kein Server, der Anwender-Anfragen empfängt.

LokLM bietet keine lokale Fine-Tuning-Option. Wer ein Modell auf eigene Texte spezialisieren möchte, verwendet dafür getrennte Werkzeuge (Unsloth, axolotl, transformers-trainer) — das ist Konstellation E und liegt außerhalb des LokLM-Funktionsumfangs.

## Was diese Taxonomie nicht klärt

Eine Taxonomie ist eine Sortierung, kein Urteil. Sie sagt nichts darüber, **welche Konstellation für welchen Zweck die richtige ist**. Konstellation A (alles Cloud) hat ihre eigenen Vorteile: stärkere Modelle, kein Setup-Aufwand, immer aktuell. Wer mit nicht-sensitiven Inhalten arbeitet — Blog-Texte, Coding-Hilfe, allgemeine Fragen — hat in A wenig zu verlieren.

Konstellation D wird interessant, sobald die Inhalte sensibel sind: Mandantenakten, Forschungsdrafts, Geschäftsunterlagen, medizinische Notizen. Dort verschiebt die Lokalität von Retrieval und Inferenz die rechtlichen Pflichten messbar — siehe die früheren Artikel der Reihe.

## Weiter im Cluster

Diese Taxonomie schließt die konzeptionelle Vorrunde der Privacy-Säule ab. Vorangegangen sind: [Definition von "privat"](/blog/was-privat-wirklich-heisst), [EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act), [DSGVO und LLM](/blog/dsgvo-und-llm-datenexport), [Quellenverweise als Datenschutz-Merkmal](/blog/quellenverweise-als-datenschutz).

Die folgenden Artikel der Reihe werden konkrete Workflows zeigen — wie eine [Anwaltskanzlei](/einsatz/anwalt) oder eine [Forschungsgruppe](/einsatz/forschung) lokale KI in der Praxis einsetzt.

Die Pillar-Seiten: [Lokale KI](/lokale-ki) und [Architektur](/architektur). LokLM zum Testen: [Download](/#download).

---

[^1]: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. Der RAG-Ursprungs-Beitrag, der die hier vorgestellte Pipeline-Trennung erstmals systematisch beschreibt. https://arxiv.org/abs/2005.11401

[^2]: Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. Standard-Verfahren für ressourcenschonendes Fine-Tuning, auch lokal möglich. https://arxiv.org/abs/2106.09685
