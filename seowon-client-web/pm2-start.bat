@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PM2=%APPDATA%\npm\pm2.cmd
if not exist "%PM2%" (
  echo pm2 가 없습니다.
  exit /b 1
)
call "%PM2%" delete seowon-web >nul 2>nul
call "%PM2%" start "%~dp0server.js" --name seowon-web --cwd "%~dp0" --interpreter node
call "%PM2%" save
