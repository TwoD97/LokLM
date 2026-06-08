# M-Szenarien (Pflichtenheft §8.3)

Dieser Ordner enthält die manuellen Test-Szenarien aus der M-Liste des
[Pflichtenhefts §8.3](../../../docs/Pflichtenheft.md) (Manuelle Test-Szenarien),
jeweils als eigene Markdown-Datei nach dem gemeinsamen Format der bestehenden
Szenarien (siehe [../README.md](../README.md)).

## Trennung Anlegen ↔ Ausführen

- **Anlegen der Szenario-Gerüste** (AP-T.3b): in diesem Ordner erledigt.
  Die Dateien dürfen bewusst `Status: Nicht durchgeführt` / `Ergebnis: Offen`
  tragen — sie sind die Anleitung, nicht das Protokoll.
- **Ausführen + Protokollieren** (AP-T.3, Sprint 7): Die Tests werden an einer
  gebauten Version durchgeführt; dabei werden Status, Datum, Tester, Build,
  Betriebssystem und die Prüfpunkt-Tabelle in der jeweiligen Datei ausgefüllt.

## Übersicht der Szenarien

| Nr. | Szenario                                                   | Datei                                                                                  | Status             |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| M3  | Markdown importieren, Frage auf Englisch (bilingual)       | [M03-markdown-import-englische-frage.md](M03-markdown-import-englische-frage.md)       | Nicht durchgeführt |
| M4  | Quellcode-Datei importieren, technische Frage zur Codebase | [M04-quellcode-import-technische-frage.md](M04-quellcode-import-technische-frage.md)   | Nicht durchgeführt |
| M8  | Workspace löschen → kaskadierendes Löschen aller Daten     | [M08-workspace-loeschen-kaskade.md](M08-workspace-loeschen-kaskade.md)                 | Nicht durchgeführt |
| M9  | App neu starten → Snapshot korrekt entschlüsselt           | [M09-neustart-snapshot-entschluesselung.md](M09-neustart-snapshot-entschluesselung.md) | Nicht durchgeführt |
| M10 | Modell-Datei umbenennen → Fallback-Synthese                | [M10-modell-umbenennen-fallback.md](M10-modell-umbenennen-fallback.md)                 | Nicht durchgeführt |
| M11 | 100+-Seiten-PDF → Indexierung + Performance                | [M11-grosses-pdf-performance.md](M11-grosses-pdf-performance.md)                       | Nicht durchgeführt |

> Hinweis: Die vollständige M1–M11-Liste steht im Pflichtenheft §8.3. Die hier
> nicht aufgeführten Szenarien (M1, M2, M5, M6, M7) sind in den themenbezogenen
> Ordnern (`auth/`, `chat/` …) abgedeckt bzw. dort verortet.

## Status-Werte

`Nicht durchgeführt` → `Bestanden` / `Fehlgeschlagen` (bei Ausführung in Sprint 7
in dieser Tabelle **und** in der jeweiligen Szenario-Datei nachziehen).
