@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set SRC=main.c test.c lib\util.c lib\front\tui\ui.c lib\front\tui\prompt.c lib\back\fs.c lib\back\http.c lib\back\crypto.c lib\back\parse.c lib\back\data_manager.c lib\back\ssv.c lib\back\sugang.c lib\c_modules\cJSON.c
set INC=-Ilib -Ilib/front -Ilib/front/tui -Ilib/back -Ilib/c_modules
set DEF=-D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
set OUT=seowon-tui.exe

where gcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] gcc
  gcc -std=c11 -Wall -Wextra -O2 %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :done
)
if exist "%USERPROFILE%\tools\tcc\tcc\tcc.exe" (
  echo [build] tcc
  "%USERPROFILE%\tools\tcc\tcc\tcc.exe" %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :done
)
where tcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] tcc
  tcc %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :done
)
where clang >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] clang
  clang -std=c11 -Wall -Wextra -O2 %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :done
)
where cl >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] MSVC cl
  cl /nologo /utf-8 /std:c11 /O2 /W3 /Ilib /Ilib\front /Ilib\front\tui /Ilib\back /Ilib\c_modules /D_CRT_SECURE_NO_WARNINGS /DCJSON_HIDE_SYMBOLS %SRC% /Fe:%OUT% /link winhttp.lib
  goto :done
)
echo Compiler not found.
exit /b 1

:done
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo BUILD OK: %OUT%
if /I "%1"=="test" seowon-tui.exe --test
endlocal
