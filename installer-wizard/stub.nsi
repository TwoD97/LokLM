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
; lzma : the stub now bundles only the wizard exe ( ~2.8 MB ) + LICENSE
; ( ~1 KB ) , so the whole .exe is ~5-10 MB. lzma's decompression cost
; is ~0.5s at this size — negligible — and trims a few MB off what the
; user downloads ( payload + cuda are fetched separately from Bunny
; during install , so the stub itself stays tiny ).
SetCompressor /SOLID lzma

!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION not defined ; invoke via scripts/build-installer-stub.mjs"
!endif
!ifndef WIZARD_EXE
  !error "WIZARD_EXE not defined ( path to loklm-installer.exe )"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE not defined"
!endif
!ifndef ICON_PATH
  !error "ICON_PATH not defined"
!endif
!ifndef LICENSE_PATH
  !error "LICENSE_PATH not defined ( path to repo LICENSE — wizard's get_license reads it at runtime )"
!endif

Name "LokLM Installer"
OutFile "${OUTPUT_FILE}"
Icon "${ICON_PATH}"
; Win11 25H2 AppCompat refuses to launch the .exe without elevation
; when ANYTHING in the name looks like an installer ( "Setup" trips it
; even at 2.5 MB ; verified on Denys's machine 2026-05-27 ). The asInvoker
; manifest is silently ignored by the shim. So we accept the one UAC
; prompt at install time. The wizard inside still targets HKCU +
; %LOCALAPPDATA%\Programs and drops elevation when launching LokLM.exe
; via the explorer.exe trampoline ( installer/windows.rs ).
RequestExecutionLevel admin
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

  ; Extract wizard binary ( ~2.8 MB ) + LICENSE ( ~1 KB , read by the
  ; wizard's get_license at runtime ). The payload + optional cuda are
  ; fetched by the wizard itself from bunny ( see installer/download.rs
  ; + payload_manifest.rs ) , so we no longer embed win-unpacked here.
  SetOutPath "$INSTDIR\installer"
  File "/oname=$INSTDIR\installer\loklm-installer.exe" "${WIZARD_EXE}"
  File "/oname=$INSTDIR\installer\LICENSE" "${LICENSE_PATH}"

  ; Launch wizard ; ExecWait blocks until it exits ( user clicks
  ; "LokLM starten" , "Schließen" , cancel , or X ). Then we tear down
  ; the temp folder so the next run extracts fresh.
  ExecWait '"$INSTDIR\installer\loklm-installer.exe"' $0

  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
SectionEnd
