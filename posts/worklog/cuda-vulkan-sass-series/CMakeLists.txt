cmake_minimum_required(VERSION 3.24)
project(cuda_vulkan_sass_series LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CUDA_STANDARD 17)

# --- Find dependencies ---
find_package(CUDAToolkit REQUIRED)
find_package(Vulkan REQUIRED)

# glslangValidator for SPIR-V compilation
find_program(GLSLANG_VALIDATOR glslangValidator HINTS
    "$ENV{VULKAN_SDK}/Bin"
    "$ENV{VULKAN_SDK}/bin"
)
if(NOT GLSLANG_VALIDATOR)
    message(FATAL_ERROR "glslangValidator not found. Install Vulkan SDK.")
endif()
message(STATUS "glslangValidator: ${GLSLANG_VALIDATOR}")

# cuobjdump for SASS disassembly
find_program(CUOBJDUMP cuobjdump HINTS
    "${CUDAToolkit_BIN_DIR}"
)
if(CUOBJDUMP)
    message(STATUS "cuobjdump: ${CUOBJDUMP}")
else()
    message(WARNING "cuobjdump not found — SASS dump targets will be unavailable")
endif()

# --- CMake helper modules ---
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(CompileGLSL)
include(DumpSASS)

# --- Shared library ---
add_library(shared_lib STATIC
    shared/src/vk_init.cpp
    shared/src/vk_pipeline_exec.cpp
    shared/src/cuda_context.cpp
)
target_include_directories(shared_lib PUBLIC shared/include)
target_link_libraries(shared_lib PUBLIC
    Vulkan::Vulkan
    CUDA::cuda_driver
)

# --- Experiments ---
add_subdirectory(exp01_toolchain)
add_subdirectory(exp02_vector_add)
add_subdirectory(exp03_memory_coalescing)
add_subdirectory(exp04_bindless_bda)
add_subdirectory(exp05_jit_pipeline_cache)
