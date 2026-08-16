@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if /I "%1"=="gui" goto :gui
if /I "%1"=="test" goto :core
goto :all

:all
call :core
if errorlevel 1 exit /b 1
goto :gui

:core
set SRC=main.c test.c lib\util.c lib\back\fs.c lib\back\http.c lib\back\crypto.c lib\back\parse.c lib\back\data_manager.c lib\back\ssv.c lib\back\sugang.c lib\back\ui_notify.c lib\c_modules\cJSON.c
set INC=-Ilib -Ilib/front -Ilib/back -Ilib/c_modules
set DEF=-D_CRT_SECURE_NO_WARNINGS -DCJSON_HIDE_SYMBOLS
set OUT=seowon-tui.exe
call :compile
if errorlevel 1 exit /b 1
if /I "%1"=="test" seowon-tui.exe --test
goto :eof

:gui
set SRC=gui_main.c
set INC=
set DEF=
set OUT=seowon-gui.exe
call :compile
if errorlevel 1 exit /b 1
echo GUI: seowon-gui.exe  or  python lib\front\gui\main.py
echo   pip install -r requirements.txt
goto :eof

:compile
where gcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] gcc -^> %OUT%
  gcc -std=c11 -Wall -Wextra -O2 %INC% %DEF% -o %OUT% %SRC% -lwinhttp -luser32
  goto :comp_done
)
if exist "%USERPROFILE%\tools\tcc\tcc\tcc.exe" (
  echo [build] tcc -^> %OUT%
  "%USERPROFILE%\tools\tcc\tcc\tcc.exe" %INC% %DEF% -o %OUT% %SRC% -lwinhttp -luser32
  goto :comp_done
)
where tcc >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [build] tcc -^> %OUT%
  tcc %INC% %DEF% -o %OUT% %SRC% -lwinhttp -luser32
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
