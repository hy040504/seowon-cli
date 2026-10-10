# CASE-021: Windows 배치에서 주석이 명령어로 실행됨

## 증상

- Windows에서 `cli.bat`을 실행해도 CLI 메뉴가 열리지 않는다.
- `cmd /d /c cli.bat --help`로 재현하면 `'의존성이' is not recognized as an internal or external command` 오류와 npm 사용법이 출력되고 종료 코드 1을 반환한다.

## 원인

- 기존 배치 파일은 UTF-8 한글 주석과 LF 줄바꿈을 사용했지만, 실행 당시 cmd의 코드 페이지는 949였다.
- 이 조합에서 주석·명령 경계가 정상 처리되지 않아 주석 일부가 명령으로 실행되고 npm 호출도 깨졌다.
- 의존성 설치 실패 처리의 `%errorlevel%`은 괄호 블록을 읽는 시점에 확장되므로, 설치 직후의 실패 코드를 정확히 전달하지 못할 수 있었다.

## 해결

- 한글 주석보다 앞에 `chcp 65001 >nul`을 두어 UTF-8 코드 페이지를 설정한다.
- 배치 파일을 BOM 없는 UTF-8과 Windows 줄바꿈(CRLF)으로 저장한다.
- `.gitattributes`에 `cli.bat text eol=crlf`를 지정해 Git 체크아웃 시 CRLF를 유지한다.
- 프로젝트 폴더 이동 실패 시 종료한다.
- `node_modules` 폴더가 있으면 실행 단계로 이동하고, 없으면 `npm install`을 실행한 뒤 별도 줄에서 실패 종료 코드를 확인한다.
- CLI에 전달받은 인자를 그대로 넘기고 CLI의 종료 코드를 반환한다.

## 적용 파일

- `cli.bat` — 코드 페이지, 폴더 이동, 의존성 설치, CLI 실행과 종료 코드 처리
- `.gitattributes` — 배치 파일의 Git 줄바꿈 규칙
- `README.md`, `docs/README.md`, `docs/BUGFIX_LOG.md` — 실행 설명과 사례·수정 기록

## 검증

- `cmd /d /c cli.bat --help`: 한글 도움말 정상 출력, 종료 코드 0.
- 실제 터미널에서 `cmd /d /c cli.bat`: 메뉴 표시 후 `0` 입력으로 정상 종료, 종료 코드 0.
- `cmd /d /c cli.bat --suite invalid`: 잘못된 조사 옵션 안내 후 종료 코드 1.
- `git check-attr text eol -- cli.bat`: `text: set`, `eol: crlf` 확인.
- 기존 `node_modules`가 있는 환경에서 검증했다. 의존성 최초 설치 경로는 실제 설치로 검증하지 않았다.

상태: ✅ 해결
