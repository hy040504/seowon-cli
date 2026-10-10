/** 학기 합계에서 화면에 쓰는 숫자만 남긴 요약 */
export interface WebErpGradeTotal {
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  cmpsjHy: string; // 이수학년
  aplyCdt: number | null; // 신청 학점
  acqsCdt: number | null; // 취득 학점
  gpa: number | null; // 학기 GPA
  tgp: number | null; // 학기 평점합
  percnSco: number | null; // 학기 백분위
  smtStnd: string; // 학기 석차
  aplyCdtTtl: number | null; // 누계 신청 학점
  acqsCdtTtl: number | null; // 누계 취득 학점
  gpaTtl: number | null; // 누계 GPA
  percnScoTtl: number | null; // 누계 백분위
  fnpGpa: number | null; // 최종 GPA
  acprbYn: string; // 학사경고 여부
}

/** 과목 성적 한 줄 */
export interface WebErpGradeSubject {
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  termLabel: string; // 표시용 학기명
  subjtCd: string; // 과목코드
  subjtNm: string; // 과목명
  corseDvclsNo: string; // 분반
  cmpsjDivCd: string; // 이수 구분 코드
  cmpsjDivNm: string; // 이수 구분명
  cmpsjCdt: number | null; // 학점
  cmpsjGradeGrdCd: string; // 등급
  cmpsjGp: number | null; // 평점
  absncHrs: number | null; // 결석 시간
}

/** 학기 묶음 */
export interface WebErpGradeTerm {
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  label: string; // 예: 2024학년도 1학기
  total: WebErpGradeTotal | null; // 학기 합계. 아직 없으면 null
  subjects: WebErpGradeSubject[]; // 과목 상세. 미조회면 빈 배열
  subjectsLoaded: boolean; // 해당 학기 과목 상세를 이미 조회했는지
}

/** 누계 요약 */
export interface WebErpGradeSummary {
  gpa: number | null; // 누계 GPA
  fnpGpa: number | null; // 최종 GPA
  aplyCdt: number | null; // 누계 신청 학점
  acqsCdt: number | null; // 누계 취득 학점
  percnSco: number | null; // 누계 백분위
  termCount: number; // 이수학기 수
  subjectCount: number; // 과목 수
}

/** ERP 전체학기 성적 (웹 응답) */
export interface WebErpOverallGrades {
  summary: WebErpGradeSummary;
  terms: WebErpGradeTerm[];
  subjects: WebErpGradeSubject[];
  divisions: Record<string, string>; // 이수구분 코드 → 이름
}
