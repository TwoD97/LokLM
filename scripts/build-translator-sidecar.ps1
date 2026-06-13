# Builds the loklm-translator sidecar (CTranslate2 + SentencePiece) and stages
# the binary into sidecars/translator/dist/ for electron-builder.
#
# Requirements: cmake >= 3.24 , a C++17 toolchain (MSVC / gcc / clang) , git.
# First build fetches + compiles CTranslate2 and SentencePiece — expect
# 10-25 min cold; incremental rebuilds of main.cpp are seconds.
#
#   pwsh scripts/build-translator-sidecar.ps1            # CPU , Release
#   pwsh scripts/build-translator-sidecar.ps1 -Config Debug
#   pwsh scripts/build-translator-sidecar.ps1 -Cuda      # NVIDIA GPU build
#
# CPU build stages dist/loklm-translator(.exe) — electron-builder ships dist/
# into the base payload. -Cuda needs the CUDA Toolkit (nvcc) and stages a
# SELF-CONTAINED dist-cuda/ : the loklm-translator-cuda(.exe) PLUS the
# redistributable CUDA libs (cudart/cublas/cublasLt/nvrtc/nvrtc-builtins) copied
# out of CUDA_PATH , so the release box (which has no CUDA toolkit) can fold the
# whole set into the CUDA archive without locating libs itself. The CUDA binary
# dynamically links those libs , so it only runs where the NVIDIA driver is
# present — it ships in the wizard's CUDA archive, never the base payload.
# -CudaArchList overrides the compute capabilities baked in (default covers
# Ampere..Blackwell via PTX).

param(
  [string]$Config = 'Release',
  [switch]$Cuda,
  # Native Ampere/Ada SASS + PTX for forward-compat JIT (Hopper/Blackwell).
  # 12.0 can't be named on CT2 4.6.0's legacy FindCUDA arch path — see CMakeLists.
  [string]$CudaArchList = '8.0;8.6;8.9+PTX'
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src = Join-Path $root 'sidecars/translator'
$build = Join-Path $src ($Cuda ? 'build-cuda' : 'build')

$cfgArgs = @('-S', $src, '-B', $build, "-DCMAKE_BUILD_TYPE=$Config")
if ($Cuda) {
  $cfgArgs += @('-DWITH_CUDA=ON', "-DCUDA_ARCH_LIST=$CudaArchList")
}
cmake @cfgArgs
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed ($LASTEXITCODE)" }

cmake --build $build --config $Config --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed ($LASTEXITCODE)" }

$baseName = $IsWindows ? 'loklm-translator.exe' : 'loklm-translator'
$exe = Join-Path $build "bin/$baseName"
if (-not (Test-Path $exe)) { throw "expected binary not found: $exe" }

if (-not $Cuda) {
  $dist = Join-Path $src 'dist'
  New-Item -ItemType Directory -Force $dist | Out-Null
  Copy-Item $exe (Join-Path $dist $baseName) -Force
  Write-Host "staged $baseName -> $dist"
  return
}

# --- CUDA: stage a self-contained dist-cuda/ (binary + CUDA redist libs) ------
$distCuda = Join-Path $src 'dist-cuda'
if (Test-Path $distCuda) { Remove-Item -Recurse -Force $distCuda }
New-Item -ItemType Directory -Force $distCuda | Out-Null
$cudaName = $IsWindows ? 'loklm-translator-cuda.exe' : 'loklm-translator-cuda'
Copy-Item $exe (Join-Path $distCuda $cudaName) -Force

$cudaRoot = $env:CUDA_PATH
if (-not $cudaRoot) { throw 'CUDA_PATH not set — cannot collect the CUDA runtime libs for dist-cuda/.' }
# CUDA 13 keeps the runtime DLLs in bin/x64 ; older toolkits use bin/. Linux
# ships the .so set in lib64/ (or targets/<triple>/lib).
$libDirs = $IsWindows `
  ? @((Join-Path $cudaRoot 'bin/x64'), (Join-Path $cudaRoot 'bin')) `
  : @((Join-Path $cudaRoot 'lib64'), (Join-Path $cudaRoot 'targets/x86_64-linux/lib'))
$patterns = $IsWindows `
  ? @('cudart64_*.dll', 'cublas64_*.dll', 'cublasLt64_*.dll', 'nvrtc64_*.dll', 'nvrtc-builtins64_*.dll') `
  : @('libcudart.so*', 'libcublas.so*', 'libcublasLt.so*', 'libnvrtc.so*', 'libnvrtc-builtins.so*')
foreach ($pat in $patterns) {
  $hit = $null
  foreach ($d in $libDirs) {
    if (Test-Path $d) { $hit = Get-ChildItem -Path $d -Filter $pat -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($hit) { break }
  }
  if (-not $hit) { throw "CUDA lib '$pat' not found under: $($libDirs -join ', ')" }
  Copy-Item $hit.FullName (Join-Path $distCuda $hit.Name) -Force
}
$count = (Get-ChildItem $distCuda).Count
Write-Host "staged $cudaName + CUDA libs ($count files) -> $distCuda"
