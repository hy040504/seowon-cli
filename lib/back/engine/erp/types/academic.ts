/** 공통 코드 항목 (findCodeComboList) */
export interface ErpCodeItem {
  code: string; // 코드
  abnm: string; // 약칭
  fullNm: string; // 전체명
  useYn: string; // 사용 여부
  groupId: string; // 그룹 ID
  raw: Record<string, unknown>;
}

/** 성적 화면에서 쓰는 코드콤보 묶음 */
export interface ErpCodeComboSet {
  semesters: ErpCodeItem[]; // dsSmtCd
  courseDivisions: ErpCodeItem[]; // dsCmpsjDivCd
  gradeLetters: ErpCodeItem[]; // dsCmpsjGradeGrdCd
  raw: Record<string, unknown>;
}

/** 학사일정 조회 결과 (findScomUnvfrSchdlInfo dsUnvfc.reslt) */
export interface ErpScheduleWindow {
  reslt: string; // 시작+종료 결합 문자열 (예: 2026070109000020260703235959)
  beginDt: string; // 앞 14자리
  endDt: string; // 뒤 14자리
  raw: Record<string, unknown>;
}

/**
 * 학생 학적 기본정보 (findSchrgBassInfoStud dsResult).
 * e-campus / 수강신청 학생정보와 필드가 다르다.
 */
export interface ErpAcademicProfile {
  stuno: string; // 학번
  stdntNm: string; // 이름
  stdntPerslNo: string; // 개인번호
  hy: string; // 학년
  hy2: string; // 학년 표시 (예: 2(2))
  deptCd: string; // 학과 코드
  deptNm: string; // 학과명
  deprtCd: string; // 학과 코드(동의)
  deprtNm: string; // 학과명(동의)
  univCd: string; // 단과대 코드
  univNm: string; // 단과대명
  deptFullNm: string; // 단과대+학과
  schrgSttusCd: string; // 학적 상태 코드
  schrgSttusNm: string; // 학적 상태명
  dghtDivCd: string; // 주야 구분 코드
  dghtDivNm: string; // 주야 구분명
  dgriCrseCd: string; // 학위과정 코드
  dgriCrseNm: string; // 학위과정명
  applyCrseCd: string; // 과정 코드
  applyCrseNm: string; // 과정명
  entnsDt: string; // 입학일
  entnsDtF: string; // 입학일 표시
  entnsDivCd: string; // 입학 구분 코드
  entnsDivNm: string; // 입학 구분명
  entnsTypeCd: string; // 입학 유형 코드
  entnsTypeNm: string; // 입학 유형명
  crclmApplcYy: string; // 교육과정 적용 연도
  cmpsjSecnt: number | null; // 이수학기 수
  acqsCdt: number | null; // 취득 학점
  acdadNm: string; // 지도교수
  majorNmMain: string; // 주전공명
  majorCdMain: string; // 주전공 코드
  photoAttflUuid: string; // 사진 첨부 UUID
  raw: Record<string, unknown>;
}

/** 강의평가 기간 체크 (executeUnvfcCheck) */
export interface ErpLectureEvalCheck {
  allowed: boolean; // ErrorCode === 0
  errorCode: number | null;
  errorMsg: string; // 기간이 아니면 안내 메시지
  raw: string; // 원본 본문
}

/** 온라인투표 목록 (findVoteYyElecInfoRegList dsSstd300) */
export interface ErpVoteInfo {
  raw: Record<string, unknown>;
}

/** 강의평가 기간 체크 옵션 */
export interface ErpLectureEvalCheckOptions {
  syy?: string;
  smtCd?: string;
  lessnEvlEraDivCd?: string;
  stuno?: string;
  menuId?: string;
  pgmId?: string;
  baseUrl?: string;
}
