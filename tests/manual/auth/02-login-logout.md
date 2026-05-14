# 02 - Login und Logout

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Authentifizierung               |
| Arbeitspaket        | AP-2.1                          |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob sich ein bestehender Benutzer erfolgreich einloggen und wieder ausloggen kann.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Die Datenbank ist erreichbar.
- Ein gültiger Testbenutzer existiert bereits.
- Der Benutzer ist aktuell nicht eingeloggt.
- Der Tester befindet sich auf der Startseite oder Login-Seite.

## Testdaten

| Feld     | Wert                            |
| -------- | ------------------------------- |
| E-Mail   | dominik.furlan@lbs4.salzburg.at |
| Passwort | Test12345!                      |

## Schritte

1. Die Login-Seite öffnen.
2. Eine gültige E-Mail-Adresse eingeben.
3. Das gültige Passwort eingeben.
4. Auf „Login“ klicken.
5. Prüfen, ob der Benutzerbereich oder die eingeloggte Startseite angezeigt wird.
6. Auf „Logout“ klicken.

## Erwartet

1. Die Login-Seite wird angezeigt.
2. Die E-Mail-Adresse wird übernommen.
3. Das Passwort wird verdeckt eingegeben.
4. Der Login wird erfolgreich durchgeführt.
5. Der Benutzerbereich oder die Startseite für eingeloggte Benutzer erscheint.
6. Der Benutzer wird ausgeloggt und zur Login- oder Startseite weitergeleitet.

## Ergebnis nach Durchführung

| Prüfpunkte                            | Ergebnis |
| ------------------------------------- | -------- |
| Login-Seite erreichbar?               | Offen    |
| Login mit gültigen Daten erfolgreich? | Offen    |
| Benutzerbereich sichtbar?             | Offen    |
| Logout erfolgreich?                   | Offen    |
| Weiterleitung nach Logout korrekt?    | Offen    |
| Fehlermeldungen aufgetreten?          | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
