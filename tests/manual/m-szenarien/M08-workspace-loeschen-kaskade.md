# M8 - Workspace löschen → kaskadierendes Löschen aller zugehörigen Daten

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Workspace / Datenbank           |
| Arbeitspaket        | AP-T.3 (M8)                     |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob beim Löschen eines Workspaces **alle zugehörigen Daten
kaskadierend** entfernt werden: Dokumente, Chunks, Konversationen und
Nachrichten (`ON DELETE CASCADE`) sowie die zugehörigen Dateien aus dem
lokalen Dateispeicher (`%APPDATA%/LokLM/files/`).

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Der Benutzer ist eingeloggt.
- Es existiert ein **Test-Workspace**, der gefahrlos gelöscht werden darf.
- In diesem Workspace ist mindestens ein Dokument importiert (→ Chunks vorhanden).
- In diesem Workspace existiert mindestens eine Konversation mit Nachrichten.
- Es existiert mindestens ein **zweiter** Workspace, der erhalten bleiben soll
  (zur Kontrolle, dass nur der gelöschte Workspace betroffen ist).

## Testdaten

| Feld               | Wert                                             |
| ------------------ | ------------------------------------------------ |
| Zu löschender WS   | `Test-Workspace-Löschen`                         |
| Inhalt im WS       | ≥ 1 Dokument, ≥ 1 Konversation mit Nachrichten   |
| Kontroll-Workspace | `Behalten-Workspace` (darf nicht betroffen sein) |
| Dateispeicher-Pfad | `%APPDATA%/LokLM/files/`                         |

## Schritte

1. Den zu löschenden Test-Workspace auswählen.
2. Inhalt notieren: Anzahl Dokumente, vorhandene Konversation(en), importierte Datei(en).
3. Optional: den Ordner `%APPDATA%/LokLM/files/` öffnen und die zugehörigen Dateien notieren.
4. Die Löschen-Funktion für den Workspace aufrufen.
5. Die Sicherheitsabfrage bestätigen.
6. Warten, bis der Löschvorgang abgeschlossen ist.
7. Die Workspace-Liste prüfen.
8. In den Kontroll-Workspace wechseln und dessen Inhalt prüfen.
9. Den Ordner `%APPDATA%/LokLM/files/` erneut prüfen.

## Erwartet

1. Der Test-Workspace lässt sich auswählen.
2. Inhalt ist vor dem Löschen sichtbar/zählbar.
3. Die zugehörigen Dateien existieren vor dem Löschen im Dateispeicher.
4. Eine Sicherheitsabfrage erscheint vor dem endgültigen Löschen.
5. Nach Bestätigung läuft der Löschvorgang ohne Fehler.
6. Der gelöschte Workspace verschwindet aus der Workspace-Liste.
7. Dokumente, Chunks, Konversationen und Nachrichten des Workspaces sind entfernt.
8. Der Kontroll-Workspace und seine Daten bleiben **unverändert** erhalten.
9. Die zum gelöschten Workspace gehörenden Dateien sind aus `%APPDATA%/LokLM/files/` entfernt.

## Ergebnis nach Durchführung

| Prüfpunkte                               | Ergebnis |
| ---------------------------------------- | -------- |
| Sicherheitsabfrage erschienen?           | Offen    |
| Workspace aus Liste entfernt?            | Offen    |
| Dokumente/Chunks entfernt?               | Offen    |
| Konversationen/Nachrichten entfernt?     | Offen    |
| Dateien aus `files/` entfernt?           | Offen    |
| Kontroll-Workspace unverändert erhalten? | Offen    |
| Fehlermeldungen aufgetreten?             | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots (vorher/nachher Workspace-Liste + `files/`-Ordner):
- Bekannte Probleme:
- Inhalt vor dem Löschen (Anzahl Dokumente/Konversationen/Dateien):
