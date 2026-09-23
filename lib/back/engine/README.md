# engine

학교 e-campus, 통합정보(ERP)와 **직접 통신**하는 외부 연동 계층입니다.

업무 로직·목록 가공·제출 오케스트레이션은 `lib/back/services` 가 맡습니다.  
이 폴더는 로그인·쿠키·원본 조회 프로토콜만 둡니다. 웹 서버는 이 저장소에 없습니다.

원본은 [seowon-client-api](https://github.com/hy040504/seowon-client-api) 이고, SAZ 분석·개설 DB는 가져오지 않았습니다.

| 폴더 | 웹에서 쓰는 일 |
| --- | --- |
| `ecampus/` | 로그인, 과목·과제·공지·자료·이러닝 URL·현재 학기 성적 조회 |
| `erp/` | 통합정보시스템 로그인, 지난 성적(학기 선택) 조회 |
| `course-registration/` | 확정 수강 목록·시간표 SVG |

공개 진입점은 `index.ts` 입니다.

`lib/back/engine/ecampus`, `lib/back/engine/erp`, `lib/back/engine/course-registration` 은 이 계층 내부 경로입니다.  
화면용 가공은 `lib/back/services/ecampus`, `lib/back/services/erp`, `lib/back/services/timetable` 에 있습니다.
