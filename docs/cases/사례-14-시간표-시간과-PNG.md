# CASE-014: 시간표 시간 칸이 비고, 과목을 고르면 SVG·HTML 저장으로 감

## 증상

- 과목 이름은 나오는데 시간 열이 비어 있다.
- 과목을 고르면 시간표 그림 저장으로 들어가고, 저장 형식은 SVG와 HTML뿐이다.

## 원인

- 화면이 `tmRms`, `time` 을 읽었다. 수강 목록의 시간 문자열은 `timtbNm` 이다.
- 저장 메뉴가 과목 선택 다음에 붙어 있었다.

## 해결

- 시간 칸은 `timtbNm` 을 보여 준다. 없으면 요일·교시 슬롯을 이어 붙인다.
- 시간표 메뉴는 "과목 목록" 과 "PNG 저장" 으로 나뉜다. 과목을 열면 시간·교수·학점만 확인하고 목록으로 돌아간다.
- PNG는 시간표 SVG를 `@resvg/resvg-js` 로 바꾼 파일이다. SVG·HTML 파일은 저장하지 않는다.
- 저장 위치는 매번 고른 폴더다.

## 적용 파일

- `lib/front/tui/cli.ts` — `pageTt`, `subjectTimeText`
- `lib/back/services/timetable/timetable.ts` — `renderTimetablePng`
- `lib/back/campus.ts` — `saveTimetableFile`
- `lib/front/tui/tui-actions.ts` — `saveTimetable`

## 상태

✅ 해결
