/**
 * 서원대 통합정보시스템 ERP 모듈 상수.
 *
 * 이 모듈은 e-campus(LMS, ecampus.seowon.ac.kr) 와
 * 수강신청(sugangh.seowon.ac.kr) 과 다른 호스트다.
 * 호스트: info.seowon.ac.kr
 *
 * 캡처 기준 주 화면은 Vue 포털의 전체학기성적조회이며,
 * JSON (`application/json`) 을 사용한다. Nexacro SSV 는 강의평가 등 일부 화면만.
 */

/** 통합정보시스템 ERP 서버 */
export const ERP_BASE_URL = "https://info.seowon.ac.kr";

/** 학부 기준 부서 코드 (패킷: regDeptCd=20000) */
export const ERP_DEFAULT_DEPT_CD = "20000";

/**
 * 전체학기성적조회* (포털 메뉴 M102947, Vue 메뉴 M106021).
 * 지난 성적 확인 패킷의 기본 화면.
 */
export const ERP_GRADE_OVERALL_PORTAL_MENU_ID = "M102947";
export const ERP_GRADE_OVERALL_VUE_MENU_ID = "M106021";
export const ERP_GRADE_OVERALL_PORTAL_PGM_ID = "P001722";
export const ERP_GRADE_OVERALL_VUE_PGM_ID = "P004511";

/**
 * 전체학기성적조회(학부)* (포털 메뉴 M104797, Vue 메뉴 M106020).
 * 같은 성적 API를 쓰지만 menuId/pgmId 가 다르다.
 */
export const ERP_GRADE_UNDERGRAD_PORTAL_MENU_ID = "M104797";
export const ERP_GRADE_UNDERGRAD_VUE_MENU_ID = "M106020";
export const ERP_GRADE_UNDERGRAD_PORTAL_PGM_ID = "P003836";
export const ERP_GRADE_UNDERGRAD_VUE_PGM_ID = "P004515";

/** 강의평가 (Nexacro, 패킷: 수업평가 기간 아님) */
export const ERP_LECTURE_EVAL_MENU_ID = "M102959";
export const ERP_LECTURE_EVAL_PGM_ID = "P001574";

/** 온라인투표 */
export const ERP_VOTE_PORTAL_MENU_ID = "M103209";
export const ERP_VOTE_VUE_MENU_ID = "M106100";
export const ERP_VOTE_PGM_ID = "P004602";

/** 포털 공지사항 */
export const ERP_NOTICE_MENU_ID = "M102651";

/** 성적 공개 학사일정 코드 (패킷: univunvfrSchdlCd=SGRA00010003, flag=2) */
export const ERP_GRADE_SCHEDULE_CD = "SGRA00010003";

/**
 * ERP API 경로 모음.
 * e-campus `/crs/scoreLect/*` 나 sugangh `/com/sapl/*` 와 혼용하지 않는다.
 */
export const ERP_PATHS = {
  // --- 포털 로그인 ---
  /** 로그인 화면 */
  loginPage: "/por/ln",
  /** 포털 로그인 (form: uid, password) */
  login: "/por/lgin",
  /** 로그인 성공 후 메인 */
  main: "/por/mn",
  /** Vue 컨테이너 */
  vueContainer: "/por/ct",
  vueHome: "/vue/",

  // --- 포털 JSON ---
  /** 메뉴 트리 등 포털 서비스 */
  portalApi: "/por/api",
  getSSOKey: "/por/getSSOKey",
  noticeList: "/por/bord/BordNtCtr/getNoticeList.json",
  noticeDetail: "/por/bord/BordNtCtr/getNotice.json",
  noticeInfo: "/por/bord/BordNtCtr/getNoticeInfo.json",

  // --- SSO / 세션 (Vue JSON) ---
  ssoLogin: "/com/SsoCtr/ssoLogin.do",
  ssoLoginJson: "/com/SsoCtr/sso_login.do",
  isLogin: "/com/SsoCtr/isLogin.do",
  findMyGLIOList: "/com/SsoCtr/findMyGLIOList.do",
  findSysdate: "/com/SsoCtr/findSysdate.do",

  // --- 메뉴 / 코드 ---
  findMenu: "/com/cmsv/MenuCtr/findMenu.do",
  findCodeComboList: "/com/cmsv/CodeCtr/findCodeComboList.do",

  // --- 성적 (지난 성적 확인, Vue JSON) ---
  /** 이수학기(학년도/학기) 목록 */
  findStdntGradeSyyList: "/sch/sgra/SgradcCtr/findStdntGradeSyyList.do",
  /** 학기별 평점/학점 합계 */
  findGradeTotalDtlsStuList: "/sch/sgra/SgradcCtr/findGradeTotalDtlsStuList.do",
  /** 학기별 과목 성적 상세 */
  findGradeMastrDtlsStuList: "/sch/sgra/SgradcCtr/findGradeMastrDtlsStuList.do",
  /** 성적 공개 학사일정 */
  findScomUnvfrSchdlInfo: "/sch/scom/ScomcmCtr/findScomUnvfrSchdlInfo.do",

  // --- 학적 ---
  /** 학생 학적 기본정보 */
  findSchrgBassInfoStud: "/sch/ssrm/SsrmstCtr/findSchrgBassInfoStud.do",

  // --- 강의평가 (Nexacro SSV) ---
  executeUnvfcCheck: "/sch/sles/SlesevCtr/executeUnvfcCheck.do",

  // --- 온라인투표 ---
  findVoteYyElecInfoRegList: "/sch/sstd/SstdelCtr/findVoteYyElecInfoRegList.do",

  // --- ClipReport (성적표 인쇄, 데이터 API 아님) ---
  callReportJsp: "/report/callReport.jsp",
  reportServer: "/report/report_server.jsp"
} as const;

/** 포털 API serviceId */
export const ERP_PORTAL_SERVICES = {
  /** 포털 메뉴 트리 */
  menuTree: "SVC0100",
  /** 단일 메뉴 상세 (strMenuId) */
  menuInfo: "SVC0101"
} as const;

/** 성적 코드콤보 요청 (학기/이수구분/등급) */
export const ERP_GRADE_CODE_REQUEST = {
  cmmnCd: "SLES0100|SCUR0100|SGRA0200",
  useYn: "1|1|1",
  textMode: "N|N|N",
  dataSet: "dsSmtCd|dsCmpsjDivCd|dsCmpsjGradeGrdCd"
} as const;
