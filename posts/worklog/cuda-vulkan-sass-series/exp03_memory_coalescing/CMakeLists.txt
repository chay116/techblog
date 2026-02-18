# exp03_memory_coalescing — AoS vs SoA memory access patterns

add_executable(exp03_memory_coalescing
    main.cpp
    cuda/coalesce_aos.cu
    cuda/coalesce_soa.cu
)
target_link_libraries(exp03_memory_coalescing PRIVATE shared_lib CUDA::cuda_driver)
set_target_properties(exp03_memory_coalescing PROPERTIES CUDA_SEPARABLE_COMPILATION ON)
dump_sass(TARGET exp03_memory_coalescing OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass)

compile_glsl(
    TARGET exp03_memory_coalescing
    SOURCES
        ${CMAKE_CURRENT_SOURCE_DIR}/glsl/coalesce_aos.comp
        ${CMAKE_CURRENT_SOURCE_DIR}/glsl/coalesce_soa.comp
    OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
)
