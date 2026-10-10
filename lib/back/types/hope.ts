/** 화면용 희망바구니 과목 한 줄. API 원본(raw SSV)은 넣지 않는다 */
export interface HopeSubjectRow {
  subjtCd: string; // 과목 코드
  subjtNm: string; // 과목명
  corseDvclsNo: string; // 분반
  estblDeprtNm: string; // 개설 학과명
  asignDeprtCd: string; // 배정/개설 학과 코드
  cmpsjCdt: string; // 학점
  cmpsjDivCd: string; // 이수 구분 코드
  cmpsjDivNm: string; // 이수 구분명
  cmpsjHyDivCd: string; // 이수 학년 구분 코드
  yearLabel: string; // 1학년 · 전체학년
  chrgInstrEmpnm: string; // 담당 교원명
  timtbNm: string; // 시간표 문자열
  hopeAppcsCnt: string; // 희망 신청 인원
  appcsLmttPcnt: string; // 수강 제한 인원
  slesLessnItem: string; // 평가/수업 속성 (e러닝 등)
  remrk: string; // 비고
}

/** 담기·취소 한 건 결과 */
export interface HopeMutationRow {
  success: boolean; // 성공 여부
  message: string; // 사용자 표시 메시지
  action: string; // add | cancel | check
  subjtCd: string; // 대상 과목 코드
  corseDvclsNo: string; // 대상 분반
}

/** 일괄 담기·취소의 한 줄 */
export interface HopeBatchItem {
  subject: HopeSubjectRow; // 대상 과목
  result: HopeMutationRow; // 처리 결과
}

/** 전공 자동담기 미리보기 */
export interface HopeMajorPreview {
  deptCd: string; // 대상 학과 코드
  deptName: string; // 학과명
  hy: string; // 학생 학년
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  allCount: number; // 학과 시간표 전체 분반 수
  candidates: HopeSubjectRow[]; // 학년 매칭 후보
  totalCredits: number; // 후보 학점 합
}

/** 희망바구니 관련 일정 */
export interface HopeScheduleRow {
  appcsSchdlCd: string; // 신청 일정 코드
  appcsNm: string; // 신청명
  appcsSchdlNm: string; // 일정 표시명
  endDate: string; // 기간 표시 문자열
  remrk: string; // 비고
  isActive: boolean; // 지금 적용 중인지
}

/** 검색 필터용 개설 학과 */
export interface HopeDepartmentRow {
  asignDeprtCd: string; // 개설 학과 코드
  deptNm: string; // 학과명
}

/** 과목코드-분반 식별 */
export interface HopeTarget {
  subjtCd: string; // 과목 코드
  corseDvclsNo: string; // 분반
}
