/** 성적 조회 메뉴 종류. e-campus 교과 성적(scoreOpenJson) 과 다름 */
export type ErpGradeMenuKind = "overall" | "undergrad";

/** Vue 성적 화면 menuId/pgmId */
export interface ErpGradeMenuContext {
  kind: ErpGradeMenuKind;
  portalMenuId: string; // 포털 메뉴 (M102947 / M104797)
  vueMenuId: string; // Vue 메뉴 (M106021 / M106020)
  portalPgmId: string;
  vuePgmId: string;
}

/** 성적 API 공통 옵션 */
export interface ErpGradeQueryOptions {
  stuno?: string; // 학번. 생략 시 세션 GLIO
  syy?: string; // 학년도
  smtCd?: string; // 학기 코드 (10=1학기, 20=2학기, 11=여름, 21=겨울)
  menuId?: string; // Vue 메뉴 ID
  pgmId?: string; // 프로그램 ID
  baseUrl?: string;
}

/** 이수학기 목록 (dsSgra251, findStdntGradeSyyList) */
export interface ErpGradeYear {
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  raw: Record<string, unknown>;
}

/**
 * 학기별 평점 합계 (dsSgra251, findGradeTotalDtlsStuList).
 * 행마다 누계(Ttl) 필드가 반복된다.
 */
export interface ErpGradeTermTotal {
  stuno: string; // 학번
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  cmpsjHy: string; // 이수학년
  aplyCdt: number | null; // 신청 학점
  acqsCdt: number | null; // 취득 학점
  gpa: number | null; // 학기 GPA
  tgp: number | null; // 학기 평점합
  percnSco: number | null; // 학기 백분위
  fcdtExclsTgp: number | null; // F학점 제외 평점
  smtStnd: string; // 학기 석차 (예: 10/43)
  aplyCdtTtl: number | null; // 누계 신청 학점
  acqsCdtTtl: number | null; // 누계 취득 학점
  gpaTtl: number | null; // 누계 GPA
  tgpTtl: number | null; // 누계 평점합
  percnScoTtl: number | null; // 누계 백분위
  fcdtExclsTgpTtl: number | null; // 누계 F제외 평점
  fcdtInclsTgpTtl: number | null; // 누계 F포함 평점
  fnpGpa: number | null; // 최종 GPA
  fnpAplyCdt: number | null; // 최종 신청 학점
  fnpMjPercnSco: string; // 전공 백분위
  ratlcAccmlCnt: number | null; // 재수강 누계
  fcdtSubjcCnt: number | null; // F 과목 수
  acprbYn: string; // 학사경고 여부
  raw: Record<string, unknown>;
}

/** 과목 성적 상세 (dsSgra211, findGradeMastrDtlsStuList) */
export interface ErpGradeSubject {
  stuno: string; // 학번
  syy: string; // 학년도
  smtCd: string; // 학기 코드
  smtNm: string; // 학기명
  subjtCd: string; // 과목코드
  subjtNm: string; // 과목명
  corseDvclsNo: string; // 분반
  cmpsjDivCd: string; // 이수 구분 코드 (01 전필, 02 전선, 03 교필, 04 교선 등)
  cmpsjCdt: number | null; // 학점
  cmpsjGradeGrdCd: string; // 등급 (A+, A, B+, P, F 등)
  cmpsjGp: number | null; // 평점
  cmpsjSco: number | null; // 점수 (패킷에서는 0 또는 null)
  absncHrs: number | null; // 결석 시간
  absncGradeGrdCd: string; // 출석 등급
  gradeSubjtCmpsjNo: string; // 성적 이수 번호
  raw: Record<string, unknown>;
}

/** 학기 단위로 묶은 전체 성적 */
export interface ErpGradeTermBundle {
  year: ErpGradeYear;
  total?: ErpGradeTermTotal;
  subjects: ErpGradeSubject[];
}

/** 전체학기 성적 조회 결과 */
export interface ErpOverallGrades {
  years: ErpGradeYear[];
  totals: ErpGradeTermTotal[];
  terms: ErpGradeTermBundle[];
  subjects: ErpGradeSubject[];
}

/** ClipReport 성적표 인쇄 요청 (데이터 JSON API 아님) */
export interface ErpGradeReportOptions {
  syy: string;
  smtCd: string;
  subjtCd: string;
  corseDvclsNo: string;
  filePath?: string; // 기본 sch/sgra/sgradc/sgradc0150_prn02
  reportParams?: Record<string, string>;
  baseUrl?: string;
}
