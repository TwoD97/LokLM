# M9 - App schließen + neu starten → Snapshot wird korrekt entschlüsselt

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Persistenz / Verschlüsselung    |
| Arbeitspaket        | AP-T.3 (M9)                     |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob beim Beenden der Anwendung ein **verschlüsselter Snapshot**
(AES-256-GCM) der lokalen Datenbank erzeugt und beim nächsten Start nach dem
Login wieder **korrekt entschlüsselt** wird, sodass alle Daten (Workspaces,
Dokumente, Konversationen) unverändert erhalten bleiben.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Der Benutzer ist eingeloggt.
- Es existieren nachprüfbare Daten: mindestens ein Workspace mit Dokument(en)
  und mindestens eine Konversation mit Nachrichten.
- Das Login-Passwort ist bekannt (es leitet den Snapshot-Schlüssel ab).

## Testdaten

| Feld               | Wert                                                               |
| ------------------ | ------------------------------------------------------------------ |
| Benutzerkonto      | dominik.furlan@lbs4.salzburg.at                                    |
| Passwort           | (Login-Passwort des Testkontos)                                    |
| Nachprüfbare Daten | Name eines Workspaces, ein Dokumenttitel, eine letzte Chat-Antwort |
| Snapshot-Pfad      | `%APPDATA%/LokLM/pgdata/` (entpackter Cluster)                     |

## Schritte

1. Vorhandene Daten notieren: Workspace-Name, ein Dokumenttitel, letzte Chat-Nachricht.
2. Die Anwendung regulär beenden (Fenster schließen / Beenden über Menü).
3. Kurz warten, bis der Prozess vollständig beendet ist.
4. Die Anwendung erneut starten.
5. Am Anmeldebildschirm mit dem korrekten Passwort einloggen.
6. Warten, bis die Oberfläche geladen ist.
7. Die zuvor notierten Daten prüfen (Workspace, Dokument, Konversation).
8. Eine bestehende Konversation öffnen und prüfen, ob der Verlauf vollständig ist.
9. (Negativtest, optional) Erneut beenden, neu starten und mit **falschem**
   Passwort einloggen → generische Anmelde-Fehlermeldung erwartet.

## Erwartet

1. Die Daten sind vor dem Beenden vorhanden und notierbar.
2. Die Anwendung beendet sich ohne Fehler.
3. Der Prozess ist vollständig beendet.
4. Die Anwendung startet erneut bis zum Anmeldebildschirm.
5. Der Login mit korrektem Passwort gelingt.
6. Die Oberfläche lädt ohne Fehlermeldung.
7. Alle zuvor notierten Daten sind unverändert vorhanden (Snapshot korrekt entschlüsselt).
8. Der Konversationsverlauf ist vollständig erhalten.
9. (Negativtest) Bei falschem Passwort schlägt die Entschlüsselung fehl und es
   erscheint eine **generische** Anmelde-Fehlermeldung (kein Datenverlust, kein Aufschluss über die Ursache).

## Ergebnis nach Durchführung

| Prüfpunkte                                           | Ergebnis |
| ---------------------------------------------------- | -------- |
| App beendet sich sauber?                             | Offen    |
| Neustart bis Anmeldebildschirm?                      | Offen    |
| Login mit korrektem Passwort erfolgreich?            | Offen    |
| Workspaces/Dokumente erhalten?                       | Offen    |
| Konversationsverlauf vollständig?                    | Offen    |
| Negativtest: falsches Passwort → generische Meldung? | Offen    |
| Fehlermeldungen aufgetreten?                         | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots (Daten vorher / nach Neustart):
- Bekannte Probleme:
- Notierte Daten (Workspace / Dokument / letzte Nachricht):
- Startzeit nach Neustart (Entschlüsselung + Laden):
