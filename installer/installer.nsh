; LokLM custom NSIS include — v6: app-style dark theme, design-only changes
;
; Design-only update: dark backgrounds and brand colors matching the LokLM
; app's design tokens. Page flow + functionality unchanged from v5.
;
; Where to edit what:
;   - All user-facing strings:  Section 1 (lines ~26–46)
;   - All colors:               Section 2 (lines ~48–60)
;   - Page layouts:             Sections 4–6 (one block per page)
;   - Install behavior:         Section 7 (customInstall / customUnInstall)

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ════════════════════════════════════════════════════════════════════════════
;  Section 1: USER-FACING STRINGS — edit text here, in one place
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
;  Section 2: COLORS — mirrors src/renderer/src/styles.css tokens
;  Note: SetCtlColors uses BGR (reverse of hex). Each pair below shows the
;  app's CSS hex on the right.
; ════════════════════════════════════════════════════════════════════════════
!define LM_BG_0      0x16110E  ; #0e1116 — page background (bg-0)
!define LM_BG_1      0x221B16  ; #161b22 — header strip / surfaces (bg-1)
!define LM_BG_2      0x2F261F  ; #1f262f — input bg (bg-2)
!define LM_FG_0      0xF3EDE6  ; #e6edf3 — primary text (fg-0)
!define LM_FG_1      0xC9BEB6  ; #b6bec9 — secondary text (fg-1)
!define LM_FG_2      0x9E948B  ; #8b949e — tertiary text (fg-2)
!define LM_ACCENT    0xF6823B  ; #3b82f6 — accent blue

; ════════════════════════════════════════════════════════════════════════════
;  Section 3: STATE + FONTS — declared once at the top
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

!macro customInit
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $CreateStartMenuShortcut "1"
  StrCpy $EnableAutostart "0"

  StrCpy $INSTDIR "$LOCALAPPDATA\${LM_BRAND_NAME}"

  CreateFont $FontHeading "Segoe UI" 16 700
  CreateFont $FontBody "Segoe UI" 9 400
!macroend

; ════════════════════════════════════════════════════════════════════════════
;  Section 4: REUSABLE HELPERS — dark-theme any MUI page's header strip
;  Used by the MUI default pages (License, InstFiles) so their headers
;  match our custom pages instead of staying default-white.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro DarkenHeader TITLE SUBTITLE
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${TITLE}"
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:${SUBTITLE}"
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_1}

    GetDlgItem $0 $HWNDPARENT 1039
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}

    GetDlgItem $0 $HWNDPARENT 1256
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
  !macroend

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
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Section 5: WELCOME PAGE
;  Full-bleed dark page (no MUI header). Brand mark + tagline + intro body.
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

    ; Brand row — accent-colored wordmark
    ${NSD_CreateLabel} 28u 28u 280u 24u "${LM_BRAND_NAME}"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ; Tagline (tertiary text)
    ${NSD_CreateLabel} 28u 54u 280u 12u "${LM_TAGLINE}"
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Thin accent-tinted divider
    ${NSD_CreateLabel} 28u 80u 280u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; Welcome heading (primary text, heading font)
    ${NSD_CreateLabel} 28u 100u 280u 18u "${LM_PAGE1_HEADING}"
    Pop $0
    SetCtlColors $0 ${LM_FG_0} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontHeading 0

    ; Body paragraph (secondary text)
    ${NSD_CreateLabel} 28u 124u 280u 60u "${LM_PAGE1_BODY}"
    Pop $0
    SetCtlColors $0 ${LM_FG_1} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ; Continuation hint (tertiary)
    ${NSD_CreateLabel} 28u 196u 280u 12u "${LM_PAGE1_HINT}"
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    nsDialogs::Show
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Section 6a: LICENSE PAGE
;  MUI_PAGE_LICENSE for body rendering. SHOW callback darkens the header
;  strip and recolors the license text area to match the app palette.
; ════════════════════════════════════════════════════════════════════════════
!ifndef BUILD_UNINSTALLER
  !macro licensePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW LicensePageShow
    !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
  !macroend

  Function LicensePageShow
    !insertmacro DarkenHeader "${LM_PAGE2_TITLE}" "${LM_PAGE2_SUBTITLE}"

    ; License text edit control (MUI control id 1006)
    GetDlgItem $0 $HWNDPARENT 1006
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_0} ${LM_BG_1}
    ${EndIf}

    ; "Please review the licence agreement..." label above the text (id 1040)
    GetDlgItem $0 $HWNDPARENT 1040
    ${If} $0 != 0
      SetCtlColors $0 ${LM_FG_1} ${LM_BG_0}
    ${EndIf}
  FunctionEnd
!endif

; ════════════════════════════════════════════════════════════════════════════
;  Section 6b: SETUP PAGE
;  Dark page body with accent-colored section labels and dark checkboxes.
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

    ; ── Section 1: Verknüpfungen — accent header + checkboxes ──
    ${NSD_CreateLabel} 8u 12u 290u 12u "${LM_PAGE3_SECTION1}"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

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

    ; Subtle divider between sections
    ${NSD_CreateLabel} 8u 72u 290u 1u ""
    Pop $0
    SetCtlColors $0 ${LM_BG_2} ${LM_BG_2}

    ; ── Section 2: Autostart ──
    ${NSD_CreateLabel} 8u 84u 290u 12u "${LM_PAGE3_SECTION2}"
    Pop $0
    SetCtlColors $0 ${LM_ACCENT} ${LM_BG_0}
    SendMessage $0 ${WM_SETFONT} $FontBody 0

    ${NSD_CreateCheckbox} 16u 104u 280u 12u "${LM_PAGE3_OPT3}"
    Pop $OptAutostartCheckbox
    SetCtlColors $OptAutostartCheckbox ${LM_FG_0} ${LM_BG_0}
    SendMessage $OptAutostartCheckbox ${WM_SETFONT} $FontBody 0
    ${If} $EnableAutostart == "1"
      ${NSD_Check} $OptAutostartCheckbox
    ${EndIf}

    ; Hint below autostart
    ${NSD_CreateLabel} 16u 120u 290u 12u "${LM_PAGE3_HINT}"
    Pop $0
    SetCtlColors $0 ${LM_FG_2} ${LM_BG_0}
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
;  Section 7: INSTALL / UNINSTALL HOOKS — unchanged behavior
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
