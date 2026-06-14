# Projektauftrag

## 3.1 Auftrag und Rahmen

Der Projektauftrag ist im **Lastenheft** (`docs/Lastenheft.md`, Version 1.0, signiert 08.05.2026) und im **Pflichtenheft** (`docs/Pflichtenheft.md`, Version 1.1.2) festgehalten.

| Feld              | Angabe                                                  |
| ----------------- | ------------------------------------------------------ |
| **Auftraggeber**  | Landesberufsschule 4 Salzburg                          |
| **Projektbetreuer** | Christoph Wirrer                                      |
| **Auftragnehmer** | Projektgruppe LokLM (Denis Tudosa, Dominik Furlan)     |
| **Projektart**    | Schulische Projektarbeit (Lehrgang), ca. 9 Wochen      |
| **Laufzeit**      | 04.05.2026 – 26.06.2026                                |
| **Lizenz**        | MIT (Open Source, keine kommerzielle Auslieferung)     |

Der Auftrag besteht in der **Entwicklung einer lokal lauffähigen Desktop-Anwendung** mit grafischer Oberfläche, Backend und relationaler Datenbank, mit der Benutzer eigene Dokumente importieren, organisieren, durchsuchen und über eine Chat-Funktion befragen können — wobei jede Antwort auf die zugrundeliegenden Textstellen zurückführbar ist (Lastenheft §2).

## 3.2 Ausgangsfrage

Die treibende Frage des Projekts lautet:

> *Wie lässt sich der Nutzen eines KI-Chatassistenten über eigene Unterlagen erzielen, ohne dass diese Unterlagen das Gerät verlassen — und so, dass jede Antwort am Originaltext überprüfbar bleibt?*

Damit verbindet das Projekt zwei Anliegen, die bei Cloud-basierten Chatlösungen in Konflikt stehen: **Vertraulichkeit** (Daten bleiben lokal) und **Nachvollziehbarkeit** (jede Aussage ist belegt).

## 3.3 Fachlicher Kontext

Wissen liegt heute verteilt in Dateien, Notizen und Skripten vor; Inhalte schnell wiederzufinden oder belegbar zu zitieren ist aufwendig. Bestehende KI-Chatlösungen verarbeiten Anfragen typischerweise auf externen Servern, wodurch sensible schulische, private oder berufliche Inhalte das Gerät verlassen. Für DSGVO-relevante Unterlagen, schulisches Lernmaterial oder interne Dokumentation ist das oft nicht akzeptabel (Lastenheft §1). LokLM adressiert genau dieses Spannungsfeld.

Die **Zielgruppe** sind Schülerinnen und Schüler, Lehrlinge, Projektgruppen, Lehrkräfte sowie Wissensarbeiter, die mit eigenen Unterlagen arbeiten und Datenschutz und Nachvollziehbarkeit hoch gewichten. Der Einsatz ist auf Notebook, Schulrechner oder lokaler Entwicklungsumgebung unter Windows vorgesehen (Lastenheft §3).

## 3.4 Technische Zielrichtung

Das Lastenheft legt den technischen Rahmen fest (Lastenheft §8):

- lokale Desktop-Umgebung unter Windows,
- Frontend mit grafischer Oberfläche, Authentifizierung und Personalisierung,
- Backend für Anmeldung, CRUD, Indexierung, Suche und Antwortlogik,
- relationale Datenbank mit mindestens fünf unabhängigen Tabellen in 3. Normalform, referentieller Integrität (PK/FK) und je mindestens einem Trigger, einer Funktion und einer Prozedur im produktiven Einsatz,
- ein **lokales Sprachmodell** für die Antwortgenerierung — **keine externen KI-APIs**,
- Quellcodeverwaltung mit täglichen Commits und Leserechten für den Projektbetreuer,
- generierte Code-Dokumentation und ein schriftliches Anwenderhandbuch.

Die konkrete technische Umsetzung dieses Rahmens ist im Pflichtenheft spezifiziert (siehe Handbuch-Kapitel zur Architektur und Datenmodell).

## 3.5 Erwartete Deliverables

| Deliverable                                | Bezug                                  |
| ------------------------------------------ | -------------------------------------- |
| Lauffähige Desktop-Anwendung (Windows)     | Lastenheft §9 Mindestumfang            |
| Windows-Installer (zusätzlich Linux-AppImage) | Lastenheft §9, Pflichtenheft AP-1.4  |
| Relationale Datenbank (Trigger/Funktion/Prozedur produktiv) | Lastenheft §8, Pflichtenheft §4 |
| Quellcodeverwaltung mit Betreuer-Leserecht | Lastenheft §8                          |
| Generierte Code-Dokumentation (TypeDoc)    | Lastenheft §8, AP-D.4                  |
| Anwenderhandbuch (deutschsprachig)         | Lastenheft §8, AP-D.2                  |
| Test- und Evaluierungsergebnisse           | Lastenheft §5 (Soll), Pflichtenheft §8 |
| Öffentliche Verteilungs-Webseite           | Lastenheft §5 (Soll), AP-D.1           |
| Projektdokumente (Lasten-/Pflichtenheft, Projekthandbuch, techn. Doku) | Pflichtenheft §11 |

## 3.6 Rahmenbedingungen

- **Offline-Prinzip:** Die Grundfunktion läuft ohne Internetverbindung; externe Dienste werden nur einmalig zur Installation kontaktiert (Lastenheft §7, Pflichtenheft §2.1).
- **Datenschutz:** Alle Inhalte bleiben lokal gespeichert; der Zugriff ist erst nach Anmeldung möglich, Passwörter werden modern gehasht (argon2id).
- **Zeitrahmen:** ca. 9 Wochen mit einer reservierten Pufferwoche (KW 24) für Integration und Stabilisierung.
- **Teamgröße:** zwei Personen mit klarer Rollentrennung (siehe Kapitel 07).

## 3.7 Abgrenzung

Nicht Bestandteil der ersten Version sind insbesondere (Lastenheft §10, Pflichtenheft §1.3): Cloudspeicherung und externe KI-APIs, Multi-Device-Synchronisation, Mehrbenutzerbetrieb auf einer Instanz, mobile Apps und Browser-Erweiterungen, OCR für gescannte PDFs, Audio-/Videotranskription als Kernumfang, externe/gemeinsam genutzte Datenbanken sowie Zwei-Faktor-Authentifizierung. Die optionalen Kann-Erweiterungen (lokales Feintuning, code-bewusste Aufteilung, automatische Zusammenfassungen) sind keine Zusicherung und nur bei Restzeit vorgesehen. Die vollständige Abgrenzung ist in Kapitel 06 dieses Handbuchs aufgeführt.

> WARN Annahme, bitte pruefen — Im späteren Projektverlauf wurde ein Audio-Transkriptions-Subsystem (Whisper + Diarisation) tatsächlich umgesetzt (Release v0.4.0), obwohl Transkription im Lastenheft (§10) als nicht-Bestandteil abgegrenzt war. Dies ist als bewusste Scope-Erweiterung über den Mindestumfang hinaus zu werten und beim Team einzuordnen.
