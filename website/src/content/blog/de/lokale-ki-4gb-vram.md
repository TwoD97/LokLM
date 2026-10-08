---
title: 'Lokale KI mit 4 GB VRAM: Was passt, was bremst?'
description: 'GPU-Speicher, Modellwechsel und Indexierung auf kleinen GPUs verstehen. LokLM-Einstellungen prüfen und Tempo sowie Quellenqualität selbst bewerten.'
lang: 'de'
translationKey: 'local-ai-small-gpu-guide'
pubDate: 2026-10-07
tags: ['lokale-ki', 'hardware', 'pdf']
---

„Meine GPU hat 4 GB“ reicht nicht aus, um die Reaktionszeit eines Dokumentenassistenten vorherzusagen. Modell, freier Speicher, Fragenlänge und gleichzeitig laufende Aufgaben spielen zusammen. Dieser Leitfaden zeigt, was du vor dem Import einer großen Bibliothek prüfen kannst und warum ein größeres Modell nicht automatisch das bessere Ergebnis liefert.

**Versionsbezug:** Die beschriebene Ressourcensteuerung entspricht dem [Entwicklungsstand](https://github.com/TwoD97/LokLM) vom 7. Oktober 2026. Daraus folgt nicht, dass Version 0.7.0 bereits jede aktuelle Änderung an Modellwechseln und Einstellungen enthält. Prüfe deine installierte Version und ihre Versionshinweise.

## Vier verschiedene Größen zählen

| Größe                             | Bedeutung für deine Arbeit                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Modelldownload auf der Festplatte | Platzbedarf der Modelldatei; er umfasst nicht den gesamten Speicherbedarf beim Ausführen.                      |
| Arbeitsspeicher, RAM              | Speicher für Betriebssystem, App, Dokumentenverarbeitung und gegebenenfalls dort ausgeführte Modellteile.      |
| GPU-Speicher                      | Platz für Modellgewichte, Inferenzzustand und weitere GPU-Belegungen. Andere Anwendungen nutzen ihn ebenfalls. |
| Kontextfenster                    | Tokenbudget für Anweisungen, Gespräch, ausgewählte Quellenstellen und Antwortgenerierung.                      |

Ein größerer Kontext benötigt mehr Speicher. Die [Kontext-Dokumentation von Ollama](https://docs.ollama.com/context-length) erklärt diesen Zusammenhang. Ihre konkreten Standardwerte sind keine LokLM-Standardwerte.

Quantisierung verkleinert den Speicherbedarf der Modellgewichte; die Abwägungen hängen von Modell und Verfahren ab. Das [llama.cpp-Projekt](https://github.com/ggml-org/llama.cpp) unterstützt quantisierte Modelle sowie kombinierte CPU-/GPU-Ausführung. Auch eine Modelldatei, die kleiner als der beworbene GPU-Speicher ist, kann mit den zusätzlichen Laufzeitbelegungen zu groß sein.

Integrierte GPUs können sich Speicher mit dem übrigen System teilen. Ihre angezeigte Kapazität lässt sich deshalb nicht wie ein eigener, gleich schneller Speicherpool mit dediziertem VRAM vergleichen.

## Was LokLM bei wenig GPU-Speicher tut

Für die gebündelten Modelle benötigt LokLM eine unterstützte integrierte oder dedizierte GPU und einen funktionierenden Treiber. **Ein reiner CPU-Betrieb wird nicht unterstützt.** Einzelne Schichten des Chatmodells können dennoch auf der CPU laufen, während andere auf der GPU liegen. Das ist kein vollständig CPU-basierter Modellbetrieb.

Die aktuelle Entwicklungsfassung weist die GPU der aktiven Aufgabe zu. Auf knapper Hardware kann die Vorbereitung von Dokument-Embeddings das Chatmodell entladen, die Embedding-Aufgabe ausführen und danach das Chatmodell wieder laden. So müssen nicht alle Modelle gleichzeitig in den GPU-Speicher passen. Der Wechsel kostet allerdings Zeit.

Der Reranker ist ein zusätzliches Modell, das gefundene Textstellen neu sortiert. Er schreibt nicht die Antwort. Im Modus **Auto** überspringt die aktuelle Steuerung den gebündelten Reranker auf einer 4-GB-GPU, um Ressourcen freizuhalten. Die Dokumentensuche bleibt verfügbar; ihre Qualität solltest du an deinen Unterlagen prüfen. **Immer** zu erzwingen kann zusätzliche Modellwechsel und längere Wartezeiten verursachen. Mehr geladene Modelle verbessern den Arbeitsablauf nicht automatisch.

Keine dieser Regeln garantiert, dass ein bestimmtes Modell auf jedem 4-GB-Gerät passt. Freier Speicher, Unterstützung durch das Backend, Kontext und Modellarchitektur bleiben entscheidend.

## Eine sinnvolle erste Einrichtung

1. **Erkannte GPU prüfen.** Kontrolliere in den Modell-/Systemeinstellungen, ob das gewünschte Gerät verfügbar ist. Falls nicht, prüfe Treiber und Fehlermeldung, bevor du ein größeres Modell versuchst. Reiner CPU-Betrieb ist kein Ausweichweg.
2. **Mit automatischer Platzierung und einem kleinen verfügbaren Modell beginnen.** Erfolgreiches Laden ist der Start eines Tests und kein Nachweis, dass jede Aufgabe in den Speicher passt.
3. **Reranker auf Auto lassen.** Meldet deine Version, dass er wegen knappen GPU-Speichers übersprungen wird, beschreibt das eine Ressourcenentscheidung und keinen Ausfall des Chatmodells.
4. **Zunächst wenige typische Dokumente indexieren.** Nimm ein normales PDF und bei Bedarf einen Scan oder eine Tabelle. Warte vor der Messung einer Chatantwort auf das Ende der Indexierung.
5. **Unnötige GPU-intensive Anwendungen schließen.** Vergleiche mit demselben Modell und derselben Frage, damit die Wirkung einer Änderung erkennbar bleibt.

Bei optionalen Ollama-Anbietern musst du Modell- und Serverkonfiguration getrennt prüfen. Ein freigegebener Server auf einem anderen Rechner verändert den Verarbeitungsort für die gewählten Funktionen. Er sollte nicht unbemerkt zum Ausweg werden, wenn vertrauliche Arbeit auf dem eigenen Gerät bleiben soll.

## Die eigene Aufgabe messen

Nutze unkritische Beispieldokumente, deren Antworten du nachprüfen kannst. Die folgende Vorlage ist für deine Beobachtungen gedacht; dieser Artikel enthält keine erfundenen Benchmarkwerte.

| Beobachtung   | Was du notierst                                                                |
| ------------- | ------------------------------------------------------------------------------ |
| Umgebung      | App-Version, Modell, GPU, RAM und weitere aktive GPU-Anwendungen               |
| Import        | Dokumentanzahl, ungefährer Umfang, Scans/Tabellen und Extraktionsfehler        |
| Indexierung   | Zeit vom Start bis zur Bereitschaft; sichtbarer Fortschritt oder Fehlermeldung |
| Erste Frage   | Zeit bis zum ersten Antworttext einschließlich möglichem Modellladen           |
| Folgefrage    | Zeit für eine vergleichbare weitere Frage bei bereits geladenem Modell         |
| Belegqualität | Richtige Werte, geprüfte Quellen, erhaltene Ausnahmen und offene Widersprüche  |

Vergleiche Einstellungen mit denselben Dokumenten und derselben Frage. Trenne Ladezeit und spätere Antwortzeit: Eine schnelle Folgefrage beschreibt nicht den ersten Zugriff nach dem Indexieren.

Beende einen Test bei wiederkehrenden Lade- oder Speicherfehlern und halte die Meldung fest. Probiere über die Bedienelemente deiner Version ein kleineres Modell oder einen kleineren Kontext. Erzwinge nicht wiederholt dieselbe scheiternde Kombination.

## Qualität in die Entscheidung einbeziehen

Ein kleinerer Kontext kann den Speicher entlasten, lässt aber weniger Platz für Verlauf und Belege. Grenze eine Frage auf das benötigte Dokument oder den Abschnitt ein, ohne notwendige Einschränkungen wegzulassen. Eine Quellen-Ausnahme nur aus Platzgründen abzuschneiden kann eine schnellere, aber falsche Antwort ergeben.

Prüfe Ergebnisse mit dem [Ablauf zur PDF-Quellenprüfung](/blog/pdf-mit-ki-quellen-pruefen). LokLM kann widersprüchliche Quellen weiterhin falsch einordnen, auch wenn Modellladen und Suche erfolgreich waren. Weder ein aktivierter Reranker noch eine größere GPU bescheinigen eine richtige Schlussfolgerung.

Läuft eine typische Aufgabe nicht zuverlässig durch oder ist die Wartezeit ungeeignet, erfüllt diese Konfiguration deinen Bedarf nicht. Genau das vor einem großen Import festzustellen ist ein nützliches Testergebnis. Die [Download-Seite](/#download) und die [Architekturübersicht](/architektur) liefern die nächsten Prüfpunkte für LokLM.
