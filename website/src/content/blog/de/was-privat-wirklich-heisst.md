---
title: 'Was "privat" für einen KI-Assistenten wirklich heißt'
description: 'Eine Checkliste mit fünf prüfbaren Eigenschaften — woran sich messen lässt, ob eine KI tatsächlich privat arbeitet. Mit DSGVO- und EU-AI-Act-Bezügen.'
lang: 'de'
translationKey: 'private-definition'
pubDate: 2026-05-28
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

Kaum eine KI-Produktseite kommt heute ohne das Wort "privat" aus — und kaum zwei meinen damit dasselbe. Ein Cloud-Anbieter versteht darunter meist: "Wir verwenden deine Eingaben nicht fürs Training." Ein Browser-Plugin meint: "Die Übertragung ist verschlüsselt." Ein On-Device-System meint: "Der Text bleibt auf dem Gerät."

Drei Aussagen, die zum Verwechseln ähnlich klingen — und drei völlig verschiedene Sachverhalte beschreiben.

Für den Einsatz in einer Anwaltskanzlei, einer Forschungsgruppe oder einer Steuerberatung reicht diese Unschärfe nicht. Wer hier ohne präzise Begriffe auswählt, läuft Gefahr, ein Werkzeug einzuführen, das den eigenen Vertraulichkeitspflichten nicht standhält — nicht weil der Hersteller täuschen wollte, sondern weil "privat" auf beiden Seiten des Kaufs etwas anderes bedeutete.

Deshalb macht dieser Artikel einen Definitionsvorschlag: fünf Eigenschaften, von denen sich jede einzeln nachprüfen lässt. Wer eine Software gegen diese Liste hält, weiß am Ende, was er vor sich hat.

## Warum die Frage rechtlich nicht trivial ist

In der Datenschutz-Grundverordnung kommt das Wort "privat" nicht vor. Ihre Begriffe sind **personenbezogene Daten** (Art. 4 Nr. 1 DSGVO[^1]) und **Verarbeitung** (Art. 4 Nr. 2 DSGVO). Verarbeitet ein KI-System personenbezogene Inhalte — ein Mandantenschreiben, einen E-Mail-Verlauf, einen Vertragsentwurf —, greifen die Anforderungen der Art. 5, 24, 32 DSGVO: eine Rechtsgrundlage, technisch-organisatorische Maßnahmen, ein Verzeichnis der Verarbeitungstätigkeiten.

Hinzu kommt der EU AI Act, in Kraft seit August 2024, dessen Pflichten stufenweise anwendbar werden[^2]. Für typische Endanwender-Werkzeuge zählen vor allem die Transparenzpflichten aus Art. 50: Menschen müssen erkennen können, dass sie es mit einer KI zu tun haben und welche Inhalte maschinell erzeugt wurden.

Die Konsequenz aus beiden Regelwerken: Das Werbewort "privat" trifft keine Aussage darüber, ob eine Verarbeitung **rechtmäßig** ist. "Privat" ist keine juristische Kategorie, sondern ein Marketing-Begriff — einer, der einen technischen Sachverhalt präzise umreißen kann oder ihn vernebelt.

## Die fünf Eigenschaften

Die folgenden fünf Punkte legen fest, was zusammenkommen muss, damit "privat" bei einem KI-Assistenten eine überprüfbare Behauptung ist — und keine Stimmungsbeschreibung.

### 1. On-Device-Inferenz

**Das antwortende Modell läuft auf dem Endgerät selbst.** Keine Anfrage erreicht einen externen Server — kein API-Aufruf, kein Reverse-Tunnel, nichts.

Prüfbar durch: Netzwerk-Monitor starten, eine Frage stellen, den ausgehenden Verkehr beobachten. Ein wirklich lokales System erzeugt während der Inferenz keinen Traffic — allenfalls einen einmaligen Update-Check beim Programmstart.

Der Unterschied ist alles andere als akademisch. "Verschlüsselt zum Anbieter übertragen" und "gar nicht zum Anbieter übertragen" sind zwei rechtlich getrennte Welten: Im ersten Fall liegt Auftragsverarbeitung vor (Art. 28 DSGVO) — mit Vertragspflicht, Verarbeitungsverzeichnis und gegebenenfalls einem Drittlandtransfer-Mechanismus[^3]. Im zweiten Fall findet überhaupt keine Übermittlung an Dritte statt.

### 2. Lokaler Index, lokale Speicherung

Wird KI auf eigene Dokumente angewandt — Retrieval Augmented Generation, kurz RAG —, entstehen **Vektor-Embeddings**: numerische Abbilder der Texte, über die das System ähnliche Passagen findet. Solche Embeddings sind abgeleitete Inhalte — und keineswegs unbedenklich.

Die entscheidende Frage lautet: **Wo liegen sie?** Verspricht eine Software "lokale KI", lädt aber die Embeddings auf einen Cloud-Server, ist das Vertraulichkeitsproblem nicht gelöst, sondern nur an eine andere Stelle geschoben. Denn aus Embeddings lässt sich vieles über den Ursprungstext rekonstruieren — die Forschung zur Embedding-Inversion belegt das eindrücklich[^4].

Prüfbar durch: Nach dem Indexieren eines Dokuments im Anwendungs-Datenverzeichnis nachschauen, ob dort eine Datei-Datenbank entstanden ist (etwa eine SQLite-Datei oder ein Vektor-Speicher). Und falls ja: Liegt sie wirklich nur lokal? Beide Teilfragen wiegen gleich schwer.

### 3. Keine Telemetrie

Moderne Software funkt standardmäßig nach Hause: kleine Pakete zu Nutzung, Fehlern und Geräteeigenschaften gehen automatisch an den Hersteller. Das ist verbreitet, häufig anonymisiert und für Bugfixes durchaus nützlich.

Für ein System mit vertraulichen Inhalten ist es trotzdem ein Problem. Die Anonymisierung von Telemetrie hält weniger, als man denkt — Geräte-Fingerprints und Nutzungsmuster genügen oft schon für eine Re-Identifikation. Und die DSGVO kennt keine Zweiklassengesellschaft aus "Inhaltsdaten" und "Metadaten": personenbezogen können beide sein.

Prüfbar durch: Erneut der Netzwerk-Monitor. Software, die vollständige Lokalität behauptet, darf auch über lange Sitzungen keinen ausgehenden Verkehr produzieren. Ergänzend lohnt der Blick in die Einstellungen: Lässt sich Telemetrie überhaupt abschalten — und wie ist die Werkseinstellung?

### 4. Auditierbarer Code

Der strukturelle Punkt der Liste. Die ersten drei Eigenschaften sind Beobachtungen von Verhalten — und Verhalten kann sich mit jedem Update ändern.

Liegt der Quellcode offen — sprich: Open Source —, kann jeder interessierte Dritte (oder eine beauftragte IT-Sicherheitsfirma) die behaupteten Eigenschaften direkt am Code verifizieren. Bei proprietärer Software bleibt als Beleg nur das, was das Marketing behauptet.

Auditierbar heißt dabei nicht auditiert: Offener Code garantiert keine Sicherheit, er macht sie prüfbar. Genau darin liegt aber die einzige Form, in der eine Vertraulichkeitszusage dauerhaft belastbar bleibt — durch Nachprüfbarkeit statt durch Versprechen.

Prüfbar durch: Auf der Hersteller-Seite nach einem Repository-Link suchen; bei Open-Source-Projekten führt er meist zu GitHub oder GitLab. Findet sich keiner, ist der Code höchstwahrscheinlich nicht offen.

### 5. Keine Hintergrund-Synchronisation

Der am häufigsten übersehene Punkt. Manche "lokale" Software gleicht Einstellungen, Gesprächsverläufe oder Vorlagen bequemerweise mit einem Cloud-Konto des Herstellers ab. In dem Moment, in dem das passiert, ist die Lokalität aus Punkt 1 faktisch aufgehoben.

Prüfbar durch: Die Einstellungen nach Konto-, Sync- oder Cloud-Funktionen durchsuchen. Falls vorhanden: Sind sie ab Werk aktiv oder inaktiv? Zwischen einer Software, die im Auslieferungszustand nichts synchronisiert und Sync nur als Opt-in kennt, und einer mit Opt-out liegt ein relevanter Unterschied.

## Warum die Liste nicht länger und nicht kürzer ist

Diese fünf Punkte erfassen sämtliche Wege, über die Daten ein Gerät verlassen oder rekonstruierbar werden können. Inferenz (1), Index-Persistenz (2), Telemetrie (3) und Sync (5) sind die vier denkbaren Abflusskanäle; Auditierbarkeit (4) ist die strukturelle Voraussetzung dafür, dass die übrigen vier Aussagen auch morgen noch überprüfbar sind.

Einige Kriterien, die anderswo auftauchen, fehlen hier mit Absicht:

- **"Verschlüsselt"**: Verschlüsselung beantwortet nicht die Frage, wer den Schlüssel besitzt. Notwendig ja — hinreichend nein.
- **"DSGVO-konform"**: Eine Software kann alle fünf Punkte erfüllen und trotzdem nicht DSGVO-konform betrieben werden (etwa ohne Verarbeitungsverzeichnis oder ohne Rechtsgrundlage). Konformität ist eine Eigenschaft des konkreten Einsatzes, nicht des Werkzeugs für sich.
- **"Privacy-first"**: Eine Eigenwerbung, kein Prüfkriterium.

## Wie diese Liste anwendbar wird

Für die Bewertung eines konkreten KI-Werkzeugs ergeben sich sechs Schritte:

1. Hersteller-Seite aufrufen: Steht dort "lokal" / "on-device"? Und wird es konkret (welches Modell läuft wo)?
2. Netzwerk-Monitor bei einer Beispiel-Anfrage: Fließt Traffic an Server außerhalb des LAN? (Update-Checks ausgenommen.)
3. Nach dem Indexieren das Anwendungs-Datenverzeichnis prüfen: Gibt es eine lokale Datei-Datenbank?
4. Einstellungen durchgehen: Existiert schaltbare Telemetrie — und mit welcher Voreinstellung?
5. Repository-Link auf der Webseite suchen — und prüfen, wie frisch das letzte Release ist.
6. Cloud-Sync-Optionen: Opt-in oder Opt-out?

Die Punkte 1, 2 und 6 sind in zehn Minuten abgehakt. Die übrigen drei (3, 4, 5) kosten etwas mehr Geduld — liefern dafür aber das komplette Bild.

## Wie sich LokLM zur Liste verhält

LokLM ist eine [On-Device-Anwendung](/lokale-ki) für Windows und macOS: Die Inferenz läuft lokal über `llama.cpp`, der Vektor-Index liegt als SQLite-Datei im Anwendungs-Datenverzeichnis, Telemetrie und Konto existieren nicht. Der Quellcode ist öffentlich auf GitHub einsehbar[^5].

Zu Punkt 5 — Hintergrund-Sync — gibt es in LokLM schlicht keinen Ansatzpunkt: Es fehlt jede Cloud-Komponente, mit der sich etwas synchronisieren ließe.

So viel zur eigenen Position, offen benannt. Andere Werkzeuge decken andere Teilmengen der Liste ab — das ist eine Feststellung, keine Abwertung. Der Zweck der Checkliste ist ja gerade, dass jeder für den eigenen Einsatzfall entscheiden kann, welche Teilmenge genügt.

## Weiter im Cluster

Wer den rechtlichen Faden weiterverfolgen möchte: Der nächste Artikel der Reihe behandelt die [DSGVO-Pflichten bei Dokument-Eingaben in Cloud-LLMs](/blog/dsgvo-und-llm-datenexport) (Art. 44 ff. — Drittlandtransfer).

Wer wissen will, worauf die fünf Eigenschaften technisch ruhen: Die [vollständige Architektur](/architektur) erklärt das Hybrid-Retrieval, das Embedding-Modell für deutsche Texte und die Speicher-Strategie.

Und wer LokLM ausprobieren möchte: Der [Download](/#download) funktioniert ohne Konto und ohne E-Mail.

---

[^1]: Verordnung (EU) 2016/679 — Datenschutz-Grundverordnung. Konsolidierte Fassung bei EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj

[^2]: Verordnung (EU) 2024/1689 — Verordnung über künstliche Intelligenz (KI-Verordnung / AI Act). https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^3]: Übersicht der Standardvertragsklauseln (SCC) und Drittlandtransfer-Regeln beim Europäischen Datenschutzausschuss: https://www.edpb.europa.eu/

[^4]: Beispiel für Forschung zu Embedding-Inversion: "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM Quellcode-Repository: https://github.com/TwoD97/LokLM
