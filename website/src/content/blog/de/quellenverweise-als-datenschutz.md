---
title: 'Quellenverweise richtig einordnen: Belege und Datenschutz'
description: 'Was ein Quellenverweis überprüfbar macht, warum er keine richtige Antwort garantiert und welche eigenen Fragen den Verbleib deiner Dokumentdaten klären.'
lang: 'de'
translationKey: 'citations-as-privacy'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['lokale-ki', 'architektur', 'datenschutz']
---

Ein Quellenverweis zeigt dir eine Stelle, an der du eine Behauptung prüfen kannst. Er belegt nicht, dass die Behauptung aus dieser Stelle folgt, dass alle relevanten Dokumente berücksichtigt wurden oder dass das Dokument auf deinem Gerät geblieben ist. Das sind eigenständige Fragen mit unterschiedlichen Nachweisen.

_Korrektur vom 7. Oktober 2026: Eine frühere Fassung dieses Artikels beschrieb Quellenverweise und Datenschutz als dieselbe Eigenschaft und legte nahe, belegte Antworten verringerten die Offenlegung von Trainingsdaten. Diese Aussagen waren nicht belegt. Die Überarbeitung trennt Quellenprüfung und Datenverarbeitung._

## Drei Prüfungen für einen brauchbaren Quellenverweis

Eine Quellenmarkierung kann überzeugend wirken, bevor du ihr Ziel gelesen hast. Prüfe drei Dinge:

1. **Zuordnung:** Führt der Verweis zum gemeinten Dokument, zur richtigen Fassung und Textstelle?
2. **Beleg:** Trägt diese Stelle die zugeordnete Aussage mit ihrem Geltungsbereich, ihren Bedingungen und Zahlen?
3. **Abdeckung:** Sind die übrigen wesentlichen Aussagen ebenfalls belegt? Fehlen relevante Ausnahmen oder Widersprüche?

Die erste bestandene Prüfung ersetzt die anderen beiden nicht. Eine echte Seite über einen Budgetvorschlag belegt keine Budgetfreigabe. Eine korrekt übernommene Zahl aus einem Jahr kann für den erfragten Zeitraum falsch sein.

Auch die Forschung unterscheidet: [ALCE](https://aclanthology.org/2023.emnlp-main.398/) bewertet Antwortkorrektheit und Quellenqualität getrennt und berichtet über unvollständige Belege in den untersuchten Systemen. Diese Benchmarkwerte sind keine Messungen von LokLM.

## Was die Dokumentensuche beiträgt

Bei Retrieval-Augmented Generation sucht ein System Textstellen und übergibt sie zusammen mit der Frage an ein Modell. Das Modell soll anhand dieser Belege antworten. So steht relevanter Text bereit, ohne bei jeder Frage die ganze Sammlung in den Prompt zu legen.

Dabei gibt es mehrere mögliche Fehlerstellen: Die Extraktion kann eine Tabellenüberschrift verlieren, die Suche eine wichtige Passage übersehen und die Antwort eine Bedingung falsch lesen. Ein Quellenverweis erleichtert die Kontrolle des Ergebnisses. Er ist kein Ablaufnachweis dafür, dass das Modell ausschließlich den belegten Text verwendet und Trainingswissen oder frühere Gesprächsinhalte ignoriert hat.

Die [Architekturübersicht](/architektur) beschreibt die Verarbeitung in LokLM. Quellenlinks führen zu Belegen zurück, garantieren aber keine richtige Schlussfolgerung. Das Einordnen widersprüchlicher Quellen bleibt eine bekannte Grenze der aktuellen Entwicklungsauswertung: Eine Antwort kann einer Quelle selbstsicher eine Verbindlichkeit zuschreiben, die aus den Dokumenten nicht hervorgeht.

## Datenschutz braucht eigene Prüfungen

Für die Datenverarbeitung sind Konfiguration und Speicherung zu untersuchen:

| Frage                                                   | Zu prüfender Nachweis                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Wo werden Dokument-Embeddings berechnet?                | Gewählter Embedding-Anbieter und dessen Zieladresse                                  |
| Wo werden Fragen und gefundene Textstellen verarbeitet? | Chat- und Reranking-Anbieter, Serveradressen und Freigaben                           |
| Was bleibt auf der Festplatte?                          | Originaldateien, extrahierter Text, Indizes, Protokolle, Backups und ihr Schutz      |
| Wird bei der Nutzung etwas übertragen?                  | Dokumentierte Netzwerkfunktionen und beobachteter Verkehr in den relevanten Abläufen |

Weder ein vorhandener noch ein fehlender Quellenverweis beantwortet diese Fragen. Ein entfernter Dienst kann genaue Belege liefern und dabei Dokumentinhalte empfangen. Ein lokales Modell kann eine Behauptung erfinden, ohne eine Anfrage nach außen zu senden. Auch eine kleinere übertragene Textmenge ist nicht automatisch unkritisch.

Mit gebündelten Modellen verarbeitet LokLM nach dem Modelldownload lokal. Optionale Ollama-Anbieter sind eine eigene Konfigurationsentscheidung: Ein Server auf einem anderen Rechner erhält Inhalte für die ihm zugewiesenen Funktionen. Der aktuelle Entwicklungsstand verlangt die ausdrückliche Freigabe dieses entfernten Ziels. Die [Datenschutz-Checkliste](/blog/was-privat-wirklich-heisst) erläutert diesen Unterschied und die Speichergrenzen. Prüfe deine installierte Version; Entwicklungsänderungen dürfen nicht als bereits in 0.7.0 enthalten vorausgesetzt werden.

## Eine nützliche Prüfroutine

Öffne bei wichtigen Antworten die Quellen, bevor du eine Schlussfolgerung übernimmst. Lies das Umfeld und trenne Beobachtung und Interpretation. Widersprechen sich zwei Dokumente, halte beide Aussagen fest und benenne den fehlenden Nachweis, der ihre Gültigkeit klären würde. Findet die Suche nichts, dokumentiere dieses begrenzte Ergebnis, statt daraus die Nichtexistenz einer Regel abzuleiten.

Einen wiederholbaren Ablauf und eine Vorlage für Belegnotizen findest du im [Leitfaden zur PDF-Quellenprüfung](/blog/pdf-mit-ki-quellen-pruefen). Wo die einzelnen Schritte eines Dokumentenassistenten laufen, erklärt die [Taxonomie lokaler KI](/blog/taxonomie-lokaler-ki).

_Produktangaben wurden am 7. Oktober 2026 mit dem [aktuellen Entwicklungsstand](https://github.com/TwoD97/LokLM) abgeglichen. Der Artikel beschreibt Prüfpraktiken, keinen Sicherheitsaudit und keine Zusage fehlerfreier Antworten._
