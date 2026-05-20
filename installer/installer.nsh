; LokLM custom NSIS include — v5: no dark theme, clean default Windows wizard
;
; Per user request: drop all background painting. Use system-default colors
; throughout. Keep:
;   - modular text (all strings as !define at the top, editable in one place)
;   - clean layout (welcome heading, sections, hints)
;   - branded bitmaps (sidebar on Finish, header on inner pages — via package.json)
;
; Page flow:
;   1. Welcome   — clean default page with brand heading + intro
;   2. License   — MUI_PAGE_LICENSE (system default rendering)
;   3. Setup     — checkboxes for shortcuts + autostart
;   4. InstFiles — MUI default
;   5. Finish    — MUI default with sidebar BMP

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ════════════════════════════════════════════════════════════════════════════
;  USER-FACING STRINGS — edit these in one place
; ════════════════════════════════════════════════════════════════════════════
!define LM_BRAND_NAME       "LokLM"
!define LM_TAGLINE          "Lokaler KI-Wissensassistent"

!define LM_PAGE1_HEADING    "Willkommen"
!define LM_PAGE1_BODY       "Dieser Assistent installiert LokLM ${VERSION} auf Ihrem Computer.$\r$\n$\r$\nLokLM läuft vollständig lokal — keine Cloud, keine Telemetrie. Ihre Dokumente bleiben auf Ihrem Gerät."
!define LM_PAGE1_HINT       "Klicken Sie auf $\"Weiter$\", um fortzufahren."

!define LM_PAGE2_TITLE      "Lizenzvereinbarung"
!define LM_PAGE2_SUBTITLE   "MIT-Lizenz — bitte vor der Installation prüfen"

!define LM_PAGE3_TITLE      "Optionen"
!define LM_PAGE3_SUBTITLE   "Verknüpfungen und Startverhalten konfigurieren"
!define LM_PAGE3_SECTION1   "Verknüpfungen"
!define LM_PAGE3_OPT1       "Desktop-Verknüpfung erstellen"
!define LM_PAGE3_OPT2       "Startmenü-Verknüpfung erstellen"
!define LM_PAGE3_SECTION2   "Beim Windows-Start"
!define LM_PAGE3_OPT3       "LokLM mit Windows starten"
!define LM_PAGE3_HINT       "Empfohlen für tägliche Nutzung."

; ════════════════════════════════════════════════════════════════════════════
;  Installer-only state
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  Var Dialog
  Var OptDesktopCheckbox
  Var OptStartMenuCheckbox
  Var OptAutostartCheckbox
  Var CreateDesktopShortcut
  Var CreateStartMenuShortcut
  Var EnableAutostart
  Var FontHeading
  Var FontBody
!endif

; ════════════════════════════════════════════════════════════════════════════
;  customInit — runs inside .onInit
; ════════════════════════════════════════════════════════════════════════════
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"

  StrCpy $INSTDIR "$LOCALAPPDATA\${LM_BRAND_NAME}"

  CreateFont $FontHeading "Segoe UI" 16 700
  CreateFont $FontBody "Segoe UI" 9 400
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  Page 1 — Welcome
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customWelcomePage
    Page custom WelcomePageCreate
  !macroend

  Function WelcomePageCreate
    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}

    ; Brand mark — heading
    ${NSD_CreateLabel} 28u 28u 280u 24u "${LM_BRAND_NAME}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ; Tagline
    ${NSD_CreateLabel} 28u 54u 280u 12u "${LM_TAGLINE}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Welcome heading
    ${NSD_CreateLabel} 28u 96u 280u 18u "${LM_PAGE1_HEADING}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ; Body paragraph
    ${NSD_CreateLabel} 28u 120u 280u 60u "${LM_PAGE1_BODY}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Continuation hint
    ${NSD_CreateLabel} 28u 196u 280u 12u "${LM_PAGE1_HINT}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    nsDialogs::Show
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 2 — License (MUI default rendering)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
  !macroend
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 3 — Setup (shortcut + autostart checkboxes)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom SetupPageCreate SetupPageLeave
  !macroend

  Function SetupPageCreate
    ; Set the MUI page header text (inline since MUI_HEADER_TEXT isn't
    ; available when our nsh is parsed by e-b)
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${LM_PAGE3_TITLE}"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${LM_PAGE3_SUBTITLE}"

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}

    ; ── Section 1: Verknüpfungen ──
    ${NSD_CreateLabel} 8u 12u 290u 12u "${LM_PAGE3_SECTION1}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateCheckbox} 16u 32u 280u 12u "${LM_PAGE3_OPT1}"
    Pop $OptDesktopCheckbox
    SendMessage $OptDesktopCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateDesktopShortcut == "1"
      ${NSD_Check} $OptDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 16u 48u 280u 12u "${LM_PAGE3_OPT2}"
    Pop $OptStartMenuCheckbox
    SendMessage $OptStartMenuCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateStartMenuShortcut == "1"
      ${NSD_Check} $OptStartMenuCheckbox
    ${EndIf}

    ; ── Section 2: Autostart ──
    ${NSD_CreateLabel} 8u 80u 290u 12u "${LM_PAGE3_SECTION2}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateCheckbox} 16u 100u 280u 12u "${LM_PAGE3_OPT3}"
    Pop $OptAutostartCheckbox
    SendMessage $OptAutostartCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $EnableAutostart == "1"
      ${NSD_Check} $OptAutostartCheckbox
    ${EndIf}

    ${NSD_CreateLabel} 16u 116u 290u 12u "${LM_PAGE3_HINT}"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    nsDialogs::Show
  FunctionEnd

  Function SetupPageLeave
    ${If} $OptDesktopCheckbox != 0
      ${NSD_GetState} $OptDesktopCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $CreateDesktopShortcut "1"
      ${Else}
        StrCpy $CreateDesktopShortcut "0"
      ${EndIf}
    ${EndIf}

    ${If} $OptStartMenuCheckbox != 0
      ${NSD_GetState} $OptStartMenuCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $CreateStartMenuShortcut "1"
      ${Else}
        StrCpy $CreateStartMenuShortcut "0"
      ${EndIf}
    ${EndIf}

    ${If} $OptAutostartCheckbox != 0
      ${NSD_GetState} $OptAutostartCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $EnableAutostart "1"
      ${Else}
        StrCpy $EnableAutostart "0"
      ${EndIf}
    ${EndIf}
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Install / Uninstall hooks
; ════════════════════════════════════════════════════════════════════════════
!macro customInstall
  ${If} $CreateDesktopShortcut == "0"
    Delete "$DESKTOP\${LM_BRAND_NAME}.lnk"
  ${EndIf}

  ${If} $CreateStartMenuShortcut == "0"
    Delete "$SMPROGRAMS\${LM_BRAND_NAME}.lnk"
  ${EndIf}

  ${If} $EnableAutostart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${LM_BRAND_NAME}" "$INSTDIR\${LM_BRAND_NAME}.exe"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${LM_BRAND_NAME}"
!macroend
