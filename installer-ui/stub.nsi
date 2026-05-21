;----------------------------------------------------------------------
; LokLM Installer Stub
;
; Tiny NSIS bootstrap : extracts the electron wizard + LokLM payload to
; %TEMP% , launches the wizard via ExecWait , cleans up.
;
; The wizard ( installer-ui/main.cjs ) does the actual install logic :
; copy payload to %LOCALAPPDATA% , shortcuts , registry uninstall key.
; This stub only exists to provide INSTANT feedback ( Splash::show ) when
; the user doubleclicks Setup.exe , killing the 7zSD self-extract
; pre-flash window we got with electron-builder's portable target.
;
; Build : driven by scripts/build-installer-stub.mjs , which passes
; PRODUCT_VERSION , INSTALLER_DIR , PAYLOAD_DIR , SPLASH_BMP , OUTPUT_FILE
; via /D defines.
;----------------------------------------------------------------------

Unicode True
; zlib , not lzma — payload is 1.2 GB raw ( node-llama-cpp's CUDA + CPU
; native binaries dominate ) , and lzma's compression takes ~15s to
; decompress on the install machine. zlib gives ~50% compression at
; ~3-4x faster decompression , which is what the user actually feels.
; The .exe will be a bit bigger than the lzma version ( ~500 MB vs
; 397 MB ) but install-time wait drops from ~20s to ~3-5s.
SetCompressor /SOLID zlib

!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION not defined ; invoke via scripts/build-installer-stub.mjs"
!endif
!ifndef INSTALLER_DIR
  !error "INSTALLER_DIR not defined"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR not defined"
!endif
!ifndef SPLASH_BMP
  !error "SPLASH_BMP not defined"
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
SilentInstall silent

; Per-run temp dir. Reset at the start of every install so leftover
; state from a previous run ( e.g. user closed wizard mid-install )
; doesn't shadow the freshly extracted files.
InstallDir "$TEMP\LokLM-Setup"

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "LokLM Installer"
VIAddVersionKey "FileDescription" "LokLM Setup"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}.0"
VIAddVersionKey "OriginalFilename" "LokLM-Setup.exe"
VIAddVersionKey "LegalCopyright" "Projektgruppe LokLM"

Section "Main" SecMain
  ; Reset stale temp from any prior run.
  RMDir /r "$INSTDIR"

  ; Show splash IMMEDIATELY ( ~50ms after process spawn ). Splash::show
  ; blocks for the duration ; 5s covers the extract phase + most of the
  ; wizard's startup ( ~3s ). After Splash::show returns , NSIS does the
  ; extraction ( ~1-2s with SetCompress off ) and launches the wizard.
  ; Total perceived wait : ~5s with splash feedback + ~2s blank before
  ; wizard window paints.
  InitPluginsDir
  File "/oname=$PLUGINSDIR\splash.bmp" "${SPLASH_BMP}"
  Splash::show 5000 "$PLUGINSDIR\splash"
  Pop $0

  ; Extract wizard + payload as two sibling folders under $INSTDIR.
  ; The wizard's payloadDir() in main.cjs resolves the payload via
  ; ../win-unpacked relative to its own .exe location.
  SetOutPath "$INSTDIR\installer"
  File /r "${INSTALLER_DIR}\*"
  SetOutPath "$INSTDIR\win-unpacked"
  File /r "${PAYLOAD_DIR}\*"

  ; Launch the wizard ; ExecWait blocks until it exits ( user clicks
  ; "Launch LokLM" , "Close" , cancel , or X ). Once it returns we
  ; tear down the temp folder.
  ExecWait '"$INSTDIR\installer\LokLM Installer.exe"' $0

  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
SectionEnd
