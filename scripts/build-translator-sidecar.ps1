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

# CMake 4.x ( what `brew install cmake` now ships on the mac runners ) dropped
# compatibility with cmake_minimum_required < 3.5 , which CTranslate2 4.6.0's
# vendored ruy/cpuinfo/clog still declares — so configure hard-errors. This flag
# is the documented escape hatch ( raises the effective policy floor to 3.5 for
# those sub-projects ). Harmless on the older CMake the linux/windows runners
# use ( the var is simply unused there ).
$cfgArgs = @('-S', $src, '-B', $build, "-DCMAKE_BUILD_TYPE=$Config", '-DCMAKE_POLICY_VERSION_MINIMUM=3.5')
if ($Cuda) {
  $cfgArgs += @('-DWITH_CUDA=ON', "-DCUDA_ARCH_LIST=$CudaArchList")
}
if ($Cuda -and $IsWindows) {
  # Windows GPU: force the single-config Ninja generator for the CUDA build. The
  # default VS generator needs the CUDA MSBuild integration (.props) the CI
  # toolkit install omits , so project(CXX CUDA) aborts in
  # CMakeDetermineCUDACompiler. Ninja resolves the toolkit via PATH and lets nvcc
  # drive cl.exe directly ( the workflow loads vcvars + puts ninja on PATH before
  # this runs ). NOT "Ninja Multi-Config" — CT2 4.6.0's legacy FindCUDA mis-expands
  # ${CONFIGURATION} there ; single-config + the -DCMAKE_BUILD_TYPE above is right.
  # The CPU build keeps the default VS generator ( it builds in a separate dir ).
  $cfgArgs = @('-G', 'Ninja') + $cfgArgs
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
if ($IsWindows) {
  # Windows resolves a DLL by its on-disk name from the exe's own directory , so
  # the versioned filename (cublas64_12.dll) is exactly what the loader wants —
  # copy it verbatim.
  $required = @('cudart64_*.dll', 'cublas64_*.dll', 'cublasLt64_*.dll', 'nvrtc64_*.dll', 'nvrtc-builtins64_*.dll')
  # cuBLASLt 12.x can pull in nvJitLink ( delay-loaded on Windows -> the sidecar
  # starts without it , but a cuBLASLt JIT path would need it on a clean box ).
  # CUDA 12.6 names it nvJitLink_120_0.dll ( NOT nvJitLink64_* ) , so glob broadly.
  # Best-effort: a miss is a warning , not a throw ( matches the Linux closure ).
  $optional = @('nvJitLink*.dll')
  foreach ($pat in ($required + $optional)) {
    $hit = $null
    foreach ($d in $libDirs) {
      if (Test-Path $d) { $hit = Get-ChildItem -Path $d -Filter $pat -ErrorAction SilentlyContinue | Select-Object -First 1 }
      if ($hit) { break }
    }
    if (-not $hit) {
      if ($optional -contains $pat) { Write-Warning "optional CUDA lib '$pat' not found — skipping"; continue }
      throw "CUDA lib '$pat' not found under: $($libDirs -join ', ')"
    }
    Copy-Item $hit.FullName (Join-Path $distCuda $hit.Name) -Force
  }
} else {
  # Linux: the loader resolves a shared lib by its SONAME (e.g. libcublas.so.12) ,
  # which is the name baked into the binary's DT_NEEDED — NOT the unversioned
  # libcublas.so dev symlink (which a naive glob's first lexicographic match would
  # grab) , and not the fully-versioned libcublas.so.12.x.y real file. Stage each
  # lib's real content under its EXACT SONAME so the co-located set resolves via
  # the $ORIGIN rpath at runtime. objdump (binutils , pulled in by build-essential)
  # reads the SONAME field straight from the ELF.
  $requiredBases = @('cudart', 'cublas', 'cublasLt', 'nvrtc', 'nvrtc-builtins')
  # libnvJitLink.so.12 is a runtime DT_NEEDED of cuBLASLt 12.x. Best-effort here ,
  # but the build job's ldd self-check FAILS if it turns out to be needed+missing.
  $optionalBases = @('nvJitLink')
  foreach ($base in ($requiredBases + $optionalBases)) {
    $cand = $null
    foreach ($d in $libDirs) {
      if (Test-Path $d) {
        # Versioned files only (libX.so.*). The longest-name match is the real
        # fully-versioned file ( the .NET matcher may also admit the bare
        # libX.so dev symlink , but the length sort always discards it ).
        $cand = Get-ChildItem -Path $d -Filter "lib$base.so.*" -ErrorAction SilentlyContinue |
          Sort-Object { $_.Name.Length } -Descending | Select-Object -First 1
      }
      if ($cand) { break }
    }
    if (-not $cand) {
      if ($optionalBases -contains $base) { Write-Warning "optional CUDA lib 'lib$base.so.*' not found — skipping ( ldd check will catch it if truly needed )"; continue }
      throw "CUDA lib 'lib$base.so.*' not found under: $($libDirs -join ', ')"
    }
    $sonameLine = (& objdump -p $cand.FullName | Select-String -Pattern 'SONAME').Line
    $soname = ($sonameLine -match 'SONAME\s+(\S+)') ? $matches[1] : $cand.Name
    # Copy-Item follows the symlink chain and writes the real content under the
    # SONAME filename — exactly the name the dynamic loader will request.
    Copy-Item $cand.FullName (Join-Path $distCuda $soname) -Force
  }
}
$count = (Get-ChildItem $distCuda).Count
Write-Host "staged $cudaName + CUDA libs ($count files) -> $distCuda"
