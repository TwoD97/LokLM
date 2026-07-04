---
title: 'DSGVO und LLM: Dokumente in ChatGPT einfügen ist ein Datenexport'
description: 'Was rechtlich passiert, wenn Mandanten- oder Forschungsunterlagen in ein Cloud-LLM eingefügt werden — Drittlandtransfer (Art. 44–49 DSGVO), Rechtsgrundlage und Auftragsverarbeitung in einer praktischen Lesart.'
lang: 'de'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

Dass in diesem Text konkret von ChatGPT die Rede ist, hat einen einfachen Grund: Die Rechtsfragen lassen sich am besten dort erklären, wo sie tatsächlich entstehen — und in der Praxis landen vertrauliche Unterlagen eben im Eingabefeld des bekanntesten Werkzeugs. Inhaltlich trifft alles Folgende genauso auf Claude, Gemini, Copilot, Perplexity und jeden anderen Cloud-Dienst zu, dessen Server außerhalb der EU stehen. ChatGPT dient hier als Anschauungsbeispiel für ein Nutzungsmuster, nicht als Ziel eines Produktvergleichs. (Und vorweg: Dieser Beitrag ist keine Rechtsberatung.)

Der Kern des Arguments passt in einen Satz: Wer eine Mandantenakte, einen Forschungsentwurf oder interne Geschäftsdokumente in ein solches Eingabefeld kopiert, führt keine harmlose _"Einfügen"_-Operation aus, sondern eine Datenübermittlung — mit allem, was die DSGVO daran knüpft.

## Was technisch passiert

Zwischen dem Absenden einer Anfrage und dem Erscheinen der Antwort läuft folgende Kette ab:

1. Der eingefügte Text verlässt das Gerät des Nutzers.
2. Er wandert per HTTPS zu einer Server-Infrastruktur von OpenAI, die in den USA betrieben wird[^1].
3. Ein Sprachmodell auf diesen Servern verarbeitet die Eingabe.
4. Das Ergebnis wird an den Nutzer zurückgeliefert.
5. Je nach Tarif und Konto-Einstellungen bleiben Eingabe und Ausgabe eine Weile gespeichert.

Juristisch entscheidend ist Schritt 2. Sein Fachbegriff: **Drittlandtransfer**.

## Drittlandtransfer nach Art. 44 DSGVO

Übermittlungen personenbezogener Daten in Staaten außerhalb des Europäischen Wirtschaftsraums behandelt die DSGVO in Artikel 44 ff. Solche Staaten nennt die Verordnung **Drittländer** — und dazu zählen die USA.

Zulässig ist ein solcher Transfer nur dann, wenn mindestens einer der drei Mechanismen aus Kapitel V erfüllt ist (Art. 44 DSGVO):

- **Angemessenheitsbeschluss** (Art. 45) — die EU-Kommission bescheinigt einem Drittland ein angemessenes Datenschutzniveau.
- **Geeignete Garantien** (Art. 46) — etwa Standardvertragsklauseln (SCC), verbindliche interne Datenschutzvorschriften (BCR) oder anerkannte Verhaltenskodizes.
- **Ausnahmen für besondere Fälle** (Art. 49) — z. B. ausdrückliche Einwilligung, Erforderlichkeit für einen Vertrag, lebenswichtige Interessen.

Greift keiner dieser Wege, ist die Übermittlung schlicht rechtswidrig. Daran ändern weder Transportverschlüsselung noch technische Schutzvorkehrungen noch vertragliche Zusagen des Anbieters etwas.

### Die aktuelle Lage USA: Data Privacy Framework

Seit Juli 2023 existiert mit dem **EU-US Data Privacy Framework**[^2] wieder ein Angemessenheitsbeschluss nach Art. 45 DSGVO — allerdings nur für US-Unternehmen, die sich unter dem Framework zertifizieren lassen. OpenAI findet sich in der öffentlichen Liste[^3].

Verlässlich ist diese Grundlage nur bedingt. Gegen das Framework laufen Beschwerden, unter anderem von NOYB; und die Geschichte mahnt zur Vorsicht: Beide Vorgänger-Konstruktionen — Safe Harbor (2015) und Privacy Shield (2020) — hat der EuGH für ungültig erklärt. Die Unsicherheit ist also kein Randphänomen, sondern Teil des Bauplans.

Solange der Beschluss Bestand hat, trägt Art. 45 DSGVO die Übermittlung an einen zertifizierten US-Empfänger. Kippt er — ein einziges EuGH-Urteil genügt dafür —, steht die Praxis von einem Tag auf den anderen ohne Rechtsgrundlage da und muss auf SCC samt ergänzender Maßnahmen und einem Transfer Impact Assessment (TIA) umsteigen.

## Rechtsgrundlage nach Art. 6 DSGVO

Noch bevor der Drittlandtransfer geprüft wird, stellt sich eine grundlegendere Frage: Worauf stützt sich die Verarbeitung überhaupt? Art. 6 Abs. 1 DSGVO kennt genau sechs Kandidaten:

- **a) Einwilligung** — freiwillig, informiert, jederzeit widerrufbar, von der betroffenen Person selbst.
- **b) Vertragserfüllung** — die Verarbeitung muss zur Erfüllung eines Vertrags mit der betroffenen Person erforderlich sein.
- **c) Rechtliche Verpflichtung** — eine gesetzliche Pflicht verlangt die Verarbeitung.
- **d) Lebenswichtige Interessen** — Notfallsituationen.
- **e) Öffentliches Interesse** — hoheitliche Aufgaben.
- **f) Berechtigte Interessen** — eine Abwägung zwischen dem Interesse an der Verarbeitung und den Rechten der Betroffenen.

Geht es um ein Mandantendokument in ChatGPT, fallen c), d) und e) praktisch immer weg. Übrig bleiben a), b) und f) — und keiner der drei trägt bequem.

**a) Einwilligung:** Der Mandant müsste ausdrücklich und im Wissen um die Umstände zustimmen, dass ein US-Unternehmen seine personenbezogenen Daten verarbeitet. Eine Standardklausel im Mandatsvertrag reicht dafür kaum aus — freiwillig und informiert ist eine Zustimmung nicht, wenn der Mandant den technischen Vorgang gar nicht kennt.

**b) Vertragserfüllung:** Das Mandat verpflichtet zur Beratung — nicht dazu, sie mit einem bestimmten Werkzeug zu erbringen. Da die Leistung auch ohne Cloud-LLM erbracht werden kann, fehlt es regelmäßig an der _Erforderlichkeit_, die b) voraussetzt.

**f) Berechtigte Interessen:** In der Praxis die meistgenannte Grundlage. Sie verlangt drei Prüfschritte: ein legitimes Interesse, dessen Erforderlichkeit, und eine Abwägung mit den Betroffenenrechten. Bei vertraulichen Mandanten- oder Patientendaten geht diese Abwägung typischerweise zugunsten der Betroffenen aus — wer eine Kanzlei beauftragt, darf berechtigterweise erwarten, dass die eigene Akte nicht bei einem US-Anbieter landet.

## Verantwortlicher und Auftragsverarbeiter

Darüber liegt eine zweite Ebene: die Rollenverteilung, die Art. 4 Nr. 7 und Nr. 8 DSGVO definieren.

- **Verantwortlicher** (controller) — bestimmt Zwecke und Mittel der Verarbeitung. Im Kanzleikontext: der Anwalt oder die Kanzlei.
- **Auftragsverarbeiter** (processor) — verarbeitet Daten im Auftrag des Verantwortlichen, ohne eigene Zweckentscheidung.

Schickt ein Anwalt Mandantendaten an OpenAI, agiert OpenAI typischerweise als **Auftragsverarbeiter**. Damit greift Art. 28 DSGVO — und der verlangt einen **Vertrag zur Auftragsverarbeitung** (AVV) zwischen beiden, der mindestens die in Art. 28 Abs. 3 aufgezählten Punkte abdeckt.

Solche AVV-Dokumente stellt OpenAI standardisiert bereit — aber nur für Business-Angebote wie Team, Enterprise und die API-Plattform[^4]. Die Free- und Plus-Tarife richten sich an Privatnutzer; ein AVV gehört dort in der Regel nicht dazu.

**Was das konkret bedeutet:** Wer beruflich mit einem persönlichen ChatGPT-Plus-Konto (20 €/Monat) arbeitet und dort Mandantendokumente einfügt, hat üblicherweise **keinen AVV mit OpenAI** — und damit fehlt bereits eine zwingende Voraussetzung aus Art. 28 DSGVO. Diese Konstellation ist regelmäßig rechtswidrig, ganz gleich, ob der Drittlandtransfer für sich genommen abgesichert wäre.

## Eine zusätzliche Schicht: Berufsgeheimnis

Anwälte, Ärzte, Steuerberater und Psychotherapeuten unterliegen zusätzlich dem **Berufsgeheimnis** — einem eigenständigen Pflichtenkreis, der **neben** der DSGVO steht und nicht in ihr aufgeht. In Deutschland vor allem:

- **§ 43a Abs. 2 BRAO** — die anwaltliche Verschwiegenheitspflicht.
- **§ 203 StGB** — Strafbarkeit der Verletzung von Privatgeheimnissen, unter anderem durch Anwälte, Ärzte und Steuerberater.

Der wesentliche Unterschied zur DSGVO: § 203 StGB ist **Strafrecht**. Ein Verstoß ist eine Straftat, keine bloße Ordnungswidrigkeit. Dafür ist der erfasste Personenkreis enger gezogen — und die Schwelle, ab der ein _"Offenbaren"_ vorliegt, niedriger.

Schon die Weitergabe an einen Cloud-Dienst kann ein Offenbaren im Sinne von § 203 StGB darstellen — selbst dann, wenn ein AVV existiert und der Transfer formal auf sicheren Füßen steht. Zusätzlich müssten die Voraussetzungen für _"mitwirkende Personen"_ nach § 203 Abs. 4 StGB erfüllt sein: eine — üblicherweise schriftliche — Verpflichtung auf die Verschwiegenheit, die das US-Unternehmen auch anerkennen müsste.

Ein etablierter Standard dafür existiert bislang nicht. Einzelne Bundesländer veröffentlichen Hinweise, manche Anwaltskammern raten für Mandantendaten ausdrücklich von Cloud-LLMs ab[^5]. Weil sich diese Lage laufend bewegt, lohnt vor der Einführung eines Werkzeugs ein Anruf bei der zuständigen Rechtsanwaltskammer.

## Was eine Kanzlei (oder Beratungsstelle) prüfen muss

Bevor ein Cloud-LLM berufliche Inhalte verarbeitet, sollten sechs Fragen beantwortet sein:

1. **Rechtsgrundlage:** Auf welchen Buchstaben aus Art. 6 Abs. 1 DSGVO stützt sich die Verarbeitung — und ist diese Entscheidung dokumentiert?
2. **AVV:** Existiert ein Auftragsverarbeitungsvertrag mit dem Anbieter, der den Anforderungen von Art. 28 Abs. 3 DSGVO genügt?
3. **Drittlandtransfer-Mechanismus:** Trägt ein Angemessenheitsbeschluss (DPF) — und ist der konkrete Anbieter zertifiziert? Falls nicht: Gibt es SCCs und ein durchgeführtes Transfer Impact Assessment?
4. **Berufsgeheimnis:** Ist die zuständige Berufskammer einbezogen worden? Sind mitwirkende Personen nach § 203 Abs. 4 StGB schriftlich verpflichtet?
5. **Mandantenseite:** Sind die Mandanten transparent informiert (Art. 13/14 DSGVO) und haben sie eine Widerspruchsmöglichkeit?
6. **Datenschutz-Folgenabschätzung (Art. 35):** Bei umfangreicher Verarbeitung sensibler Daten Pflicht — liegt sie vor?

In der typischen Konstellation eines privaten ChatGPT-Plus-Abos bleiben mindestens vier dieser sechs Fragen unbeantwortet. Genau das macht sie rechtlich verwundbar.

## Was sich bei lokaler Verarbeitung ändert

Findet die Verarbeitung **komplett auf dem eigenen Gerät** statt — kein Byte des Textes erreicht einen fremden Server —, erledigen sich die Fragen 2 und 3 von selbst. Ohne externe Stelle, die im Auftrag verarbeitet, gibt es keinen Auftragsverarbeiter. Ohne Datenfluss über die EWR-Grenze gibt es keinen Drittlandtransfer.

Die Fragen 1, 4, 5 und 6 dagegen bleiben. Lokalität schaltet die DSGVO nicht ab — sie verkleinert lediglich den Ausschnitt, der beantwortet werden muss.

Darin liegt der eigentliche Unterschied zwischen Cloud-LLM und On-Device-Lösung: nicht in einem diffusen _"mehr"_ oder _"weniger"_ Datenschutz, sondern in einer **anderen Anzahl offener Prüfpunkte**.

## Weiter im Cluster

Den Auftakt der Reihe machte die Definition der [fünf Eigenschaften lokaler KI](/blog/was-privat-wirklich-heisst); danach folgte die [Einordnung lokaler KI im EU AI Act](/blog/on-device-ki-unter-dem-eu-ai-act). Mit diesem dritten Beitrag ist die rechtliche Vorrunde komplett.

Alle drei Artikel sind auf der [Pillar-Seite zur lokalen KI](/lokale-ki) gebündelt. Wie die On-Device-Verarbeitung technisch aufgebaut ist, zeigt die [Architektur](/architektur)-Seite.

LokLM selbst testen: [Download](/#download), ohne Konto, ohne E-Mail.

---

[^1]: OpenAI Privacy Policy: https://openai.com/policies/privacy-policy/

[^2]: Adequacy decision EU-US Data Privacy Framework, Beschluss (EU) 2023/1795 der Kommission: https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj

[^3]: Data Privacy Framework Listing (öffentliches Verzeichnis der zertifizierten US-Unternehmen): https://www.dataprivacyframework.gov/list

[^4]: OpenAI Data Processing Addendum: https://openai.com/policies/data-processing-addendum/

[^5]: Beispielsweise die Hinweise der Bundesrechtsanwaltskammer zur Nutzung von KI-Anwendungen: https://www.brak.de/
