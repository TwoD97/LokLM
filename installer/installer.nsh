; LokLM custom NSIS include — fully custom dark-themed wizard pages
;
; Strategy: replace MUI default pages with nsDialogs custom pages where we
; create every control and SetCtlColors it explicitly to LokLM's dark
; palette. Native Win32 push-buttons and the progress bar remain default
; (no clean owner-draw without third-party plugins); everything else is dark.
;
; Page flow (oneClick=false, allowToChangeInstallationDirectory=false):
;   1. Welcome      (custom nsDialogs) — brand + intro
;   2. License      (custom nsDialogs) — MIT text in dark scrolling panel
;   3. Setup        (custom nsDialogs) — install path + 3 option checkboxes
;   4. InstFiles    (MUI default, brief; native progress bar)
;   5. Finish       (MUI default with our sidebar BMP)

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "FileFunc.nsh"

; ── LokLM color tokens — BGR for SetCtlColors, mirrors styles.css ──
!define LM_BG_0      0x16110E  ; #0e1116 — page background
!define LM_BG_1      0x221B16  ; #161b22 — secondary surface
!define LM_BG_2      0x2F261F  ; #1f262f — input bg
!define LM_FG_0      0xF3EDE6  ; #e6edf3 — primary text
!define LM_FG_1      0xC9BEB6  ; #b6bec9 — secondary text
!define LM_FG_2      0x9E948B  ; #8b949e — tertiary text
!define LM_ACCENT    0xF6823B  ; #3b82f6 — accent blue (BGR of #3b82f6)

!ifndef BUILD_UNINSTALLER
  ; Page state vars
  Var Dialog
  Var PathInput
  Var BrowseButton
  Var OptDesktopCheckbox
  Var OptStartMenuCheckbox
  Var OptAutostartCheckbox
  Var CreateDesktopShortcut
  Var CreateStartMenuShortcut
  Var EnableAutostart

  ; Cached fonts
  Var FontHeading
  Var FontBody
  Var FontMono
!endif

; ════════════════════════════════════════════════════════════════════════════
;  customInit — runs inside .onInit
; ════════════════════════════════════════════════════════════════════════════
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"

  ; Default install path: per-user AppData\Local\LokLM
  StrCpy $INSTDIR "$LOCALAPPDATA\LokLM"

  ; Pre-create fonts (released at .onGUIEnd)
  CreateFont $FontHeading "Segoe UI" 16 700
  CreateFont $FontBody "Segoe UI" 9 400
  CreateFont $FontMono "Consolas" 9 400
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  Page 1 — Welcome
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customWelcomePage
    Page custom WelcomePageCreate
  !macroend

  Function WelcomePageCreate
    ; Hide the MUI header strip on this page (welcome should feel full-bleed).
    ; Control 1037/1038/1039 belong to the parent header; we suppress paint
    ; by recoloring them to match our dark background.
    GetDlgItem $0 $HWNDPARENT 1037
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
      SendMessage $0 ${WM_SETTEXT} 0 "STR:"
    ${EndIf}
    GetDlgItem $0 $HWNDPARENT 1038
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
      SendMessage $0 ${WM_SETTEXT} 0 "STR:"
    ${EndIf}
    GetDlgItem $0 $HWNDPARENT 1039
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
    ${EndIf}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}
    SetCtlColors $Dialog ${LM_FG_0} ${LM_BG_0}

    ; Brand mark (rendered as a colored block — the actual sidebar BMP is on
    ; the Finish page; here we go full-text for cleaner load).
    ${NSD_CreateLabel} 28u 30u 120u 24u "LokLM"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ${NSD_CreateLabel} 28u 56u 280u 12u "Lokaler KI-Wissensassistent"
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Divider
    ${NSD_CreateLabel} 28u 80u 280u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; Body heading
    ${NSD_CreateLabel} 28u 96u 280u 16u "Willkommen"
    Pop $0
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ; Body paragraph
    ${NSD_CreateLabel} 28u 120u 280u 60u "Dieser Assistent installiert LokLM ${VERSION} auf Ihrem Computer.$\r$\n$\r$\nLokLM läuft vollständig lokal — keine Cloud, keine Telemetrie. Ihre Dokumente bleiben auf Ihrem Gerät."
    Pop $0
    SetCtlColors $0 ${LM_FG_1} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Continuation hint
    ${NSD_CreateLabel} 28u 196u 280u 12u "Klicken Sie auf $\"Weiter$\", um fortzufahren."
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    nsDialogs::Show
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 2 — License (MIT)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    Page custom LicensePageCreate LicensePageLeave
  !macroend

  Function LicensePageCreate
    ; Restore the MUI header strip for inner pages
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Lizenzvereinbarung"
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:MIT-Lizenz — bitte vor der Installation prüfen"
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_1}
    GetDlgItem $0 $HWNDPARENT 1039
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}
    SetCtlColors $Dialog ${LM_FG_0} ${LM_BG_0}

    ; Read the LICENSE file into a buffer
    FileOpen $0 "${PROJECT_DIR}\LICENSE" r
    ${If} $0 == ""
      StrCpy $1 "License file not found."
    ${Else}
      StrCpy $1 ""
      ${Do}
        FileRead $0 $2
        ${If} ${Errors}
          ${Break}
        ${EndIf}
        StrCpy $1 "$1$2"
      ${Loop}
      FileClose $0
    ${EndIf}

    ; Multiline read-only edit for the license text
    nsDialogs::CreateControl EDIT \
      "${__NSD_Text_STYLE}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${WS_TABSTOP}" \
      "${__NSD_Text_EXSTYLE}" \
      8u 8u 290u 130u "$1"
    Pop $0
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    SendMessage $0 ${WM_SETFONT} $FontMono 0

    nsDialogs::Show
  FunctionEnd

  Function LicensePageLeave
    ; Accepting by proceeding (no decline option needed for MIT)
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 3 — Setup (install path + options on one screen)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom SetupPageCreate SetupPageLeave
  !macroend

  Function SetupPageCreate
    ; Header
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Installation einrichten"
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Zielordner und Verknüpfungen wählen"
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_1}
    GetDlgItem $0 $HWNDPARENT 1039
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}
    SetCtlColors $Dialog ${LM_FG_0} ${LM_BG_0}

    ; ── Install path section ──
    ${NSD_CreateLabel} 8u 8u 290u 12u "Zielordner"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateText} 8u 24u 230u 14u "$INSTDIR"
    Pop $PathInput
    SetCtlColors $PathInput ${LM_FG_0} ${LM_BG_2}
    SendMessage $PathInput ${WM_SETFONT} $FontMono 0

    ${NSD_CreateButton} 244u 24u 54u 14u "Durchsuchen…"
    Pop $BrowseButton
    ${NSD_OnClick} $BrowseButton OnBrowseClick

    ${NSD_CreateLabel} 8u 42u 290u 10u "LokLM wird in diesem Ordner installiert. Etwa 1,2 GB werden belegt."
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; ── Divider ──
    ${NSD_CreateLabel} 8u 60u 290u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; ── Verknüpfungen section ──
    ${NSD_CreateLabel} 8u 70u 290u 12u "Verknüpfungen"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateCheckbox} 16u 86u 280u 12u "Desktop-Verknüpfung erstellen"
    Pop $OptDesktopCheckbox
    SetCtlColors $OptDesktopCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptDesktopCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateDesktopShortcut == "1"
      ${NSD_Check} $OptDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 16u 100u 280u 12u "Startmenü-Verknüpfung erstellen"
    Pop $OptStartMenuCheckbox
    SetCtlColors $OptStartMenuCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptStartMenuCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateStartMenuShortcut == "1"
      ${NSD_Check} $OptStartMenuCheckbox
    ${EndIf}

    ; ── Divider ──
    ${NSD_CreateLabel} 8u 120u 290u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; ── Autostart section ──
    ${NSD_CreateLabel} 8u 130u 290u 12u "Beim Windows-Start"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateCheckbox} 16u 146u 280u 12u "LokLM mit Windows starten (empfohlen für tägliche Nutzung)"
    Pop $OptAutostartCheckbox
    SetCtlColors $OptAutostartCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptAutostartCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $EnableAutostart == "1"
      ${NSD_Check} $OptAutostartCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function OnBrowseClick
    nsDialogs::SelectFolderDialog "Zielordner auswählen" "$INSTDIR"
    Pop $0
    ${If} $0 != error
      StrCpy $INSTDIR "$0"
      ${NSD_SetText} $PathInput "$INSTDIR"
    ${EndIf}
  FunctionEnd

  Function SetupPageLeave
    ; Persist install path from the text field
    ${NSD_GetText} $PathInput $INSTDIR

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
;  Install / Uninstall hooks
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
