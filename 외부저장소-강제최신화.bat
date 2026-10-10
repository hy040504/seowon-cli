@echo off
rem 사용자 확인 후 추적 파일을 origin/main과 동기화하는 수동 실행 도구다.
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

rem Git 설치와 현재 폴더의 저장소 여부를 먼저 확인한다.
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

rem 동기화 결과 안내에 사용할 이전 커밋과 현재 브랜치를 읽는다.
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "OLD_COMMIT=%%H"
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH set "CURRENT_BRANCH=main"

echo.
echo [1/4] 원격 저장소 정보 갱신 중...
rem 원격 추적 브랜치를 갱신하고 삭제된 원격 브랜치 정보를 정리한다.
git fetch origin --prune
if errorlevel 1 goto :fail

rem 재작성된 이력과 이전 복제본을 섞지 않는다. 공개 데이터 검사도 백업 생성 전에 수행한다.
git merge-base HEAD origin/main >nul 2>nul
if errorlevel 1 goto :require_clone
if not exist "scripts\security\public-data.mjs" goto :require_clone
where node >nul 2>nul
if errorlevel 1 goto :require_clone
node scripts/security/public-data.mjs --history --summary
if errorlevel 1 goto :require_clone

echo [2/4] 현재 상태 백업 브랜치 생성 중...
set "BACKUP_BRANCH=before-force-update-%RANDOM%"
rem 백업 브랜치는 현재 커밋만 보존한다. 커밋하지 않은 파일 변경은 포함하지 않는다.
git branch "%BACKUP_BRANCH%" HEAD >nul 2>nul
if errorlevel 1 goto :fail

echo [3/4] 원격 main 상태로 강제 동기화 중...
rem 추적 파일의 미커밋 변경을 버린 뒤 main을 원격 main 커밋으로 맞춘다.
git reset --hard HEAD
if errorlevel 1 goto :fail
git switch main
if errorlevel 1 goto :fail
git reset --hard origin/main
if errorlevel 1 goto :fail

echo [4/4] 결과 확인...
rem 현재 저장소 상태와 갱신된 커밋을 완료 안내에 표시한다.
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

:require_clone
echo.
echo 이전 이력 또는 공개 검사에 문제가 있어 강제 동기화를 중단했습니다.
echo GitHub 저장소를 새 폴더에 복제하고 보안 안내의 이전 복제본 정리 절차를 따르세요.
echo 기존 백업 브랜치나 Git 메타데이터를 새 복제본으로 병합하지 마세요.
pause
exit /b 1

:fail
rem 앞선 Git 작업이 실패하면 오류 안내 후 실패 종료 코드를 반환한다.
echo.
echo 외부 저장소 강제 최신화에 실패했습니다. 위 오류를 확인하세요.
pause
exit /b 1
