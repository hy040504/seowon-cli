/**
 * 수강신청 본신청 모듈 상수.
 * 이 모듈은 정식 수강신청(본신청, appcsKindCd 미적용)이며,
 * 수강희망바구니(appcsKindCd=100)와 같은 sugangh.seowon.ac.kr 서버를 쓰지만
 * menuId=M100780, pgmId=P001619를 사용하고 경로가 다르다.
 *
 * 수강희망바구니와 다름 — 본신청 전용. 희망바구니 경로(saveHopeAppcsDtls 등)를 쓰지 않는다.
 */

/** 수강신청 본신청 서버 (희망바구니와 동일 서버) */
export const COURSE_REG_BASE_URL = "https://sugangh.seowon.ac.kr";

/** 수강신청 본신청 메뉴 ID (희망바구니 M100779와 다름) */
export const COURSE_REG_MENU_ID = "M100780";

/** 수강신청 본신청 프로그램 ID (희망바구니 P001609와 다름) */
export const COURSE_REG_PGM_ID = "P001619";

/** 로그인/공통 메뉴 ID (희망바구니와 동일) */
export const COURSE_REG_PORTAL_MENU_ID = "edu";

/** 로그인/공통 프로그램 ID (희망바구니와 동일) */
export const COURSE_REG_PORTAL_PGM_ID = "edu";

/** 학부 기준 부서 코드 */
export const COURSE_REG_DEFAULT_DEPT_CD = "20000";

/** 수강신청 메뉴 코드 (findMenu에서 사용) */
export const COURSE_REG_MENU_STR_ID = "M100780";

/** 로그인 공지 구분 코드 (공통) */
export const COURSE_REG_NOTC_CL_CD = "L";

/** 본신청 검증 대상 구분 (패킷: ceckTrgetGbn=H) */
export const COURSE_REG_CHECK_TARGET = "H";

/**
 * 수강신청 본신청 API 경로 모음.
 * 로그인/공통 경로는 희망바구니(lib/back/engine/hope-basket/constants.ts)와 동일하나,
 * 수강신청 전용 경로(saveAppcsDtls 등)는 다르다.
 *
 * saveAppcsDtls.do 는 saveHopeAppcsDtls.do 와 다름 (본신청 등록).
 * findAppcsDtlsList.do 는 findEstblSubjtShpbsList.do 와 다름 (내 신청 목록).
 */
export const COURSE_REG_PATHS = {
  /** Nexacro 포털 진입 (SESSIONID 확보) */
  nxHome: "/nx/",

  // --- 공통 SSO (희망바구니와 동일 경로, menuId=edu) ---
  /** 로그인 인증 */
  findAppcsLogin: "/com/SsoCtr/findAppcsLogin.do",
  /** 학생 기본 정보 조회 */
  findStunoInfo: "/com/SsoCtr/findStunoInfo.do",
  /** 로그인 일정 체크 */
  findAppcsLoginChk: "/com/SsoCtr/findAppcsLoginChk.do",
  /** 학년도/학기 코드 조회 */
  findScomUnvfrSchdlInfo: "/com/SsoCtr/findScomUnvfrSchdlInfo.do",
  /** 신청 일정 목록 */
  findAppcsSchdlList: "/com/SsoCtr/findAppcsSchdlList.do",
  /** 수강신청 공지사항 */
  findAppcsNotcList: "/com/SsoCtr/findAppcsNotcList.do",
  /** 기본 정보 조회 */
  findBaseInfo: "/com/SsoCtr/findBaseInfo.do",
  /** 로그인 여부 확인 */
  isLogin: "/com/SsoCtr/isLogin.do",
  /** 접속 정보 조회 (학과코드 등) */
  findMyGLIOList: "/com/SsoCtr/findMyGLIOList.do",
  /** 서버 현재 시각 */
  findSysdate: "/com/SsoCtr/findSysdate.do",
  /** 메뉴 정보 조회 */
  findMenu: "/com/cmsv/MenuCtr/findMenu.do",

  // --- 수강신청 전용 경로 (희망바구니와 다름) ---
  /** 개설 과목 검색 (경로 동일, menuId/pgmId=M100780/P001619) */
  findEstblSubjtGnrlList: "/com/sapl/SaplapCtr/findEstblSubjtGnrlList.do",
  /** 내 수강신청 목록 (희망바구니 findEstblSubjtShpbsList 와 다름) */
  findAppcsDtlsList: "/com/sapl/SaplapCtr/findAppcsDtlsList.do",
  /** 수강신청 등록 (희망바구니 saveHopeAppcsDtls 와 다름) */
  saveAppcsDtls: "/com/sapl/SaplapCtr/saveAppcsDtls.do",
  /** 수강신청 취소 (희망바구니 saveHopeAppcsDtlsCancl 와 다름) */
  saveAppcsDtlsCancl: "/com/sapl/SaplapCtr/saveAppcsDtlsCancl.do",
  /** 경고 장학생 조회 횟수 확인 (본신청 전용) */
  findWarnStdrInqryCscnt: "/com/sapl/SaplapCtr/findWarnStdrInqryCscnt.do",
  /** 경고 장학생 조회 횟수 저장 (본신청 전용) */
  saveWarnStdrInqrtCscnt: "/com/sapl/SaplapCtr/saveWarnStdrInqrtCscnt.do",

  // --- ClipReport 공식 시간표 이미지 경로 ---
  /** ClipReport 시간표 이미지 페이지 */
  callReportHtml: "/callReport.html",
  callReportJsp: "/report/callReport.jsp",
  reportServer: "/report/report_server.jsp"
} as const;
