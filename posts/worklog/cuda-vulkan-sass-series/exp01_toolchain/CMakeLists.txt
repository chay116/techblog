# exp01_toolchain — CUDA PTX/SASS dump + Vulkan pipeline executable props

# --- CUDA target ---
add_executable(exp01_cuda
    main_cuda.cpp
    cuda/noop_kernel.cu
)
target_link_libraries(exp01_cuda PRIVATE shared_lib CUDA::cuda_driver)
set_target_properties(exp01_cuda PROPERTIES CUDA_SEPARABLE_COMPILATION ON)
dump_sass(TARGET exp01_cuda OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass)

# --- Vulkan target ---
add_executable(exp01_vulkan
    main_vulkan.cpp
)
target_link_libraries(exp01_vulkan PRIVATE shared_lib)
compile_glsl(
    TARGET exp01_vulkan
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/glsl/noop.comp
    OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
)
