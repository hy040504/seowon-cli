@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if /I "%1"=="gui" goto :gui
if /I "%1"=="all" goto :tui
goto :tui

:tui
set SRC=main.c test.c lib\util.c lib\front\tui\ui.c lib\front\tui\prompt.c lib\back\fs.c lib\back\http.c lib\back\crypto.c lib\back\parse.c lib\back\data_manager.c lib\c_modules\cJSON.c
set INC=-Ilib -Ilib/front -Ilib/front/tui -Ilib/back -Ilib/c_modules
set DEF=-D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
set OUT=seowon-tui.exe
call :compile
if errorlevel 1 exit /b 1
if /I "%1"=="test" seowon-tui.exe --test
if /I "%1"=="all" goto :gui
goto :eof

:gui
set SRC=gui_main.c
set INC=
set DEF=
set OUT=seowon-gui.exe
call :compile
if errorlevel 1 exit /b 1
echo GUI: python lib\front\gui\main.py  or  seowon-gui.exe
echo   pip install -r requirements.txt
goto :eof

:compile
where gcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] gcc -^> %OUT%
  gcc -std=c11 -Wall -Wextra -O2 %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :comp_done
)
if exist "%USERPROFILE%\tools\tcc\tcc\tcc.exe" (
  echo [build] tcc -^> %OUT%
  "%USERPROFILE%\tools\tcc\tcc\tcc.exe" %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :comp_done
)
where tcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] tcc -^> %OUT%
  tcc %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :comp_done
)
where clang >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] clang -^> %OUT%
  clang -std=c11 -Wall -Wextra -O2 %INC% %DEF% -o %OUT% %SRC% -lwinhttp
  goto :comp_done
)
where cl >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] MSVC cl -^> %OUT%
  cl /nologo /utf-8 /std:c11 /O2 /W3 /Ilib /Ilib\front /Ilib\front\tui /Ilib\back /Ilib\c_modules /D_CRT_SECURE_NO_WARNINGS /DCJSON_HIDE_SYMBOLS %SRC% /Fe:%OUT% /link winhttp.lib
  goto :comp_done
)
echo Compiler not found.
exit /b 1
:comp_done
if errorlevel 1 (
  echo BUILD FAILED: %OUT%
  exit /b 1
)
echo BUILD OK: %OUT%
exit /b 0
