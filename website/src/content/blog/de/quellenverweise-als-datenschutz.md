---
title: 'Quellenverweise als Datenschutz-Merkmal, nicht nur UX'
description: 'Warum Antworten mit Quellenverweis weniger preisgeben als reine Modell-Antworten — Privacy und Verifizierbarkeit sind zwei Seiten derselben Eigenschaft.'
lang: 'de'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
tags: ['lokale-ki', 'architektur', 'datenschutz']
---

Wenn Produkte vorgeführt werden, laufen Quellenverweise üblicherweise unter Komfort: _"Der Beleg steht auf Seite 47."_ Elegant, nachprüfbar, angenehm zu benutzen. Alles richtig — und trotzdem greift diese Sicht zu kurz. Denn Quellenverweise sind gleichzeitig ein **Privacy-Merkmal**. Die These, um die es hier geht, wirkt zunächst unscheinbar, ist bei näherem Hinsehen aber geradezu banal: Eine Antwort, die auf Quellen verweist, verrät weniger über das Modell als eine Antwort ohne jeden Verweis.

Auf den folgenden Abschnitten wird diese These entfaltet.

## Was eine "reine Modell-Antwort" ist

Sprachmodelle entstehen durch Training auf riesigen Textmengen. Beantwortet ein Modell eine Frage, ohne sich auf konkrete Quellen zu stützen, speist sich die Antwort aus einem Gemisch: aus dem Trainingscorpus, aus eventuellem Fine-Tuning-Material und aus der statistischen Generalisierung im Inneren des Modells. Das Ergebnis kann stimmen — oder frei erfunden sein, ein Phänomen, das als Halluzination bekannt ist[^1]. Welcher Teil der Antwort in welche Kategorie fällt, lässt sich von außen meist nicht feststellen.

Man kann dieses Gemisch als _"Model-knows-things"_-Fläche beschreiben: die Gesamtheit aller Aussagen, die das Modell ohne Rückhalt in konkreten Quellen produzieren kann. Diese Fläche ist enorm — ein Modell mit 7 bis 70 Milliarden Parametern hat im Training Textmengen im zweistelligen Terabyte-Bereich gesehen.

## Wie ein Quellenverweis die Fläche schrumpft

Bei einer Retrieval-augmentierten Antwort läuft der Prozess anders. Bevor das Modell überhaupt generiert, durchsucht das System einen Index nach passenden Textstellen und legt die Treffer dem Modell als Kontext vor. Die Anweisung lautet: **Stütze die Antwort auf diesen Kontext** — nicht auf das, was im Training hängen geblieben ist.

Besteht der Index ausschließlich aus den eigenen Dokumenten eines Nutzers — Mandantenakten, Forschungsdrafts, Geschäftsunterlagen —, verengt sich die Aufgabe des Modells erheblich: _"Beantworte die Frage anhand dieser Stellen aus diesen Dokumenten."_ Aus der Fläche _"alles, was ich im Training gelernt habe"_ wird die Fläche _"das, was in diesen 30 Absätzen steht"_.

Der Quellenverweis macht genau diese Verengung sichtbar. Steht an der Antwort _"Seite 17, Absatz 3"_, hat der Nutzer einen konkreten Hebel in der Hand: Er schlägt die Stelle nach und sieht sofort, ob die Antwort bei der Quelle geblieben ist — oder ob das Modell darüber hinausgeschossen ist.

## Privacy und Verifizierbarkeit als dieselbe Eigenschaft

An dieser Stelle greift die These. Worin besteht eigentlich das Privacy-Risiko einer Antwort ohne Quellenverweis?

In zwei Dingen zugleich:

1. **Information-Leak aus dem Training.** Ein Modell kann Inhalte reproduzieren, die im Trainingscorpus lagen — wörtlich oder umformuliert. Steckt in diesem Corpus Web-Material, Forendaten oder gescrapte Dokumente, kann eine Antwort unbeabsichtigt Fremdinhalte transportieren, die mit der Nutzerfrage nichts zu tun haben. Dass so etwas technisch machbar ist, hat die Forschung zu _Training Data Extraction_ belegt[^2].
2. **Information-Mix aus mehreren Eingaben.** In längeren Konversationen kann das Modell Inhalte verschiedener Eingaben miteinander vermengen. Was in Frage 1 stand, kann — beabsichtigt oder nicht — in Antwort 3 wieder auftauchen.

Beide Risiken sinken, sobald das Modell auf einen eng umrissenen Kontext festgelegt wird und die verwendeten Stellen in der Antwort ausgewiesen sind. Genau genommen schrumpft nicht der Verweis das Risiko — das leistet der enge Kontext. Aber erst die Verweise machen das Ganze **überprüfbar**: Ohne sie hätte der Nutzer keine Möglichkeit festzustellen, ob sich das Modell tatsächlich an den Kontext gehalten hat.

So fallen zwei Eigenschaften in eins:

- **Verifizierbarkeit:** Kann ich nachschlagen, was mir das Modell erzählt?
- **Privacy-Bounding:** Habe ich Anhaltspunkte dafür, dass das Modell nicht aus fremden Quellen dazugegriffen hat?

Ein und dasselbe technische Merkmal beantwortet beide Fragen.

## Was Quellenverweise nicht leisten

Damit die These nicht mehr trägt, als sie kann, drei klare Grenzen:

- **Quellenverweise garantieren keine Treue.** Ein Modell kann auf eine echte Quelle verweisen und trotzdem etwas behaupten, das dort gar nicht steht — sogenannte _Citation Hallucination_, und die ist messbar häufig[^3]. Verweise senken dieses Risiko, sie beseitigen es nicht.
- **Quellenverweise allein machen ein System nicht privat.** Auch ein Cloud-RAG-System mit makellosen Verweisen schickt jede Anfrage an einen fremden Server. Die Eigenschaft _"Daten verlassen das Gerät nicht"_ steht senkrecht auf der Verweis-Eigenschaft — die eine folgt nicht aus der anderen.
- **Quellenverweise sind nur so gut wie ihr Index.** Bei einem lückenhaften Index kann ein System ehrlich sagen: _"In den verfügbaren Quellen finde ich dazu nichts"_ — eine durchaus wertvolle Auskunft. Es kann aber auch passieren, dass das Modell dann doch auf sein Trainingswissen ausweicht. Wie ein System den Fall _"nicht gefunden"_ behandelt, ist eine Design-Entscheidung — und sie verändert das Privacy-Bild.

## Wie die Eigenschaft in einer lokalen Architektur konkret aussieht

In einer On-Device-RAG-Architektur wie der von LokLM durchläuft jede Antwort drei Stationen:

1. **Indexieren.** Die Dokumente werden in Chunks aufgeteilt; für jeden Chunk entsteht ein Embedding. Der gesamte Index liegt als lokale Datenbank vor.
2. **Retrieven.** Aus der Nutzerfrage wird ebenfalls ein Embedding erzeugt; das System wählt die ähnlichsten Chunks aus dem Index — typischerweise kombiniert aus dense Retrieval (Vektor-Ähnlichkeit) und lexikalischer Suche (BM25). Diese Hybrid-Retrieval-Logik behandelt der [Architektur-Artikel](/architektur) im Detail.
3. **Generieren.** Das Modell erhält Frage und ausgewählte Chunks als Prompt — mit der Anweisung, sich auf diese Chunks zu stützen und deren Herkunft in der Antwort kenntlich zu machen.

Erst in Schritt 3 wird die Privacy-Eigenschaft _sichtbar_. Ohne die Verweise könnte niemand unterscheiden, ob eine Aussage aus dem eigenen Dokument stammt oder eine Erfindung des Modells ist — daran ändert auch die Lokalität nichts.

## Eine praktische Konsequenz

Wer Quellenverweise nur als UX-Detail einordnet, lässt eine ganze Bewertungsdimension liegen. Bei der Auswahl eines KI-Werkzeugs für vertrauliche Inhalte ist _"liefert das System zu jeder Aussage eine nachschlagbare Stelle?"_ eben nicht nur eine Frage der Bedienbarkeit, sondern zugleich:

- eine Privacy-Frage (Wie fest ist die Aussage an die eigene Eingabe gekoppelt?)
- eine Haftungs-Frage (Wer steht für eine Aussage ein, die sich in keiner zitierten Quelle findet?)
- eine Audit-Frage (Kann man nach drei Monaten noch rekonstruieren, woher eine Antwort stammt?)

Drei Fragen — beantwortet durch ein einziges technisches Merkmal.

## Weiter im Cluster

Dieser Beitrag schlägt die Brücke zwischen der [Privacy-Säule](/lokale-ki) und der [Architektur-Säule](/architektur). Die ersten drei Artikel der Reihe — [Definition von "privat"](/blog/was-privat-wirklich-heisst), [EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act), [DSGVO und LLM](/blog/dsgvo-und-llm-datenexport) — argumentieren rechtlich-konzeptionell; dieser hier technisch-konzeptionell.

Als Nächstes folgt eine [Taxonomie lokaler KI](/blog/taxonomie-lokaler-ki): Inferenz, Retrieval, Training — und welche Eigenschaft an welcher Stelle zählt.

LokLM zum Testen: [Download](/#download), ohne Konto.

---

[^1]: Übersichtsarbeit zur Halluzination in Sprachmodellen: "A Survey on Hallucination in Large Language Models". https://arxiv.org/abs/2311.05232

[^2]: "Extracting Training Data from Large Language Models". USENIX Security 2021. https://arxiv.org/abs/2012.07805

[^3]: "Evaluating Verifiability in Generative Search Engines". EMNLP 2023. https://arxiv.org/abs/2304.09848
