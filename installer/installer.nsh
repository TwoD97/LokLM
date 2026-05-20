; LokLM custom NSIS include — v4: modular text, clean dark layout
;
; All user-facing strings are !define'd at the top of this file so they can
; be edited in one place (or extracted to a separate language file later).
;
; Page flow:
;   1. Welcome   — full-bleed dark (MUI header hidden)
;   2. License   — dark header + scrollable MIT text
;   3. Setup     — dark header + options checkboxes (path = fixed default)
;   4. InstFiles — MUI default (brief, native progress)
;   5. Finish    — MUI default with sidebar BMP
;
; Known electron-builder limitation: the per-user/per-machine install-mode
; page appears between License and Setup whenever perMachine=false. We
; can't suppress it without breaking the install-mode behavior, but with
; allowElevation=false the per-machine option is greyed out so it's a
; pass-through click.

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
;  COLOR TOKENS — BGR for SetCtlColors (mirrors src/renderer/src/styles.css)
; ════════════════════════════════════════════════════════════════════════════
!define LM_BG_0      0x16110E  ; #0e1116 — page background
!define LM_BG_1      0x221B16  ; #161b22 — secondary surface (header strip)
!define LM_BG_2      0x2F261F  ; #1f262f — input bg / dividers
!define LM_FG_0      0xF3EDE6  ; #e6edf3 — primary text
!define LM_FG_1      0xC9BEB6  ; #b6bec9 — secondary text
!define LM_FG_2      0x9E948B  ; #8b949e — tertiary text
!define LM_ACCENT    0xF6823B  ; #3b82f6 — accent blue

; ════════════════════════════════════════════════════════════════════════════
;  Installer-only state — uninstaller pass warns 6001 on unused vars
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
  Var FontMono
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
  CreateFont $FontMono "Consolas" 9 400
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  Helpers
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER

  ; Paint the MUI header strip dark with the given title/subtitle.
  !macro DarkenHeader TITLE SUBTITLE
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${TITLE}"
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${SUBTITLE}"
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_1}

    GetDlgItem $0 $HWNDPARENT 1039
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    ; Header background panel (control id 1256 on MUI Modern UI)
    GetDlgItem $0 $HWNDPARENT 1256
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
  !macroend

  ; Hide the MUI header strip entirely (welcome page only).
  !macro HideHeader
    GetDlgItem $0 $HWNDPARENT 1037
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1038
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1039
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1256
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1028
    ShowWindow $0 0
  !macroend

  ; Create a dark-themed accent label (used for section titles)
  !macro AccentLabel X Y W H TEXT
    ${NSD_CreateLabel} ${X} ${Y} ${W} ${H} "${TEXT}"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0
  !macroend

  ; Create a dark-themed primary label
  !macro PrimaryLabel X Y W H TEXT
    ${NSD_CreateLabel} ${X} ${Y} ${W} ${H} "${TEXT}"
    Pop $0
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0
  !macroend

  ; Create a dark-themed secondary label (lighter text)
  !macro SecondaryLabel X Y W H TEXT
    ${NSD_CreateLabel} ${X} ${Y} ${W} ${H} "${TEXT}"
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0
  !macroend

!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 1 — Welcome (MUI header hidden, full-bleed dark)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customWelcomePage
    Page custom WelcomePageCreate
  !macroend

  Function WelcomePageCreate
    !insertmacro HideHeader

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}
    SetCtlColors $Dialog ${LM_FG_0} ${LM_BG_0}

    ; Brand mark — colored heading
    ${NSD_CreateLabel} 28u 28u 280u 24u "${LM_BRAND_NAME}"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    !insertmacro SecondaryLabel 28u 54u 280u 12u "${LM_TAGLINE}"

    ; Thin accent divider
    ${NSD_CreateLabel} 28u 78u 280u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; Welcome heading
    ${NSD_CreateLabel} 28u 100u 280u 18u "${LM_PAGE1_HEADING}"
    Pop $0
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    !insertmacro PrimaryLabel 28u 124u 280u 60u "${LM_PAGE1_BODY}"
    !insertmacro SecondaryLabel 28u 200u 280u 12u "${LM_PAGE1_HINT}"

    nsDialogs::Show
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 2 — License (dark header + MUI_PAGE_LICENSE for the body)
;
;  Using MUI_PAGE_LICENSE here (not custom nsDialogs) because it handles
;  license file loading, scrollbar, and font correctly out of the box. We
;  just dark the header strip via the SHOW callback.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW LicensePageShow
    !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
  !macroend

  Function LicensePageShow
    !insertmacro DarkenHeader "${LM_PAGE2_TITLE}" "${LM_PAGE2_SUBTITLE}"
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Page 3 — Setup (options checkboxes only; install path is fixed)
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom SetupPageCreate SetupPageLeave
  !macroend

  Function SetupPageCreate
    !insertmacro DarkenHeader "${LM_PAGE3_TITLE}" "${LM_PAGE3_SUBTITLE}"

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
      Abort
    ${EndIf}
    SetCtlColors $Dialog ${LM_FG_0} ${LM_BG_0}

    ; ── Section 1: Verknüpfungen ──
    !insertmacro AccentLabel 8u 12u 290u 12u "${LM_PAGE3_SECTION1}"

    ${NSD_CreateCheckbox} 16u 32u 280u 12u "${LM_PAGE3_OPT1}"
    Pop $OptDesktopCheckbox
    SetCtlColors $OptDesktopCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptDesktopCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateDesktopShortcut == "1"
      ${NSD_Check} $OptDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 16u 48u 280u 12u "${LM_PAGE3_OPT2}"
    Pop $OptStartMenuCheckbox
    SetCtlColors $OptStartMenuCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptStartMenuCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $CreateStartMenuShortcut == "1"
      ${NSD_Check} $OptStartMenuCheckbox
    ${EndIf}

    ; ── Divider ──
    ${NSD_CreateLabel} 8u 72u 290u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; ── Section 2: Autostart ──
    !insertmacro AccentLabel 8u 84u 290u 12u "${LM_PAGE3_SECTION2}"

    ${NSD_CreateCheckbox} 16u 104u 280u 12u "${LM_PAGE3_OPT3}"
    Pop $OptAutostartCheckbox
    SetCtlColors $OptAutostartCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptAutostartCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $EnableAutostart == "1"
      ${NSD_Check} $OptAutostartCheckbox
    ${EndIf}

    !insertmacro SecondaryLabel 16u 120u 290u 12u "${LM_PAGE3_HINT}"

    nsDialogs::Show
  FunctionEnd

  Function SetupPageLeave
    ; Defensive reads: only get state if the checkbox HWND was actually set
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
;  Install / Uninstall hooks — honor checkbox state
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
