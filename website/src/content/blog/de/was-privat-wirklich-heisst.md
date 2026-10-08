---
title: 'Was "privat" für einen KI-Assistenten wirklich heißt'
description: 'Fünf praktische Prüfungen für KI-Datenverarbeitung: Verarbeitungsort, Speicherung, Telemetrie, Prüfbarkeit und Sync. Mit LokLM-Anbieter- und Speichergrenzen.'
lang: 'de'
translationKey: 'private-definition'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

Kaum eine KI-Produktseite kommt heute ohne das Wort "privat" aus — und kaum zwei meinen damit dasselbe. Ein Cloud-Anbieter versteht darunter meist: "Wir verwenden deine Eingaben nicht fürs Training." Ein Browser-Plugin meint: "Die Übertragung ist verschlüsselt." Ein On-Device-System meint: "Der Text bleibt auf dem Gerät."

Drei Aussagen, die zum Verwechseln ähnlich klingen — und drei völlig verschiedene Sachverhalte beschreiben.

Für den Einsatz in einer Anwaltskanzlei, einer Forschungsgruppe oder einer Steuerberatung reicht diese Unschärfe nicht. Wer hier ohne präzise Begriffe auswählt, läuft Gefahr, ein Werkzeug einzuführen, das den eigenen Vertraulichkeitspflichten nicht standhält — nicht weil der Hersteller täuschen wollte, sondern weil "privat" auf beiden Seiten des Kaufs etwas anderes bedeutete.

Die folgenden fünf Prüfungen machen die Aussage konkreter. Sie sind ein Einstieg in die Bewertung einer Installation, kein vollständiger Sicherheitsaudit.

## Warum die Frage rechtlich nicht trivial ist

Verarbeitet ein KI-Werkzeug personenbezogene Daten, bleiben Rechtsgrundlage, Zweckbindung, Datenminimierung und angemessene Schutzmaßnahmen zu prüfen. Lokale Ausführung allein beantwortet diese Fragen nicht. Eine verständliche Einführung bietet der [Europäische Datenschutzausschuss](https://www.edpb.europa.eu/sme/learn-the-basics/data-protection-basics_de).

Auch der AI Act knüpft Pflichten an Rolle und Verwendung. [Artikel 50 und die Erläuterungen der Kommission](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) unterscheiden unter anderem Hinweise bei direkter KI-Interaktion, technische Markierungen und Offenlegung bei bestimmten Veröffentlichungen. Daraus folgt keine pauschale Kennzeichnungspflicht für jede interne Notiz. Das Werbewort „privat“ belegt weder die Einhaltung dieser Regeln noch der DSGVO.

## Die fünf Eigenschaften

Prüfe diese Aspekte getrennt. Halte Konfiguration und App-Version fest, damit ein Ergebnis nicht unbemerkt auf eine andere Einrichtung übertragen wird.

### 1. On-Device-Inferenz

**Kläre, wo die Antwort erzeugt wird.** Ein lokales Modell kann in der App oder über eine API auf demselben Gerät laufen. Ein API-Aufruf ist nicht automatisch ein entfernter Aufruf; die Zieladresse entscheidet. Prüfe Embedding- und Reranking-Anbieter getrennt vom Chatmodell.

Prüfbar durch: Eingestellte Ziele kontrollieren und anschließend den Verkehr bei Import, Indexierung und einer Frage mit unkritischem Beispielmaterial beobachten. Unterscheide Modelldownloads und Update-Prüfungen von der Inhaltsverarbeitung. Ein unauffälliger Test beweist nicht, dass jeder Ablauf, Fehlerfall oder spätere Versionsstand lokal bleibt.

Verschlüsselte Übertragung und rein lokale Verarbeitung haben unterschiedliche Datenflüsse. Ob ein externer Dienst Auftragsverarbeiter ist, hängt von seiner tatsächlichen Rolle ab; bei Verarbeitung im Auftrag sind die Anforderungen des Art. 28 DSGVO zu prüfen. Backups, Fernzugriffe und optionale Dienste gehören ebenfalls in die Prüfung. Mehr dazu im [Beitrag zu DSGVO und Cloud-LLMs](/blog/dsgvo-und-llm-datenexport).

### 2. Lokaler Index, lokale Speicherung

Wird KI auf eigene Dokumente angewandt — Retrieval Augmented Generation, kurz RAG —, entstehen **Vektor-Embeddings**: numerische Abbilder der Texte, über die das System ähnliche Passagen findet. Solche Embeddings sind abgeleitete Inhalte — und keineswegs unbedenklich.

Die entscheidende Frage lautet: **Wo liegen sie?** Ein Werkzeug kann Chat lokal ausführen und trotzdem Dokumenttext an einen Embedding-Dienst senden oder Vektoren entfernt speichern. Eine numerische Darstellung ist nicht automatisch harmlos: Forschung hat unter untersuchten Bedingungen Text aus Embeddings rekonstruiert[^4]. Das ist ein Grund, abgeleitete Daten zu schützen, aber keine Aussage, dass jedes Embedding immer umkehrbar wäre.

Prüfbar durch: Speicherorte von Originalen, extrahiertem Text und Indizes sowie die Verschlüsselung der einzelnen Kopien feststellen. Temporäre Arbeitsdateien und Backups durch Betriebssystem oder Ordner-Synchronisation einbeziehen. Eine lokale Datenbank belegt nicht, dass nie eine weitere Kopie hochgeladen wurde.

### 3. Keine Telemetrie

Telemetrie kann Nutzung, Fehler und Geräteeigenschaften an einen Hersteller melden. Ihre Bedeutung für den Datenschutz hängt von Inhalten, Zielen und Kontrollmöglichkeiten ab. Ein Bericht mit einem Dokumentpfad oder Textauszug braucht eine andere Prüfung als ein einfacher aggregierter Zähler. Untersuche den tatsächlichen Versand, statt dich auf die Bezeichnung „anonym“ zu verlassen.

Prüfbar durch: Dokumentierte Telemetrie und Fehlerberichte, Einstellungen und beobachtete Ziele untersuchen. Welche Inhalte enthalten Berichte, ist der Versand optional und was ist voreingestellt? Kein beobachteter Verkehr in einer Sitzung ist ein begrenzter Befund, kein Abwesenheitsbeweis.

### 4. Auditierbarer Code

Der strukturelle Punkt der Liste. Die ersten drei Eigenschaften sind Beobachtungen von Verhalten — und Verhalten kann sich mit jedem Update ändern.

Öffentlicher Quellcode ermöglicht die Prüfung von Implementierungsangaben. Für die installierte Anwendung muss zusätzlich geklärt werden, welcher Quellstand und welche Abhängigkeiten in der ausführbaren Datei stecken. Unabhängige Audits und Tests der konkreten Installation können sowohl für offene als auch für geschlossene Software Nachweise liefern.

Auditierbar heißt nicht auditiert. Offener Code schafft eine Prüfmöglichkeit; er belegt nicht, dass jemand das relevante Verhalten untersucht oder jeden Fehler gefunden hat.

Prüfbar durch: Auf der Hersteller-Seite nach einem Repository-Link suchen; bei Open-Source-Projekten führt er meist zu GitHub oder GitLab. Findet sich keiner, ist der Code höchstwahrscheinlich nicht offen.

### 5. Keine Hintergrund-Synchronisation

Sync kann Einstellungen, Gesprächsverläufe oder Dokumente übertragen, während die Modellinferenz weiterhin auf dem Gerät läuft. Prüfe die App-Synchronisation und externe Dienste, die ihre Ordner sichern. Lokale Inferenz und ausschließlich lokale Speicherung sind getrennte Eigenschaften.

Prüfbar durch: Die Einstellungen nach Konto-, Sync- oder Cloud-Funktionen durchsuchen. Falls vorhanden: Sind sie ab Werk aktiv oder inaktiv? Zwischen einer Software, die im Auslieferungszustand nichts synchronisiert und Sync nur als Opt-in kennt, und einer mit Opt-out liegt ein relevanter Unterschied.

## Was diese Prüfungen offenlassen

Die Liste ist nicht vollständig. Auch Exporte, Zwischenablage, gemeinsam genutzte Rechner, Backups, Schadsoftware und der Zugriff auf eine entsperrte Sitzung können Informationen offenlegen. Welche Risiken zählen, hängt vom konkreten Einsatz ab.

Einige Kriterien, die anderswo auftauchen, fehlen hier mit Absicht:

- **"Verschlüsselt"**: Verschlüsselung beantwortet nicht die Frage, wer den Schlüssel besitzt. Notwendig ja — hinreichend nein.
- **"DSGVO-konform"**: Eine Software kann alle fünf Punkte erfüllen und trotzdem nicht DSGVO-konform betrieben werden (etwa ohne Verarbeitungsverzeichnis oder ohne Rechtsgrundlage). Konformität ist eine Eigenschaft des konkreten Einsatzes, nicht des Werkzeugs für sich.
- **"Privacy-first"**: Eine Eigenwerbung, kein Prüfkriterium.

## Wie diese Liste anwendbar wird

Für die Bewertung eines konkreten KI-Werkzeugs ergeben sich sechs Schritte:

1. Hersteller-Seite aufrufen: Steht dort "lokal" / "on-device"? Und wird es konkret (welches Modell läuft wo)?
2. Verkehr bei Import, Indexierung und Chat mit Beispielmaterial beobachten. Verarbeitungsziele außerhalb des Geräts einschließlich Servern im LAN festhalten.
3. Originale, extrahierten Text, Indizes und Arbeitskopien lokalisieren; Verschlüsselung und Backups prüfen.
4. Einstellungen durchgehen: Existiert schaltbare Telemetrie — und mit welcher Voreinstellung?
5. Repository-Link auf der Webseite suchen — und prüfen, wie frisch das letzte Release ist.
6. Cloud-Sync-Optionen: Opt-in oder Opt-out?

Halte die Beobachtungen zusammen mit App-Version und Einstellungen fest. Wiederhole die relevanten Prüfungen bei einem Wechsel von Anbieter, Speichermodus oder Version.

## Wie sich LokLM zur Liste verhält

LokLM ist eine [On-Device-Anwendung](/lokale-ki) für Windows, Linux und macOS. Mit gebündelten Modellen verarbeitet es nach dem Modelldownload lokal über `llama.cpp` und benötigt kein Konto bei einem externen KI-Anbieter. Das Entsperren des lokalen Tresors ist ein eigener Anmeldeschritt. Der Quellcode ist öffentlich auf GitHub einsehbar[^5].

Der aktuelle Entwicklungsstand speichert Arbeitsbereichsdaten in verschlüsseltem SQLite und verwendet einen separaten Vektorspeicher. Der Vektorindex ist also keine SQLite-Datei. Vektordaten sind standardmäßig im Ruhezustand verschlüsselt; solange der Arbeitsbereich geöffnet ist, besteht ein **lokales Arbeitsverzeichnis im Klartext**. Für unkritische Sammlungen gibt es einen optionalen unverschlüsselten Vektorspeichermodus. Importierte Originaldateien bleiben an ihrem ursprünglichen Ort und werden von LokLM nicht verschlüsselt. Geräteschutz und Backup-Einstellungen bleiben deshalb relevant.

Optionale Ollama-Anbieter können Chat, Embeddings oder Reranking übernehmen. Ein Server auf einem anderen Rechner erhält dabei die jeweiligen Eingaben; der aktuelle Entwicklungsstand verlangt die ausdrückliche Freigabe dieses Ziels. Der gebündelte Pfad enthält keine Anwendungstelemetrie, Modelldownloads und Update-Prüfungen sind aber Netzwerkaktivität. Prüfe die tatsächlichen Einstellungen und Abläufe, statt sämtliche Eigenschaften aus dem Wort „lokal“ abzuleiten.

Diese Produktangaben wurden am **7. Oktober 2026** mit dem Entwicklungsstand abgeglichen. Eine installierte Version, auch 0.7.0, kann davon abweichen; unveröffentlichte Änderungen werden hier nicht als bereits ausgeliefert dargestellt. Die separate Frage, ob eine Antwort durch ihre Dokumente gedeckt ist, behandelt der [Leitfaden zur PDF-Quellenprüfung](/blog/pdf-mit-ki-quellen-pruefen).

## Weiter im Cluster

Wer den rechtlichen Faden weiterverfolgen möchte: Der nächste Artikel der Reihe behandelt die [DSGVO-Pflichten bei Dokument-Eingaben in Cloud-LLMs](/blog/dsgvo-und-llm-datenexport) (Art. 44 ff. — Drittlandtransfer).

Wer wissen will, worauf die fünf Eigenschaften technisch ruhen: Die [vollständige Architektur](/architektur) erklärt das Hybrid-Retrieval, das Embedding-Modell für deutsche Texte und die Speicher-Strategie.

Und wer LokLM ausprobieren möchte: Der [Download](/#download) funktioniert ohne Konto und ohne E-Mail.

---

[^4]: Beispiel für Forschung zu Embedding-Inversion: "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM Quellcode-Repository: https://github.com/TwoD97/LokLM
