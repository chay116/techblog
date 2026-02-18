# exp05_jit_pipeline_cache — JIT compilation and pipeline cache comparison

add_executable(exp05_jit_pipeline_cache
    main.cpp
    cuda/jit_kernel.cu
)
target_link_libraries(exp05_jit_pipeline_cache PRIVATE shared_lib CUDA::cuda_driver)
set_target_properties(exp05_jit_pipeline_cache PROPERTIES CUDA_SEPARABLE_COMPILATION ON)
dump_sass(TARGET exp05_jit_pipeline_cache OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass)

compile_glsl(
    TARGET exp05_jit_pipeline_cache
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/glsl/cached_kernel.comp
    OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
)
