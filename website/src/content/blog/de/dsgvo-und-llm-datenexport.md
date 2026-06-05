---
title: 'DSGVO und LLM: Dokumente in ChatGPT einfügen ist ein Datenexport'
description: 'Was rechtlich passiert, wenn Mandanten- oder Forschungsunterlagen in ein Cloud-LLM eingefügt werden — Drittlandtransfer (Art. 44–49 DSGVO), Rechtsgrundlage und Auftragsverarbeitung in einer praktischen Lesart.'
lang: 'de'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

> **Hinweis:** Erstentwurf — wird vor der Veröffentlichung von einer Person mit juristischer Qualifikation überarbeitet. Dieser Text ist keine Rechtsberatung.

Dieser Artikel benennt ChatGPT ausdrücklich. Das ist beabsichtigt, weil sich die rechtliche Lage am tatsächlichen Verhalten von Nutzern beschreiben lässt: Dokumente werden in das ChatGPT-Eingabefeld kopiert, weil das Werkzeug populär und greifbar ist. Die Analyse selbst gilt für jedes Cloud-LLM mit Server-Standort außerhalb der EU — also auch für Claude, Gemini, Copilot, Perplexity und viele andere. ChatGPT steht hier exemplarisch für eine Praxis, nicht als Vergleichsobjekt.

Wer Mandantenakten, Forschungsentwürfe oder vertrauliche Geschäftsunterlagen in ein solches Feld kopiert, löst rechtlich mehr aus als das Wort _"einfügen"_ suggeriert. Es ist eine Übermittlung. Genau das ist der Punkt dieses Textes.

## Was technisch passiert

Wenn ein Text in ChatGPT eingefügt und die Anfrage abgeschickt wird, geschieht der folgende Ablauf:

1. Der Text verlässt das Endgerät des Nutzers.
2. Er wird über HTTPS an einen Server-Cluster von OpenAI übertragen — in den USA[^1].
3. Dort wird er von einem Sprachmodell verarbeitet.
4. Eine Antwort wird zurückgeschickt.
5. Anfrage und Antwort werden — abhängig von Einstellungen und Tarif — für eine gewisse Zeit gespeichert.

Punkt 2 ist der rechtlich relevante. Er heißt **Drittlandtransfer**.

## Drittlandtransfer nach Art. 44 DSGVO

Die DSGVO regelt in Artikel 44 ff. die Übermittlung personenbezogener Daten in Länder außerhalb des Europäischen Wirtschaftsraums. Solche Länder heißen im Vokabular der Verordnung **Drittländer**. Die USA sind ein Drittland im Sinne der DSGVO.

Eine Übermittlung in ein Drittland ist nur zulässig, wenn einer der drei in Kapitel V geregelten Mechanismen greift (Art. 44 DSGVO):

- **Angemessenheitsbeschluss** (Art. 45) — die EU-Kommission erklärt das Datenschutzniveau eines Drittlands für angemessen.
- **Geeignete Garantien** (Art. 46) — Standardvertragsklauseln (SCC), verbindliche interne Datenschutzvorschriften (BCR), Verhaltenskodizes.
- **Ausnahmen für besondere Fälle** (Art. 49) — Einwilligung der betroffenen Person, Vertragsdurchführung, lebenswichtige Interessen.

Ohne einen dieser Mechanismen ist die Übermittlung rechtswidrig — unabhängig von Verschlüsselung, technischen Schutzmaßnahmen oder vertraglichen Zusicherungen.

### Die aktuelle Lage USA: Data Privacy Framework

Für die USA gilt seit Juli 2023 der **EU-US Data Privacy Framework**[^2]: ein Angemessenheitsbeschluss nach Art. 45 DSGVO für Unternehmen, die sich zertifiziert haben. OpenAI ist gelistet[^3].

Das Framework ist allerdings rechtlich umstritten. NOYB und andere Datenschutzorganisationen haben Klagen eingereicht; in der Vergangenheit wurden zwei Vorgänger-Mechanismen (Safe Harbor 2015, Privacy Shield 2020) vom EuGH gekippt. Wer auf das Framework setzt, sollte wissen, dass Unsicherheit zur Konstruktion gehört.

Solange der Beschluss gilt, kann eine Übermittlung an einen DPF-zertifizierten US-Empfänger auf Art. 45 DSGVO gestützt werden. Fällt der Beschluss — und das kann mit einem EuGH-Urteil über Nacht passieren —, fehlt die Rechtsgrundlage und es muss auf SCC mit zusätzlichen Maßnahmen (TIA, Transfer Impact Assessment) ausgewichen werden.

## Rechtsgrundlage nach Art. 6 DSGVO

Vor der Frage des Drittlandtransfers steht die Vor-Frage: Auf welcher Rechtsgrundlage wird überhaupt verarbeitet? Art. 6 Abs. 1 DSGVO listet sechs mögliche:

- **a) Einwilligung** — von der betroffenen Person, freiwillig, informiert, jederzeit widerrufbar.
- **b) Vertragserfüllung** — die Verarbeitung ist erforderlich, um einen Vertrag mit der betroffenen Person zu erfüllen.
- **c) Rechtliche Verpflichtung** — gesetzliche Auflage.
- **d) Lebenswichtige Interessen** — Notfälle.
- **e) Öffentliches Interesse** — staatliche Aufgaben.
- **f) Berechtigte Interessen** — Abwägung zwischen Verarbeitungsinteresse und Betroffenenrechten.

Für die Verarbeitung eines Mandantendokuments in ChatGPT scheiden c), d) und e) regelmäßig aus. In Betracht kommen a), b) und f).

**a) Einwilligung:** Der Mandant müsste der Verarbeitung seiner personenbezogenen Daten durch ein US-Unternehmen ausdrücklich zustimmen. Eine pauschale Klausel in einer Mandatsvereinbarung wird der Anforderung an Freiwilligkeit und Informiertheit kaum genügen — vor allem nicht, wenn der Mandant nicht weiß, was technisch passiert.

**b) Vertragserfüllung:** Eine Mandatsvereinbarung verpflichtet den Anwalt zur Beratung, nicht zu deren Durchführung mit einem konkreten Werkzeug. Die Vertragserfüllung kann mit anderen Mitteln erfolgen. Damit ist _erforderlich_ im Sinne von b) meist nicht erfüllt.

**f) Berechtigte Interessen:** Die häufigste in der Praxis herangezogene Grundlage. Sie verlangt eine Drei-Stufen-Prüfung: berechtigtes Interesse, Erforderlichkeit, Abwägung gegen Betroffenenrechte. Bei vertraulichen Mandanten- oder Patientendaten ist die Abwägung in der Regel zugunsten der Betroffenen — die Erwartung, dass eigene Akten nicht an US-Anbieter übermittelt werden, ist berechtigt.

## Verantwortlicher und Auftragsverarbeiter

Eine zweite Schicht: die Rollen-Verteilung nach Art. 4 Nr. 7 und Nr. 8 DSGVO.

- **Verantwortlicher** (controller) — wer entscheidet über Zwecke und Mittel der Verarbeitung. In der Kanzlei: der Anwalt bzw. die Kanzlei.
- **Auftragsverarbeiter** (processor) — wer im Auftrag des Verantwortlichen verarbeitet, ohne eigenständig über die Zwecke zu entscheiden.

Wenn ein Anwalt Mandantendaten an OpenAI sendet, ist OpenAI in der Regel **Auftragsverarbeiter**. Damit greift Art. 28 DSGVO: zwischen Anwalt und OpenAI muss ein **Vertrag zur Auftragsverarbeitung** (AVV) bestehen, der mindestens die in Art. 28 Abs. 3 genannten Inhalte enthält.

OpenAI bietet für Business-Tarife (Team, Enterprise, API-Plattform) standardisierte AVV-Dokumente an[^4]. Für die kostenlosen oder Plus-Tarife gilt das in der Regel nicht — diese Tarife sind primär für Privatpersonen gedacht.

**Praktische Folge:** Wer in einer beruflichen Konstellation ein ChatGPT-Konto auf den eigenen Namen verwendet (Plus-Tarif zu 20 €/Monat) und dort Mandantendokumente einfügt, hat in der Regel **keinen AVV mit OpenAI**. Damit fehlt eine Voraussetzung aus Art. 28 DSGVO. Die Verarbeitung ist unter dieser Konstellation regelmäßig rechtswidrig — unabhängig davon, ob der Drittlandtransfer-Mechanismus greift.

## Eine zusätzliche Schicht: Berufsgeheimnis

Für Anwälte, Ärzte, Steuerberater, Psychotherapeuten gilt das **Berufsgeheimnis** als eigenes Pflichtenregime, das **parallel** zur DSGVO läuft. In Deutschland:

- **§ 43a Abs. 2 BRAO** — Verschwiegenheitspflicht für Rechtsanwälte.
- **§ 203 StGB** — Strafbarkeit der Verletzung von Privatgeheimnissen, u. a. durch Anwälte, Ärzte, Steuerberater.

§ 203 StGB unterscheidet sich von der DSGVO in einem entscheidenden Punkt: er ist **strafrechtlich**. Verstöße sind Straftaten, nicht nur Ordnungswidrigkeiten. Der Personenkreis ist enger, die Schwelle für _"Offenbaren"_ niedriger.

Übermittlung an einen Cloud-Anbieter kann ein Offenbaren im Sinne von § 203 StGB sein — auch wenn ein AVV vorliegt und der Drittlandtransfer formal abgesichert ist. Die Anforderungen an _"mitwirkende Personen"_ (§ 203 Abs. 4 StGB) müssen erfüllt sein: Verpflichtung zur Verschwiegenheit, in der Regel schriftlich, das US-Unternehmen müsste die Verpflichtung anerkennen.

In der Praxis hat sich dafür kein klarer Standard etabliert. Manche Bundesländer geben Hinweise heraus, manche Anwaltskammern empfehlen explizit gegen Cloud-LLMs für Mandantendaten[^5]. Diese Lage ist im Fluss; ein Anruf bei der zuständigen Rechtsanwaltskammer vor der Werkzeug-Einführung ist nicht überflüssig.

## Was eine Kanzlei (oder Beratungsstelle) prüfen muss

Sechs Fragen vor dem Einsatz eines Cloud-LLMs für berufliche Inhalte:

1. **Rechtsgrundlage:** Welcher Buchstabe aus Art. 6 Abs. 1 DSGVO trägt die Verarbeitung? Ist die Wahl dokumentiert?
2. **AVV:** Liegt ein Vertrag zur Auftragsverarbeitung mit dem Anbieter vor? Erfüllt er Art. 28 Abs. 3 DSGVO?
3. **Drittlandtransfer-Mechanismus:** Greift ein Angemessenheitsbeschluss (DPF) — und ist der Anbieter zertifiziert? Liegen sonst SCCs vor? Wurde ein Transfer Impact Assessment durchgeführt?
4. **Berufsgeheimnis:** Wurde die zuständige Berufskammer befragt? Werden mitwirkende Personen im Sinne von § 203 Abs. 4 StGB schriftlich verpflichtet?
5. **Mandantenseite:** Wurden Mandanten transparent informiert (Art. 13/14 DSGVO)? Können sie der Verarbeitung widersprechen?
6. **Datenschutz-Folgenabschätzung (Art. 35):** Bei umfangreicher Verarbeitung sensibler Daten erforderlich. Wurde sie durchgeführt?

Mindestens vier dieser sechs Fragen sind in einer typischen Praxis bei einem privaten ChatGPT-Plus-Abo offen. Das macht die Konstellation rechtlich angreifbar.

## Was sich bei lokaler Verarbeitung ändert

Wenn die Verarbeitung **vollständig auf dem Endgerät** stattfindet — also kein Text an einen externen Server geht —, fallen die Fragen 2 und 3 vollständig weg. Es gibt keinen Auftragsverarbeiter, weil niemand mit den Daten arbeitet außer dem Verantwortlichen selbst. Es gibt keinen Drittlandtransfer, weil die Daten kein Drittland erreichen.

Die Fragen 1, 4, 5 und 6 bleiben bestehen. Die DSGVO entfällt nicht durch Lokalität — sie wird nur deutlich enger anwendbar.

Das ist der eigentliche Unterschied zwischen Cloud-LLM und On-Device-Lösung. Nicht _"mehr"_ oder _"weniger"_ Datenschutz, sondern eine **andere Zahl von zu beantwortenden Fragen**.

## Weiter im Cluster

Der erste Artikel der Reihe definierte die [fünf Eigenschaften lokaler KI](/blog/was-privat-wirklich-heisst). Der zweite betrachtete die [Stellung lokaler KI im EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act). Dieser dritte schließt die rechtliche Vorrunde ab.

Die [Pillar-Seite zur lokalen KI](/lokale-ki) sammelt alle drei Artikel. Wer die technische Architektur sehen will, auf der die On-Device-Verarbeitung tatsächlich läuft, findet sie unter [Architektur](/architektur).

LokLM selbst testen: [Download](/#download), ohne Konto, ohne E-Mail.

---

[^1]: OpenAI Privacy Policy: https://openai.com/policies/privacy-policy/

[^2]: Adequacy decision EU-US Data Privacy Framework, Beschluss (EU) 2023/1795 der Kommission: https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj

[^3]: Data Privacy Framework Listing (öffentliches Verzeichnis der zertifizierten US-Unternehmen): https://www.dataprivacyframework.gov/list

[^4]: OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/

[^5]: Beispielsweise die Hinweise der Bundesrechtsanwaltskammer zur Nutzung von KI-Anwendungen: https://www.brak.de/
