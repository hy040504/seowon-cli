@echo off
setlocal EnableExtensions
chcp 65001 >nul
rem 프로젝트 폴더에서 CLI를 실행하고 전달받은 명령행 인자를 그대로 넘긴다.
cd /d "%~dp0" || exit /b 1
rem 처음 실행해 의존성이 없으면 설치하고, 설치 실패 시 종료한다.
if exist "%~dp0node_modules\" goto run
call npm.cmd ci
if errorlevel 1 exit /b %errorlevel%

:run
call npm.cmd run api-cli -- %*
rem 호출한 CLI의 종료 코드를 배치 실행 결과로 반환한다.
exit /b %errorlevel%
