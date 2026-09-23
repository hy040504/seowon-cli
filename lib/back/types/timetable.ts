/** timtbNm 한 줄에서 푼 교시 슬롯. day는 Date.getDay() (0=일) */
export interface LectureSlot {
  day: number; // 요일 숫자 (0=일 … 6=토)
  period: number; // 교시 번호
  startMin: number; // 시작 시각(자정 기준 분)
  endMin: number; // 종료 시각(자정 기준 분)
}

/** 웹 시간표 과목 한 줄. API 과목을 화면용으로 얇게 직렬화한다 */
export interface TimetableSubjectRow {
  subjtCd: string; // 과목 코드
  subjtNm: string; // 과목명
  corseDvclsNo: string; // 분반
  cmpsjCdt: string; // 학점
  chrgInstrEmpnm: string; // 담당 교원명
  timtbNm: string; // 시간표 문자열 원문
  kind: string; // 전공 · 교양 · 기타
  slots: LectureSlot[]; // 요일·교시로 푼 슬롯
}

/** API 시간표에서 꺼낸 원본 과목. 본신청·희망바구니 필드가 들쑥날쑥하다 */
export interface TimetableSubjectLike {
  subjtCd?: string; // 과목 코드
  subjtNm?: string; // 과목명
  corseDvclsNo?: string; // 분반
  cmpsjCdt?: string | number; // 학점
  chrgInstrEmpnm?: string; // 담당 교원명
  timtbNm?: string; // 시간표 문자열
  cmpsjDivCd?: string; // 이수 구분 코드
  estblCrseDivNm?: string; // 개설 과정 구분명
  cmpsjDivNm?: string; // 이수 구분명
}

/** 공식 SVG 렌더가 쓰는 셀(요일×교시) */
export interface TimetableCellLike {
  day?: string; // 요일 한글 (월…금)
  period?: number; // 교시 번호
  subjects?: Array<{
    subjtNm?: string; // 과목명
    place?: string; // 강의실/장소
  }>;
}

/** getMyRegisteredTimetable / getMyHopeBasketTimetable 공통 모양 */
export interface TimetableLike {
  courseCount?: number; // 과목 수
  totalCredits?: number | string; // 학점 합
  conflicts?: unknown[]; // 같은 칸 충돌 셀
  subjects?: TimetableSubjectLike[]; // 원본 과목 목록
  cells?: TimetableCellLike[]; // 공식 렌더 셀
}

/**
 * JSON + 그림이 붙은 웹 시간표.
 * source=registered 는 본신청 확정 목록, basket 은 희망바구니 목록.
 */
export interface WebTimetable {
  source: "registered" | "basket"; // 데이터 출처
  label: string; // 화면 짧은 이름
  title: string; // 그림 제목 (이름 + 수강/희망바구니)
  courseCount: number; // 과목 수
  totalCredits: number | string; // 학점 합
  conflictCount: number; // 충돌 칸 수
  subjects: TimetableSubjectRow[]; // 화면용 과목 목록
  svg: string; // 공식 SVG(여백 자름) 또는 격자 SVG
  html: string; // iframe용 흰 HTML 래퍼
}
