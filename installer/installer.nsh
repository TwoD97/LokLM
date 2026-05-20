; LokLM custom NSIS include — dark theme + combined dir/options page
;
; Hooks into electron-builder's NSIS template via documented !macro names.
; See: https://www.electron.build/configuration/nsis

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ── Color tokens (BGR for SetCtlColors; mirrors src/renderer/src/styles.css) ──
!define LM_BG_0      0x16110E  ; #0e1116 -- page background
!define LM_BG_1      0x221B16  ; #161b22 -- secondary surface
!define LM_BG_2      0x2F261F  ; #1f262f -- input bg
!define LM_FG_0      0xF3EDE6  ; #e6edf3 -- primary text
!define LM_FG_2      0x9E948B  ; #8b949e -- tertiary text
!define LM_ACCENT    0xF6823B  ; #3b82f6 -- accent

; ── Globals for checkbox state ──
Var DesktopShortcutCheckbox
Var StartMenuShortcutCheckbox
Var AutostartCheckbox
Var CreateDesktopShortcut
Var CreateStartMenuShortcut
Var EnableAutostart

; ── Hook: customHeader — runs once at the top of the generated installer.nsi ──
!macro customHeader
  ; Defaults: shortcuts on, autostart off
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"
!macroend

; ── Hook: customInit — runs in .onInit ──
!macro customInit
  ; Placeholder. No special init beyond what electron-builder provides.
!macroend

; ── Hook: customDirectoryPage — extends MUI_PAGE_DIRECTORY with checkboxes ──
;
; electron-builder respects MUI_PAGE_CUSTOMFUNCTION_SHOW/LEAVE if we define
; them before its template inserts the page. The functions below add 3
; checkboxes BELOW the existing directory controls on the same page.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW DirectoryPageShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryPageLeave

Function DirectoryPageShow
  ; Apply dark colors to dialog + child controls
  GetDlgItem $0 $HWNDPARENT 0 ; (no-op, kept for symmetry)

  ; Add the three checkboxes via nsDialogs onto the directory page's dialog.
  ; The page dialog HWND is HWNDPARENT in this context.
  ${NSD_CreateCheckbox} 20u 110u 280u 12u "Create desktop shortcut"
  Pop $DesktopShortcutCheckbox
  SetCtlColors $DesktopShortcutCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_Check} $DesktopShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 20u 124u 280u 12u "Create Start Menu shortcut"
  Pop $StartMenuShortcutCheckbox
  SetCtlColors $StartMenuShortcutCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $CreateStartMenuShortcut == "1"
    ${NSD_Check} $StartMenuShortcutCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 20u 138u 280u 12u "Launch LokLM at Windows startup"
  Pop $AutostartCheckbox
  SetCtlColors $AutostartCheckbox ${LM_FG_0} ${LM_BG_0}
  ${If} $EnableAutostart == "1"
    ${NSD_Check} $AutostartCheckbox
  ${EndIf}
FunctionEnd

Function DirectoryPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}

  ${NSD_GetState} $StartMenuShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateStartMenuShortcut "1"
  ${Else}
    StrCpy $CreateStartMenuShortcut "0"
  ${EndIf}

  ${NSD_GetState} $AutostartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $EnableAutostart "1"
  ${Else}
    StrCpy $EnableAutostart "0"
  ${EndIf}
FunctionEnd

; ── Hook: customInstall — runs inside the install section ──
!macro customInstall
  ; Honor checkbox states (override electron-builder defaults where needed).
  ; electron-builder already creates desktop + start menu shortcuts by default
  ; based on package.json build.nsis.createDesktopShortcut / createStartMenuShortcut.
  ; If user UNCHECKED them in our custom UI, remove what e-b created.

  ${If} $CreateDesktopShortcut == "0"
    Delete "$DESKTOP\LokLM.lnk"
  ${EndIf}

  ${If} $CreateStartMenuShortcut == "0"
    Delete "$SMPROGRAMS\LokLM.lnk"
  ${EndIf}

  ; Autostart: write HKCU Run key only if checked.
  ${If} $EnableAutostart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM" "$INSTDIR\LokLM.exe"
  ${EndIf}
!macroend

; ── Hook: customUnInstall — runs inside the uninstall section ──
!macro customUnInstall
  ; Clean up the autostart key if it exists.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM"
!macroend
