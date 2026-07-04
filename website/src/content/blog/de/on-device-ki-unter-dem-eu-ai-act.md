---
title: 'On-Device-KI unter dem EU AI Act'
description: 'Wo lokale KI-Systeme im EU AI Act stehen — eine Lesart der Artikel 6, 50 und 95. Mit Rollen-Logik und Praxis-Bezug für DACH-Kanzleien und -Forschungsgruppen.'
lang: 'de'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
tags: ['lokale-ki', 'eu-ai-act', 'dsgvo']
---

Seit dem 1. August 2024 gilt der EU AI Act (Verordnung 2024/1689[^1]) — allerdings nicht auf einen Schlag, sondern in Stufen: Erste Verbote greifen seit Februar 2025, die allgemeinen Regeln für General-Purpose-AI-Modelle seit August 2025, der Großteil der Hochrisiko-Pflichten erst ab August 2026. Konzipiert wurde die Verordnung erkennbar mit großen KI-Systemen vor Augen: ein Anbieter hostet, ein Betreiber setzt ein, Notifizierte Stellen prüfen. (Auch dieser Text ist keine Rechtsberatung.)

Für alle, die ein Modell schlicht auf dem eigenen Laptop laufen lassen, drängen sich damit Fragen auf: Erfasst mich die Verordnung überhaupt? Bin ich in ihrer Logik Anbieter oder Betreiber? Und muss ich Transparenz gegenüber jemandem herstellen, wenn außer mir niemand mit dem System arbeitet?

Drei Vorschriften stehen im Zentrum dieses Artikels: **Artikel 6** (Hochrisiko-Klassifizierung), **Artikel 50** (Transparenzpflichten) und **Artikel 95** (Verhaltenskodizes / Code of Practice). Sie betreffen nicht jeden gleichermaßen — worauf es ankommt, ist zu bestimmen, welche Pflichten im eigenen Fall überhaupt greifen und welche ins Leere laufen.

## Die Rollen-Logik des AI Acts

Wer welche Pflichten trägt, hängt im AI Act strikt an der Rolle. Vier davon definiert Art. 3 Nr. 3–7 AI Act:

- **Anbieter** (provider): entwickelt ein KI-System selbst oder lässt es entwickeln und bringt es unter eigenem Namen oder eigener Marke in der EU in Verkehr — als natürliche oder juristische Person.
- **Betreiber** (deployer): verwendet ein KI-System in eigener Verantwortung — ausgenommen ist nur die rein persönliche, nicht-berufliche Nutzung.
- **Importeur**: vertritt Anbieter mit Sitz in einem Drittland innerhalb der EU.
- **Händler**: stellt das System auf dem Markt bereit, ohne selbst Anbieter oder Importeur zu sein.

Auf ein On-Device-System wie LokLM übertragen ist die Zuordnung eindeutig: Anbieter ist der Software-Hersteller. Betreiber ist, wer die Software beruflich einsetzt — etwa eine Kanzlei, eine Forschungsgruppe oder eine Steuerberatung.

Wer LokLM dagegen privat zuhause über die eigenen Texte laufen lässt, nutzt es rein persönlich und nicht-beruflich — und ist damit nach der Ausnahme des AI Acts gar kein Betreiber. Betreiber-Pflichten entstehen in diesem Fall keine.

## Artikel 6: Hochrisiko-Klassifizierung

Ob ein KI-System als **Hochrisiko-System** einzustufen ist, bestimmt Artikel 6 AI Act — über zwei getrennte Pfade:

- **Weg 1 (Art. 6 Abs. 1):** Das System dient als Sicherheitsbauteil eines Produkts, das seinerseits unter eine der Harmonisierungsvorschriften aus Anhang I fällt (etwa Medizinprodukte, Maschinen, Spielzeug). Ein lokales RAG-Werkzeug für Textdokumente wird davon praktisch nie erfasst.
- **Weg 2 (Art. 6 Abs. 2 i. V. m. Anhang III):** Das System kommt in einem der acht in Anhang III genannten Einsatzfelder zum Einsatz — darunter Justiz (Buchstabe h), Strafverfolgung, Migrations- und Grenzkontrolle sowie kritische Infrastruktur.

In Anhang III Nr. 8 Buchstabe a stehen ausdrücklich Systeme, die _"justizielle Behörden bei der Auslegung von Sachverhalten und Recht und bei der Anwendung des Rechts auf einen konkreten Sachverhalt unterstützen"_. Eine Anwaltskanzlei ist aber keine justizielle Behörde — sie übt einen privaten Beruf aus. Für anwaltliche Nutzung läuft Buchstabe a deshalb in aller Regel leer.

**Praktische Konsequenz:** Setzt eine Kanzlei ein lokales KI-Werkzeug für die interne Dokumentenrecherche ein, liegt in den meisten Konstellationen kein Hochrisiko-Einsatz nach Anhang III vor. Die Bewertung kippt erst, wenn dasselbe Werkzeug etwa bei einer Strafverfolgungs- oder Migrationsbehörde arbeitet — dann greifen die Hochrisiko-Pflichten der Artt. 8 ff.

Wichtig: Diese Aussage betrifft ausschließlich die AI-Act-Klassifizierung. Über DSGVO-Pflichten, anwaltliches Berufsrecht oder Verschwiegenheit sagt sie nichts — diese Regime laufen parallel und unabhängig weiter.

## Artikel 50: Transparenzpflichten

Für Endanwender ist Artikel 50 AI Act meist die praktisch wichtigste Norm, denn seine Pflichten gelten häufig auch dann, wenn das System gar nicht hochrisikoreich ist.

Drei Absätze verdienen bei lokaler KI regelmäßig einen Blick:

### 50 Abs. 1: Direkte Interaktion mit Menschen

> _"Anbieter stellen sicher, dass KI-Systeme, die für die direkte Interaktion mit natürlichen Personen bestimmt sind, so konzipiert und entwickelt werden, dass die betreffenden natürlichen Personen darüber informiert werden, dass sie mit einem KI-System interagieren."_

Adressat ist der **Anbieter** — nicht die einzelne nutzende Person. Wer eine lokale KI ausschließlich für sich selbst verwendet und keine Dritten mit ihr interagieren lässt, hat hier nichts zu tun. Anders, wer ein solches System etwa als Chatbot auf der eigenen Website Mandanten oder Kunden gegenüberstellt: Dann wird er selbst zum Anbieter dieses Systems im Sinne der Verordnung und muss die Information sicherstellen.

### 50 Abs. 2: Synthetisch erzeugte Inhalte

> _"Anbieter von KI-Systemen, einschließlich KI-Systemen mit allgemeinem Verwendungszweck, die synthetische Audio-, Bild-, Video- oder Textinhalte erzeugen, stellen sicher, dass die Ausgaben des KI-Systems in einem maschinenlesbaren Format gekennzeichnet und als künstlich erzeugt oder manipuliert erkennbar sind."_

Gemeint sind Wasserzeichen und Provenienz-Markierungen für generierte Inhalte. Ob der Output eines lokalen Werkzeugs, das eigene Dokumente zusammenfasst oder daraus Antworten baut, überhaupt "synthetisch erzeugter Textinhalt" im Sinne der Norm ist, bleibt ungeklärt. Die Erwägungsgründe 132–135 legen nahe, dass der Gesetzgeber vor allem Deepfakes und breit ausgespielte Endverbraucher-Generierung im Blick hatte. Eine gefestigte Behördenpraxis gibt es dazu Stand 2026 nicht.

### 50 Abs. 4: Deepfakes und politisch relevante Inhalte

> _"Betreiber eines KI-Systems, das Bild-, Audio- oder Videoinhalte erzeugt oder manipuliert, die ein Deepfake darstellen, müssen offenlegen, dass die Inhalte künstlich erzeugt oder manipuliert wurden."_

Solange ein lokales Werkzeug ausschließlich mit Text arbeitet und weder Bilder noch Audio produziert, ist dieser Absatz nicht einschlägig.

## Artikel 95: Verhaltenskodizes

Mit Artikel 95 beauftragt der AI Act die Kommission und das AI-Board damit, **Verhaltenskodizes** (Codes of Practice) zu fördern — freiwillige Standards, denen sich auch nicht-hochrisikoreiche Systeme anschließen können, etwa zu Umweltauswirkungen, Datenethik oder Barrierefreiheit.

Der entscheidende Unterschied zu Art. 6 und 50: Artikel 95 **verpflichtet niemanden**. Er ist als Anreiz gebaut. Wer lokale KI-Software entwickelt, kann einen solchen Kodex unterzeichnen, um Vertrauen aufzubauen — muss es aber nicht.

Praktisch relevant wird die Vorschrift für lokale Werkzeuge vor allem mit dem ersten Code of Practice für General-Purpose AI (die Kommission legte Anfang 2025 einen Entwurf vor[^2]). Daran lässt sich ablesen, welche Selbstverpflichtungen sich in der Branche etablieren — Open-Source-Hersteller können sich anschließen, wenn es passt.

## Wo der AI Act schweigt

Drei Themen regelt der AI Act nicht — ob absichtlich oder nicht —, obwohl sie für lokale KI in der Praxis den Ausschlag geben:

1. **Datenschutz.** Der AI Act tritt neben die DSGVO, nicht an ihre Stelle. Wer personenbezogene Daten verarbeitet, trägt die Pflichten aus Art. 5, 24, 32 DSGVO[^3] unabhängig vom AI Act. Lokale Verarbeitung ändert daran nur eines: Es findet keine Übermittlung an einen Cloud-Anbieter statt, sodass Art. 44 ff. DSGVO entfällt — alles Übrige gilt weiter.
2. **Berufsrechtliche Verschwiegenheit.** Anwälte (§ 43a BRAO), Ärzte (§ 203 StGB), Steuerberater und vergleichbare Berufsträger schulden Verschwiegenheit — unabhängig von DSGVO und AI Act. Weil eine Übermittlung in die Cloud den Kreis der Verschwiegenheit verlässt, ist eine lokal arbeitende KI hier häufig die einzige zulässige Option.
3. **Open-Source-Sonderregel.** Art. 2 Abs. 12 AI Act nimmt Open-Source-KI-Modelle aus, sofern sie nicht als Teil eines hochrisikoreichen oder verbotenen Systems in Verkehr gebracht oder in Betrieb genommen werden. Für quelloffene Werkzeuge hebt das die Eingriffsschwelle spürbar an — die Details stehen in den Erwägungsgründen 102–104.

## Der praktische Fall: eine Kanzlei führt LokLM ein

Angenommen, eine mittelständische Anwaltskanzlei möchte ihre Mandantenunterlagen lokal durchsuchbar machen und installiert LokLM auf den Arbeitsplätzen. Was folgt daraus AI-Act-seitig?

- **Rolle:** Die Kanzlei ist Betreiber, der LokLM-Hersteller Anbieter.
- **Hochrisiko (Art. 6):** Anhang III Buchst. h erfasst justizielle Behörden — die anwaltliche Berufsausübung gehört nicht dazu. Keine Hochrisiko-Einstufung.
- **Transparenz (Art. 50):** Die Nutzung bleibt kanzleiintern. Eine Pflicht, Mandanten über KI-Unterstützung bei der Recherche zu informieren, besteht nicht — solange Mandanten keine KI-Erzeugnisse als solche untergeschoben bekommen. Würde die Kanzlei ein anwaltliches Schreiben ungeprüft und rein KI-generiert herausgeben, läge darin ohnehin zuerst ein berufsrechtliches Problem, ganz unabhängig vom AI Act.
- **Verschwiegenheit (§ 43a BRAO):** Lokale Verarbeitung bleibt innerhalb des Verschwiegenheitskreises; eine Cloud-Übermittlung würde ihn durchbrechen.
- **DSGVO:** Ist die Verarbeitung umfangreich oder besonders risikoreich, braucht die Kanzlei eine Datenschutz-Folgenabschätzung (Art. 35 DSGVO) — die sich bei lokaler Verarbeitung genauso durchführen lässt.

Das Fazit dieses Durchgangs: In der Standardkonstellation steht der AI Act einer lokalen KI-Lösung in der Kanzlei nicht im Weg und erzeugt keine zusätzlichen Pflichten. Die eigentlichen Hürden liegen woanders — im Berufsrecht und in der DSGVO, die beide parallel weiterlaufen.

## Weiter im Cluster

Dieser Beitrag gehört zur Reihe über lokale KI, deren Auftakt die [Definition von "privat"](/blog/was-privat-wirklich-heisst) bildete. Der nächste Artikel widmet sich dann ausführlich der DSGVO bei Dokumenten-Eingaben in Cloud-LLMs — hier nur angerissen.

Alle Beiträge der Reihe versammelt die [Pillar-Seite zu lokaler KI](/lokale-ki). Die technische Umsetzung beschreibt die [Architektur](/architektur)-Seite.

LokLM zum Selbst-Ausprobieren: [Download](/#download), ohne Konto, ohne E-Mail.

---

[^1]: Verordnung (EU) 2024/1689 — Verordnung über künstliche Intelligenz (KI-Verordnung / AI Act). Volltext bei EUR-Lex: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^2]: Aktueller Stand des General-Purpose-AI Code of Practice der Europäischen Kommission: https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice

[^3]: Verordnung (EU) 2016/679 — Datenschutz-Grundverordnung. Konsolidierte Fassung: https://eur-lex.europa.eu/eli/reg/2016/679/oj
