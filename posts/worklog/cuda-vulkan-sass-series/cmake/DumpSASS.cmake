# DumpSASS.cmake
# Provides dump_sass() function to extract SASS from CUDA object files.
#
# Usage:
#   dump_sass(
#     TARGET my_cuda_target
#     OUTPUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/sass
#   )

function(dump_sass)
    cmake_parse_arguments(SASS "" "TARGET;OUTPUT_DIR" "" ${ARGN})

    if(NOT CUOBJDUMP)
        message(WARNING "cuobjdump not found — skipping SASS dump for ${SASS_TARGET}")
        return()
    endif()

    if(NOT SASS_OUTPUT_DIR)
        set(SASS_OUTPUT_DIR "${CMAKE_CURRENT_BINARY_DIR}/sass")
    endif()
    file(MAKE_DIRECTORY ${SASS_OUTPUT_DIR})

    set(SASS_FILE "${SASS_OUTPUT_DIR}/${SASS_TARGET}.sass")

    add_custom_command(
        TARGET ${SASS_TARGET} POST_BUILD
        COMMAND ${CUOBJDUMP} --dump-sass $<TARGET_FILE:${SASS_TARGET}>
                > ${SASS_FILE}
        COMMENT "Dumping SASS: ${SASS_TARGET}.sass"
        VERBATIM
    )
endfunction()
