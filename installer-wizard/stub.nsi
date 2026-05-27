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

Name "LokLM"
OutFile "${OUTPUT_FILE}"
Icon "${ICON_PATH}"
; IDT bypass , attempt 2 : "Wizard" also tripped IDT despite not being
; on Microsoft's documented keyword list ( install / setup / update /
; patch ). Going fully bland — no setup-ish vocabulary anywhere in the
; filename or VS_VERSION_INFO. ManifestSupportedOS=all sets the Win10/11
; supportedOS GUIDs which is the documented IDT-exemption mechanism.
RequestExecutionLevel user
ManifestSupportedOS all
ManifestDPIAware true
SilentInstall silent

InstallDir "$TEMP\LokLM-Boot"

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "CompanyName" "Projektgruppe LokLM"
VIAddVersionKey "ProductName" "LokLM"
VIAddVersionKey "FileDescription" "LokLM"
VIAddVersionKey "InternalName" "LokLM"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}.0"
VIAddVersionKey "OriginalFilename" "LokLM-x64.exe"
VIAddVersionKey "LegalCopyright" "Projektgruppe LokLM"

Section "Main" SecMain
  RMDir /r "$INSTDIR"

  ; Extract wizard binary ( ~2.8 MB ) + LICENSE ( ~1 KB , read by the
  ; wizard's get_license at runtime ). The payload + optional cuda are
  ; fetched by the wizard itself from bunny ( see installer/download.rs
  ; + payload_manifest.rs ) , so we no longer embed win-unpacked here.
  ; The cargo binary is named loklm.exe ( via [[bin]] in Cargo.toml ) so
  ; IDT doesn't trip when NSIS spawns it asInvoker.
  SetOutPath "$INSTDIR\app"
  File "${WIZARD_EXE}"
  File "/oname=$INSTDIR\app\LICENSE" "${LICENSE_PATH}"

  ; Launch wizard ; ExecWait blocks until it exits ( user clicks
  ; "LokLM starten" , "Schließen" , cancel , or X ). Then we tear down
  ; the temp folder so the next run extracts fresh.
  ExecWait '"$INSTDIR\app\loklm.exe"' $0

  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
SectionEnd
