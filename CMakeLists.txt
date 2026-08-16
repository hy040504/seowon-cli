cmake_minimum_required(VERSION 3.16)
project(seowon-cli C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(seowon-core
    main.c
    test.c
    lib/util.c
    lib/back/fs.c
    lib/back/http.c
    lib/back/crypto.c
    lib/back/parse.c
    lib/back/data_manager.c
    lib/back/ssv.c
    lib/back/sugang.c
    lib/back/ui_notify.c
    lib/c_modules/cJSON.c
)
target_include_directories(seowon-core PRIVATE lib lib/front lib/back lib/c_modules)
target_compile_definitions(seowon-core PRIVATE _CRT_SECURE_NO_WARNINGS CJSON_HIDE_SYMBOLS)

add_executable(seowon-gui gui_main.c)
if(WIN32)
    target_link_libraries(seowon-gui PRIVATE user32)
endif()

if(MSVC)
    target_compile_options(seowon-core PRIVATE /utf-8 /W3)
    target_link_libraries(seowon-core PRIVATE winhttp)
elseif(WIN32)
    target_compile_options(seowon-core PRIVATE -Wall -Wextra)
    target_link_libraries(seowon-core PRIVATE winhttp)
endif()

set_target_properties(seowon-core seowon-gui PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR})
