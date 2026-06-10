# M10 - Modell-Datei umbenennen → Fallback-Synthese

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Robustheit / Modell             |
| Arbeitspaket        | AP-T.3 (M10)                    |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob die Anwendung beim **Fehlen der Modell-Datei** (simuliert
durch Umbenennen der GGUF-Datei im Modell-Ordner) nicht abstürzt, sondern
sauber in die **deterministische Fallback-Synthese** wechselt: Die Modell-Pille
zeigt „nicht geladen", und auf eine Frage werden die Top-Chunks mit ihren
`[doc:X, chunk:Y]`-Markern formatiert ausgegeben (ohne natürliche Sprachgenerierung).

## Vorbedingung

- Die Anwendung ist **beendet** (Modell-Datei darf nicht in Benutzung sein).
- Ein Workspace mit mindestens einem indexierten Dokument existiert (damit
  Retrieval Treffer liefern kann).
- Der Modell-Ordner `%APPDATA%/LokLM/models/` (userData/models/) ist bekannt
  und enthält die LLM-GGUF-Datei.
- Der ursprüngliche Dateiname der Modell-Datei ist notiert (zum Zurückbenennen).

## Testdaten

| Feld               | Wert                                                    |
| ------------------ | ------------------------------------------------------- |
| Modell-Ordner      | `%APPDATA%/LokLM/models/`                               |
| Original-Dateiname | `<llm-modell>.gguf`                                     |
| Umbenannt zu       | `<llm-modell>.gguf.bak`                                 |
| Testfrage          | Eine Frage, deren Antwort im indexierten Dokument steht |

## Schritte

1. Die Anwendung beenden (falls geöffnet).
2. Den Modell-Ordner `%APPDATA%/LokLM/models/` öffnen.
3. Die LLM-GGUF-Datei umbenennen (z. B. Endung `.bak` anhängen). Original-Namen notieren.
4. Die Anwendung starten und einloggen.
5. Die Modell-Pille / den Modell-Status prüfen.
6. In den Einstellungen prüfen, ob ein Hinweis auf den erwarteten Modell-Pfad erscheint.
7. Eine Frage stellen, deren Antwort im indexierten Dokument enthalten ist.
8. Die Antwort prüfen: enthält sie die Top-Chunks mit `[doc:X, chunk:Y]`-Markern?
9. Sicherstellen, dass die Anwendung **nicht abstürzt** und bedienbar bleibt.
10. **Aufräumen:** Anwendung beenden, Modell-Datei auf den Originalnamen zurückbenennen,
    Anwendung erneut starten und prüfen, dass das Modell wieder „geladen" anzeigt.

## Erwartet

1. Die Anwendung ist beendet, die Datei ist nicht gesperrt.
2. Der Modell-Ordner ist erreichbar.
3. Die Modell-Datei wird erfolgreich umbenannt.
4. Die Anwendung startet trotz fehlender Modell-Datei normal und Login gelingt.
5. Die Modell-Pille zeigt „nicht geladen".
6. In den Einstellungen erscheint ein Hinweis, wo die Modell-Datei abgelegt werden muss.
7. Die Frage kann abgesendet werden.
8. Die Antwort ist die deterministische Fallback-Synthese (Top-Chunks mit `[doc:X, chunk:Y]`-Markern), keine natürlichsprachige Generierung.
9. Die Anwendung bleibt stabil und bedienbar (kein Absturz).
10. Nach Zurückbenennen und Neustart zeigt das Modell wieder „geladen" und der Chat antwortet wieder natürlichsprachig.

## Ergebnis nach Durchführung

| Prüfpunkte                                        | Ergebnis |
| ------------------------------------------------- | -------- |
| App startet trotz fehlender Modell-Datei?         | Offen    |
| Modell-Pille zeigt „nicht geladen"?               | Offen    |
| Hinweis auf Modell-Pfad in Einstellungen?         | Offen    |
| Fallback-Synthese mit `[doc:X, chunk:Y]`-Markern? | Offen    |
| Kein Absturz / App bedienbar?                     | Offen    |
| Nach Zurückbenennen wieder „geladen"?             | Offen    |
| Fehlermeldungen aufgetreten?                      | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots (Modell-Pille, Fallback-Antwort, Einstellungs-Hinweis):
- Bekannte Probleme:
- Original-Dateiname (zum Zurückbenennen):
- Wichtig: Nach dem Test Modell-Datei wieder korrekt benennen!
