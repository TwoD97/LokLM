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

## Automatisierte Tests

Zusätzlich zu den manuellen Tests gibt es automatisierte Tests direkt bei den
jeweiligen Modulen. Sie werden nicht als manuelle Schritt-für-Schritt-Szenarien
in diesem Ordner gepflegt, sondern mit Vitest ausgeführt:

```powershell
pnpm test
```

| Bereich     | Datei                                                    | Zweck                                                                                                                         |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Auth/Tresor | `src/main/services/auth/AuthService.integration.test.ts` | Prüft Registrierung, Sperren, Persistenz und erneutes Entsperren des lokalen Tresors.                                         |
| React-UI    | `src/renderer/src/App.smoke.test.tsx`                    | Prüft grundlegende UI-Zustände, z. B. Registrierungsansicht und Aktivierung des Registrierungsbuttons nach gültigen Eingaben. |
