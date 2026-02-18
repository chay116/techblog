# exp02_vector_add — C[i] = A[i] + B[i] in CUDA and Vulkan, SASS comparison

add_executable(exp02_vector_add
    main.cpp
    cuda/vector_add.cu
)
target_link_libraries(exp02_vector_add PRIVATE shared_lib CUDA::cuda_driver)
set_target_properties(exp02_vector_add PROPERTIES CUDA_SEPARABLE_COMPILATION ON)
dump_sass(TARGET exp02_vector_add OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass)

compile_glsl(
    TARGET exp02_vector_add
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/glsl/vector_add.comp
    OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
)
