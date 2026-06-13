# Builds the loklm-translator sidecar (CTranslate2 + SentencePiece , CPU-only)
# and stages the binary into sidecars/translator/dist/ for electron-builder.
#
# Requirements: cmake >= 3.24 , a C++17 toolchain (MSVC / gcc / clang) , git.
# First build fetches + compiles CTranslate2 and SentencePiece — expect
# 10-25 min cold; incremental rebuilds of main.cpp are seconds.
#
#   pwsh scripts/build-translator-sidecar.ps1            # Release
#   pwsh scripts/build-translator-sidecar.ps1 -Config Debug

param(
  [string]$Config = 'Release'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src = Join-Path $root 'sidecars/translator'
$build = Join-Path $src 'build'
$dist = Join-Path $src 'dist'

cmake -S $src -B $build -DCMAKE_BUILD_TYPE=$Config
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed ($LASTEXITCODE)" }

cmake --build $build --config $Config --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed ($LASTEXITCODE)" }

$exeName = $IsWindows ? 'loklm-translator.exe' : 'loklm-translator'
$exe = Join-Path $build "bin/$exeName"
if (-not (Test-Path $exe)) { throw "expected binary not found: $exe" }

New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $exe (Join-Path $dist $exeName) -Force
Write-Host "staged $exeName -> $dist"
