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

  ; Holds the EnumChildWindows callback pointer once initialized.
  Var DarkenCallbackPtr
!endif

; ════════════════════════════════════════════════════════════════════════════
;  customInit — runs inside the installer's .onInit
; ════════════════════════════════════════════════════════════════════════════
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"

  ; Allocate the EnumChildWindows callback once. NSIS's System plugin builds a
  ; native function pointer that wraps our DarkenChildProc NSIS function.
  GetFunctionAddress $0 DarkenChildProc
  System::Call "User32::EnumChildWindows(p, p, p) i"
  System::Get '(p .R0, p .R1) i.r2'
  Pop $DarkenCallbackPtr
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  Page 1 — Welcome (uses installerSidebar BMP automatically)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !define MUI_WELCOMEPAGE_TITLE "Willkommen zum LokLM Setup"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert LokLM ${VERSION} auf Ihrem Computer.$\r$\n$\r$\nLokLM ist Ihr lokaler KI-Wissensassistent mit Quellenverifikation — keine Cloud, keine Telemetrie.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."

  !macro customWelcomePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomePageShow
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  Function WelcomePageShow
    Call ApplyDarkTheme
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 2 — License (reads from repo-root LICENSE)
;
;  After MUI_PAGE_LICENSE auto-undefs MUI_PAGE_CUSTOMFUNCTION_SHOW, we
;  re-define it pointing at DirectoryPageShow so the next page in e-b's
;  template (MUI_PAGE_DIRECTORY) picks up our directory-page SHOW callback.
;  Doing the define here (not top-level) avoids a "macro already defined"
;  collision with customWelcomePage which runs earlier.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW LicensePageShow
    !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW DirectoryPageShow
  !macroend

  Function LicensePageShow
    Call ApplyDarkTheme
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 3 — Install directory (stock MUI_PAGE_DIRECTORY, darkened via SHOW)
;
;  The MUI_PAGE_CUSTOMFUNCTION_SHOW define is set at the tail of licensePage
;  (above) so it activates just before e-b inserts MUI_PAGE_DIRECTORY.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  Function DirectoryPageShow
    Call ApplyDarkTheme
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 4 — Options (separate page after directory: shortcuts + autostart)
;
;  electron-builder inserts this whenever we define customPageAfterChangeDir.
;  Building it ourselves gives full control over coordinates and theming.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom OptionsPageCreate OptionsPageLeave
  !macroend

  Function OptionsPageCreate
    ; Set the MUI page header text directly (MUI_HEADER_TEXT macro isn't
    ; available here because electron-builder includes us before MUI2.nsh).
    ; Control IDs 1037/1038 are the MUI header title/subtitle labels.
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Optionen"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Verknüpfungen und Startverhalten konfigurieren"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ; Section header
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

    ; Spacer + second section
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

    Call ApplyDarkTheme
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
;  Dark-theming helper: enumerates child windows of the current page dialog
;  and applies LokLM colors based on each control's class.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  Function ApplyDarkTheme
    ; Inner page dialog = first "#32770" child of $HWNDPARENT
    FindWindow $0 "#32770" "" $HWNDPARENT
    ${If} $0 == 0
      Return
    ${EndIf}

    ; Repaint the dialog itself with our dark background.
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}

    ; Walk every descendant and apply per-class colors.
    System::Call "User32::EnumChildWindows(p r0, p $DarkenCallbackPtr, p 0)"

    ; Force a repaint so the new colors take effect immediately.
    System::Call "User32::InvalidateRect(p r0, p 0, i 1)"
    System::Call "User32::UpdateWindow(p r0)"
  FunctionEnd

  Function DarkenChildProc
    ; Stack: hwnd lParam   →   returns 1 to continue enumeration
    Pop $0  ; lParam (unused)
    Pop $1  ; hwnd

    ; Get class name (max 32 chars; enough for "Button", "Edit", "Static", etc.)
    System::Call "User32::GetClassNameW(p r1, w .r2, i 32) i"

    ${If} $2 == "Static"
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_0}
    ${ElseIf} $2 == "Button"
      ; Native push-buttons can't be cleanly recolored (owner-drawn paint).
      ; Checkboxes and radios still pick up colors though.
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_0}
    ${ElseIf} $2 == "Edit"
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_2}
    ${ElseIf} $2 == "RichEdit20W"
      ; License text panel
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_1}
    ${ElseIf} $2 == "RICHEDIT50W"
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_1}
    ${ElseIf} $2 == "SysListView32"
      SetCtlColors $1 ${LM_FG_0} ${LM_BG_1}
    ${EndIf}

    ; Continue enumeration
    Push 1
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
