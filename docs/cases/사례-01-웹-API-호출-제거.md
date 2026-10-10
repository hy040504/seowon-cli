# CASE-001: 메뉴가 웹 API를 호출하고 웹 서버 없이는 동작하지 않음

## 증상

- 로그가 `GET /api/snapshot?refresh=1` 처럼 웹 경로로 나온다.
- `http://127.0.0.1:3780` 이 떠 있어야 CLI가 조회된다.
- 학생웹 관제 메뉴와 웹 서버 코드가 CLI 안에 있다.

## 원인

- 학생 웹의 API CLI를 그대로 가져와, 이 프로세스가 웹 서버의 클라이언트로 동작했다.
- 화면 로그가 HTTP 메서드와 경로를 찍었다.

## 해결

- `Campus` 가 `lib/back/services` 를 직접 부른다. 웹 서버를 띄우지 않는다.
- 추적 로그는 `fetchSnapshot({"refresh":true})` 처럼 함수 이름만 남긴다.
- 학생웹 관제 메뉴와 그 소스를 제거했다.
- 이러닝 시청 기록(`watchLesson`)은 호출하지 않는다.

## 적용 파일

- `lib/back/campus.ts`
- `lib/front/tui/tui-kit.ts` — `bindApi`
- `lib/front/tui/cli.ts`

## 상태

✅ 해결
