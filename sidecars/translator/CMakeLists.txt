# loklm-translator — CPU-only static build of CTranslate2 + SentencePiece
# around src/main.cpp. Output lands in <build>/bin/loklm-translator(.exe);
# scripts/build-translator-sidecar.ps1 copies it to sidecars/translator/dist/
# which electron-builder ships as resources/translator/.
#
# GEMM backend is ruy (bundled CT2 submodule) — dependency-free on all three
# platforms. If int8 CPU throughput ever becomes the bottleneck , oneDNN
# (-DWITH_DNNL=ON + an installed oneDNN) is the upgrade path.

cmake_minimum_required(VERSION 3.24)
project(loklm-translator CXX)

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

# --- CTranslate2 (static , CPU-only , ruy GEMM) ------------------------------
set(BUILD_CLI OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_DNNL OFF CACHE BOOL "" FORCE)
set(WITH_RUY ON CACHE BOOL "" FORCE)
set(OPENMP_RUNTIME "NONE" CACHE STRING "" FORCE)
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

set_target_properties(loklm-translator PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
  RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/bin
  RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_BINARY_DIR}/bin
)
