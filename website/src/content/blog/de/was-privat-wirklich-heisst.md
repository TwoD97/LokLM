---
title: 'Was "privat" für einen KI-Assistenten wirklich heißt'
description: 'Eine Checkliste mit fünf prüfbaren Eigenschaften — woran sich messen lässt, ob eine KI tatsächlich privat arbeitet. Mit DSGVO- und EU-AI-Act-Bezügen.'
lang: 'de'
translationKey: 'private-definition'
pubDate: 2026-05-28
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

> **Hinweis:** Erstentwurf — wird vor der Veröffentlichung redaktionell überarbeitet.

Das Wort "privat" steht inzwischen auf nahezu jeder Produktseite, die mit Künstlicher Intelligenz wirbt. Es bedeutet jedes Mal etwas anderes. Bei einem Cloud-Anbieter heißt "privat" oft "wir versprechen, deine Eingaben nicht zum Training zu verwenden". Bei einem Browser-Plugin heißt es "verschlüsselt während der Übertragung". Bei einem On-Device-System heißt es "der Text verlässt das Gerät nicht".

Diese drei Aussagen sehen ähnlich aus. Sie beschreiben grundverschiedene Sachverhalte.

Wer KI-Werkzeuge in einer Anwaltskanzlei, einer Forschungsgruppe oder einer Steuerberatung einsetzen will, braucht eine präzisere Sprache. Sonst riskiert man, ein System einzuführen, das den eigenen Vertraulichkeitspflichten nicht genügt — nicht aus böser Absicht des Herstellers, sondern weil "privat" auf zwei Seiten unterschiedliche Bedeutungen hatte.

Dieser Artikel schlägt eine Definition vor. Fünf Eigenschaften, jede einzeln prüfbar. Wer eine Software auf diese Liste prüft, weiß hinterher, womit er es zu tun hat.

## Warum die Frage rechtlich nicht trivial ist

Die Datenschutz-Grundverordnung kennt kein Wort "privat". Sie kennt **personenbezogene Daten** (Art. 4 Nr. 1 DSGVO[^1]) und **Verarbeitung** (Art. 4 Nr. 2 DSGVO). Sobald ein KI-System personenbezogene Inhalte verarbeitet — sei es ein Mandantenschreiben, ein E-Mail-Verlauf, ein Vertragsentwurf —, greifen die Vorgaben aus den Art. 5, 24, 32 DSGVO: Rechtsgrundlage, technisch-organisatorische Maßnahmen, Verzeichnis der Verarbeitungstätigkeiten.

Eine zweite Schicht liegt im EU-AI-Act, der seit August 2024 in Kraft ist und dessen Pflichten gestaffelt anwendbar sind[^2]. Für die meisten Endanwender-Werkzeuge sind die Transparenzpflichten aus Art. 50 relevant: Nutzer müssen erkennen können, dass sie mit einer KI interagieren und welche Inhalte generiert wurden.

Aus beiden Regelwerken folgt: Wer "privat" als Werbeversprechen verwendet, sagt damit noch nichts darüber, ob die Verarbeitung **rechtmäßig** ist. "Privat" ist keine Rechtskategorie. Es ist ein Marketing-Wort, das einen technischen Sachverhalt umreißen kann — oder verschleiern.

## Die fünf Eigenschaften

Die folgenden fünf Punkte beschreiben, was bei einem KI-Assistenten zusammenkommen muss, damit "privat" eine prüfbare Aussage wird statt einer atmosphärischen.

### 1. On-Device-Inferenz

**Das Modell, das die Antwort erzeugt, läuft auf dem Endgerät.** Keine Anfrage geht an einen externen Server, kein API-Aufruf, kein Reverse-Tunnel.

Prüfbar durch: Netzwerk-Monitor öffnen, eine Frage stellen, ausgehenden Datenverkehr beobachten. Ein vollständig lokales System erzeugt während der Inferenz keinen Traffic, abgesehen von ggf. einem einmaligen Update-Check beim Start.

Das ist keine Subtilität. "Verschlüsselte Übertragung an den Anbieter" und "keine Übertragung an den Anbieter" sind rechtlich unterschiedliche Sachverhalte. Im ersten Fall liegt eine Auftragsverarbeitung vor (Art. 28 DSGVO), die einen Vertrag, ein Verarbeitungsverzeichnis und ggf. einen Drittlandtransfer-Mechanismus benötigt[^3]. Im zweiten Fall liegt keine Übermittlung an einen Dritten vor.

### 2. Lokaler Index, lokale Speicherung

Wer KI auf eigene Dokumente anwendet — Retrieval Augmented Generation, kurz RAG — erzeugt **Vektor-Embeddings**: numerische Repräsentationen der Texte, mit denen das System ähnliche Stellen findet. Diese Embeddings sind Ableitungen der Inhalte. Sie sind nicht harmlos.

**Wo liegen die Embeddings?** Eine Software, die "lokale KI" verspricht, aber die Embeddings auf einen Cloud-Server lädt, hat das Vertraulichkeits-Problem nur verschoben, nicht gelöst. Wer Embeddings besitzt, kann viele Eigenschaften des Ausgangstextes rekonstruieren — Forschungsarbeiten zu Embedding-Inversion zeigen das deutlich[^4].

Prüfbar durch: Im Anwendungs-Datenverzeichnis nachsehen, ob nach dem Indexieren eines Dokuments dort eine Datei-Datenbank entsteht (z. B. eine SQLite-Datei oder ein Vektor-Speicher). Wenn ja: ist diese Datei lokal? Die zweite Frage ist genauso wichtig wie die erste.

### 3. Keine Telemetrie

Telemetrie ist die Standard-Annahme moderner Software: kleine Datenpakete über Nutzung, Fehler, Geräte-Eigenschaften, gehen automatisch an den Hersteller. Üblich, oft anonymisiert, technisch sinnvoll für Bugfixes.

Für ein vertrauliches System ist das ein Problem. Anonymisierung in Telemetrie-Daten ist schwächer als oft angenommen — schon Geräte-Fingerprints und Nutzungsmuster reichen häufig zur Re-Identifikation. Zudem unterscheidet die DSGVO nicht zwischen "Inhaltsdaten" und "Metadaten": Beides kann personenbezogen sein.

Prüfbar durch: Wieder Netzwerk-Monitor. Eine Software, die für sich beansprucht, vollständig lokal zu arbeiten, sollte über lange Sitzungen hinweg keinen ausgehenden Datenverkehr erzeugen. Optional: in den Einstellungen nachsehen, ob Telemetrie überhaupt schaltbar ist und in welcher Standard-Einstellung sie kommt.

### 4. Auditierbarer Code

Dies ist die strukturelle Eigenschaft. Die ersten drei Punkte sind Verhaltens-Beobachtungen. Sie können sich mit dem nächsten Update ändern.

Wenn der Quellcode öffentlich zugänglich ist — also Open Source —, kann ein interessierter Dritter (oder eine beauftragte IT-Sicherheits-Firma) die Verhaltensbehauptungen am Code prüfen. Bei proprietärer Software bleibt nur das Vertrauen auf das Marketing-Material.

Auditierbarkeit ist nicht dasselbe wie "auditiert". Ein offener Quellcode garantiert keine Sicherheit; er erlaubt sie zu prüfen. Das ist die einzige Form, in der eine Vertraulichkeits-Aussage langfristig stabil bleibt: über die Möglichkeit zur Nachprüfung, nicht über das Versprechen.

Prüfbar durch: Repository-Link auf der Hersteller-Seite suchen. Bei Open-Source-Projekten meist auf GitHub oder GitLab. Wenn kein Link auffindbar ist: wahrscheinlich kein offener Code.

### 5. Keine Hintergrund-Synchronisation

Letzter Punkt, der oft übersehen wird. Manche "lokale" Software synchronisiert Einstellungen, Konversationsverläufe oder Vorlagen mit einem Cloud-Konto desselben Herstellers — als Komfort-Funktion. Sobald das geschieht, ist das System nicht mehr lokal in dem Sinn, den der erste Punkt beschreibt.

Prüfbar durch: In den Einstellungen nach Konto-, Sync- oder Cloud-Optionen suchen. Wenn vorhanden: standardmäßig aktiv oder standardmäßig aus? Eine Software, die im Werkszustand nichts synchronisiert und die Synchronisation als opt-in anbietet, verhält sich anders als eine, die opt-out ist.

## Warum die Liste nicht länger und nicht kürzer ist

Diese fünf Punkte decken die Wege ab, auf denen Daten ein Endgerät verlassen oder rekonstruierbar werden. Inferenz (1), Index-Persistenz (2), Telemetrie (3) und Sync (5) sind die vier möglichen Daten-Abflüsse. Auditierbarkeit (4) ist die strukturelle Bedingung dafür, dass die anderen vier Aussagen über die Zeit überprüfbar bleiben.

Punkte, die in anderen Definitionen auftauchen und hier bewusst fehlen:

- **"Verschlüsselt"**: Verschlüsselung sagt nichts darüber aus, wer den Schlüssel hat. Sie ist ein notwendiges, aber kein hinreichendes Kriterium.
- **"DSGVO-konform"**: Eine Software kann fünf der fünf Punkte erfüllen und dennoch nicht DSGVO-konform betrieben werden (z. B. ohne Verarbeitungsverzeichnis, ohne Rechtsgrundlage). Die Konformität ist eine Eigenschaft des Einsatzes, nicht des Werkzeugs allein.
- **"Privacy-first"**: Eine Selbstbeschreibung, kein Test.

## Wie diese Liste anwendbar wird

Sechs Schritte bei der Bewertung eines konkreten KI-Werkzeugs:

1. Hersteller-Seite öffnen. Steht "lokal" / "on-device" auf der Startseite? Wenn ja, wird es konkret benannt (welches Modell läuft wo)?
2. Netzwerk-Monitor während einer Beispiel-Anfrage: Geht Traffic an Server außerhalb des LAN? (Update-Checks ausgenommen.)
3. Anwendungs-Datenverzeichnis nach Indexierung prüfen: existiert eine lokale Datei-Datenbank?
4. Einstellungen durchsehen: gibt es schaltbare Telemetrie? Welche Standardeinstellung?
5. Repository-Link auf der Webseite — und wie aktuell ist das letzte Release?
6. Cloud-Sync-Optionen: opt-in oder opt-out?

Drei der sechs Punkte (1, 2, 6) sind in zehn Minuten erledigt. Die anderen drei (3, 4, 5) verlangen etwas Geduld, ergeben aber das vollständige Bild.

## Wie sich LokLM zur Liste verhält

LokLM ist eine [On-Device-Anwendung](/lokale-ki) für Windows und macOS. Inferenz läuft über `llama.cpp` lokal, der Vektor-Index liegt als SQLite-Datei im Anwendungs-Datenverzeichnis, es gibt keine Telemetrie und kein Konto. Der Quellcode liegt offen auf GitHub[^5].

Punkt 5 — Hintergrund-Sync — existiert in LokLM nicht: es gibt keine Cloud-Komponente, mit der synchronisiert werden könnte.

Das ist die ehrliche Position. Andere Werkzeuge erfüllen Teilmengen dieser Liste — das ist keine Wertung, sondern eine Beobachtung. Der Sinn der Checkliste ist, dass jeder selbst entscheiden kann, welche Teilmenge für seinen Einsatzfall genügt.

## Weiter im Cluster

Wer den Pfad in die rechtlichen Details vertiefen möchte: der nächste Artikel der Reihe behandelt die [DSGVO-Pflichten bei Dokument-Eingaben in Cloud-LLMs](/blog/dsgvo-und-llm-datenexport) (Art. 44 ff. — Drittlandtransfer).

Wer die technische Architektur kennenlernen möchte, auf der diese Eigenschaften technisch ruhen: die [vollständige Architektur](/architektur) beschreibt das Hybrid-Retrieval, das Embedding-Modell für deutsche Texte und die Speicher-Strategie.

Wer LokLM testen möchte: der [Download](/#download) steht ohne Konto und ohne E-Mail bereit.

---

[^1]: Verordnung (EU) 2016/679 — Datenschutz-Grundverordnung. Konsolidierte Fassung bei EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj

[^2]: Verordnung (EU) 2024/1689 — Verordnung über künstliche Intelligenz (KI-Verordnung / AI Act). https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^3]: Übersicht der Standardvertragsklauseln (SCC) und Drittlandtransfer-Regeln beim Europäischen Datenschutzausschuss: https://www.edpb.europa.eu/

[^4]: Beispiel für Forschung zu Embedding-Inversion: Morris et al., "Text Embeddings Reveal (Almost) As Much As Text", arXiv:2310.06816. https://arxiv.org/abs/2310.06816

[^5]: LokLM Quellcode-Repository: https://github.com/TwoD97/LokLM
