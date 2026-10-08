param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (-not $env:WIN_CSC_LINK -and -not $env:WIN_CSC_KEY_PASSWORD) {
  Write-Warning 'No Windows signing certificate configured; artifact remains unsigned.'
  exit 0
}
if (-not $env:WIN_CSC_LINK -or -not $env:WIN_CSC_KEY_PASSWORD) {
  throw 'Incomplete Windows signing configuration'
}
$pfx = Join-Path $env:RUNNER_TEMP ('loklm-sign-' + [guid]::NewGuid().ToString() + '.pfx')
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WIN_CSC_LINK))
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $signtool) { throw 'Windows SDK signtool missing' }
  & $signtool sign /fd SHA256 /f $pfx /p $env:WIN_CSC_KEY_PASSWORD /tr http://timestamp.digicert.com /td SHA256 /d LokLM $Path
  if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed' }
  & $signtool verify /pa $Path
  if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed' }
} finally {
  Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
}
