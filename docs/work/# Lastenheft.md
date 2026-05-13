# Lastenheft
 
# Lokaler KI-Wissensassistent mit Quellenverifikation
 
**Projekt: LokLM**
 
| | |
|---|---|
| **Angebot an** | Landesberufsschule 4 Salzburg |
| **Auftraggeber** | Christoph Wirrer |
| **Autor des Dokuments** | Projektgruppe LokLM (Denys Tudosa, Dominik Furlan) |
| **Version** | 1.0 |
| **Dateiname** | Lastenheft_LokLM.md |
| **Ort, Datum** | Salzburg, 08.05.2026 |
 
## Kurzbeschreibung
 
Ziel des Projekts ist die Entwicklung einer lokalen Desktop-Anwendung, mit der Benutzer eigene Dokumente (PDF, Markdown, Textdateien, Quellcode) speichern, in Arbeitsbereiche organisieren und über eine Chat-Oberfläche befragen können. Jede Antwort wird mit nachvollziehbaren Verweisen auf die Originaltextstellen versehen, sodass der Benutzer per Klick zur zitierten Passage springen kann. Die Anwendung arbeitet vollständig lokal, ohne Internetverbindung und ohne externe Cloud-Dienste; alle Daten bleiben auf dem Gerät des Benutzers.
 
## 1. Ausgangssituation
 
Wissen liegt heute verteilt in unterschiedlichen Dateien, Notizen und Skripten. Inhalte schnell wiederzufinden oder belegbar zu zitieren ist aufwendig. Bestehende KI-Chatlösungen verarbeiten Anfragen typischerweise auf externen Servern, wodurch sensible schulische, private oder berufliche Inhalte das Gerät verlassen. Für DSGVO-relevante Unterlagen, schulisches Lernmaterial oder interne Dokumentation ist das oft nicht akzeptabel.
 
LokLM schließt diese Lücke: Die Anwendung speichert Wissen lokal, macht es durchsuchbar und beantwortet Fragen ausschließlich auf Basis der eigenen Dokumente. Jede Antwort enthält klickbare Quellenverweise, mit denen sich die Aussage am Originaltext überprüfen lässt.
 
## 2. Ziel des Projekts
 
Das Projekt soll eine lokal lauffähige Desktop-Anwendung mit grafischer Oberfläche, Backend und relationaler Datenbank bereitstellen. Benutzer können eigene Dokumente importieren, in Arbeitsbereiche organisieren, durchsuchen und über eine Chat-Funktion befragen. Antworten enthalten Verweise auf die zugrundeliegenden Textstellen.
 
Die Anwendung beantwortet keine Fragen aus allgemeinem Internetwissen, sondern arbeitet ausschließlich mit den lokal gespeicherten Inhalten. Wenn keine passende Quelle vorhanden ist, gibt das System eine klare Verweigerungsmeldung aus, anstatt eine Antwort zu erfinden.
 
## 3. Zielgruppe und Einsatzbereich
 
Zielgruppe sind Schülerinnen und Schüler, Lehrlinge, Projektgruppen, Lehrkräfte sowie Wissensarbeiter, die mit eigenen schulischen, privaten oder beruflichen Unterlagen arbeiten und dabei Datenschutz und Nachvollziehbarkeit hoch gewichten. Der Einsatz ist auf einem Notebook, Schulrechner oder einer lokalen Entwicklungsumgebung unter Windows vorgesehen.
 
## 4. Systemübersicht
 
```
Benutzer
   │
   ▼
┌──────────────────────┐    ┌──────────────────────┐
│ Frontend             │    │ Backend              │
│  Login / Logout      │───▶│  Authentifizierung   │
│  Arbeitsbereiche     │    │  CRUD-Logik          │
│  Dokumentenimport    │    │  Indexierung         │
│  Chat-Oberfläche     │    │  Suchlogik           │
│  Quellenanzeige      │    │  Antwortlogik        │
│  Suche & Filter      │    │  Quellenverwaltung   │
└──────────────────────┘    └──────────┬───────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
            ┌──────────────────────┐    ┌──────────────────────┐
            │ Lokale Datenbank     │    │ Lokales Sprachmodell │
            │  Benutzer            │    │  keine externe API   │
            │  Arbeitsbereiche     │    │  Antwortgenerierung  │
            │  Dokumente, Chunks   │    │  Quellen-Zitierung   │
            │  Chats, Nachrichten  │    └──────────────────────┘
            │  alle Inhalte lokal  │
            └──────────────────────┘
```
 
**Grundsatz: lokal, offline nutzbar, keine Cloud und keine externen KI-APIs.**
 
*Abbildung 1: Vereinfachte Systemübersicht von LokLM.*
 
## 5. Funktionale Anforderungen
 
Die Anforderungen sind als **Muss-**, **Soll-** und **Kann-**Anforderungen formuliert. Der Mindestumfang ergibt sich aus den Muss-Anforderungen; Soll- und Kann-Anforderungen erweitern den Funktionsumfang ohne den Pflichtumfang aufzublähen.
 
| Priorität | Bereich | Anforderung |
|---|---|---|
| **Muss** | Anmeldung | Benutzer kann sich registrieren, anmelden und abmelden. Passwörter werden nicht im Klartext gespeichert. |
| **Muss** | Passwort-Wiederherstellung | Benutzer kann ein vergessenes Passwort über lokal generierte Wiederherstellungscodes zurücksetzen. |
| **Muss** | Dokumentenimport | PDF-, Markdown-, Text- und Quellcode-Dateien können importiert werden. |
| **Muss** | Arbeitsbereiche | Dokumente können in benannten Arbeitsbereichen (Workspaces) organisiert werden. |
| **Muss** | Indexierung | Importierte Dokumente werden im Hintergrund verarbeitet und durchsuchbar gemacht; der Fortschritt ist sichtbar. |
| **Muss** | Inhalte verwalten | Dokumente und Arbeitsbereiche können angelegt, angezeigt, umbenannt und gelöscht werden (CRUD). |
| **Muss** | Suche und Filter | Inhalte können innerhalb eines Arbeitsbereichs durchsucht und gefiltert werden. |
| **Muss** | Chat-Oberfläche | Benutzer kann Fragen über eine Chat-Oberfläche stellen; Antworten werden gestreamt dargestellt. |
| **Muss** | Quellenverweise | Jede Antwort enthält klickbare Verweise auf die zugrundeliegenden Dokumentstellen. |
| **Muss** | Quellenanzeige | Per Klick auf einen Quellenverweis öffnet sich die Originalpassage mit Kontext. |
| **Muss** | Speicherung | Inhalte, Arbeitsbereiche und Chatverläufe werden lokal gespeichert. |
| **Muss** | Antwortlogik | Das System nutzt ausschließlich lokale Inhalte für Antworten. |
| **Muss** | Fehlerfall | Wenn keine passenden Inhalte gefunden werden, gibt das System eine klare Verweigerungsmeldung aus. |
| **Muss** | Mehrsprachigkeit | Suche und Antworten funktionieren für deutsche und englische Inhalte. |
| **Soll** | Semantische Suche | Inhalte sollen zusätzlich zur Stichwortsuche auch sinngemäß gefunden werden können. |
| **Soll** | DOCX-Import | Word-Dokumente (.docx) sollen importiert werden können. |
| **Soll** | Chatverlauf | Frühere Chatverläufe sollen wieder geöffnet und fortgesetzt werden können. |
| **Soll** | Einstellungen | Chunkgröße, Überlappung und Anzahl der Treffer sollen in den Einstellungen konfigurierbar sein. |
| **Soll** | Designpattern | Der Quellcode soll erkennbare Architekturmuster verwenden und diese in der Dokumentation benennen. |
| **Soll** | Hardware-Test | Die Anwendung soll auf unterschiedlichen Hardwarekonfigurationen getestet sein und das Ergebnis dokumentiert werden. |
| **Soll** | Evaluierung | Die Antwortqualität soll mit einem festgelegten Testset gemessen und dokumentiert werden (Citation Accuracy, Faithfulness, Refusal Rate). |
| **Soll** | Verteilungsseite | Eine öffentliche Projektseite soll Installer und Anwenderdokumentation bereitstellen. |
| **Kann** | Lokales Feintuning | Das verwendete Sprachmodell kann mit projekteigenen Daten lokal nachtrainiert werden, um Quellentreue zu erhöhen. |
| **Kann** | Code-bewusste Aufteilung | Quellcode-Dateien können entlang von Funktions- und Klassengrenzen aufgeteilt werden. |
| **Kann** | Zusammenfassungen | Importierte Dokumente können automatisch zusammengefasst werden. |
 
## 6. Hauptfunktionen im Ablauf
 
```
  1            2              3              4              5              6              7
┌──────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│Anmel-│───▶│Arbeits-  │───▶│Dokumente │───▶│Indexie-  │───▶│Frage im  │───▶│Antwort   │───▶│Quelle    │
│den   │    │bereich   │    │importie- │    │rung im   │    │Chat      │    │mit       │    │öffnen    │
│      │    │anlegen   │    │ren       │    │Hinter-   │    │stellen   │    │Quellen   │    │(Klick)   │
└──────┘    └──────────┘    └──────────┘    │grund     │    └──────────┘    └──────────┘    └──────────┘
                                            └──────────┘
                                                                        Wenn nichts gefunden:
                                                                        klare Verweigerungs-Meldung
 
  ◉ Offline       ◉ Lokal gespeichert       ◉ Datenschutz       ◉ Quellenbasiert
```
 
*Abbildung 2: Grundablauf aus Sicht des Benutzers.*
 
## 7. Nichtfunktionale Anforderungen
 
| Bereich | Anforderung |
|---|---|
| **Datenschutz** | Alle Daten bleiben lokal gespeichert. Für die Grundfunktion werden keine externen Dienste benötigt. |
| **Offline-Fähigkeit** | Die Anwendung muss ohne Internetverbindung nutzbar sein. |
| **Sicherheit** | Zugriff auf gespeicherte Inhalte ist erst nach Anmeldung möglich. Passwörter werden mit einem modernen Verfahren gehasht. |
| **Bedienbarkeit** | Die Oberfläche soll übersichtlich, deutsch- und englischsprachig nutzbar und für den vorgesehenen Einsatz geeignet sein. |
| **Nachvollziehbarkeit** | Antworten müssen auf konkret benannte gespeicherte Inhalte zurückführbar sein. |
| **Zuverlässigkeit** | Das System darf keine Antwort vortäuschen, wenn keine passenden lokalen Daten vorhanden sind. |
| **Performance** | Antwortdarstellung beginnt zügig nach Eingabe der Frage; die genauen Werte werden im Pflichtenheft festgelegt. |
| **Wartbarkeit** | Der Quellcode ist strukturiert, kommentiert und über generierte Code-Dokumentation erschließbar. |
| **Datenintegrität** | Bearbeiten und Löschen dürfen keine unbeabsichtigten Datenverluste verursachen. |
| **Portabilität** | Die Anwendung läuft als Desktop-Installer auf Windows 10/11 (64-bit). |
 
## 8. Technischer Rahmen
 
Die genaue technische Umsetzung wird im Pflichtenheft festgelegt. Für das Lastenheft reicht die Festlegung des Rahmens:
 
- lokale Desktop-Umgebung unter Windows
- Frontend mit grafischer Benutzeroberfläche, Authentifizierung und Personalisierung
- Backend zur Verarbeitung von Anmeldung, CRUD, Indexierung, Suche und Antwortlogik
- relationale Datenbank mit mindestens fünf unabhängigen Tabellen (3. Normalform), referentieller Integrität (PK/FK) und mindestens je einem Trigger, einer Funktion und einer Prozedur in produktivem Einsatz
- lokales Sprachmodell für die Antwortgenerierung; keine externen KI-APIs
- Quellcodeverwaltung mit täglichen Commits und Leserechten für den Projektbetreuer
- generierte Code-Dokumentation und schriftliches Anwenderhandbuch
 
## 9. Mindestumfang für den Projektabschluss
 
Für einen positiven Projektabschluss muss das Grundsystem stabil funktionieren. Erweiterungen sind erst sinnvoll, wenn dieser Kern vollständig läuft.
 
| Nr. | Mindestbestandteil |
|---|---|
| 1 | Registrierung, Login und Logout mit Passwort-Wiederherstellung |
| 2 | Lokale Speicherung von Dokumenten, Arbeitsbereichen und Chatverläufen |
| 3 | CRUD-Funktionen für Arbeitsbereiche und Dokumente |
| 4 | Import von PDF, Markdown, Text und Quellcode mit Hintergrund-Indexierung |
| 5 | Suche und Filter innerhalb eines Arbeitsbereichs |
| 6 | Chat-Oberfläche mit gestreamten Antworten |
| 7 | Antworten enthalten klickbare Quellenverweise auf konkrete Textstellen |
| 8 | Klick auf einen Quellenverweis öffnet die Originalpassage mit Kontext |
| 9 | Klare Verweigerungsmeldung, wenn keine passenden Inhalte gefunden werden |
| 10 | Lokale Vorführung ohne verpflichtende Internetverbindung |
| 11 | Lauffähiger Windows-Installer |
 
## 10. Abgrenzung des Projektumfangs
 
**Nicht Bestandteil der ersten Version sind:**
 
- Cloudspeicherung und externe KI-APIs
- Multi-Device-Synchronisation und Mehrbenutzerbetrieb auf einer Instanz
- Mobile Apps (iOS, Android) und Browser-Erweiterungen
- Texterkennung aus gescannten PDFs (OCR)
- Audio- und Videotranskription
- Externe oder gemeinsam genutzte Datenbanken
- Zwei-Faktor-Authentifizierung (für eine reine Einzel-Geräte-Anwendung ohne externes Trust-Domain ohne Mehrwert)
 
**Optionale Erweiterungen (nur bei Restzeit nach Erreichen des Mindestumfangs):**
 
- Lokales Feintuning des Sprachmodells mit projekteigenen Daten zur Erhöhung der Quellentreue (siehe Funktionsanforderung *Lokales Feintuning*)
- Code-bewusste Aufteilung von Quellcode-Dateien
- Automatische Zusammenfassungen importierter Dokumente
 
Diese optionalen Erweiterungen werden nicht zugesichert. Sie werden umgesetzt, wenn der Mindestumfang stabil läuft und die Pufferwoche nicht für Stabilisierung benötigt wird.
 
## 11. Meilensteine
 
| Meilenstein | Datum |
|---|---|
| Projektstart | 04.05.2026 |
| Abgabe Lastenheft | 08.05.2026 |
| Projekt-Pitch | 15.05.2026 |
| Abgabe Pflichtenheft | 15.05.2026 |
| Feature-Freeze (alle Muss- und Soll-Anforderungen umgesetzt) | 12.06.2026 |
| Pufferwoche / Integrationstests | 15.–19.06.2026 |
| Testabschluss | 19.06.2026 |
| Dokumentationsübergabe | 26.06.2026 |
| Projektpräsentation | 26.06.2026 |
 
## 12. Anhang: Kurzcheckliste
 
| Erfüllt | Anforderung |
|---|---|
| ☐ | Frontend funktionsfähig |
| ☐ | Backend funktionsfähig |
| ☐ | Relationale Datenbank funktionsfähig (≥5 Tabellen, 3. NF, PK/FK, Trigger/Funktion/Prozedur in Einsatz) |
| ☐ | Authentifizierung mit Passwort-Wiederherstellung umgesetzt |
| ☐ | CRUD-Funktionen umgesetzt |
| ☐ | Suche und Filter umgesetzt |
| ☐ | Chat-Oberfläche mit Streaming umgesetzt |
| ☐ | Quellenverweise und Quellenanzeige umgesetzt |
| ☐ | Mehrsprachige Suche (Deutsch / Englisch) umgesetzt |
| ☐ | Lokale Speicherung umgesetzt |
| ☐ | Quellcodeverwaltung mit Leserechten für den Projektbetreuer eingerichtet |
| ☐ | Generierte Code-Dokumentation verfügbar |
| ☐ | Technische Dokumentation und Benutzerhandbuch erstellt |
| ☐ | Multi-Hardware-Testmatrix dokumentiert |
| ☐ | Testkonzept und Testszenarien dokumentiert |
| ☐ | Evaluierungsergebnisse (Citation Accuracy, Faithfulness, Refusal Rate) dokumentiert |
| ☐ | Verteilungsseite mit Installer-Download bereitgestellt |
| ☐ | Projektpräsentation mit Live-Demo vorbereitet |

## 13. Vereinbarungen
 
 | Dimension              | Vereinbarung |
|------------------------|--------------|
| Informieren            | Alle wichtigen Informationen werden zeitnah und klar an das Team weitergegeben. |
| Planen                 | Aufgaben und Termine werden gemeinsam geplant und realistisch eingeschätzt. |
| Entscheiden            | Entscheidungen werden gemeinsam besprochen und mehrheitlich getroffen. Bei einer Patt-Situation entscheidet eine außenstehende, nicht involvierte Person anhand der besseren und sachlich stärkeren Argumente. |
| Verändern              | Änderungen werden offen kommuniziert und gemeinsam angepasst. |
| Zusammenarbeiten       | Wir unterstützen uns gegenseitig und arbeiten respektvoll miteinander. |
| Konflikte lösen        | Konflikte werden direkt, sachlich und respektvoll angesprochen und gelöst. |
| Verantwortung          | Jede Person übernimmt Verantwortung für ihre Aufgaben und hält Abmachungen ein. |