---
title: 'Eine Taxonomie "lokaler KI": Inferenz, Retrieval, Training'
description: 'Was alles "lokal" sein kann an einer KI — drei Etappen einer Pipeline, drei Mal die Frage "wo läuft das eigentlich?". Eine Referenz, auf die andere Artikel der Reihe zurückverweisen.'
lang: 'de'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
tags: ['lokale-ki', 'architektur', 'datenschutz']
---

Wer über KI-Werkzeuge spricht, benutzt _"lokal"_ meist so, als gäbe es dafür genau eine Bedeutung. In Wirklichkeit besteht eine moderne KI-Anwendung aus drei getrennten Etappen — und jede davon kann für sich genommen auf dem eigenen Gerät oder auf fremden Servern stattfinden. Wer diese Trennung ignoriert, legt ein einziges Wort über Produkte, die sich auf ganz verschiedenen Achsen unterscheiden — und vergleicht damit Unvergleichbares.

Dieser Text ist als Nachschlagepunkt gedacht: die Referenz, auf die die übrigen Artikel der Reihe zeigen. Er umreißt die drei Etappen so knapp wie möglich und ordnet die Konstellationen ein, die in der Praxis tatsächlich vorkommen.

## Die drei Etappen

Wird KI auf eigene Dokumente angesetzt (Retrieval Augmented Generation, RAG[^1]), zerfällt der Gesamtprozess in drei sauber trennbare Schritte:

### 1. Training

In dieser Etappe entsteht das Sprachmodell selbst — durch Training auf gewaltigen Textcorpora. Nichts in der Pipeline verschlingt mehr Rechenleistung und Daten. Training geschieht einmal je Modellversion, in den Rechenzentren der Modell-Anbieter (Meta, Mistral, Microsoft, Alibaba und andere). Aus Sicht des Endanwenders ist Training damit praktisch immer **nicht-lokal**: Auch Open-Weight-Modelle werden zentral trainiert und anschließend als Datei zum Download bereitgestellt.

Eine Ausnahme gibt es: Fine-Tuning lässt sich lokal durchführen (LoRA, QLoRA[^2]), etwa um ein vorhandenes Modell auf eigene Texte zuzuschneiden. Ein komplettes Training von Null ist für Endanwender dagegen ökonomisch außer Reichweite.

### 2. Retrieval und Indexierung

Sollen eigene Dokumente durchsuchbar werden, braucht es einen Index. Dafür werden die Texte in Chunks zerteilt; ein Embedding-Modell übersetzt jeden Chunk in einen numerischen Vektor, und diese Vektoren wandern in eine Datenbank. Kommt später eine Frage, wird auch sie zu einem Vektor — und der Index liefert die ähnlichsten Chunks zurück.

Diese Etappe **kann** auf dem Gerät laufen — oder in der Cloud. Das ist eine Architektur-Entscheidung des jeweiligen Herstellers, und sie bestimmt unmittelbar, wo die Embeddings der Anwender-Dokumente liegen.

### 3. Inferenz

Was die meisten für "die KI" halten, ist genau dieser Schritt: Aus Frage plus Kontext erzeugt das Modell eine Antwort. Auch hier gilt: lokal **oder** entfernt, beides ist möglich. Lokal geschieht Inferenz typischerweise mit Werkzeugen wie `llama.cpp`, `ollama` oder `vLLM`; entfernt läuft sie über eine API — zu OpenAI, Anthropic, Google oder einem selbst gehosteten Endpoint.

## Die Konstellationen in der Praxis

Drei Etappen mal zwei mögliche Orte (lokal/entfernt) ergäben rechnerisch acht Kombinationen. In der Praxis begegnet man fünf Konstellationen — wobei A und B im Lokalitäts-Profil identisch sind und sich nur architektonisch unterscheiden:

| #   | Training              | Retrieval/Index | Inferenz  | Beispiel-Typ                                                                                             |
| --- | --------------------- | --------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| A   | entfernt              | entfernt        | entfernt  | Klassisches Cloud-LLM (Web-Chat-Werkzeuge) — die häufigste Konstellation                                 |
| B   | entfernt              | entfernt        | entfernt  | ↳ Variante von A: Cloud-RAG mit Drittanbieter-Vector-DB — für den Endanwender identisch                  |
| C   | entfernt              | **lokal**       | entfernt  | "Hybrid": Index lokal, Inferenz Cloud — selten, weil die Daten zur Inferenz trotzdem das Gerät verlassen |
| D   | entfernt              | **lokal**       | **lokal** | On-Device RAG mit Open-Weight-Modell — z. B. LokLM                                                       |
| E   | **lokal** (Fine-Tune) | **lokal**       | **lokal** | Spezialisiertes lokales System — eher Forschung/Enterprise                                               |

Besonders lehrreich ist Konstellation C: Der lokale Index bringt keinerlei Privacy-Gewinn, wenn Anfrage und gefundene Chunks für die Inferenz doch an eine Cloud-API geschickt werden — die Daten verlassen das Gerät ja trotzdem. _"Lokal"_ an einer Stelle der Pipeline macht die Pipeline nicht als Ganzes lokal.

## Warum die Unterscheidung Privacy-Folgen hat

Jede Etappe beantwortet ihre eigene Version der Frage: **Wo fallen die Daten dieses Nutzers an?**

- **Training**: Hier geht es nicht um die Daten des Endanwenders, sondern um das Trainingsmaterial. Solange der Anwender nichts zum Training beisteuert, spielt die Trainings-Lokalität für seine Privacy eine Nebenrolle. Kritisch wird es erst, wenn ein Anbieter Nutzer-Eingaben in künftige Trainingsläufe einspeist — viele Cloud-AGB sehen genau das vor, häufig mit Opt-out-Regelung.
- **Retrieval/Index**: Hier liegen die eigentlichen Anwender-Daten — als Embeddings plus Original-Chunks. Ein Cloud-Index bedeutet: Die Dokumente des Anwenders liegen in der Cloud, selbst wenn dort nie "echte" Inferenz stattfindet.
- **Inferenz**: Hier wird jede einzelne Anfrage verarbeitet. Läuft die Inferenz remote, erreicht **jede Anfrage** einen fremden Server — mitsamt den Chunks, die ein etwaiges lokales Retrieval ausgewählt hat.

Die [DSGVO-Pflichten](/blog/dsgvo-und-llm-datenexport), die ein früherer Artikel der Reihe behandelt hat, setzen an allen drei Stellen verschieden an: Ein Drittlandtransfer entsteht in Etappe 2 oder 3, sobald Daten die EU-Grenze in Richtung Drittland überschreiten; auch Auftragsverarbeitung ist je Etappe getrennt zu beurteilen.

## Wo LokLM sich auf den Achsen positioniert

LokLM fällt in Konstellation D: Das Training geschieht extern — das fertige Modell wird heruntergeladen —, Retrieval und Inferenz laufen lokal. Der Index ist eine SQLite-Datei im Anwendungs-Datenverzeichnis, die Inferenz übernimmt `llama.cpp`. Einen Server, der Anfragen von Anwendern entgegennimmt, gibt es schlicht nicht.

Lokales Fine-Tuning gehört nicht zum Funktionsumfang von LokLM. Wer ein Modell auf eigene Texte spezialisieren will, greift zu eigenständigen Werkzeugen (Unsloth, axolotl, transformers-trainer) — das entspricht Konstellation E und liegt außerhalb dessen, was LokLM abdeckt.

## Was diese Taxonomie nicht klärt

Eine Taxonomie sortiert — sie urteilt nicht. Sie beantwortet nicht, **welche Konstellation zu welchem Zweck passt**. Konstellation A (alles in der Cloud) hat handfeste Vorteile: leistungsfähigere Modelle, null Einrichtungsaufwand, stets aktuell. Wer ausschließlich mit unkritischen Inhalten arbeitet — Blog-Texte, Coding-Hilfe, Alltagsfragen —, riskiert in A wenig.

Interessant wird Konstellation D, sobald sensible Inhalte im Spiel sind: Mandantenakten, Forschungsdrafts, Geschäftsunterlagen, medizinische Notizen. Dann verschiebt die Lokalität von Retrieval und Inferenz die rechtliche Pflichtenlage spürbar — die früheren Artikel der Reihe zeigen, wie.

## Weiter im Cluster

Mit dieser Taxonomie endet die konzeptionelle Vorrunde der Privacy-Säule. Vorausgegangen sind: [Definition von "privat"](/blog/was-privat-wirklich-heisst), [EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act), [DSGVO und LLM](/blog/dsgvo-und-llm-datenexport), [Quellenverweise als Datenschutz-Merkmal](/blog/quellenverweise-als-datenschutz).

Die kommenden Beiträge werden konkret: Sie zeigen Workflows, mit denen eine [Anwaltskanzlei](/einsatz/anwalt) oder eine [Forschungsgruppe](/einsatz/forschung) lokale KI im Alltag einsetzt.

Die Pillar-Seiten: [Lokale KI](/lokale-ki) und [Architektur](/architektur). LokLM zum Testen: [Download](/#download).

---

[^1]: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. Der RAG-Ursprungs-Beitrag, der die hier vorgestellte Pipeline-Trennung erstmals systematisch beschreibt. https://arxiv.org/abs/2005.11401

[^2]: "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. Standard-Verfahren für ressourcenschonendes Fine-Tuning, auch lokal möglich. https://arxiv.org/abs/2106.09685
