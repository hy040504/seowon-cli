@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY if exist "%LocalAppData%\Programs\Python\Python314\python.exe" set "PY=%LocalAppData%\Programs\Python\Python314\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"

if not defined PY (
  echo Python 3.10+ not found. Install Python and enable Add to PATH.
  pause
  exit /b 1
)

echo Starting seowon GUI...
%PY% seowon_gui.py %*
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo GUI failed, exit %ERR%.
  echo   %PY% -m pip install -r requirements.txt
  echo   %PY% seowon_gui.py
  echo Log: seowon-gui.log
  pause
)
exit /b %ERR%
