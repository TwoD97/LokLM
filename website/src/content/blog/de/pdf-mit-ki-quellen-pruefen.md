---
title: 'PDFs mit KI auswerten: Antworten und Quellen prüfen'
description: 'PDF-Text kontrollieren, gezielt fragen, Quellen prüfen und widersprüchliche Versionen auseinanderhalten. Mit einer Vorlage für die eigene Belegnotiz.'
lang: 'de'
translationKey: 'pdf-source-checking-workflow'
pubDate: 2026-10-07
tags: ['lokale-ki', 'pdf', 'forschung']
---

Eine hilfreiche PDF-Antwort führt zurück zur Textstelle: Du kannst nachlesen und beurteilen, ob die Schlussfolgerung daraus folgt. Das gilt für Kundenprojekte, wissenschaftliche Arbeiten und interne Abläufe. Eine flüssige Zusammenfassung allein erledigt diese Prüfung nicht.

Dieser Ablauf nutzt LokLM als Dokumentenarbeitsplatz. Die Prüfschritte lassen sich auch auf andere PDF-Assistenten übertragen. Er ist eine Arbeitshilfe, kein Benchmark und keine Garantie, dass ein guter Prompt Fehler verhindert. Bei widersprüchlichen Quellen kann LokLM weiterhin zu selbstsichere Schlussfolgerungen liefern.

## 1. Mit einem überschaubaren Dokumentensatz beginnen

Wähle eine konkrete Frage und die dafür benötigten Unterlagen. Dateiname, Version und Datum sollten unterscheidbar sein: `Reiserichtlinie — freigegeben März.pdf` hilft mehr als zwei Dateien namens `final.pdf`. Bewahre genau die Fassung auf, die du prüfst.

Kontrolliere vor dem Import vertraulicher Inhalte die gewählten Anbieter. Mit den gebündelten LokLM-Modellen läuft die Verarbeitung nach dem Modelldownload auf dem Gerät. Optionale Ollama-Verbindungen können Inhalte an den eingestellten Server senden. Ein Server auf einem anderen Rechner ist ein anderes Datenziel, auch im eigenen Unternehmen. Die [Datenschutz-Checkliste](/blog/was-privat-wirklich-heisst) zeigt die relevanten Prüfpunkte.

Teste eine neue Installation zunächst mit unkritischem Material. Die [Download-Voraussetzungen](/#download) und der [Leitfaden für kleine GPUs](/blog/lokale-ki-4gb-vram) helfen bei der Einschätzung deines Rechners.

## 2. Prüfen, ob der PDF-Text brauchbar ist

Öffne das PDF und kopiere einen Satz mit einer Zahl oder einem Namen. Lies den eingefügten Text. Ein Scan kann gut aussehen und trotzdem keinen brauchbaren Text für die Suche enthalten. OCR ergänzt erkannten Text, dessen Richtigkeit weiterhin geprüft werden muss. Die [OCR-Dokumentation von Adobe](https://helpx.adobe.com/ca/acrobat/desktop/create-documents/scan-documents-to-pdfs/recognize-text.html) beschreibt die durchsuchbare Textebene und die anschließende Kontrolle der Erkennung.

Warte in LokLM auf das Ende der Indexierung, bevor du die Suche bewertest. Beachte gemeldete Import- oder Indexierungsfehler. Suche anschließend nach einer auffälligen Formulierung, die du im Original siehst. Fehlt sie oder ist sie verstümmelt, prüfe zuerst die Texterkennung, bevor du eine Aussage über das gesamte Dokument erwartest.

Tabellen brauchen einen eigenen Test: Kopiere eine Zeile und kontrolliere, ob der Wert noch zur richtigen Spaltenüberschrift gehört. Lesereihenfolge, Fußnoten und Dezimalzeichen können die Bedeutung verändern, ohne dass der Text offensichtlich kaputt aussieht.

## 3. Eine überprüfbare Frage stellen

Nenne Dokument, Thema und Geltungsbereich. Diese Beispielprompts lassen sich anpassen:

| Dein Arbeitskontext             | Eine geeignete erste Frage                                                                                     | Was du prüfst                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Selbstständigkeit oder Beratung | „Welche Leistungen nennt der unterschriebene Projektauftrag für Phase zwei? Belege jede mit einer Textstelle.“ | Phase, Unterschrift/Fassung und Ausnahmen       |
| Studium oder Forschung          | „Welche Grenzen nennen die Autoren für dieses Experiment? Trenne ihre Aussagen von deiner Interpretation.“     | Untersuchte Gruppe, Methode und Einschränkungen |
| Arbeit mit internen Unterlagen  | „Was sagt die freigegebene Reiserichtlinie zu Belegen bei Inlandsreisen?“                                      | Freigabe, Reiseart und Ausnahmen                |

Kläre offene Punkte einzeln. „Vergleiche die beiden Fassungen und belege jede Abweichung“ beschreibt eine verständlichere Aufgabe als eine pauschale Zusammenfassung. Vollständigkeit garantiert die Formulierung trotzdem nicht.

## 4. Aussagen an den Textstellen prüfen

Öffne den Quellenverweis und lies den umgebenden Absatz, die Tabellenüberschrift und die Fußnote. Prüfe:

- Trägt die Stelle die ganze Aussage, einschließlich Zahl, Einheit und Bedingung?
- Geht es um dieselbe Person, dasselbe Projekt, dieselbe Gruppe oder denselben Zeitraum?
- Beschreibt sie einen Vorschlag, eine Beobachtung oder eine freigegebene Vorgabe?
- Verändert eine Ausnahme auf der nächsten Seite die Schlussfolgerung?

Auch ein echter Quellenverweis kann neben einer unbelegten Behauptung stehen. Die [ALCE-Forschung](https://aclanthology.org/2023.emnlp-main.398/) bewertet deshalb Quellenqualität und Antwortkorrektheit getrennt. Ein anklickbarer Beleg erleichtert die Prüfung; er bescheinigt keine Richtigkeit.

Weichen angezeigte Quelle und aktuelles Original voneinander ab, kläre zuerst, welche Fassung indexiert wurde. Eine Markierung ist ein Einstieg ins Lesen. Sie erfasst nicht automatisch alle Einschränkungen, die eine Antwort berücksichtigen müsste.

## 5. Widersprüche sichtbar lassen

Das folgende Beispiel ist **frei erfunden und kein LokLM-Testergebnis**:

| Dokument                               | Wortlaut                         | Was damit belegt ist                        |
| -------------------------------------- | -------------------------------- | ------------------------------------------- |
| Freigegebener Workshopplan vom 3. Juni | „Die Einheit dauert 45 Minuten.“ | Der freigegebene Plan enthält 45 Minuten.   |
| Agendaentwurf vom 10. Juni             | „Die Einheit dauert 60 Minuten.“ | Der spätere Entwurf schlägt 60 Minuten vor. |

Das spätere Datum belegt allein nicht, dass der Entwurf den freigegebenen Plan ersetzt. Halte beide Aussagen fest und benenne den fehlenden Freigabe- oder Änderungsnachweis. Ein selbstsicheres „Die Einheit dauert jetzt 60 Minuten“ darf diesen fehlenden Schritt nicht ersetzen.

Die aktuelle RAG-Auswertung von LokLM zeigt weiterhin Grenzen beim Schlussfolgern aus widersprüchlichen Quellen. Auch die Aufforderung, Unterschiede aufzulisten, kann einen Konflikt übersehen oder einer Quelle zu viel Verbindlichkeit zuschreiben. Prüfe für eine folgenreiche Entscheidung beide Originale und hole die fehlende Bestätigung bei der zuständigen Person ein.

Ebenso beschreibt „Ich habe keine Stelle gefunden“ ein Suchergebnis. Daraus folgt nicht, dass eine solche Regel im gesamten Dokumentensatz fehlt.

## 6. Eine kurze Belegnotiz sichern

Nutze diese Vorlage in einer Notiz oder deinem Arbeitsdokument. Trenne den Quellenwortlaut von deiner eigenen Schlussfolgerung:

```text
Frage und Geltungsbereich:
Dokumenttitel, Fassung/Datum und Seite:
Relevanter Quellenwortlaut:
Meine geprüfte Schlussfolgerung:
Ausnahmen oder widersprechende Stellen:
Noch zu klären, und mit wem:
```

Notiere die aufgedruckte Seitenzahl, falls sie von der Seitenzählung des PDF-Programms abweicht. Lass offene Punkte beim Weitergeben der Notiz erkennbar. Teile nur Inhalte, die du weitergeben darfst.

Wie die Dokumentensuche arbeitet, erklärt die [LokLM-Architektur](/architektur). Die Einordnung von Belegen und Datenverarbeitung behandelt [Quellenverweise richtig einordnen](/blog/quellenverweise-als-datenschutz).

_Produktangaben wurden am 7. Oktober 2026 mit dem [aktuellen Entwicklungsstand](https://github.com/TwoD97/LokLM) abgeglichen. Eine installierte Version, auch 0.7.0, kann andere Bedienelemente oder Abläufe haben. Dieser Leitfaden kündigt keine neue Veröffentlichung an._
