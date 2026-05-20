; LokLM minimal NSIS include — branded but invisible
;
; Architectural decision (see docs/superpowers/specs/2026-05-20-...):
; The installer is intentionally minimal. NSIS native controls cannot match
; the app's design system without owner-drawing every control (high crash
; risk, low visual return). All onboarding polish lives in the app's
; <FirstRunWizard /> React component, which uses the exact same design
; tokens as the rest of LokLM.
;
; This file therefore contains only:
;   - customUnInstall hook to clean up the autostart registry key
;     (set by the first-run wizard, not by this installer)
;
; The branded sidebar + header BMPs (installerSidebar/installerHeader in
; package.json) still apply to the Finish page and the InstFiles header,
; giving a small visual hint that this is LokLM without trying to recreate
; the app aesthetic in Win32 GDI.

!macro customUnInstall
  ; First-run wizard may have written an autostart key — clean it up.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LokLM"
!macroend
