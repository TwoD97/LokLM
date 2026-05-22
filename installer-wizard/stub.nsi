;----------------------------------------------------------------------
; LokLM Installer Stub
;
; Minimal NSIS bootstrap : extracts the Tauri wizard exe + LokLM payload
; to %TEMP% , launches the wizard , cleans up after it exits.
;
; The wizard ( loklm-installer.exe , ~2.8 MB Rust+WebView2 ) handles the
; actual install logic ( robocopy , powershell shortcuts , registry ,
; uninstaller .ps1 ). It launches in ~200ms with its own boot-splash so
; the user sees brand feedback right away ; we don't need NSIS's
; Splash::show on top of that.
;
; Build : driven by scripts/build-installer-stub.mjs which passes
; PRODUCT_VERSION , WIZARD_DIR , PAYLOAD_DIR , ICON_PATH , OUTPUT_FILE
; via /D defines.
;----------------------------------------------------------------------

Unicode True
; zlib : payload is ~1.2 GB raw and lzma's compression saved ~15%
; size at the cost of ~15s of decompression at install time. zlib
; produces a slightly bigger .exe ( ~500 MB vs ~400 MB ) but extracts
; ~3-4x faster , which is what the user actually feels.
SetCompressor /SOLID zlib

!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION not defined ; invoke via scripts/build-installer-stub.mjs"
!endif
!ifndef WIZARD_EXE
  !error "WIZARD_EXE not defined ( path to loklm-installer.exe )"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR not defined"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE not defined"
!endif
!ifndef ICON_PATH
  !error "ICON_PATH not defined"
!endif

Name "LokLM Installer"
OutFile "${OUTPUT_FILE}"
Icon "${ICON_PATH}"
RequestExecutionLevel user
; Windows AppCompat auto-elevates any binary whose filename matches
; installer heuristics ( "setup" , "install" , "update" ) UNLESS the
; manifest is "complete" enough for Windows to trust it. RequestExecution-
; Level user alone embeds only the security part ; we also need the
; supportedOS + DPI declarations so Windows treats the manifest as
; modern and skips the elevation shim.
ManifestSupportedOS all
ManifestDPIAware true
SilentInstall silent

InstallDir "$TEMP\LokLM-Setup"

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "LokLM Installer"
VIAddVersionKey "FileDescription" "LokLM Setup"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}.0"
VIAddVersionKey "OriginalFilename" "LokLM-Setup.exe"
VIAddVersionKey "LegalCopyright" "Projektgruppe LokLM"

Section "Main" SecMain
  RMDir /r "$INSTDIR"

  ; Extract wizard binary ( ~2.8 MB ) and LokLM payload ( ~1.2 GB ) as
  ; two sibling folders. The wizard's payload_dir() in installer.rs
  ; resolves the payload via ../win-unpacked relative to its own exe.
  SetOutPath "$INSTDIR\installer"
  File "/oname=$INSTDIR\installer\loklm-installer.exe" "${WIZARD_EXE}"
  SetOutPath "$INSTDIR\win-unpacked"
  File /r "${PAYLOAD_DIR}\*"

  ; Launch wizard ; ExecWait blocks until it exits ( user clicks
  ; "LokLM starten" , "Schließen" , cancel , or X ). Then we tear down
  ; the temp folder so the next run extracts fresh.
  ExecWait '"$INSTDIR\installer\loklm-installer.exe"' $0

  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
SectionEnd
