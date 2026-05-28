---
title: 'Quellenverweise als Datenschutz-Merkmal, nicht nur UX'
description: 'Warum Antworten mit Quellenverweis weniger preisgeben als reine Modell-Antworten — Privacy und Verifizierbarkeit sind zwei Seiten derselben Eigenschaft.'
lang: 'de'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
tags: ['lokale-ki', 'architektur', 'datenschutz']
---

> **Hinweis:** Erstentwurf — wird vor der Veröffentlichung redaktionell überarbeitet.

In Produkt-Demos werden Quellenverweise meist als Komfort-Feature vorgeführt. _"Hier steht der Beleg, Seite 47."_ Schick. Verifizierbar. Nutzerfreundlich. Das ist nicht falsch — aber es übersieht, dass Quellenverweise zugleich eine **Privacy-Eigenschaft** sind. Die folgende These ist nicht offensichtlich, ist aber bei genauem Hinsehen schlicht: Antworten mit Quellenverweis geben weniger über das Modell preis als Antworten ohne.

Dieser Artikel arbeitet die These aus.

## Was eine "reine Modell-Antwort" ist

Ein Sprachmodell ist auf großen Textcorpora trainiert worden. Wenn es eine Frage beantwortet, ohne auf spezifische Quellen zu verweisen, schöpft es aus einer Mischung: dem Trainingscorpus, eventuellen Fine-Tuning-Daten, und der internen statistischen Generalisierung. Die Antwort kann korrekt sein. Sie kann auch erfunden sein (das Phänomen wird Halluzination genannt[^1]). Aus der Antwort allein lässt sich oft nicht erkennen, welcher Teil welcher Sorte ist.

Diese Mischung ist die _"Model-knows-things"_-Fläche. Sie ist die Summe aller Aussagen, die das Modell ohne Stützung durch konkrete Quellen treffen kann. Sie ist groß: ein Modell der Größenordnung 7–70 Milliarden Parameter hat Trainingsdaten in zweistelliger Terabyte-Größenordnung gesehen.

## Wie ein Quellenverweis die Fläche schrumpft

Eine Retrieval-augmentierte Antwort ist anders aufgebaut. Vor der Generierung sucht das System in einem Index nach passenden Textpassagen. Die gefundenen Passagen werden dem Modell als Kontext mitgegeben. Das Modell soll die Antwort **auf diesen Kontext stützen**, nicht auf sein Trainings-Wissen.

Wenn der Index nur die eigenen Dokumente eines Nutzers enthält — Mandantenakten, Forschungsdrafts, Geschäftsunterlagen —, dann steht das Modell vor einer schmaleren Aufgabe: _"Beantworte diese Frage mit Bezug auf diese Stellen aus diesen Dokumenten."_ Die Aussagefläche schrumpft von _"alles, was ich aus dem Training weiß"_ auf _"das, was in diesen 30 Absätzen steht"_.

Quellenverweise sind die Sichtbarkeit dieser Schrumpfung. Wenn an einer Antwort _"Seite 17, Absatz 3"_ steht, hat der Nutzer einen direkten Hebel: er kann die Stelle prüfen und erkennt, ob die Antwort der Quelle treu ist oder ob das Modell darüber hinausgegangen ist.

## Privacy und Verifizierbarkeit als dieselbe Eigenschaft

Hier kommt die These zum Tragen. Was ist das Privacy-Risiko bei einer Antwort ohne Quellenverweis?

Zwei Dinge gleichzeitig:

1. **Information-Leak aus dem Training.** Das Modell könnte Inhalte ausgeben, die in seinem Trainingscorpus waren — und zwar wörtlich oder paraphrasiert. Wenn der Corpus Webseiten, Forendaten, möglicherweise gescrappte Dokumente enthält, kann eine Antwort versehentlich Inhalte enthalten, die nicht zur Nutzerfrage gehören. Forschung zu _Training Data Extraction_ hat gezeigt, dass das technisch möglich ist[^2].
2. **Information-Mix aus mehreren Eingaben.** Bei Mehr-Turn-Konversationen kann das Modell Inhalte aus früheren Eingaben verquicken. Was der Nutzer in Frage 1 eingegeben hat, kann in Antwort 3 wieder auftauchen — gewollt oder nicht.

Beide Risiken werden kleiner, wenn das Modell explizit auf einen begrenzten Kontext gezwungen wird und die genutzten Stellen in der Antwort markiert sind. Quellenverweise sind nicht der Mechanismus, der das Risiko schrumpft — der Mechanismus ist der enge Kontext. Aber die Verweise machen das **prüfbar**: ohne sie könnte der Nutzer nicht erkennen, ob das Modell tatsächlich nur den Kontext genutzt hat.

Damit fallen zwei Eigenschaften zusammen:

- **Verifizierbarkeit:** Habe ich nachgeschlagen, was das Modell mir sagt?
- **Privacy-Bounding:** Habe ich Grund anzunehmen, dass das Modell nicht aus anderen Quellen herübergegriffen hat?

Beide Fragen werden mit derselben technischen Eigenschaft beantwortbar.

## Was Quellenverweise nicht leisten

Drei wichtige Einschränkungen, damit die These nicht überdehnt wird:

- **Quellenverweise garantieren keine Treue.** Ein Modell kann eine korrekte Quelle zitieren und dabei eine Aussage treffen, die in der Quelle so nicht steht. Das nennt sich _Citation Hallucination_ und ist messbar verbreitet[^3]. Verweise reduzieren das Risiko, eliminieren es nicht.
- **Quellenverweise allein machen ein System nicht privat.** Ein Cloud-RAG-System mit perfekten Quellenverweisen verschickt die Anfrage trotzdem an einen externen Server. Die Privacy-Eigenschaft _"Daten verlassen das Gerät nicht"_ ist orthogonal zur Verweis-Eigenschaft.
- **Quellenverweise sind nur so gut wie ihr Index.** Wenn der Index unvollständig ist, kann das System ehrlich antworten _"in den verfügbaren Quellen finde ich nichts dazu"_ — und das ist eine wertvolle Aussage. Es kann aber auch das Modell zwingen, doch wieder auf Training-Wissen auszuweichen. Wie ein System mit _"nicht gefunden"_ umgeht, ist eine Design-Entscheidung, die das Privacy-Bild ändert.

## Wie die Eigenschaft in einer lokalen Architektur konkret aussieht

In einer On-Device-RAG-Architektur wie LokLM laufen drei Schritte ab, bevor eine Antwort entsteht:

1. **Indexieren.** Dokumente werden in Chunks zerlegt, jeder Chunk bekommt ein Embedding. Index liegt lokal als Datenbank.
2. **Retrieven.** Die Nutzerfrage wird zu einem Embedding, die ähnlichsten Chunks aus dem Index werden ausgewählt — meist eine Mischung aus dense (Vektor-Ähnlichkeit) und lexikalisch (BM25). Diese Hybrid-Retrieval-Logik wird im [Architektur-Artikel](/architektur) ausführlicher.
3. **Generieren.** Das Modell bekommt die Frage plus die ausgewählten Chunks als Prompt. Es wird angewiesen, die Antwort auf diese Chunks zu stützen und die Chunk-Quelle in der Antwort zu markieren.

Schritt 3 ist die Stelle, an der die Privacy-Eigenschaft _sichtbar_ wird. Ohne die Verweise könnte der Nutzer nicht zwischen _"das stand in meinem Dokument"_ und _"das hat sich das Modell ausgedacht"_ unterscheiden — die Lokalität allein hilft hier nicht.

## Eine praktische Konsequenz

Wer Quellenverweise als reines UX-Feature bewertet, verpasst eine Bewertungsdimension. Bei der Auswahl eines KI-Werkzeugs für vertrauliche Inhalte ist die Frage _"liefert das System pro Aussage eine prüfbare Stelle?"_ nicht nur eine UX-Frage. Sie ist auch:

- eine Privacy-Frage (Wie eng ist die Aussage an die Eingabe gebunden?)
- eine Haftungs-Frage (Wer ist verantwortlich für eine Aussage, die in keiner zitierten Quelle steht?)
- eine Audit-Frage (Lässt sich nach drei Monaten nachvollziehen, woher eine Antwort kam?)

Drei Fragen, eine technische Eigenschaft.

## Weiter im Cluster

Dieser Artikel verbindet die [Privacy-Säule](/lokale-ki) mit der [Architektur-Säule](/architektur). Die ersten drei Artikel der Reihe — [Definition von "privat"](/blog/was-privat-wirklich-heisst), [EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act), [DSGVO und LLM](/blog/dsgvo-und-llm-datenexport) — sind rechtlich-konzeptionell. Dieser hier ist technisch-konzeptionell.

Das nächste Stück der Reihe wird eine [Taxonomie lokaler KI](/blog/taxonomie-lokaler-ki) skizzieren — Inferenz, Retrieval, Training, und wofür welche Eigenschaft greift.

LokLM zum Testen: [Download](/#download), ohne Konto.

---

[^1]: Übersichtsarbeit zur Halluzination in Sprachmodellen: Huang et al., "A Survey on Hallucination in Large Language Models". https://arxiv.org/abs/2311.05232

[^2]: Carlini et al., "Extracting Training Data from Large Language Models". USENIX Security 2021. https://arxiv.org/abs/2012.07805

[^3]: Liu et al., "Evaluating Verifiability in Generative Search Engines". EMNLP 2023. https://arxiv.org/abs/2304.09848
