# Manuelle Testszenarien

Dieser Ordner enthält die manuellen Testszenarien, die im
[Pflichtenheft](../../Pflichtenheft_LokLM.md) §8.3 (Manuelle Test-Szenarien)
beschrieben sind.

Automatisierte Unit- und Integrationstests liegen direkt bei den jeweiligen
Quellcode-Modulen als `*.test.ts` oder `*.test.tsx` Dateien
(gemäß Konvention aus Anhang A).

Dieser Ordner ist ausschließlich für Testanleitungen gedacht, die ein Mensch
Schritt für Schritt an einer gebauten/lauffähigen Version des Programms ausführt.

Typische Beispiele sind:

- erste Registrierung eines neuen Benutzers
- Login und Logout
- Zurücksetzen über Recovery-Code
- Chat-Nachricht senden und Antwort prüfen
- Quellen/Zitate anklicken und prüfen
- Smoke-Test auf unterschiedlicher Hardware

## Format

Für jedes Testszenario wird eine eigene Markdown-Datei angelegt.

Dateiname:

`<NN>-<kurzer-name>.md`
