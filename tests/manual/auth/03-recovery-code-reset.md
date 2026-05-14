# 03 - Recovery-Code Reset

## Test-Info

| Feld | Wert |
|---|---|
| Status | Nicht durchgeführt |
| Ergebnis | Offen |
| Bereich | Authentifizierung / Wiederherstellung |
| Arbeitspaket | AP-2.1 |
| Priorität | Hoch |
| Datum |  |
| Tester | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem |  |
| App-Version / Build |  |

## Ziel

Es wird geprüft, ob ein Benutzer den Zugang über einen gültigen Recovery-Code wiederherstellen und ein neues Passwort setzen kann.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Die Datenbank ist erreichbar.
- Ein gültiger Testbenutzer existiert bereits.
- Für den Testbenutzer wurde ein gültiger Recovery-Code erzeugt.
- Der Benutzer ist aktuell nicht eingeloggt.
- Der Tester befindet sich auf der Login-Seite oder Wiederherstellungsseite.

## Testdaten

| Feld | Wert |
|---|---|
| E-Mail | testuser@example.com |
| Recovery-Code | erzogen erdloch krebs muffel hinfort fasching grill neubau atelier anmachen jacht kentern mickrig liege ausufern flapsig erkunden befugnis |
| Neues Passwort | NeuesTest12345! |
| Neues Passwort bestätigen | NeuesTest12345! |

## Schritte

1. Die Login-Seite öffnen.
2. Die Funktion „Passwort vergessen“ oder „Recovery-Code verwenden“ öffnen.
3. Die E-Mail-Adresse des Testbenutzers eingeben.
4. Den gültigen Recovery-Code eingeben.
5. Ein neues Passwort eingeben.
6. Das neue Passwort zur Bestätigung erneut eingeben.
7. Den Reset absenden.
8. Zur Login-Seite wechseln.
9. Mit der E-Mail-Adresse und dem neuen Passwort einloggen.
10. Prüfen, ob der Benutzerbereich angezeigt wird.

## Erwartet

1. Die Login-Seite wird angezeigt.
2. Die Wiederherstellungsseite wird geöffnet.
3. Die E-Mail-Adresse wird akzeptiert.
4. Der Recovery-Code wird akzeptiert.
5. Das neue Passwort erfüllt die Anforderungen.
6. Beide Passwörter stimmen überein.
7. Das Passwort wird erfolgreich geändert und eine Erfolgsmeldung erscheint.
8. Die Login-Seite ist erreichbar.
9. Der Login mit dem neuen Passwort funktioniert.
10. Der Benutzerbereich oder die eingeloggte Startseite wird angezeigt.

## Ergebnis nach Durchführung

| Prüfpunkte | Ergebnis |
|---|---|
| Wiederherstellungsseite erreichbar? | Offen |
| E-Mail-Adresse akzeptiert? | Offen |
| Recovery-Code akzeptiert? | Offen |
| Neues Passwort akzeptiert? | Offen |
| Passwortänderung erfolgreich? | Offen |
| Erfolgsmeldung sichtbar? | Offen |
| Login mit neuem Passwort möglich? | Offen |
| Benutzerbereich sichtbar? | Offen |
| Alter Recovery-Code danach ungültig? | Offen |
| Fehlermeldungen aufgetreten? | Offen |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
- Verwendeter Recovery-Code:
- Hinweis zur Sicherheit: