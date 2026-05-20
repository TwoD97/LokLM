; LokLM custom NSIS include — dark theme + branded wizard pages
;
; Hooks into electron-builder's NSIS template via documented !macro names.
; See: https://www.electron.build/configuration/nsis

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ── Color tokens (BGR for SetCtlColors; mirrors src/renderer/src/styles.css) ──
!define LM_BG_0      0x16110E  ; #0e1116 -- page background
!define LM_BG_1      0x221B16  ; #161b22 -- secondary surface
!define LM_BG_2      0x2F261F  ; #1f262f -- input bg
!define LM_FG_0      0xF3EDE6  ; #e6edf3 -- primary text
!define LM_FG_1      0xC9BEB6  ; #b6bec9 -- secondary text
!define LM_FG_2      0x9E948B  ; #8b949e -- tertiary text
!define LM_ACCENT    0xF6823B  ; #3b82f6 -- accent blue

; ── Installer-only globals (uninstaller pass would warn 6001 on unused vars) ──
!ifndef BUILD_UNINSTALLER
  Var OptDesktopCheckbox
  Var OptStartMenuCheckbox
  Var OptAutostartCheckbox
  Var CreateDesktopShortcut
  Var CreateStartMenuShortcut
  Var EnableAutostart
!endif

; ════════════════════════════════════════════════════════════════════════════
;  customInit — runs inside the installer's .onInit
;  Only safe NSIS commands here; no System::Call experiments.
; ════════════════════════════════════════════════════════════════════════════
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  ApplyHeaderColors — dark the MUI header strip on the current page
;
;  MUI page header controls have well-known IDs:
;    1037 = title label
;    1038 = subtitle label
;    1039 = background panel under header
;    1256 = icon area background
;  SetCtlColors on those gives us a dark header on every inner page.
;  Page body (text fields, labels, buttons) keeps native Windows colors —
;  trying to recolor every child control across all MUI pages requires
;  EnumChildWindows + a callback proxy, which is fragile in NSIS. We accept
;  the limit and lean on the dark header + branded bitmaps for "vibe".
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  Function ApplyHeaderColors
    ; Header background panel
    GetDlgItem $0 $HWNDPARENT 1039
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    ${EndIf}

    ; Header title (top)
    GetDlgItem $0 $HWNDPARENT 1037
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    ${EndIf}

    ; Header subtitle (smaller)
    GetDlgItem $0 $HWNDPARENT 1038
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_2} ${LM_BG_1}
    ${EndIf}

    ; Force a repaint of the header area
    System::Call "User32::InvalidateRect(p $HWNDPARENT, p 0, i 1)"
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 1 — Welcome (uses installerSidebar BMP automatically)
;
;  The welcome page has its own layout (no header strip) — the sidebar BMP
;  fills the left panel automatically because we set
;  MUI_WELCOMEFINISHPAGE_BITMAP via package.json installerSidebar config.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !define MUI_WELCOMEPAGE_TITLE "Willkommen zum LokLM Setup"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert LokLM ${VERSION} auf Ihrem Computer.$\r$\n$\r$\nLokLM ist Ihr lokaler KI-Wissensassistent mit Quellenverifikation — keine Cloud, keine Telemetrie.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."

  !macro customWelcomePage
    !insertmacro MUI_PAGE_WELCOME
  !macroend
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 2 — License (reads from repo-root LICENSE)
;
;  After MUI_PAGE_LICENSE consumes MUI_PAGE_CUSTOMFUNCTION_SHOW (set inside
;  the macro), we re-define it for the next page (MUI_PAGE_DIRECTORY).
;  Doing the directory-page define HERE (not top-level) avoids a "macro
;  already defined" collision with customWelcomePage which runs earlier.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW LicensePageShow
    !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DirectoryPageShow
  !macroend

  Function LicensePageShow
    Call ApplyHeaderColors
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 3 — Install directory (stock MUI_PAGE_DIRECTORY, header darkened)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  Function DirectoryPageShow
    Call ApplyHeaderColors
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 4 — Options (separate page after directory: shortcuts + autostart)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom OptionsPageCreate OptionsPageLeave
  !macroend

  Function OptionsPageCreate
    ; Inline equivalent of MUI_HEADER_TEXT (MUI macro isn't available here).
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Optionen"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Verknüpfungen und Startverhalten konfigurieren"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ; Section header — Verknüpfungen
    ${NSD_CreateLabel} 0 0 100% 12u "Verknüpfungen"
    Pop $1
    SetCtlColors $1 ${LM_ACCENT} transparent

    ${NSD_CreateCheckbox} 8u 16u 280u 12u "Desktop-Verknüpfung erstellen"
    Pop $OptDesktopCheckbox
    ${If} $CreateDesktopShortcut == "1"
      ${NSD_Check} $OptDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 8u 32u 280u 12u "Startmenü-Verknüpfung erstellen"
    Pop $OptStartMenuCheckbox
    ${If} $CreateStartMenuShortcut == "1"
      ${NSD_Check} $OptStartMenuCheckbox
    ${EndIf}

    ; Spacer + second section — Autostart
    ${NSD_CreateLabel} 0 56u 100% 12u "Beim Windows-Start"
    Pop $1
    SetCtlColors $1 ${LM_ACCENT} transparent

    ${NSD_CreateCheckbox} 8u 72u 280u 12u "LokLM mit Windows starten"
    Pop $OptAutostartCheckbox
    ${If} $EnableAutostart == "1"
      ${NSD_Check} $OptAutostartCheckbox
    ${EndIf}

    ${NSD_CreateLabel} 8u 88u 280u 24u "Empfohlen für Power-User. Sie können dies jederzeit in den App-Einstellungen ändern."
    Pop $1
    SetCtlColors $1 ${LM_FG_2} transparent

    Call ApplyHeaderColors
    nsDialogs::Show
  FunctionEnd

  Function OptionsPageLeave
    ${NSD_GetState} $OptDesktopCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $CreateDesktopShortcut "1"
    ${Else}
      StrCpy $CreateDesktopShortcut "0"
    ${EndIf}

    ${NSD_GetState} $OptStartMenuCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $CreateStartMenuShortcut "1"
    ${Else}
      StrCpy $CreateStartMenuShortcut "0"
    ${EndIf}

    ${NSD_GetState} $OptAutostartCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $EnableAutostart "1"
    ${Else}
      StrCpy $EnableAutostart "0"
    ${EndIf}
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  customInstall — honor checkbox state from the options page
; ════════════════════════════════════════════════════════════════════════════
!macro customInstall
  ${If} $CreateDesktopShortcut == "0"
    Delete "$DESKTOP\LokLM.lnk"
  ${EndIf}

  ${If} $CreateStartMenuShortcut == "0"
    Delete "$SMPROGRAMS\LokLM.lnk"
  ${EndIf}

  ${If} $EnableAutostart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM" "$INSTDIR\LokLM.exe"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM"
!macroend
