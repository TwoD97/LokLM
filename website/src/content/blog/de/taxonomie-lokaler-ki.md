---
title: 'Eine Taxonomie "lokaler KI": Inferenz, Retrieval, Training'
description: 'Was alles "lokal" sein kann an einer KI — drei Etappen einer Pipeline, drei Mal die Frage "wo läuft das eigentlich?". Eine Referenz, auf die andere Artikel der Reihe zurückverweisen.'
lang: 'de'
translationKey: 'local-ai-taxonomy'
pubDate: 2026-05-28
updatedDate: 2026-10-07
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

Prüfe Embedding-Berechnung und Indexspeicherung getrennt. Ein Werkzeug kann Text an einen entfernten Embedding-Anbieter senden und die resultierenden Vektoren lokal speichern. Umgekehrt lassen sich lokal erzeugte Vektoren auf einen entfernten Speicher hochladen. Der Speicherort des Index zeigt allein nicht, wo seine Inhalte verarbeitet wurden.

### 3. Inferenz

Was die meisten für "die KI" halten, ist genau dieser Schritt: Aus Frage plus Kontext erzeugt das Modell eine Antwort. Auch hier gilt: lokal **oder** entfernt, beides ist möglich. Lokal geschieht Inferenz typischerweise mit Werkzeugen wie `llama.cpp`, `ollama` oder `vLLM`; entfernt läuft sie über eine API — zu OpenAI, Anthropic, Google oder einem selbst gehosteten Endpoint.

## Die Konstellationen in der Praxis

Drei Etappen mal zwei mögliche Orte (lokal/entfernt) ergäben rechnerisch acht Kombinationen. In der Praxis begegnet man fünf Konstellationen — wobei A und B im Lokalitäts-Profil identisch sind und sich nur architektonisch unterscheiden:

| #   | Training              | Retrieval/Index | Inferenz  | Beispiel-Typ                                                                             |
| --- | --------------------- | --------------- | --------- | ---------------------------------------------------------------------------------------- |
| A   | entfernt              | entfernt        | entfernt  | Klassisches Cloud-LLM (Web-Chat-Werkzeuge) — die häufigste Konstellation                 |
| B   | entfernt              | entfernt        | entfernt  | ↳ Variante von A: Cloud-RAG mit Drittanbieter-Vector-DB — für den Endanwender identisch  |
| C   | entfernt              | **lokal**       | entfernt  | Lokaler Index mit entfernter Antwortgenerierung; ausgewählte Stellen verlassen das Gerät |
| D   | entfernt              | **lokal**       | **lokal** | On-Device RAG mit heruntergeladenem Modell — z. B. der gebündelte Modellpfad von LokLM   |
| E   | **lokal** (Fine-Tune) | **lokal**       | **lokal** | Spezialisiertes lokales System — eher Forschung/Enterprise                               |

In Konstellation C kann die vollständige Sammlung auf dem Gerät bleiben, während ausgewählte Textstellen und die Frage an ein entferntes Modell gehen. Das ist eine kleinere Übertragung als der Upload der gesamten Sammlung; die ausgewählten Inhalte können dennoch vertraulich sein. _"Lokal"_ an einer Stelle macht die Verarbeitung nicht als Ganzes lokal.

## Warum die Unterscheidung Privacy-Folgen hat

Jede Etappe beantwortet ihre eigene Version der Frage: **Wo fallen die Daten dieses Nutzers an?**

- **Training**: Der Download eines vortrainierten Modells sendet deine Dokumente nicht von selbst in dessen Training. Prüfe bei gehosteten Diensten die Regeln für das konkrete Produkt und Konto. Trainingsnutzung, Übertragung und Speicherung sind getrennte Fragen.
- **Retrieval/Index**: Indizes können Vektoren, Textstellen und Metadaten enthalten. Prüfe, was davon entfernt gespeichert wird, statt jedem Index vollständige Originaldokumente oder harmlos gewordene Vektoren zu unterstellen.
- **Inferenz**: Hier wird jede einzelne Anfrage verarbeitet. Läuft die Inferenz remote, erreicht **jede Anfrage** einen fremden Server — mitsamt den Chunks, die ein etwaiges lokales Retrieval ausgewählt hat.

Prüfe Ziele und beteiligte Rollen für jeden Schritt. Der [Beitrag zu DSGVO und Cloud-LLMs](/blog/dsgvo-und-llm-datenexport) erklärt, warum entfernte Verarbeitung, Auftragsverarbeitung und Drittlandtransfer getrennt zu beurteilen sind.

## Wo LokLM sich auf den Achsen positioniert

Der gebündelte Modellpfad von LokLM fällt in Konstellation D: Extern trainierte Modelle werden heruntergeladen; die Dokumentenverarbeitung läuft danach lokal, die Modellinferenz nutzt `llama.cpp`. Arbeitsbereichsdaten nutzen SQLite, der Vektorindex hat einen separaten Speicher. Die [Datenschutz-Checkliste](/blog/was-privat-wirklich-heisst) behandelt Verschlüsselung, Arbeitskopien im Klartext und unveränderte Originaldateien.

Optionale Ollama-Anbieter können den Verarbeitungsort für Chat, Embeddings oder Reranking ändern. Ein Server auf einem anderen Rechner erhält Eingaben für die gewählten Funktionen; der aktuelle Entwicklungsstand verlangt die ausdrückliche Freigabe dieses Ziels. Eine lokale Benutzeroberfläche belegt deshalb nicht allein den Verarbeitungsort.

Diese Angaben entsprechen dem am **7. Oktober 2026** geprüften Entwicklungsstand. Kontrolliere deine installierte Version und Konfiguration; nicht jede aktuelle Änderung ist damit als bereits in 0.7.0 enthalten beschrieben.

Lokales Fine-Tuning gehört nicht zum Funktionsumfang von LokLM. Wer ein Modell auf eigene Texte spezialisieren will, greift zu eigenständigen Werkzeugen (Unsloth, axolotl, transformers-trainer) — das entspricht Konstellation E und liegt außerhalb dessen, was LokLM abdeckt.

## Was diese Taxonomie nicht klärt

Eine Taxonomie bestimmt nicht, **welche Konfiguration zu deiner Arbeit passt**. Vergleiche den konkreten Dienst oder das Modell, verfügbare Hardware, Datenziele, Kosten und Antwortqualität. Weder „Cloud“ noch „lokal“ belegen diese Eigenschaften allein.

Dokumentenverarbeitung auf dem Gerät vermeidet die Übertragung dieser Eingaben an einen Modellserver anderswo. Zugriff auf das Gerät, Backups, Aufbewahrung und angemessene Nutzung bleiben zu prüfen. Lokalität bescheinigt weder Rechtskonformität noch richtige Antworten.

## Weiter im Cluster

Verwandte Grundlagen: [Definition von "privat"](/blog/was-privat-wirklich-heisst), [EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act), [DSGVO und LLM](/blog/dsgvo-und-llm-datenexport) und [Quellenverweise richtig einordnen](/blog/quellenverweise-als-datenschutz).

Für praktische Prüfungen nutze den [Ablauf zur PDF-Quellenprüfung](/blog/pdf-mit-ki-quellen-pruefen) und den [Leitfaden für kleine GPUs](/blog/lokale-ki-4gb-vram). Der [Anwendungsfall Forschung](/einsatz/forschung) zeigt eine weitere Möglichkeit, die eigene Dokumentenarbeit zu organisieren.

Die Pillar-Seiten: [Lokale KI](/lokale-ki) und [Architektur](/architektur). LokLM zum Testen: [Download](/#download).

---

[^1]: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks". NeurIPS 2020. Der RAG-Ursprungs-Beitrag, der die hier vorgestellte Pipeline-Trennung erstmals systematisch beschreibt. https://arxiv.org/abs/2005.11401

[^2]: "LoRA: Low-Rank Adaptation of Large Language Models". ICLR 2022. Standard-Verfahren für ressourcenschonendes Fine-Tuning, auch lokal möglich. https://arxiv.org/abs/2106.09685
