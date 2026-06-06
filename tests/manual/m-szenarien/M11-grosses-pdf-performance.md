# M11 - 100+-Seiten-PDF → Indexierung + Performance dokumentiert

## Test-Info

| Feld                | Wert                            |
| ------------------- | ------------------------------- |
| Status              | Nicht durchgeführt              |
| Ergebnis            | Offen                           |
| Bereich             | Import / Performance            |
| Arbeitspaket        | AP-T.3 (M11)                    |
| Priorität           | Hoch                            |
| Datum               |                                 |
| Tester              | dominik.furlan@lbs4.salzburg.at |
| Betriebssystem      |                                 |
| App-Version / Build |                                 |

## Ziel

Es wird geprüft, ob ein **sehr großes Dokument (PDF mit 100+ Seiten)**
erfolgreich importiert und indexiert wird und ob die Anwendung dabei stabil
und bedienbar bleibt. Die **Performance** (Importdauer, Indexierungsdauer,
erste Antwortzeit) wird dokumentiert.

## Vorbedingung

- Die Anwendung ist installiert und gestartet.
- Der Benutzer ist eingeloggt.
- Ein Workspace ist angelegt und aktiv.
- Ein PDF mit **mindestens 100 Seiten** liegt bereit.
- Die Hardware-Daten des Testgeräts sind notierbar (RAM, CPU, GPU/VRAM),
  da die Performance hardwareabhängig ist.

## Testdaten

| Feld                | Wert                                                           |
| ------------------- | -------------------------------------------------------------- |
| Import-Datei        | `gross.pdf` (≥ 100 Seiten)                                     |
| Seitenzahl          | (tatsächliche Seitenzahl notieren)                             |
| Dateigröße          | (in MB notieren)                                               |
| Chunk-Konfiguration | Standard (Größe 2000 / Überlappung 200), sofern nicht geändert |
| Testfrage           | Eine Frage, deren Antwort im PDF steht                         |
| Hardware-Profil     | (HW-1 / HW-2 / … gemäß Pflichtenheft 8.4)                      |

## Schritte

1. Den aktiven Workspace öffnen.
2. Den Import starten und das große PDF auswählen. **Startzeit notieren.**
3. Beobachten, ob ein Fortschritt (z. B. Seiten-/Chunk-Zähler) angezeigt wird.
4. Warten, bis die Indexierung abgeschlossen ist. **Endzeit notieren.**
5. Während des Imports prüfen, ob die Oberfläche bedienbar/reaktiv bleibt.
6. Nach Abschluss prüfen, ob das Dokument vollständig als indexiert erscheint.
7. Eine Frage stellen, deren Antwort im PDF steht. **Antwortzeit notieren.**
8. Prüfen, ob die Antwort korrekt ist und die Quelle auf das PDF verweist.
9. Speicher-/CPU-Auslastung während Import grob beobachten (optional, Task-Manager).
10. Alle Messwerte unter „Notizen" dokumentieren.

## Erwartet

1. Der Workspace wird ohne Fehler geöffnet.
2. Das große PDF wird zum Import akzeptiert; die Startzeit ist erfasst.
3. Ein Fortschritt ist erkennbar (kein „eingefrorenes" Verhalten ohne Rückmeldung).
4. Die Indexierung schließt erfolgreich ab; die Endzeit ist erfasst.
5. Die Oberfläche bleibt während des Imports bedienbar (oder zeigt klaren Ladezustand).
6. Das Dokument erscheint vollständig indexiert.
7. Eine Frage kann gestellt werden; die Antwortzeit ist erfasst.
8. Die Antwort ist korrekt und verweist als Quelle auf das PDF.
9. Kein Absturz, kein „Out of Memory", keine Datenbeschädigung.
10. Importdauer, Indexierungsdauer und Antwortzeit sind dokumentiert.

## Ergebnis nach Durchführung

| Prüfpunkte                              | Ergebnis |
| --------------------------------------- | -------- |
| Import des 100+-Seiten-PDF erfolgreich? | Offen    |
| Fortschritt sichtbar?                   | Offen    |
| Oberfläche während Import bedienbar?    | Offen    |
| Indexierung vollständig?                | Offen    |
| Antwort korrekt + Quelle = PDF?         | Offen    |
| Kein Absturz / kein Out-of-Memory?      | Offen    |
| Performance dokumentiert?               | Offen    |

## Notizen

- **Performance-Messwerte:**
  - Seitenzahl / Dateigröße:
  - Importdauer (Start → Indexierung fertig):
  - Erste Antwortzeit auf Frage:
  - Hardware (RAM / CPU / GPU+VRAM):
  - Spitzen-RAM-/CPU-Auslastung (grob):
- Auffälligkeiten:
- Screenshots (Fortschritt, fertige Indexierung, Antwort mit Quelle):
- Bekannte Probleme:
