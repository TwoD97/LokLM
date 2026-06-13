# loklm-translator — static build of CTranslate2 + SentencePiece around
# src/main.cpp. Output lands in <build>/bin/loklm-translator(.exe);
# scripts/build-translator-sidecar.ps1 copies it to sidecars/translator/dist/
# which electron-builder ships as resources/translator/.
#
# CPU GEMM backend is ruy (bundled CT2 submodule) — dependency-free on all three
# platforms. If int8 CPU throughput ever becomes the bottleneck , oneDNN
# (-DWITH_DNNL=ON + an installed oneDNN) is the upgrade path.
#
# GPU: -DWITH_CUDA=ON builds an NVIDIA-CUDA-capable binary (Windows/Linux only —
# CT2 has no Metal/ROCm backend , so macOS + AMD stay CPU). The binary still
# runs on CPU when no CUDA device is present , BUT it dynamically links the CUDA
# runtime , so it won't START on a box without the NVIDIA driver/runtime — ship
# it only in the CUDA payload (mirrors the app's win-x64 vs win-x64-cuda split)
# and keep the plain CPU binary as the default. The sidecar picks CPU vs GPU at
# runtime via --device auto (GPU iff enough free VRAM).

cmake_minimum_required(VERSION 3.24)

# CUDA must be enabled as a language at project() time when requested.
option(WITH_CUDA "Build with NVIDIA CUDA GPU support (Windows/Linux only)" OFF)
# Native SASS for Ampere (8.0/8.6) + Ada (8.9) , plus compute_89 PTX so newer
# GPUs (Hopper 9.0 , Blackwell 12.0) the driver JIT-compiles forward at first
# launch. We can't name 12.0 here: CT2 4.6.0 routes through the legacy
# FindCUDA select_compute_arch , and CMake ≤3.30's copy predates Blackwell
# ("arch_bin wasn't set"). +PTX is the portable way to cover it. Override with
# -DCUDA_ARCH_LIST= once the toolchain knows newer arches natively.
set(CUDA_ARCH_LIST "8.0;8.6;8.9+PTX" CACHE STRING "CT2 CUDA compute capabilities")
if(WITH_CUDA)
  project(loklm-translator CXX CUDA)
else()
  project(loklm-translator CXX)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# MSVC: CTranslate2 forces the static CRT (/MT) for static-lib builds in its
# own scope , and a mixed-CRT link dies with LNK2038/LNK2005. Match it across
# the whole tree. Two mechanisms because sentencepiece pins cmake 3.1 and its
# policy scope ignores CMAKE_MSVC_RUNTIME_LIBRARY (CMP0091 OLD) — it picks the
# runtime up from the inherited per-config flags instead. Static CRT also
# drops the VC-redist requirement for the shipped exe.
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  foreach(flag_var
      CMAKE_CXX_FLAGS_DEBUG CMAKE_CXX_FLAGS_RELEASE
      CMAKE_CXX_FLAGS_MINSIZEREL CMAKE_CXX_FLAGS_RELWITHDEBINFO
      CMAKE_C_FLAGS_DEBUG CMAKE_C_FLAGS_RELEASE
      CMAKE_C_FLAGS_MINSIZEREL CMAKE_C_FLAGS_RELWITHDEBINFO)
    string(REPLACE "/MD" "/MT" ${flag_var} "${${flag_var}}")
  endforeach()
endif()

# Pin upstream versions here — bump deliberately and rebuild all platforms.
set(CT2_GIT_TAG "v4.6.0" CACHE STRING "CTranslate2 tag to build against")
set(SPM_GIT_TAG "v0.2.0" CACHE STRING "SentencePiece tag to build against")
set(JSON_VERSION "3.11.3" CACHE STRING "nlohmann/json release")

include(FetchContent)

# --- CTranslate2 (static , ruy CPU GEMM , optional CUDA) ---------------------
set(BUILD_CLI OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_DNNL OFF CACHE BOOL "" FORCE)
set(WITH_RUY ON CACHE BOOL "" FORCE)
set(OPENMP_RUNTIME "NONE" CACHE STRING "" FORCE)
# WITH_CUDA is read by CTranslate2's own CMake too; our option() above sets it.
# CUDA_ARCH_LIST feeds CT2's cuda_select_nvcc_arch_flags (legacy FindCUDA path).
if(WITH_CUDA)
  set(WITH_CUDA ON CACHE BOOL "" FORCE)
  set(WITH_CUDNN OFF CACHE BOOL "" FORCE)
endif()
FetchContent_Declare(ctranslate2
  GIT_REPOSITORY https://github.com/OpenNMT/CTranslate2.git
  GIT_TAG ${CT2_GIT_TAG}
)

# --- SentencePiece (static) --------------------------------------------------
set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
FetchContent_Declare(sentencepiece
  GIT_REPOSITORY https://github.com/google/sentencepiece.git
  GIT_TAG ${SPM_GIT_TAG}
)

# --- nlohmann/json (header-only , slim release tarball) ----------------------
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v${JSON_VERSION}/json.tar.xz
)

FetchContent_MakeAvailable(ctranslate2 sentencepiece json)

add_executable(loklm-translator src/main.cpp)
target_link_libraries(loklm-translator PRIVATE
  ctranslate2
  sentencepiece-static
  nlohmann_json::nlohmann_json
)
# sentencepiece doesn't export its include dir for build-tree consumers.
target_include_directories(loklm-translator PRIVATE
  ${sentencepiece_SOURCE_DIR}/src
)

# GPU: define LOKLM_WITH_CUDA (gates the device-selection + cudaMemGetInfo code
# in main.cpp) and link the CUDA runtime for the free-VRAM probe.
if(WITH_CUDA)
  find_package(CUDAToolkit REQUIRED)
  target_compile_definitions(loklm-translator PRIVATE LOKLM_WITH_CUDA)
  target_link_libraries(loklm-translator PRIVATE CUDA::cudart)
endif()

set_target_properties(loklm-translator PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
  RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/bin
  RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_BINARY_DIR}/bin
)
