@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title seowon-cli 외부 저장소 강제 최신화

echo.
echo [주의] 이 작업은 현재 프로젝트의 추적 파일 변경사항을 원격 main 상태로 덮어씁니다.
echo        의존성 설치(npm install) 및 빌드(npm run build)는 자동으로 수행되지 않습니다.
echo.
choice /C YN /N /M "계속하시겠습니까? [Y/N] "
if errorlevel 2 exit /b 0

where git >nul 2>nul
if errorlevel 1 (
  echo Git을 찾을 수 없습니다.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo Git 저장소가 아닙니다.
  pause
  exit /b 1
)

for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "OLD_COMMIT=%%H"
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH set "CURRENT_BRANCH=main"

echo.
echo [1/4] 원격 저장소 정보 갱신 중...
git fetch origin --prune
if errorlevel 1 goto :fail

echo [2/4] 현재 상태 백업 브랜치 생성 중...
set "BACKUP_BRANCH=before-force-update-%RANDOM%"
git branch "%BACKUP_BRANCH%" HEAD >nul 2>nul

echo [3/4] 원격 main 상태로 강제 동기화 중...
git reset --hard HEAD
if errorlevel 1 goto :fail
git switch main
if errorlevel 1 goto :fail
git reset --hard origin/main
if errorlevel 1 goto :fail

echo [4/4] 결과 확인...
git status --short --branch
for /f "delims=" %%N in ('git rev-parse --short HEAD 2^>nul') do set "NEW_COMMIT=%%N"

echo.
echo 외부 저장소 강제 최신화가 완료되었습니다.
echo 이전 커밋: %OLD_COMMIT%
echo 현재 커밋: %NEW_COMMIT%
echo 백업 브랜치: %BACKUP_BRANCH%
echo.
echo 참고: 필요한 경우 'npm install' 또는 'npm run build'를 직접 실행하세요.
pause
exit /b 0

:fail
echo.
echo 외부 저장소 강제 최신화에 실패했습니다. 위 오류를 확인하세요.
pause
exit /b 1
