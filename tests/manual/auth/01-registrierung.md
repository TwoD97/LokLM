# 01 - Registrierung

## Test-Info

| Feld                | Wert               |
| ------------------- | ------------------ |
| Status              | Nicht durchgeführt |
| Ergebnis            | Offen              |
| Bereich             | Authentifizierung  |
| Arbeitspaket        | AP-2.1             |
| Priorität           | Hoch               |
| Datum               |                    |
| Tester              |                    |
| Betriebssystem      |                    |
| App-Version / Build |                    |

## Ziel

Es wird geprüft, ob ein neuer Benutzer erfolgreich registriert werden kann.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Die Datenbank ist erreichbar.
- Es existiert noch kein Benutzerkonto mit der verwendeten Test-E-Mail-Adresse.
- Der Tester befindet sich auf der Startseite.

## Testdaten

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| E-Mail              | dominik.furlan@lbs4.salzburg.at |
| Benutzername        | Dominik Furlan                  |
| Passwort            | Test12345!                      |
| Passwort bestätigen | Test12345!                      |

## Schritte

1. Auf „Registrieren“ klicken.
2. Eine gültige E-Mail-Adresse eingeben.
3. Einen Benutzernamen eingeben.
4. Ein gültiges Passwort eingeben.
5. Das Passwort erneut zur Bestätigung eingeben.
6. Die Registrierung absenden.

## Erwartet

1. Die Registrierungsseite wird geöffnet.
2. Die E-Mail-Adresse wird akzeptiert.
3. Der Benutzername wird akzeptiert.
4. Das Passwort erfüllt die Anforderungen.
5. Beide Passwörter stimmen überein.
6. Das Benutzerkonto wird erstellt und eine Erfolgsmeldung erscheint.

## Ergebnis nach Durchführung

| Prüfpunkte                         | Ergebnis |
| ---------------------------------- | -------- |
| Registrierung erfolgreich?         | Offen    |
| Erfolgsmeldung sichtbar?           | Offen    |
| Benutzer in Datenbank gespeichert? | Offen    |
| Weiterleitung korrekt?             | Offen    |
| Fehlermeldungen aufgetreten?       | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
