# seowon-client-web

<p align="center">
  <strong>같은 망의 다른 학생도 브라우저로 쓰는 e-campus 웹</strong>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-20+-339933?logo=nodedotjs&logoColor=white">
  <img alt="http" src="https://img.shields.io/badge/server-Node_http-informational">
  <img alt="API" src="https://img.shields.io/badge/engine-seowon--client--api-00599C">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

[`seowon-client-api`](https://github.com/hy040504/seowon-client-api) 를 쓰는 웹입니다.  
한 대에서 서버를 켜 두면, 같은 네트워크의 다른 학생도 브라우저로 자기 학번·비밀번호를 넣고 과제·이러닝·시간표·성적을 봅니다.

C TUI(`seowon-tui.exe`)·PyQt GUI(`seowon-gui.exe`) 의 짝입니다.  
공식 SDK가 아닙니다. 이러닝 **자동 시청**과 수강신청 **등록**은 없습니다.

---

## 왜 따로 폴더인가

C 클라이언트는 한 사람 컴퓨터에서 돕니다.  
웹은 **서버 한 번, 학생은 각자 로그인** 이라서 전용 폴더 `seowon-client-web/` 에 두었습니다.

- 비밀번호는 디스크에 쓰지 않습니다. `login.json` 을 만들지 않습니다.
- 세션은 서버 메모리와 HttpOnly 쿠키 `sw_sid` 에만 약 30분 둡니다.
- 서버를 재시작하면 세션은 사라집니다. 다시 로그인하면 됩니다.

---

## 화면

Toss 톤(라이트 `#F2F4F6` / 다크 `#17171C`) 입니다. 목록은 채용 공고 카드처럼 한 줄씩 쌓입니다.

| 메뉴 | 하는 일 |
| --- | --- |
| 로그인 | 학번·비밀번호. 성공하면 **로그인 완료**와 이름·학과. 학번은 칩에 넣지 않음 |
| 과제 | 전체 / 지금 할 수 있는 / 미제출. 행을 누르면 상세·첨부·본문·파일 제출이 펼쳐짐 |
| 강의실 자료 | 강의자료실 글과 첨부 다운로드 |
| 이러닝 | 차시·들을 차시, 학습률(%). 학교 URL 재생, 진행 막대와 X 취소가 있는 영상 받기 |
| 시간표 | 과목 목록(전공/교양)을 그림 위에 둠. 강의 30분 전·수업 중이면 천천히 깜빡임 |
| 성적 | 공개된 과목 점수·등급. 미공개는 이유만 |
| 현황 | 교과 / 비교과. 지금 기간의 미제출·미완료는 흰 글씨, 없으면 회색 |
| 설정 | 다크 모드, 다시 조회, 로그아웃 |

출결 글자색은 학교 문구를 그대로 씁니다.

| 출결 | 색 |
| --- | --- |
| 미학습 · 결석 | 밝은 빨강 `#ff2d2d` |
| 학습중 · 지각 | 민트 `#2ee6c4` |
| 학습완료 | 초밝은 록색 `#39ff14` |

조회 대기 스피너는 **그 페이지 안**에만 뜹니다. 사이드바는 그대로라서 다른 메뉴로 옮겨 조회를 병렬로 걸 수 있습니다.

시간표 사진은 `/api/timetable.html` 입니다. 공식 SVG를 흰 표만 남기도록 잘라 iframe에 넣습니다.  
단독 `/api/timetable.svg` 주소는 브라우저에서 깨질 수 있습니다.

학습률은 차시 목록에 없어서 **고른 차시만** 한 번 더 조회합니다. 시청 기록은 보내지 않습니다.

---

## 필요 환경

| 항목 | 내용 |
| --- | --- |
| Node.js | 20 이상 |
| 조회 엔진 | [seowon-client-api](https://github.com/hy040504/seowon-client-api) (이미 빌드된 `dist/`) |

실제 로그인은 API 패키지를 찾습니다. 기본으로 아래를 봅니다.

1. 환경 변수 `SEOWON_CLIENT_API`
2. `%USERPROFILE%\Desktop\개인 개발 프로젝트\seowon-client-api`

없으면 로그인이 되지 않습니다. API 저장소에서 `npm run build` 를 한 뒤 경로를 맞춰 주세요.

---

## 실행

```bat
cd seowon-client-web
start.bat
```

또는

```bat
cd seowon-client-web
node server.js
```

기본 주소는 `http://127.0.0.1:3780` 입니다.  
같은 Wi-Fi 의 다른 학생은 콘솔에 찍힌 `http://<이 컴퓨터 IP>:3780` 으로 들어옵니다.

| 환경 변수 | 기본 | 설명 |
| --- | --- | --- |
| `PORT` | `3780` | 포트 |
| `HOST` | `0.0.0.0` | 모든 망 인터페이스 |
| `SEOWON_CLIENT_API` | (자동 탐색) | API 폴더 절대 경로 |
| `SEOWON_WEB_IDLE_MS` | `1800000` | 세션 만료(ms) |

Windows 방화벽이 막으면 해당 포트 인바운드를 허용해야 다른 PC 에서 열립니다.

인터넷에 그대로 열지 마세요. HTTP 이고, 학번·비밀번호가 오갑니다. **같은 실습실·같은 Wi-Fi 실험용** 입니다.

---

## API

브라우저와 같은 출처만 씁니다. Express 없이 Node 내장 `http` 입니다.

| 방법 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/api/login` | `{ studentId, password }` |
| POST | `/api/logout` | 세션 삭제 |
| GET | `/api/me` | 로그인 여부 |
| GET | `/api/profile` | 이름·학과 (수강신청 SSO, 필요하면 그때 로그인) |
| GET | `/api/snapshot` | 전 과목 스냅샷 |
| POST | `/api/refresh` | 다시 조회 |
| GET | `/api/assignments?filter=all\|due\|missing` | 과제 표 |
| POST | `/api/assignment-detail` | `{ crsCreCd, id }` |
| POST | `/api/assignment-submit` | multipart `crsCreCd`, `id`, `text`, `file` |
| GET | `/api/materials` | 강의자료실 목록 |
| POST | `/api/material-files` | `{ crsCreCd, id }` 첨부 목록 |
| POST | `/api/download` | `{ url, title }` e-campus 파일 받기 |
| GET | `/api/lessons?filter=all\|watch` | 차시 표 |
| POST | `/api/progress` | `{ crsCreCd, lessonCntsId }` 조회만 |
| POST | `/api/lesson-download` | 이러닝 영상 스트림. 연결을 끊으면 학교 쪽도 중단 |
| GET | `/api/summary?filter=all\|curricular\|extracurricular` | 현황 한 표 |
| GET | `/api/timetable` | 수강 시간표 JSON. `?refresh=1` 다시 조회 |
| GET | `/api/timetable.html` | 흰 표만 남긴 공식 시간표 그림 |
| GET | `/api/timetable.svg` | SVG 원문 (HTML 삽입용) |
| GET | `/api/scores` | 과목별 성적. `?refresh=1` 다시 조회 |
| GET | `/api/health` | 서버·API 경로 확인 |

쿠키 `sw_sid` 는 HttpOnly · SameSite=Lax 입니다. 비밀번호는 세션 객체에 넣지 않습니다.  
같은 IP 의 로그인은 5분에 12회로 막습니다.

---

## 구조

```text
seowon-client-web/
├─ server.js            Node http + JSON API
├─ start.bat
├─ pm2-start.bat
├─ package.json
├─ lib/
│  ├─ resolve-api.js    seowon-client-api 경로
│  ├─ query.js          로그인·조회·제출·다운로드
│  ├─ filters.js        기간·미제출·들을 차시·교과/비교과
│  ├─ session.js        메모리 세션
│  └─ multipart.js      과제 제출 폼
└─ public/              브라우저 화면
   ├─ index.html
   ├─ style.css
   └─ app.js
```

주석은 [seowon-client-api](https://github.com/hy040504/seowon-client-api) 와 같이 한국어 JSDoc 입니다.

---

## 하지 않는 것

- 이러닝 자동 시청 · 출석 처리
- 수강신청 · 희망바구니 **등록** (시간표 **조회·그림**만)
- 다른 학생 계정 조회
- 서버에 `login.json` / 비밀번호 파일 저장
- 공인 인증서 없이 인터넷에 열어 두는 구성
