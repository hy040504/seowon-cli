@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0node_modules" ( call npm.cmd --prefix "%~dp0" install || exit /b %errorlevel% )
call npm.cmd run api-cli -- %*
exit /b %errorlevel%
