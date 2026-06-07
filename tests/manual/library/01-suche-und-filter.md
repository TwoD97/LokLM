# 01 - Suche und Filter (Library)

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Library / Suche                 |
| Arbeitspaket        | AP-6                            |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob die Library-Suche (AP-6, Pflichtenheft §3.5) zu einer Eingabe eine
Trefferliste mit Dokumentname, Seitenzahl/Heading und gehighlightetem Auszug liefert, ob
die Filter (Typ/Datum/Größe) und die Sortierung (Relevanz/Dateiname/Importdatum) wirken,
und ob ein Klick auf einen Treffer die Quelle im SourceViewer (AP-8) an der richtigen
Stelle öffnet.

Dieses manuelle Szenario deckt den End-to-End-Durchstich ab, weil die Playwright-E2E-Harness
projektweit defekt ist (Electron 42 lehnt das von Playwright injizierte
`--remote-debugging-port=0` ab — eigenes Infra-Ticket, siehe Spec §7). Die Logik selbst ist
durch tx-, Integrations- und Komponententests automatisiert abgedeckt.

## Vorbedingung

- Die Anwendung ist gebaut und gestartet, der Benutzer ist eingeloggt (Vault entsperrt).
- Ein Workspace ist aktiv und enthält einen Test-Korpus aus M2/M3, mindestens:
  - eine **PDF**-Datei mit Seitenzahlen,
  - eine **Markdown**-Datei mit Überschriften,
  - optional eine **Text-**, **Code-** und **DOCX**-Datei (für den Typ-Filter).
- Die Dokumente sind vollständig indexiert (Status „ready").

## Testdaten

| Feld                  | Wert                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| Suchbegriff (Treffer) | ein Wort, das in mehreren Dokumenten vorkommt (z. B. „Datenschutz")     |
| Suchbegriff (DE)      | ein deutsches Wort aus der Markdown-Datei                               |
| Erwarteter Treffer    | mindestens ein Dokument mit hervorgehobenem Begriff im Auszug           |
| Besonderheit          | PDF-Treffer zeigt Seitenzahl, Markdown-Treffer zeigt Heading-Breadcrumb |

## Schritte

1. Die Library-Route öffnen.
2. In das Suchfeld einen Begriff eingeben, der in mehreren Dokumenten vorkommt.
3. Die Trefferliste beobachten (erscheint automatisch, debounced beim Tippen).
4. Prüfen, ob jeder Treffer Dokumentname, Ort (Seitenzahl bei PDF / Heading bei Markdown)
   und einen Auszug zeigt, in dem der Suchbegriff **hervorgehoben** (`<mark>`) ist.
5. Den Typ-Filter „PDF" aktivieren und prüfen, dass nur noch PDF-Treffer erscheinen;
   danach „Markdown" zusätzlich/stattdessen testen.
6. Den Datum-Filter (z. B. „Letzte 30 Tage") und den Größe-Filter (z. B. „< 1 MB") testen.
7. Die Sortierung auf „Dateiname" und dann „Importdatum" umstellen und die Reihenfolge prüfen.
8. Auf einen Treffer klicken.
9. Prüfen, ob der SourceViewer das richtige Dokument an der passenden Stelle (Seite/Chunk) öffnet.
10. Den SourceViewer schließen (Esc) und das Suchfeld leeren.
11. Prüfen, ob ohne Suchbegriff wieder die normale Dokumentliste (Browse-Ansicht) erscheint.

## Erwartet

1. Die Library wird ohne Fehlermeldung geöffnet.
2. Die Eingabe erscheint korrekt im Suchfeld.
3. Eine Trefferliste wird angezeigt (oder ein „keine Treffer"-Hinweis bei leerer Menge).
4. Jeder Treffer zeigt Name, Ort und einen Auszug mit hervorgehobenem Suchbegriff.
5. Der Typ-Filter schränkt die Treffer korrekt auf die gewählten Dokumenttypen ein.
6. Datum- und Größe-Filter schränken die Treffer plausibel ein.
7. Die Sortierung ordnet die Treffer nach Dateiname (alphabetisch) bzw. Importdatum (neueste zuerst).
8. Der Klick ist möglich.
9. Der SourceViewer öffnet das richtige Dokument an der passenden Stelle.
10. Der SourceViewer schließt sich sauber.
11. Ohne Suchbegriff erscheint wieder die normale Dokumentliste.

## Ergebnis nach Durchführung

| Prüfpunkte                                     | Ergebnis |
| ---------------------------------------------- | -------- |
| Library erreichbar?                            | Offen    |
| Trefferliste erscheint beim Tippen?            | Offen    |
| Name + Ort (Seite/Heading) sichtbar?           | Offen    |
| Suchbegriff im Auszug hervorgehoben?           | Offen    |
| Typ-Filter wirkt?                              | Offen    |
| Datum-Filter wirkt?                            | Offen    |
| Größe-Filter wirkt?                            | Offen    |
| Sortierung Dateiname korrekt?                  | Offen    |
| Sortierung Importdatum korrekt?                | Offen    |
| Klick öffnet SourceViewer an richtiger Stelle? | Offen    |
| Leeres Suchfeld → Browse-Ansicht zurück?       | Offen    |
| Fehlermeldungen aufgetreten?                   | Offen    |

## Notizen

- Auffälligkeiten:
- Screenshots:
- Bekannte Probleme:
- Getestete Dokumente (Typen):
- Reaktionszeit der Suche:
