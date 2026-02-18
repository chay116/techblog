# CompileGLSL.cmake
# Provides compile_glsl() function to compile GLSL compute shaders to SPIR-V.
#
# Usage:
#   compile_glsl(
#     TARGET my_target
#     SOURCES shader1.comp shader2.comp
#     OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/spv
#   )

function(compile_glsl)
    cmake_parse_arguments(GLSL "" "TARGET;OUTPUT_DIR" "SOURCES" ${ARGN})

    if(NOT GLSL_OUTPUT_DIR)
        set(GLSL_OUTPUT_DIR "${CMAKE_CURRENT_BINARY_DIR}/spv")
    endif()
    file(MAKE_DIRECTORY ${GLSL_OUTPUT_DIR})

    set(SPV_FILES "")
    foreach(SHADER ${GLSL_SOURCES})
        get_filename_component(SHADER_NAME ${SHADER} NAME_WE)
        set(SPV_FILE "${GLSL_OUTPUT_DIR}/${SHADER_NAME}.spv")

        add_custom_command(
            OUTPUT ${SPV_FILE}
            COMMAND ${GLSLANG_VALIDATOR}
                --target-env vulkan1.2
                -o ${SPV_FILE}
                ${SHADER}
            DEPENDS ${SHADER}
            COMMENT "Compiling GLSL → SPIR-V: ${SHADER_NAME}.spv"
            VERBATIM
        )
        list(APPEND SPV_FILES ${SPV_FILE})
    endforeach()

    add_custom_target(${GLSL_TARGET}_shaders ALL DEPENDS ${SPV_FILES})
    add_dependencies(${GLSL_TARGET} ${GLSL_TARGET}_shaders)

    # Export SPV directory as a compile definition
    target_compile_definitions(${GLSL_TARGET} PRIVATE
        SPV_DIR="${GLSL_OUTPUT_DIR}"
    )
endfunction()
