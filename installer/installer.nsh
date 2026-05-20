; LokLM minimal NSIS include — Installer-Chrome ist auf das Nötigste reduziert.
;
; Architektur-Entscheidung (Migrationsplan vom 2026-05-20):
; Polish lebt im <FirstRunWizard /> React-Component innerhalb der App, nicht
; in NSIS. Dieser Installer macht ausschließlich was NSIS gut kann:
;   - Files extrahieren (electron-builder Default)
;   - Desktop-/Start-Menü-Shortcuts (electron-builder Config)
;   - Uninstaller-Registry-Eintrag (electron-builder Default)
;
; Custom-Hooks die wir behalten:
;   - customInstall   — räumt Shortcuts auf, falls in First-Run-Wizard abgewählt
;   - customUnInstall — räumt Autostart-Eintrag auf den der Wizard ggf. setzt
;
; Alle vorher hier definierten Wizard-Pages (Welcome, License, Setup) sind
; in den FirstRunWizard gewandert — siehe src/renderer/src/firstrun/.

!include "LogicLib.nsh"

; ════════════════════════════════════════════════════════════════════════════
;  customInstall — räumt Shortcuts auf, falls First-Run sie deaktiviert hat
;
;  electron-builder erstellt Desktop + Start-Menü-Shortcuts standardmäßig
;  (per build.nsis.createDesktopShortcut / createStartMenuShortcut).
;  Der First-Run-Wizard schreibt $CreateDesktopShortcut / $CreateStartMenuShortcut
;  als Registry-Werte; wir lesen die hier zurück und löschen ggf. wieder.
;
;  TODO Denys: Falls First-Run-Wizard die Toggles vor dem ersten Hook-Run
;  setzt, dann sind diese Vars beim ersten Install noch leer und nichts
;  passiert hier — Default-Verhalten von electron-builder gilt. Beim zweiten
;  Install (Update) werden die Toggles korrekt ausgewertet.
; ════════════════════════════════════════════════════════════════════════════
!macro customInstall
  ReadRegStr $0 HKCU "Software\LokLM\Setup" "DesktopShortcut"
  ${If} $0 == "0"
    Delete "$DESKTOP\LokLM.lnk"
  ${EndIf}

  ReadRegStr $0 HKCU "Software\LokLM\Setup" "StartMenuShortcut"
  ${If} $0 == "0"
    Delete "$SMPROGRAMS\LokLM.lnk"
  ${EndIf}
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  customUnInstall — räumt Autostart + Setup-Settings auf
; ════════════════════════════════════════════════════════════════════════════
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM"
  DeleteRegKey HKCU "Software\LokLM\Setup"
!macroend
