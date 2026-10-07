---
title: 'On-Device-KI unter dem EU AI Act'
description: 'Wie der EU AI Act lokale KI erfasst: Anbieter- und Betreiberrollen, Einsatzrisiko, Transparenz, KI-Kompetenz und die Grenzen von Open-Source-Ausnahmen.'
lang: 'de'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['lokale-ki', 'eu-ai-act', 'dsgvo']
---

Ein Modell auf dem eigenen Rechner verändert die Datenflüsse. Daraus entsteht keine allgemeine Ausnahme vom EU AI Act. Für die berufliche Einführung zählen zunächst die eigene Rolle, die Zweckbestimmung des Systems und die weitere Verwendung seiner Ausgaben.

Dieser Überblick wurde am 7. Oktober 2026 geprüft und ersetzt keine individuelle rechtliche Bewertung. Anwendungsdaten und Übergangsregeln unterscheiden sich nach Pflicht und wurden seit Verabschiedung der Verordnung geändert. Für die Planung bietet die Kommission einen [aktuellen Umsetzungszeitplan mit Verweisen auf die Änderungsgesetzgebung](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai).

## Die eigene Rolle bestimmen

Eine Organisation, die eine KI-Anwendung eines Herstellers beruflich nutzt, ist regelmäßig **Betreiber**. **Anbieter** entwickelt ein System oder lässt es entwickeln und bringt es unter eigenem Namen in Verkehr oder nimmt es in Betrieb. Eine selbst entwickelte oder unter eigener Marke vertriebene Integration kann die Einordnung verändern; das bloße Hosting eines Chatbots entscheidet sie nicht. Die Definitionen stehen in [Artikel 3](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3).

Für natürliche Personen bei rein persönlicher, nicht beruflicher Nutzung gelten die Betreiberpflichten nach [Artikel 2 Absatz 10](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2) nicht. Eine Kanzlei fällt nicht deshalb darunter, weil ihre Software auf Laptops läuft.

## Den Einsatzzweck statt den Beruf prüfen

Lokale Dokumentensuche und die Vorauswahl von Bewerbern verfolgen unterschiedliche Zwecke. Die [Risikoübersicht der Kommission](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) nennt Beschäftigung, bestimmte öffentliche Leistungen und justizielle Anwendungen als Bereiche für eine Hochrisikoprüfung. Weder „Kanzlei“ noch „Behörde“ bestimmt die Einstufung jedes dort eingesetzten Werkzeugs.

Zur Einführung gehören eine dokumentierte Zweckbestimmung und die Prüfung der einschlägigen Voraussetzungen und Ausnahmen aus Artikel 6. Lokales Hosting belegt weder geringes Risiko noch die Einhaltung von Hochrisikoanforderungen.

## Artikel 50 unterscheidet mehrere Pflichten

Für Textassistenten sind drei Unterschiede wichtig:

- **Direkte Interaktion:** Anbieter müssen Menschen auf die KI-Interaktion hinweisen, sofern diese im jeweiligen Kontext nicht offensichtlich ist. „Nur intern genutzt“ ist für sich keine Ausnahme. Siehe die [FAQ der Kommission zu Artikel 50](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act).
- **Technische Markierung:** Artikel 50 Absatz 2 erfasst Anbieter von Systemen für synthetische Inhalte, einschließlich Text. Er verlangt maschinenlesbare Markierung und Erkennbarkeit unter seinen technischen Bedingungen und Bearbeitungsausnahmen. Lokale Ausführung allein befreit davon nicht. Siehe [Artikel 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50).
- **Veröffentlichung:** Absatz 4 betrifft auch Texte zur öffentlichen Information über Angelegenheiten von öffentlichem Interesse, nicht nur Deepfakes. Die Ausnahme für Texte verlangt menschliche Überprüfung oder redaktionelle Kontrolle **und** eine Person mit redaktioneller Verantwortung. Daraus folgt keine automatische Kennzeichnung jedes internen Entwurfs. Siehe [Artikel 50 Absatz 4](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50).

Die [Transparenzleitlinien der Kommission](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations) erläutern Reichweite und Ausnahmen. Sie sind Umsetzungshinweise; Rechtsgrundlage bleibt die verlinkte Gesetzgebung. Bei den Fristen unterscheiden die [Kommissions-FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) zwischen allgemeiner Anwendbarkeit und der begrenzten Übergangsregel zu Absatz 2 für ältere Systeme.

## Auch lokale Teams brauchen KI-Kompetenz

[Artikel 4](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4) verlangt Maßnahmen zur Förderung der KI-Kompetenz durch Anbieter und Betreiber, unter Berücksichtigung von Kenntnissen und Einsatzkontext. Ein bestimmtes Kompetenzniveau jeder einzelnen Person muss dabei nicht garantiert werden.

Für Dokumentenassistenten kann eine praktische Einweisung unvollständige Suche, falsche Antworten, irreführende Quellenverweise und die Prüfung am Original behandeln. Eine klare Prüfverantwortung hilft mehr, als flüssig formulierte Antworten als freigegebene Ergebnisse zu behandeln.

## Open Source und freiwillige Kodizes sind keine Pauschalausnahmen

[Artikel 2 Absatz 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2) betrifft freie und quelloffene **KI-Systeme**. Die Ausnahme erfasst keine Systeme, die unter Hochrisikoregeln, Artikel 5 oder Artikel 50 fallen. Pflichten für Anbieter von KI-Modellen mit allgemeinem Verwendungszweck sind gesondert zu prüfen.

[Artikel 95](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-95) fördert freiwillige Verhaltenskodizes. Der [GPAI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice) ist ein gesondertes Instrument für Modellanbieter nach Artikel 56. Freiwillige Teilnahme macht die zugrunde liegenden gesetzlichen Pflichten nicht freiwillig.

## Eine praktische Einführungsdokumentation

Ein Team, das LokLM einführt, kann folgende Punkte knapp festhalten:

1. Vorgesehene Aufgaben, Nutzer und unterstützte Entscheidungen.
2. Rollen- und Risikoprüfung mit den einschlägigen Anwendungsdaten.
3. Einweisung, Quellenprüfung und Zuständigkeit für die Prüfung von Ausgaben.
4. Öffentliche Interaktionen oder Veröffentlichungen mit gesondertem Transparenzbedarf.
5. Datenzugriffe, Backups, Aufbewahrung und optionale externe Dienste.

DSGVO und berufliche Verschwiegenheit bleiben eigenständige Anforderungen. Lokale Verarbeitung kann externe Offenlegung reduzieren; sie erfüllt nicht automatisch beide Regelwerke. Die Unterschiede erklärt unser [Beitrag zu DSGVO und Cloud-LLMs](/blog/dsgvo-und-llm-datenexport).

Mit der [Architektur](/architektur) und dem [Leitfaden zu lokaler KI](/lokale-ki) lässt sich die technische Grenze von LokLM prüfen. Dieser Artikel bescheinigt keiner konkreten Installation Rechtskonformität.
