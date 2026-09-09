@echo off
setlocal EnableExtensions
cd /d "%~dp0"

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>nul
if errorlevel 1 (
  echo Python 3.10 이상을 찾지 못했습니다. https://www.python.org 에서 설치하세요.
  exit /b 1
)

if /I "%~1"=="gui" (
  python seowon_gui.py %2
  exit /b %ERRORLEVEL%
)
if /I "%~1"=="test" (
  python seowon_tui.py --test
  exit /b %ERRORLEVEL%
)
if /I "%~1"=="demo" (
  python seowon_tui.py --demo
  exit /b %ERRORLEVEL%
)
if /I "%~1"=="help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="--help" goto :help

python seowon_tui.py %*
exit /b %ERRORLEVEL%

:help
echo seowon-cli  (Python)
echo   build.bat            TUI
echo   build.bat demo       TUI 데모
echo   build.bat test       단위 테스트
echo   build.bat gui        GUI
echo   build.bat gui --demo GUI 데모
echo.
echo   pip install -r requirements.txt
exit /b 0
