# exp04_bindless_bda — CUDA raw ptr vs Vulkan UBO vs Vulkan BDA

add_executable(exp04_bindless_bda
    main.cpp
    cuda/raw_ptr.cu
)
target_link_libraries(exp04_bindless_bda PRIVATE shared_lib CUDA::cuda_driver)
set_target_properties(exp04_bindless_bda PROPERTIES CUDA_SEPARABLE_COMPILATION ON)
dump_sass(TARGET exp04_bindless_bda OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass)

compile_glsl(
    TARGET exp04_bindless_bda
    SOURCES
        ${CMAKE_CURRENT_SOURCE_DIR}/glsl/ubo_access.comp
        ${CMAKE_CURRENT_SOURCE_DIR}/glsl/bda_access.comp
    OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
)
