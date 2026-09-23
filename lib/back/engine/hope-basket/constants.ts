/**
 * 수강희망바구니 모듈 상수.
 * 이 모듈은 정식 수강신청(본신청)이 아니라 희망바구니(appcsKindCd=100) 전용이다.
 */

/** sugangh 호스트 (희망바구니/수강신청 공통 서버) */
export const DEFAULT_SUGANG_BASE_URL = "https://sugangh.seowon.ac.kr";

/** 학부 기준 부서 코드 */
export const DEFAULT_UNVFR_STDR_DEPT_CD = "20000";

/** 희망바구니 메뉴 ID */
export const DEFAULT_BASKET_MENU_ID = "M100779";

/** 희망바구니 프로그램 ID */
export const DEFAULT_BASKET_PGM_ID = "P001609";

/** 포털 기본 메뉴 ID */
export const DEFAULT_PORTAL_MENU_ID = "edu";

/** 포털 기본 프로그램 ID */
export const DEFAULT_PORTAL_PGM_ID = "edu";

/** 희망바구니 신청 종류 코드 (100=희망바구니, 정식 수강신청 코드와 다름) */
export const DEFAULT_APPCS_KIND_CD = "100";

/** 로그인 공지 구분 코드 */
export const DEFAULT_NOTC_CL_CD = "L";

/** 희망바구니 검증 대상 구분 (H=Hope) */
export const DEFAULT_BASKET_CHECK_TARGET = "H";

/**
 * 희망바구니 관련 sugangh API 경로 모음.
 * 정식 수강신청 경로가 추가되면 별도 모듈/상수로 분리한다.
 */
export const SUGANG_PATHS = {
  findAppcsLogin: "/com/SsoCtr/findAppcsLogin.do",
  findStunoInfo: "/com/SsoCtr/findStunoInfo.do",
  findAppcsLoginChk: "/com/SsoCtr/findAppcsLoginChk.do",
  findScomUnvfrSchdlInfo: "/com/SsoCtr/findScomUnvfrSchdlInfo.do",
  findAppcsSchdlList: "/com/SsoCtr/findAppcsSchdlList.do",
  findEstblCorseList: "/com/SsoCtr/findEstblCorseList.do",
  findEstblCorseDtlList: "/com/SsoCtr/findEstblCorseDtlList.do",
  findEstblDeprtList: "/com/sapl/SaplapCtr/findEstblDeprtList.do",
  findCltrDomnList: "/com/sapl/SaplapCtr/findCltrDomnList.do",
  /** 내 희망바구니 목록 (장바구니 조회) */
  findEstblSubjtShpbsList: "/com/sapl/SaplapCtr/findEstblSubjtShpbsList.do",
  /** 개설 교과목 검색 */
  findEstblSubjtGnrlList: "/com/sapl/SaplapCtr/findEstblSubjtGnrlList.do",
  findSaplHopeAppcsChk: "/com/sapl/SaplapCtr/findSaplHopeAppcsChk.do",
  saveHopeAppcsDtls: "/com/sapl/SaplapCtr/saveHopeAppcsDtls.do",
  saveHopeAppcsDtlsCancl: "/com/sapl/SaplapCtr/saveHopeAppcsDtlsCancl.do",
  findSysdate: "/com/SsoCtr/findSysdate.do",
  nxHome: "/nx/"
} as const;
