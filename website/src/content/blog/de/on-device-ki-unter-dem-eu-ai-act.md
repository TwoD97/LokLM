---
title: 'On-Device-KI unter dem EU AI Act'
description: 'Wo lokale KI-Systeme im EU AI Act stehen — eine Lesart der Artikel 6, 50 und 95. Mit Rollen-Logik und Praxis-Bezug für DACH-Kanzleien und -Forschungsgruppen.'
lang: 'de'
translationKey: 'eu-ai-act-on-device'
pubDate: 2026-05-28
tags: ['lokale-ki', 'eu-ai-act', 'dsgvo']
---

> **Hinweis:** Erstentwurf — die rechtliche Einschätzung wird vor der Veröffentlichung von einer Person mit juristischer Qualifikation überarbeitet. Dieser Text ist keine Rechtsberatung.

Der EU AI Act (Verordnung 2024/1689[^1]) ist seit dem 1. August 2024 in Kraft. Seine Pflichten gelten gestaffelt: einige Verbote ab Februar 2025, allgemeine Pflichten für General-Purpose-AI-Modelle ab August 2025, Hochrisiko-Pflichten überwiegend ab August 2026. Die Verordnung ist in ihrer Bauart auf große KI-Systeme zugeschnitten — gehostet bei einem Anbieter, eingesetzt von einem Betreiber, geprüft durch Notifizierte Stellen.

Wer KI lokal auf dem eigenen Laptop laufen lässt, fragt sich zu Recht: Falle ich da überhaupt drunter? Bin ich Anbieter? Bin ich Betreiber? Muss ich Transparenz herstellen, wenn ich der einzige Nutzer bin?

Dieser Artikel arbeitet drei Punkte heraus. **Artikel 6** (Hochrisiko-Klassifizierung), **Artikel 50** (Transparenzpflichten) und **Artikel 95** (Verhaltenskodizes / Code of Practice). Nicht alle drei sind für alle gleichermaßen relevant — der Punkt ist, zu erkennen, welche Pflichten überhaupt zutreffen und welche nicht.

## Die Rollen-Logik des AI Acts

Der AI Act unterscheidet streng zwischen vier Rollen (Art. 3 Nr. 3–7 AI Act). Die Unterscheidung entscheidet, welche Pflichten gelten.

- **Anbieter** (provider): natürliche oder juristische Person, die ein KI-System entwickelt oder entwickeln lässt und es unter eigenem Namen oder unter eigener Marke in der EU in Verkehr bringt.
- **Betreiber** (deployer): jede natürliche oder juristische Person, die ein KI-System in eigener Verantwortung verwendet, außer im Rahmen einer rein persönlichen, nicht-beruflichen Tätigkeit.
- **Importeur**: in einem Drittland ansässige Anbieter werden in der EU durch einen Importeur vertreten.
- **Händler**: bringt das System auf dem Markt zur Verfügung, ohne Anbieter oder Importeur zu sein.

Für ein On-Device-System wie LokLM ergibt sich daraus eine klare Verteilung. Der Software-Hersteller ist Anbieter. Wer die Software in einer Kanzlei, einer Forschungsgruppe oder einer Steuerberatung einsetzt, ist Betreiber — sofern der Einsatz beruflich erfolgt.

Eine Privatperson, die LokLM zuhause auf eigenen Texten ausprobiert, fällt unter die Ausnahme für rein persönliche, nicht-berufliche Nutzung und ist im Sinne des AI Acts nicht Betreiber. Sie hat keine Betreiber-Pflichten.

## Artikel 6: Hochrisiko-Klassifizierung

Artikel 6 AI Act regelt, wann ein KI-System als **Hochrisiko-System** gilt. Die Klassifizierung folgt zwei Wegen:

- **Weg 1 (Art. 6 Abs. 1):** Das System wird als Sicherheitsbauteil eines Produkts verwendet, das selbst einer der in Anhang I gelisteten Harmonisierungsvorschriften unterliegt (z. B. Medizinprodukte, Maschinen, Spielzeug). Für ein lokales RAG-Werkzeug für Textdokumente ist dieser Weg in aller Regel nicht einschlägig.
- **Weg 2 (Art. 6 Abs. 2 i. V. m. Anhang III):** Das System wird in einem in Anhang III gelisteten Bereich eingesetzt. Anhang III nennt acht Bereiche, darunter Justiz (Buchstabe h), Strafverfolgung, Migrations- und Grenzkontrolle, kritische Infrastruktur.

Anhang III Nr. 8 Buchstabe a nennt ausdrücklich Systeme, die _"justizielle Behörden bei der Auslegung von Sachverhalten und Recht und bei der Anwendung des Rechts auf einen konkreten Sachverhalt unterstützen"_. Eine Anwaltskanzlei nutzt KI nicht als justizielle Behörde — sie ist private Berufsausübung. Damit greift Buchstabe a in der Regel nicht für anwaltliche Nutzung.

**Praktische Konsequenz:** Eine Anwaltskanzlei, die ein lokales KI-Werkzeug zur internen Dokumentenrecherche einsetzt, hat in den meisten Konstellationen keinen Hochrisiko-Einsatz im Sinne von Anhang III. Anders kann es liegen, wenn ein KI-Werkzeug in einer Strafverfolgungsbehörde oder bei einer Migrationsbehörde eingesetzt wird — dann sind die Hochrisiko-Pflichten der Artt. 8 ff. zu beachten.

Diese Einschätzung gilt für die Klassifizierung. Sie sagt nichts über DSGVO-Pflichten, anwaltliche Berufspflichten oder Verschwiegenheitspflichten aus — die laufen parallel und unabhängig.

## Artikel 50: Transparenzpflichten

Artikel 50 AI Act ist die für Endanwender am häufigsten relevante Vorschrift, weil die Pflichten oft auch ohne Hochrisiko-Einstufung greifen.

Drei Pflichten aus Artikel 50 sind für lokale KI typisch zu prüfen:

### 50 Abs. 1: Direkte Interaktion mit Menschen

> _"Anbieter stellen sicher, dass KI-Systeme, die für die direkte Interaktion mit natürlichen Personen bestimmt sind, so konzipiert und entwickelt werden, dass die betreffenden natürlichen Personen darüber informiert werden, dass sie mit einem KI-System interagieren."_

Diese Pflicht trifft den **Anbieter**, nicht den Einzelnutzer. Wer eine lokale KI für sich selbst nutzt — also nicht in Interaktion mit Dritten —, ist nicht Adressat. Wer eine lokale KI in einem Chatbot auf der eigenen Website betreibt, der mit Mandanten oder Kunden interagiert, ist Anbieter dieses Systems im Sinne der Verordnung und muss die Information herstellen.

### 50 Abs. 2: Synthetisch erzeugte Inhalte

> _"Anbieter von KI-Systemen, einschließlich KI-Systemen mit allgemeinem Verwendungszweck, die synthetische Audio-, Bild-, Video- oder Textinhalte erzeugen, stellen sicher, dass die Ausgaben des KI-Systems in einem maschinenlesbaren Format gekennzeichnet und als künstlich erzeugt oder manipuliert erkennbar sind."_

Hier geht es um Wasserzeichen / Provenienz-Marker bei generierten Inhalten. Für ein lokales Werkzeug, das Texte zusammenfasst oder Antworten aus eigenen Dokumenten erzeugt, ist die Frage offen, ob der Output als "synthetisch erzeugter Textinhalt" im Sinne der Vorschrift gilt. Die Erwägungsgründe 132–135 zeigen, dass der Gesetzgeber primär Deepfakes und an Endverbraucher gerichtete Generierung adressieren wollte. Eine eindeutige Behördenpraxis dazu fehlt zum Stand 2026.

### 50 Abs. 4: Deepfakes und politisch relevante Inhalte

> _"Betreiber eines KI-Systems, das Bild-, Audio- oder Videoinhalte erzeugt oder manipuliert, die ein Deepfake darstellen, müssen offenlegen, dass die Inhalte künstlich erzeugt oder manipuliert wurden."_

Für lokale Textwerkzeuge nicht direkt einschlägig, solange keine Bilder oder Audio erzeugt werden.

## Artikel 95: Verhaltenskodizes

Artikel 95 AI Act fordert die Kommission und das AI-Board auf, **Verhaltenskodizes** (Codes of Practice) zu erleichtern, die nicht-hochrisikoreiche Systeme freiwillig einhalten können — z. B. für Umwelt-Auswirkungen, Datenethik oder Zugang für Menschen mit Behinderungen.

Anders als die Verpflichtungen aus Art. 6 oder 50 ist Artikel 95 **nicht verpflichtend**. Er ist ein Anreiz-Instrument. Wer lokal arbeitende KI-Software entwickelt, kann freiwillig einen solchen Kodex unterzeichnen, um Vertrauen zu schaffen — er muss es aber nicht.

Für die Praxis lokaler KI-Werkzeuge ist Artikel 95 vor allem dann interessant, wenn der erste Code of Practice für General-Purpose AI veröffentlicht wird (der Entwurf der Kommission lag Anfang 2025 vor[^2]). Open-Source-Hersteller können daran sehen, welche Selbstverpflichtungen branchenüblich werden — und ggf. anschließen.

## Wo der AI Act schweigt

Drei Punkte, die der AI Act bewusst oder unbewusst offenlässt — und die für lokale KI in der Praxis trotzdem zentral sind:

1. **Datenschutz.** Der AI Act ersetzt keine DSGVO. Er ergänzt sie. Wer mit personenbezogenen Daten arbeitet, hat unabhängig vom AI Act die Pflichten aus Art. 5, 24, 32 DSGVO[^3]. Lokale Verarbeitung verändert die DSGVO-Lage nur insofern, als keine Übermittlung an einen Cloud-Anbieter erfolgt (Art. 44 ff. DSGVO entfällt) — der Rest bleibt.
2. **Berufsrechtliche Verschwiegenheit.** Für Anwälte (§ 43a BRAO), Ärzte (§ 203 StGB), Steuerberater und ähnliche Berufsträger gilt das Berufsgeheimnis. Die Pflicht ist unabhängig von DSGVO und AI Act. Eine lokal arbeitende KI ist hier oft die einzig zulässige Variante, weil eine Cloud-Übermittlung den Verschwiegenheitskreis verlässt.
3. **Open-Source-Sonderregel.** Art. 2 Abs. 12 AI Act enthält eine Ausnahme für Open-Source-KI-Modelle, die nicht in Verkehr gebracht oder in Betrieb genommen werden als Teil eines hochrisikoreichen oder verbotenen Systems. Das ist eine relevante Anhebung der Schwelle für quelloffene Werkzeuge — die Einzelheiten sind in den Erwägungsgründen 102–104 zu lesen.

## Der praktische Fall: eine Kanzlei führt LokLM ein

Eine mittelständische Anwaltskanzlei will Mandantenunterlagen lokal durchsuchen. Sie installiert LokLM auf den Arbeitsplätzen. Was ergibt sich aus dem AI Act?

- **Rolle:** Kanzlei ist Betreiber im Sinne des AI Acts. LokLM-Hersteller ist Anbieter.
- **Hochrisiko (Art. 6):** Anhang III Buchst. h nennt justizielle Behörden — anwaltliche Praxis ist davon nicht erfasst. Das System ist nicht hochrisikoreich.
- **Transparenz (Art. 50):** Die Kanzlei interagiert intern. Es gibt keine Pflicht, Mandanten darüber zu informieren, dass im Hintergrund KI bei der Recherche hilft — solange die KI keine Inhalte erzeugt, die Mandanten als KI-generiert verkauft bekommen. Sobald die Kanzlei ein anwaltliches Schreiben an einen Mandanten als rein KI-generiert herausgäbe (ohne Prüfung durch den Anwalt), wäre das zudem ein berufsrechtliches Problem unabhängig vom AI Act.
- **Verschwiegenheit (§ 43a BRAO):** Lokal-Verarbeitung hält den Verschwiegenheitskreis ein, eine Cloud-Übermittlung würde ihn verletzen.
- **DSGVO:** Die Kanzlei muss eine Datenschutz-Folgenabschätzung durchführen, falls die Verarbeitung umfangreich oder besonders risikoreich ist (Art. 35 DSGVO). Das ist auch bei lokaler Verarbeitung möglich.

Das Bild zeigt: der AI Act erlaubt eine lokale KI-Lösung in einer Kanzlei in der Standardkonstellation ohne zusätzliche AI-Act-Pflichten. Die Schwierigkeit liegt nicht im AI Act — sie liegt im Berufsrecht und in der DSGVO. Beide laufen parallel.

## Weiter im Cluster

Dieser Artikel ist Teil der Reihe zur lokalen KI, die mit der [Definition von "privat"](/blog/was-privat-wirklich-heisst) begann. Der nächste Beitrag wird sich speziell mit der DSGVO bei Dokumenten-Eingaben in Cloud-LLMs befassen — was hier nur kurz gestreift wurde.

Die [Pillar-Seite zu lokaler KI](/lokale-ki) verlinkt alle Artikel der Reihe. Wer die technische Umsetzung kennenlernen will, findet sie unter [Architektur](/architektur).

LokLM zum Selbst-Ausprobieren: [Download](/#download), ohne Konto, ohne E-Mail.

---

[^1]: Verordnung (EU) 2024/1689 — Verordnung über künstliche Intelligenz (KI-Verordnung / AI Act). Volltext bei EUR-Lex: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

[^2]: Aktueller Stand des General-Purpose-AI Code of Practice der Europäischen Kommission: https://digital-strategy.ec.europa.eu/en/policies/ai-code-practice

[^3]: Verordnung (EU) 2016/679 — Datenschutz-Grundverordnung. Konsolidierte Fassung: https://eur-lex.europa.eu/eli/reg/2016/679/oj
