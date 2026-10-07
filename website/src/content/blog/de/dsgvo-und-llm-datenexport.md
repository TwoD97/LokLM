---
title: 'DSGVO und Cloud-LLMs: Rollen, Datenflüsse und Übermittlungen'
description: 'Was vor dem Upload von Dokumenten in ein Cloud-LLM zu prüfen ist: Rechtsgrundlage, Auftragsverarbeitung, Drittlandtransfers und die Grenzen lokaler Verarbeitung.'
lang: 'de'
translationKey: 'gdpr-llm-data-export'
pubDate: 2026-05-28
updatedDate: 2026-10-07
tags: ['lokale-ki', 'dsgvo', 'datenschutz']
---

Wer ein Dokument an ein Cloud-LLM sendet, macht dessen Inhalt außerhalb des eigenen Geräts verfügbar. Gerade bei Mandantenakten oder Forschungsdaten braucht das eine bewusste Prüfung. Daraus folgen aber **nicht automatisch** ein Drittlandtransfer oder eine Auftragsverarbeitung.

Dieser Überblick wurde am 7. Oktober 2026 geprüft. Er bietet allgemeine Informationen, keine rechtliche Bewertung einer bestimmten Organisation oder Dienstkonfiguration.

## Mit Daten und Zweck beginnen

Welche personenbezogenen Daten sind betroffen, wozu ist die KI-Verarbeitung nötig und welche Rechtsgrundlage trägt sie? Einwilligung ist eine Möglichkeit, keine allgemeine Pflicht. Auch Vertragserfüllung oder berechtigte Interessen haben jeweils eigene Voraussetzungen. Für Gesundheitsdaten und andere besondere Datenkategorien ist zusätzlich eine Bedingung aus Art. 9 erforderlich. Ein Übermittlungsmechanismus ersetzt keine Rechtsgrundlage. Der [EDSA-Leitfaden zur rechtmäßigen Verarbeitung](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_de) erläutert die Unterschiede.

Vor der Einführung sollten der konkrete Dienst, empfangende Unternehmen, Zugriffsländer, Aufbewahrung, Trainingsnutzung und angebundene Werkzeuge dokumentiert werden. „ChatGPT“ oder „Cloud-KI“ allein beschreibt die Verarbeitung nicht hinreichend.

Beispielsweise bieten geeignete ChatGPT-Enterprise- und Edu-Konfigurationen europäische Speicher- und Inferenzregionen. Das sind unterschiedliche Einstellungen mit Ausnahmen für Funktionen und Verarbeitungsschritte; sie halten nicht automatisch sämtliche Vorgänge in der gewählten Region. Maßgeblich ist die [aktuelle OpenAI-Dokumentation zur Datenresidenz](https://help.openai.com/en/articles/9903489-data-residency-and-inference-residency-for-chatgpt) für den jeweiligen Arbeitsbereich.

## Wann greift Artikel 28?

Ein Auftragsverarbeiter verarbeitet personenbezogene Daten für einen Verantwortlichen. Verfolgt ein Dienst eigene Zwecke, kann er für diese Verarbeitung selbst Verantwortlicher sein. Entscheidend sind die tatsächlichen Tätigkeiten, nicht Verschlüsselung oder Vertragsbezeichnung allein. Bei Auftragsverarbeitung verlangt Art. 28 einen geeigneten Vertrag oder anderen zulässigen Rechtsakt. Siehe die [EDSA-Leitlinien zu Verantwortlichen und Auftragsverarbeitern](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf).

OpenAI veröffentlicht einen [Auftragsverarbeitungszusatz](https://openai.com/policies/data-processing-addendum/) für Verarbeitungen unter dem jeweiligen Geschäftsvertrag. Zu prüfen ist, ob dieser den tatsächlich verwendeten Dienst und Einsatzzweck abdeckt. Tarifname, Bezahlung oder eine deaktivierte Trainingsnutzung belegen für sich keine Rechtmäßigkeit.

## Wann liegt ein Drittlandtransfer vor?

Der EDSA nennt drei kumulative Voraussetzungen: Der Exporteur unterliegt für die Verarbeitung der DSGVO; er macht personenbezogene Daten einem anderen Verantwortlichen oder Auftragsverarbeiter verfügbar; und dieser Empfänger befindet sich in einem Drittland oder ist eine internationale Organisation. Verarbeitung außerhalb des Geräts allein erfüllt diesen Test nicht. Siehe [Leitlinien 05/2021](https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf).

Greift Kapitel V, sind Angemessenheit, geeignete Garantien wie Standardvertragsklauseln oder eine eng anwendbare Ausnahme zu prüfen. Verschlüsselung kann Teil der Schutzmaßnahmen sein, beantwortet aber nicht allein sämtliche Übermittlungsanforderungen. Der [EDSA-Leitfaden zu internationalen Übermittlungen](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en) erläutert die Wege.

Die [aktuelle Angemessenheitsliste der Kommission](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en) umfasst teilnehmende US-Unternehmen unter dem EU–US Data Privacy Framework. Aktive Teilnahme und Geltungsbereich des konkreten Empfängers sind zu prüfen; das ist keine pauschale Freigabe sämtlicher US-Dienste.

## Verschwiegenheit und Risiko gesondert prüfen

Berufsgeheimnisse erfordern eine eigene Prüfung. Sie verbieten nicht ausnahmslos jeden Cloud-Dienst: [§ 43e BRAO](https://www.gesetze-im-internet.de/brao/__43e.html) regelt für Rechtsanwälte unter anderem Auswahl, Verschwiegenheit und Zugriff bei Dienstleistern; [§ 203 StGB](https://www.gesetze-im-internet.de/stgb/__203.html) erfasst auch mitwirkende Personen. Ein DSGVO-Vertrag erledigt die berufsrechtlichen Fragen nicht.

Eine Datenschutz-Folgenabschätzung ist erforderlich, wenn die Verarbeitung voraussichtlich hohe Risiken für die Rechte und Freiheiten von Menschen verursacht. Weder „nutzt KI“ noch „läuft lokal“ entscheidet darüber. Dazu bietet der [EDSA Hinweise zur Umsetzung](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en).

## Was lokale Verarbeitung verändert

Inferenz und Speicherung innerhalb der eigenen Organisation können die Übermittlung von Dokumentinhalten an einen externen KI-Anbieter vermeiden. Diese Grenze muss auch bei Backups, Fernwartung, optionalen Integrationen und Exporten geprüft werden.

Rechtmäßiger Zweck, geeignete Zugriffsrechte, Aufbewahrungsregeln und Betroffenenrechte bleiben relevant. Lokale Verarbeitung kann den Datenfluss vereinfachen; sie ist kein DSGVO-Zertifikat.

Unser [Leitfaden zu lokaler KI](/lokale-ki) und die [Architektur](/architektur) erläutern die technischen Entscheidungen. Der ergänzende Beitrag behandelt [lokale KI unter dem AI Act](/blog/on-device-ki-unter-dem-eu-ai-act).
