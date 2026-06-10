# M4 - Quellcode-Datei importieren + technische Frage zur Codebase

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Import / Chat                   |
| Arbeitspaket        | AP-T.3 (M4)                     |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob eine **Quellcode-Datei** importiert und indexiert wird und
ob eine **technische Frage zur Codebase** mit korrekter Antwort und Quellenangabe
beantwortet wird. Geprüft wird das textbasierte Einlesen mit Encoding-Erkennung
und die Verwendbarkeit von Code als Wissensquelle.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Der Benutzer ist eingeloggt.
- Ein Workspace ist angelegt und aktiv.
- Eine Quellcode-Test-Datei mit eindeutig benennbarem Inhalt liegt bereit
  (z. B. eine `.ts`-/`.py`-Datei mit einer klar benannten Funktion).
- Das Sprachmodell ist geladen.

## Testdaten

| Feld             | Wert                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Import-Datei     | `beispiel.ts` (oder andere Quellcode-Datei)                          |
| Beispiel-Inhalt  | Eine Funktion mit eindeutigem Namen und nachvollziehbarem Zweck      |
| Testfrage        | „Was macht die Funktion `<name>` und welche Parameter erwartet sie?" |
| Erwartete Quelle | `beispiel.ts`                                                        |
| Besonderheit     | Antwort soll sich auf den tatsächlichen Code-Inhalt beziehen         |

## Schritte

1. Den aktiven Workspace öffnen.
2. Den Import starten und die Quellcode-Datei auswählen.
3. Warten, bis Import und Indexierung abgeschlossen sind.
4. In den Chatbereich wechseln.
5. Die technische Testfrage zur importierten Datei eingeben.
6. Die Nachricht absenden.
7. Warten, bis die Antwort vollständig angezeigt wird.
8. Prüfen, ob die Antwort den Code korrekt beschreibt.
9. Prüfen, ob die Quellenangabe auf die importierte Code-Datei verweist.
10. Auf die Quellenangabe klicken und die richtige Stelle prüfen.

## Erwartet

1. Der Workspace wird ohne Fehler geöffnet.
2. Die Quellcode-Datei wird zum Import akzeptiert.
3. Der Import schließt erfolgreich ab; die Datei erscheint als indexiert.
4. Der Chatbereich ist bedienbar.
5. Die technische Frage wird korrekt angezeigt.
6. Die Nachricht wird gesendet und im Verlauf angezeigt.
7. Eine Antwort wird vollständig geladen.
8. Die Antwort beschreibt den Code fachlich korrekt (kein Halluzinieren).
9. Mindestens eine Quellenangabe verweist auf die Code-Datei.
10. Die Quelle ist anklickbar und die passende Stelle wird geöffnet/hervorgehoben.

## Ergebnis nach Durchführung

| Prüfpunkte                           | Ergebnis |
| ------------------------------------ | -------- |
| Quellcode-Import erfolgreich?        | Offen    |
| Indexierung abgeschlossen?           | Offen    |
| Antwort beschreibt Code korrekt?     | Offen    |
| Quelle verweist auf richtige Datei?  | Offen    |
| Quelle anklickbar / Stelle geöffnet? | Offen    |
| Fehlermeldungen aufgetreten?         | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
- Verwendete Datei / Funktion:
- Antwortzeit:
