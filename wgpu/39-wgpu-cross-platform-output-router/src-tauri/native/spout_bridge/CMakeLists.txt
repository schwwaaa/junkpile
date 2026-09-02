cmake_minimum_required(VERSION 3.20)
project(junkpile_spout_bridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED SPOUT2_DIR)
  message(FATAL_ERROR "SPOUT2_DIR is required")
endif()

file(TO_CMAKE_PATH "${SPOUT2_DIR}" SPOUT2_DIR_CMAKE)
set(SPOUTSDK_DIR "${SPOUT2_DIR_CMAKE}/SPOUTSDK")
set(SPOUTGL_DIR "${SPOUTSDK_DIR}/SpoutGL")
set(SPOUTDX_DIR "${SPOUTSDK_DIR}/SpoutDirectX/SpoutDX")

add_library(junkpile_spout_bridge STATIC
  spout_bridge.cpp
  spout_bridge.h
  "${SPOUTDX_DIR}/SpoutDX.cpp"
  "${SPOUTGL_DIR}/SpoutCopy.cpp"
  "${SPOUTGL_DIR}/SpoutDirectX.cpp"
  "${SPOUTGL_DIR}/SpoutFrameCount.cpp"
  "${SPOUTGL_DIR}/SpoutSenderNames.cpp"
  "${SPOUTGL_DIR}/SpoutSharedMemory.cpp"
  "${SPOUTGL_DIR}/SpoutUtils.cpp"
)

target_include_directories(junkpile_spout_bridge PRIVATE
  "${SPOUTGL_DIR}"
  "${SPOUTDX_DIR}"
)

if(MSVC)
  target_compile_definitions(junkpile_spout_bridge PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_compile_options(junkpile_spout_bridge PRIVATE /EHsc)
endif()

target_link_libraries(junkpile_spout_bridge PRIVATE
  d3d11 dxgi user32 gdi32 winmm psapi shell32 advapi32 version comctl32
)
