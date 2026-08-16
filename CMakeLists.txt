cmake_minimum_required(VERSION 3.16)
project(seowon-cli C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(seowon-cli
    main.c
    test.c
    lib/util.c
    lib/front/ui.c
    lib/front/prompt.c
    lib/back/fs.c
    lib/back/http.c
    lib/back/crypto.c
    lib/back/parse.c
    lib/back/data_manager.c
    lib/c_modules/cJSON.c
)

target_include_directories(seowon-cli PRIVATE
    lib
    lib/front
    lib/back
    lib/c_modules
)
target_compile_definitions(seowon-cli PRIVATE _CRT_SECURE_NO_WARNINGS CJSON_HIDE_SYMBOLS)

if(MSVC)
    target_compile_options(seowon-cli PRIVATE /utf-8 /W3)
    target_link_libraries(seowon-cli PRIVATE winhttp)
elseif(WIN32)
    target_compile_options(seowon-cli PRIVATE -Wall -Wextra)
    target_link_libraries(seowon-cli PRIVATE winhttp)
endif()

set_target_properties(seowon-cli PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR})
