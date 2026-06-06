# M3 - Markdown-Datei importieren + englische Frage (bilingual)

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Import / Chat                   |
| Arbeitspaket        | AP-T.3 (M3)                     |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob eine **deutschsprachige** Markdown-Datei importiert und
indexiert wird und ob eine **in englischer Sprache** gestellte Frage trotzdem
die passenden Inhalte mit Quellenangabe findet. Dieses Szenario prüft das
**bilinguale Retrieval** (deutsch-englische Volltext-/Vektorsuche).

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Der Benutzer ist eingeloggt.
- Ein Workspace ist angelegt und aktiv.
- Eine Markdown-Test-Datei mit eindeutigem **deutschem** Inhalt liegt bereit
  (z. B. ein kurzer Text über ein abgrenzbares Thema).
- Das Sprachmodell ist geladen (Modell-Pille zeigt „geladen"), damit eine
  natürlichsprachige Antwort statt der Fallback-Synthese erscheint.

## Testdaten

| Feld             | Wert                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| Import-Datei     | `test-bilingual.md` (deutscher Inhalt)                                         |
| Beispiel-Inhalt  | Ein Absatz mit einer klar nachprüfbaren deutschen Aussage                      |
| Testfrage (EN)   | Eine englische Frage, deren Antwort nur in der deutschen `.md` steht           |
| Erwartete Quelle | `test-bilingual.md`                                                            |
| Besonderheit     | Frage-Sprache (EN) ≠ Dokument-Sprache (DE); Antwort muss trotzdem korrekt sein |

## Schritte

1. Den aktiven Workspace öffnen.
2. Den Import starten und die Datei `test-bilingual.md` auswählen.
3. Warten, bis der Import und die Indexierung abgeschlossen sind.
4. In den Chatbereich wechseln.
5. Die Testfrage in **englischer Sprache** in das Eingabefeld schreiben.
6. Die Nachricht absenden.
7. Warten, bis die Antwort vollständig angezeigt wird.
8. Prüfen, ob die Antwort inhaltlich zur (deutschen) Quelle passt.
9. Prüfen, ob mindestens eine Quellenangabe auf `test-bilingual.md` verweist.
10. Auf die Quellenangabe klicken und prüfen, ob die richtige Stelle geöffnet wird.

## Erwartet

1. Der Workspace wird ohne Fehler geöffnet.
2. Die Markdown-Datei wird zum Import akzeptiert.
3. Der Import schließt erfolgreich ab und die Datei erscheint als indexiert.
4. Der Chatbereich ist bedienbar.
5. Die englische Frage wird korrekt im Eingabefeld angezeigt.
6. Die Nachricht wird gesendet und im Verlauf angezeigt.
7. Eine Antwort wird vollständig geladen.
8. Die Antwort ist inhaltlich korrekt, obwohl Frage (EN) und Dokument (DE)
   unterschiedliche Sprachen haben.
9. Mindestens eine Quellenangabe verweist auf `test-bilingual.md`.
10. Die Quelle ist anklickbar und die passende Stelle wird geöffnet/hervorgehoben.

## Ergebnis nach Durchführung

| Prüfpunkte                                      | Ergebnis |
| ----------------------------------------------- | -------- |
| Markdown-Import erfolgreich?                    | Offen    |
| Indexierung abgeschlossen?                      | Offen    |
| Antwort trotz Sprachwechsel inhaltlich korrekt? | Offen    |
| Quelle verweist auf richtige `.md`?             | Offen    |
| Quelle anklickbar / Stelle wird geöffnet?       | Offen    |
| Fehlermeldungen aufgetreten?                    | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
- Verwendete Frage (EN) / Dokument-Stelle (DE):
- Antwortzeit:
