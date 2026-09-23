/**
 * 수강신청 본신청 요청 생성/응답 파싱.
 *
 * 본신청 전용 — 수강희망바구니와 다름.
 * appcsKindCd 미사용, menuId=M100780 / pgmId=P001619.
 * 등록: saveAppcsDtls.do (saveHopeAppcsDtls.do 아님)
 * 목록: findAppcsDtlsList.do (findEstblSubjtShpbsList.do 아님)
 *
 * 순수 함수(create* / parse*)만 포함. 세션 관리는 CourseRegistrationClient.
 */

import { absoluteUrl } from "../ecampus/utils.js";
import {
  createSsvRequestTimeStr,
  encodeSsvParams,
  encodeSsvRequest,
  findSsvDataset,
  parseSsv,
  readNexacroXmlParameter,
  readSsvErrorCode,
  type SsvDocument,
  type SsvRow
} from "../hope-basket/ssv.js";
import type {
  SugangLoginScheduleCheck,
  SugangStudentInfo,
  SugangSubject
} from "../hope-basket/types/basket.js";
import {
  COURSE_REG_BASE_URL,
  COURSE_REG_CHECK_TARGET,
  COURSE_REG_DEFAULT_DEPT_CD,
  COURSE_REG_MENU_ID,
  COURSE_REG_MENU_STR_ID,
  COURSE_REG_NOTC_CL_CD,
  COURSE_REG_PATHS,
  COURSE_REG_PGM_ID,
  COURSE_REG_PORTAL_MENU_ID,
  COURSE_REG_PORTAL_PGM_ID
} from "./constants.js";
import {
  classifyCourseRegError,
  CourseRegErrorType,
  formatCourseRegError
} from "./errors.js";
import type {
  CourseRegGetRequest,
  CourseRegLoginCredentials,
  CourseRegLoginResult,
  CourseRegMutationOptions,
  CourseRegMutationResult,
  CourseRegMyListOptions,
  CourseRegRegisteredSubject,
  CourseRegSearchOptions,
  CourseRegSessionInfo,
  CourseRegSsvPostRequest,
  CourseRegTermCodeInfo,
  CourseRegTermContext
} from "./types/registration.js";

export type {
  CourseRegistrationClientOptions,
  CourseRegGetRequest,
  CourseRegLoginCredentials,
  CourseRegLoginOptions,
  CourseRegLoginResult,
  CourseRegMutationOptions,
  CourseRegMutationResult,
  CourseRegMyListOptions,
  CourseRegRegisteredSubject,
  CourseRegRegisteredTimetable,
  CourseRegRetryRegisterOptions,
  CourseRegRetryRegisterResult,
  CourseRegSearchOptions,
  CourseRegSearchSubject,
  CourseRegSessionInfo,
  CourseRegSsvPostRequest,
  CourseRegTermCodeInfo,
  CourseRegTermContext
} from "./types/registration.js";

export {
  COURSE_REG_BASE_URL,
  COURSE_REG_CHECK_TARGET,
  COURSE_REG_DEFAULT_DEPT_CD,
  COURSE_REG_MENU_ID,
  COURSE_REG_MENU_STR_ID,
  COURSE_REG_NOTC_CL_CD,
  COURSE_REG_PATHS,
  COURSE_REG_PGM_ID,
  COURSE_REG_PORTAL_MENU_ID,
  COURSE_REG_PORTAL_PGM_ID
} from "./constants.js";

export {
  classifyCourseRegError,
  classifyCourseRegNetworkError,
  CourseRegErrorType,
  formatCourseRegError
} from "./errors.js";

/** findAppcsDtlsList / findEstblSubjtGnrlList dsParam 컬럼 (패킷 기준, cltrDomnCd 없음) */
const LIST_SEARCH_COLUMNS = [
  "syy",
  "smtCd",
  "unvfrStdrDeptCd",
  "cmpsjHyDivCd",
  "cmpsjDivCd",
  "serchDiv",
  "estblCrseDivCd",
  "stuno",
  "asignDeprtCd",
  "subjtCd",
  "corseDvclsNo"
] as const;

/**
 * saveAppcsDtls / saveAppcsDtlsCancl dsParam 컬럼.
 * 희망바구니 mutation 과 달리 cmpsjDivCd 포함.
 */
const MUTATION_COLUMNS = [
  "syy",
  "smtCd",
  "stuno",
  "unvfrStdrDeptCd",
  "subjtCd",
  "corseDvclsNo",
  "ceckTrgetGbn",
  "hiPass",
  "ttcMapngNo",
  "gschSubjtYn",
  "stdntChngLmttYn",
  "bchdmCntcSubjtYn",
  "cmpsjDivCd"
] as const;

/**
 * 본신청 로그인 컬럼.
 * appcsKindCd 없음 — 본신청은 appcsKindCd 파라미터를 전송하지 않는다.
 */
const LOGIN_COLUMNS = [
  "syy",
  "smtCd",
  "unvfrStdrDeptCd",
  "stuno",
  "password",
  "hy",
  "deptCd",
  "notcClCd"
] as const;

/**
 * SESSIONID 확보용 포털 홈 진입 요청을 만든다
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegGetRequest} 홈 진입 GET 요청
 */
export function createCourseRegHomeRequest(baseUrl = COURSE_REG_BASE_URL): CourseRegGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(COURSE_REG_PATHS.nxHome, baseUrl)
  };
}

/**
 * 현재 학년도/학기 결합 코드 조회 요청을 만든다
 * @param {{ unvfrSchdlCd?: string; regDeptCd?: string; baseUrl?: string; menuId?: string; pgmId?: string }} [options={}] - 일정 코드 조회 옵션
 * @returns {CourseRegSsvPostRequest} 학사일정 코드 POST 요청
 */
export function createCourseRegTermCodeRequest(
  options: {
    unvfrSchdlCd?: string;
    regDeptCd?: string;
    baseUrl?: string;
    menuId?: string;
    pgmId?: string;
  } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const body = encodeSsvParams({
    flag: "1",
    univunvfrSchdlCd: options.unvfrSchdlCd ?? "SAPL00010001",
    regDeptCd: options.regDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
    applcDeptCd: "",
    applyCrseCd: "",
    dgriCrseCd: "",
    hy: "",
    syy: "",
    smtCd: "",
    requestTimeStr: createSsvRequestTimeStr()
  });

  return createSsvPost(
    COURSE_REG_PATHS.findScomUnvfrSchdlInfo,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_PORTAL_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PORTAL_PGM_ID
    },
    baseUrl
  );
}

/**
 * 수강신청 본신청 로그인 요청을 만든다.
 * appcsKindCd 를 전송하지 않는다 (희망바구니와 다름).
 * @param {CourseRegLoginCredentials} credentials - 학번/비밀번호
 * @param {CourseRegTermContext} context - 학년도/학기 문맥
 * @param {{ baseUrl?: string; menuId?: string; pgmId?: string }} [options={}] - 요청 옵션
 * @returns {CourseRegSsvPostRequest} 로그인 POST 요청
 */
export function createCourseRegLoginRequest(
  credentials: CourseRegLoginCredentials,
  context: CourseRegTermContext,
  options: { baseUrl?: string; menuId?: string; pgmId?: string } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const unvfrStdrDeptCd = context.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD;
  const notcClCd = credentials.notcClCd ?? COURSE_REG_NOTC_CL_CD;

  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: [...LOGIN_COLUMNS],
      rows: [
        {
          _rowType: "U",
          syy: context.syy,
          smtCd: context.smtCd,
          unvfrStdrDeptCd,
          stuno: credentials.stuno,
          password: credentials.password,
          hy: "",
          deptCd: "",
          notcClCd
        },
        {
          _rowType: "O",
          syy: context.syy,
          smtCd: context.smtCd,
          unvfrStdrDeptCd,
          stuno: "",
          password: "",
          hy: "",
          deptCd: "",
          notcClCd
        }
      ]
    }
  ]);

  return createSsvPost(
    COURSE_REG_PATHS.findAppcsLogin,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_PORTAL_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PORTAL_PGM_ID
    },
    baseUrl
  );
}

/**
 * 로그인 직후 학생 기본정보 조회 요청을 만든다
 * @param {CourseRegLoginCredentials} credentials - 학번/비밀번호
 * @param {CourseRegTermContext} context - 학년도/학기 문맥
 * @param {{ baseUrl?: string; menuId?: string; pgmId?: string }} [options={}] - 요청 옵션
 * @returns {CourseRegSsvPostRequest} 학생 정보 POST 요청
 */
export function createCourseRegStudentInfoRequest(
  credentials: CourseRegLoginCredentials,
  context: CourseRegTermContext,
  options: { baseUrl?: string; menuId?: string; pgmId?: string } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: [...LOGIN_COLUMNS],
      rows: [
        {
          _rowType: "N",
          syy: context.syy,
          smtCd: context.smtCd,
          unvfrStdrDeptCd: context.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
          stuno: credentials.stuno,
          password: credentials.password,
          hy: "",
          deptCd: "",
          notcClCd: credentials.notcClCd ?? COURSE_REG_NOTC_CL_CD
        }
      ]
    }
  ]);

  return createSsvPost(
    COURSE_REG_PATHS.findStunoInfo,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_PORTAL_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PORTAL_PGM_ID
    },
    baseUrl
  );
}

/**
 * 신청 가능 일정 확인 요청을 만든다
 * @param {CourseRegLoginCredentials} credentials - 학번/비밀번호
 * @param {Pick<SugangStudentInfo, "hy" | "deptCd">} student - 학생 학년/학과
 * @param {CourseRegTermContext} context - 학년도/학기 문맥
 * @param {{ baseUrl?: string; menuId?: string; pgmId?: string }} [options={}] - 요청 옵션
 * @returns {CourseRegSsvPostRequest} 일정 가능 여부 POST 요청
 */
export function createCourseRegLoginCheckRequest(
  credentials: CourseRegLoginCredentials,
  student: Pick<SugangStudentInfo, "hy" | "deptCd">,
  context: CourseRegTermContext,
  options: { baseUrl?: string; menuId?: string; pgmId?: string } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const unvfrStdrDeptCd = context.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD;
  const notcClCd = credentials.notcClCd ?? COURSE_REG_NOTC_CL_CD;

  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: [...LOGIN_COLUMNS],
      rows: [
        {
          _rowType: "U",
          syy: context.syy,
          smtCd: context.smtCd,
          unvfrStdrDeptCd,
          stuno: credentials.stuno,
          password: credentials.password,
          hy: student.hy,
          deptCd: student.deptCd,
          notcClCd
        },
        {
          _rowType: "O",
          syy: context.syy,
          smtCd: context.smtCd,
          unvfrStdrDeptCd,
          stuno: credentials.stuno,
          password: credentials.password,
          hy: "",
          deptCd: "",
          notcClCd
        }
      ]
    }
  ]);

  return createSsvPost(
    COURSE_REG_PATHS.findAppcsLoginChk,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_PORTAL_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PORTAL_PGM_ID
    },
    baseUrl
  );
}

/**
 * 수강신청 메뉴 정보 조회 요청을 만든다 (strMenuId=M100780)
 * @param {string} [menuId=COURSE_REG_MENU_STR_ID] - 메뉴 문자열 ID
 * @param {{ baseUrl?: string; portalMenuId?: string; portalPgmId?: string }} [options={}] - 요청 옵션
 * @returns {CourseRegSsvPostRequest} 메뉴 POST 요청
 */
export function createCourseRegMenuRequest(
  menuId: string = COURSE_REG_MENU_STR_ID,
  options: { baseUrl?: string; portalMenuId?: string; portalPgmId?: string } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const body = encodeSsvParams({
    strMenuId: menuId,
    requestTimeStr: createSsvRequestTimeStr()
  });

  return createSsvPost(
    COURSE_REG_PATHS.findMenu,
    body,
    {
      menuId: options.portalMenuId ?? COURSE_REG_PORTAL_MENU_ID,
      pgmId: options.portalPgmId ?? COURSE_REG_PORTAL_PGM_ID
    },
    baseUrl
  );
}

/**
 * 내 수강신청 목록 조회 요청(findAppcsDtlsList)을 만든다.
 * 희망바구니 findEstblSubjtShpbsList 와 경로가 다르다.
 * @param {CourseRegMyListOptions} options - 조회 조건
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 내 신청 목록 POST 요청
 */
export function createCourseRegMyListRequest(
  options: CourseRegMyListOptions,
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  return createListStyleRequest(
    COURSE_REG_PATHS.findAppcsDtlsList,
    options,
    {
      serchDiv: options.serchDiv ?? "0",
      cmpsjHyDivCd: options.cmpsjHyDivCd ?? "",
      cmpsjDivCd: options.cmpsjDivCd ?? "",
      estblCrseDivCd: options.estblCrseDivCd ?? "",
      asignDeprtCd: options.asignDeprtCd ?? "",
      subjtCd: options.subjtCd ?? "",
      corseDvclsNo: options.corseDvclsNo ?? ""
    },
    {
      baseUrl,
      menuId: options.menuId ?? COURSE_REG_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PGM_ID
    }
  );
}

/**
 * 개설 교과목 검색 요청(findEstblSubjtGnrlList, menuId=M100780)을 만든다
 * @param {CourseRegSearchOptions} options - 검색 조건
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 개설 과목 검색 POST 요청
 */
export function createCourseRegSearchRequest(
  options: CourseRegSearchOptions,
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  const keyword = options.keyword ?? "";
  const isCode = Boolean(keyword && /^[a-zA-Z0-9]+$/.test(keyword));
  // 패킷 dsParam 에 subjtNm 이 없으므로 검색어는 subjtCd 슬롯에 넣는다
  const subjtCd = options.subjtCd ?? (isCode ? keyword : keyword || "");

  return createListStyleRequest(
    COURSE_REG_PATHS.findEstblSubjtGnrlList,
    options,
    {
      serchDiv: options.serchDiv ?? "0",
      cmpsjHyDivCd: options.cmpsjHyDivCd ?? "",
      cmpsjDivCd: options.cmpsjDivCd ?? "",
      estblCrseDivCd: options.estblCrseDivCd ?? "",
      asignDeprtCd: options.asignDeprtCd ?? "",
      subjtCd: options.subjtCd ?? subjtCd,
      corseDvclsNo: options.corseDvclsNo ?? ""
    },
    {
      baseUrl,
      menuId: options.menuId ?? COURSE_REG_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PGM_ID
    }
  );
}

/**
 * 수강신청 등록 요청(saveAppcsDtls)을 만든다.
 * 희망바구니 saveHopeAppcsDtls 와 경로가 다르다.
 * @param {CourseRegMutationOptions} options - 등록할 과목 정보
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 등록 POST 요청
 */
export function createCourseRegRegisterRequest(
  options: CourseRegMutationOptions,
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  return createMutationRequest(COURSE_REG_PATHS.saveAppcsDtls, options, baseUrl, {
    ceckTrgetGbn: options.ceckTrgetGbn ?? COURSE_REG_CHECK_TARGET,
    hiPass: options.hiPass ?? "0",
    gschSubjtYn: options.gschSubjtYn ?? "0"
  });
}

/**
 * 수강신청 취소 요청(saveAppcsDtlsCancl)을 만든다.
 * 희망바구니 saveHopeAppcsDtlsCancl 와 경로가 다르다.
 * @param {CourseRegMutationOptions} options - 취소할 과목 정보
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 취소 POST 요청
 */
export function createCourseRegCancelRequest(
  options: CourseRegMutationOptions,
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  // 패킷 취소 요청: ceckTrgetGbn/hiPass/gschSubjtYn 이 빈 값
  return createMutationRequest(COURSE_REG_PATHS.saveAppcsDtlsCancl, options, baseUrl, {
    ceckTrgetGbn: options.ceckTrgetGbn ?? "",
    hiPass: options.hiPass ?? "",
    gschSubjtYn: options.gschSubjtYn ?? ""
  });
}

/**
 * 경고 장학생 조회 횟수 확인 요청을 만든다 (본신청 전용)
 * @param {Partial<CourseRegTermContext>} [options={}] - 문맥
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 경고 체크 POST 요청
 */
export function createCourseRegWarnCheckRequest(
  options: Partial<CourseRegTermContext> = {},
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  const term = normalizeTerm(options);
  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: ["syy", "smtCd", "stuno", "unvfrStdrDeptCd"],
      rows: [
        {
          _rowType: "N",
          syy: term.syy,
          smtCd: term.smtCd,
          stuno: options.stuno ?? term.stuno ?? "",
          unvfrStdrDeptCd: term.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD
        }
      ]
    }
  ]);

  return createSsvPost(
    COURSE_REG_PATHS.findWarnStdrInqryCscnt,
    body,
    { menuId: COURSE_REG_MENU_ID, pgmId: COURSE_REG_PGM_ID },
    baseUrl
  );
}

/**
 * 경고 장학생 조회 횟수 저장 요청을 만든다 (본신청 전용)
 * @param {Partial<CourseRegTermContext>} [options={}] - 문맥
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegSsvPostRequest} 경고 저장 POST 요청
 */
export function createCourseRegWarnSaveRequest(
  options: Partial<CourseRegTermContext> = {},
  baseUrl = COURSE_REG_BASE_URL
): CourseRegSsvPostRequest {
  const term = normalizeTerm(options);
  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: ["syy", "smtCd", "stuno", "unvfrStdrDeptCd"],
      rows: [
        {
          _rowType: "N",
          syy: term.syy,
          smtCd: term.smtCd,
          stuno: options.stuno ?? term.stuno ?? "",
          unvfrStdrDeptCd: term.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD
        }
      ]
    }
  ]);

  return createSsvPost(
    COURSE_REG_PATHS.saveWarnStdrInqrtCscnt,
    body,
    { menuId: COURSE_REG_MENU_ID, pgmId: COURSE_REG_PGM_ID },
    baseUrl
  );
}

/**
 * 접속 정보(GLIO) 조회 요청을 만든다
 * @param {string} [columnList="deptCd"] - 조회 컬럼 목록
 * @param {{ baseUrl?: string }} [options={}] - 요청 옵션
 * @returns {CourseRegSsvPostRequest} GLIO POST 요청
 */
export function createCourseRegGLIORequest(
  columnList = "deptCd",
  options: { baseUrl?: string } = {}
): CourseRegSsvPostRequest {
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const body = encodeSsvParams({
    columnList,
    requestTimeStr: createSsvRequestTimeStr()
  });

  return createSsvPost(
    COURSE_REG_PATHS.findMyGLIOList,
    body,
    { menuId: COURSE_REG_MENU_ID, pgmId: COURSE_REG_PGM_ID },
    baseUrl
  );
}

/**
 * 서버 시각 조회 GET 요청을 만든다
 * @param {string} [baseUrl=COURSE_REG_BASE_URL] - sugangh 기본 URL
 * @returns {CourseRegGetRequest} sysdate GET 요청
 */
export function createCourseRegSysdateRequest(baseUrl = COURSE_REG_BASE_URL): CourseRegGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(COURSE_REG_PATHS.findSysdate, baseUrl)
  };
}

/**
 * findAppcsLogin 응답을 로그인 결과 형태로 정규화한다
 * @param {string} body - SSV 응답 본문
 * @returns {Omit<CourseRegLoginResult, "raw" | "student" | "termCode"> & { raw: SsvDocument }} 로그인 파싱 결과
 */
export function parseCourseRegLoginResponse(body: string): {
  success: boolean;
  flag: string;
  mayBeFalseError: boolean;
  session?: CourseRegSessionInfo;
  errorCode?: number;
  errorType?: CourseRegErrorType;
  message: string;
  raw: SsvDocument;
} {
  const raw = parseSsv(body);
  const errorCode = readSsvErrorCode(raw);
  const flag = findSsvDataset(raw, "dsFlag")?.rows[0]?.flag ?? "";
  const sessionRow = findSsvDataset(raw, "dsSession")?.rows[0];
  const session = sessionRow ? mapSession(sessionRow) : undefined;
  const success = errorCode === 0 && (flag === "1" || session?.msg === "success");

  // ErrorCode=0 이지만 flag=0 → 서버 과부하 허위 실패 가능
  const mayBeFalseError = !success && errorCode === 0 && flag === "0";
  const errorType = !success
    ? classifyCourseRegError(errorCode ?? 0, undefined, { flag })
    : undefined;

  return {
    success,
    flag,
    mayBeFalseError,
    session,
    errorCode,
    errorType,
    message: success
      ? "로그인에 성공했습니다."
      : mayBeFalseError
        ? formatCourseRegError(CourseRegErrorType.LOGIN_FAILED)
        : session?.msg && session.msg !== "success"
          ? session.msg
          : "로그인에 실패했습니다.",
    raw
  };
}

/**
 * findStunoInfo 응답을 학생 기본정보로 정규화한다
 * @param {string} body - SSV 응답 본문
 * @returns {SugangStudentInfo | undefined} 학생 정보
 */
export function parseCourseRegStudentInfoResponse(body: string): SugangStudentInfo | undefined {
  const raw = parseSsv(body);
  const row = findSsvDataset(raw, "dsStunoInfo")?.rows[0];
  if (!row) return undefined;
  return mapStudent(row);
}

/**
 * findAppcsLoginChk 응답을 신청 가능 일정 목록으로 정규화한다
 * @param {string} body - SSV 응답 본문
 * @returns {SugangLoginScheduleCheck[]} 일정 가능 여부 목록
 */
export function parseCourseRegLoginCheckResponse(body: string): SugangLoginScheduleCheck[] {
  const raw = parseSsv(body);
  return (findSsvDataset(raw, "dsLoginInfoChk")?.rows ?? []).map((row) => ({
    possYn: row.possYn ?? "",
    appcsSchdlCd: row.appcsSchdlCd ?? "",
    appcsSchdlSeqno: row.appcsSchdlSeqno ?? "",
    appcsTrgetTypeCnt: row.appcsTrgetTypeCnt ?? "",
    allowed: row.possYn === "1",
    raw: row
  }));
}

/**
 * 학사일정 코드 응답을 syy/smtCd로 분리한다
 * @param {string} body - SSV 응답 본문
 * @returns {CourseRegTermCodeInfo | undefined} 학년도/학기 코드
 */
export function parseCourseRegTermCodeResponse(body: string): CourseRegTermCodeInfo | undefined {
  const raw = parseSsv(body);
  const row = findSsvDataset(raw, "dsUnvfc")?.rows[0];
  if (!row) return undefined;
  const termCode = row.reslt ?? "";
  const syy = termCode.slice(0, 4);
  const smtCd = termCode.slice(4) || "";
  return { termCode, syy, smtCd, raw: row, params: raw.params };
}

/**
 * 내 수강신청 목록 응답(dsSapl231)을 정규화한다
 * @param {string} body - SSV 응답 본문
 * @returns {CourseRegRegisteredSubject[]} 신청 과목 목록
 */
export function parseCourseRegMyListResponse(body: string): CourseRegRegisteredSubject[] {
  const raw = parseSsv(body);
  return (findSsvDataset(raw, "dsSapl231")?.rows ?? []).map((row) => mapRegisteredSubject(row));
}

/**
 * 개설 과목 검색 응답(dsSles131)을 SugangSubject 로 정규화한다 (희망바구니 타입 재사용)
 * @param {string} body - SSV 응답 본문
 * @returns {SugangSubject[]} 과목 목록
 */
export function parseCourseRegSearchResponse(body: string): SugangSubject[] {
  const raw = parseSsv(body);
  return (findSsvDataset(raw, "dsSles131")?.rows ?? []).map((row) => mapSearchSubject(row));
}

/**
 * 수강신청/취소 응답을 정규화한다
 * @param {string} body - SSV 응답 본문
 * @param {"register" | "cancel"} action - 수행 동작
 * @param {Pick<CourseRegMutationOptions, "subjtCd" | "corseDvclsNo">} options - 대상 과목 식별자
 * @returns {CourseRegMutationResult} 정규화된 작업 결과
 */
export function parseCourseRegMutationResponse(
  body: string,
  action: "register" | "cancel",
  options: Pick<CourseRegMutationOptions, "subjtCd" | "corseDvclsNo">
): CourseRegMutationResult {
  const raw = parseSsv(body);
  const errorCode = readSsvErrorCode(raw);
  const errorMsg = raw.params.ErrorMsg ?? raw.params.errorMsg ?? "";
  const success = errorCode === 0;
  const errorType = success
    ? undefined
    : classifyCourseRegError(errorCode ?? -1, errorMsg || undefined);

  return {
    success,
    errorCode,
    errorMsg: errorMsg || undefined,
    errorType,
    message: success
      ? action === "register"
        ? "수강신청에 성공했습니다."
        : "수강신청을 취소했습니다."
      : errorMsg ||
        formatCourseRegError(errorType ?? CourseRegErrorType.UNKNOWN_SERVER_ERROR) ||
        `수강신청 ${action} 요청이 실패했습니다. (ErrorCode=${errorCode ?? "?"})`,
    action,
    subjtCd: options.subjtCd,
    corseDvclsNo: options.corseDvclsNo,
    raw
  };
}

/**
 * findSysdate XML 응답에서 _sysdate 값을 추출한다
 * @param {string} xml - XML 본문
 * @returns {string} 서버 시각 문자열 (예: 20260812100439)
 */
export function parseCourseRegSysdateResponse(xml: string): string {
  return readNexacroXmlParameter(xml, "_sysdate");
}

/**
 * 로그인 단계별 응답을 하나의 결과 객체로 합친다
 * @param {{ loginBody: string; studentBody?: string; loginCheckBody?: string; termCode?: string }} parts - 단계별 응답
 * @returns {CourseRegLoginResult} 통합 로그인 결과
 */
export function composeCourseRegLoginResult(parts: {
  loginBody: string;
  studentBody?: string;
  loginCheckBody?: string;
  termCode?: string;
}): CourseRegLoginResult {
  const login = parseCourseRegLoginResponse(parts.loginBody);
  const student = parts.studentBody
    ? parseCourseRegStudentInfoResponse(parts.studentBody)
    : undefined;

  return {
    success: login.success,
    message: login.message,
    flag: login.flag,
    mayBeFalseError: login.mayBeFalseError,
    session: login.session,
    student,
    termCode: parts.termCode,
    errorCode: login.errorCode,
    errorType: login.errorType,
    raw: {
      login: login.raw,
      student: parts.studentBody ? parseSsv(parts.studentBody) : undefined,
      loginCheck: parts.loginCheckBody ? parseSsv(parts.loginCheckBody) : undefined
    }
  };
}

/**
 * CLI 출력용 신청 과목 목록 문자열을 만든다
 * @param {CourseRegRegisteredSubject[]} subjects - 신청 과목 목록
 * @param {number} [startIndex=1] - 시작 번호
 * @returns {string} 콘솔 표시 문자열
 */
export function stringifyCourseRegSubjects(
  subjects: CourseRegRegisteredSubject[],
  startIndex = 1
): string {
  return subjects
    .map((subject, index) => {
      const title = `${startIndex + index}. [${subject.subjtCd}-${subject.corseDvclsNo}] ${subject.subjtNm}`;
      const meta = [
        subject.estblDeprtNm && `개설=${subject.estblDeprtNm}`,
        subject.cmpsjCdt && `학점=${subject.cmpsjCdt}`,
        subject.chrgInstrEmpnm && `담당=${subject.chrgInstrEmpnm}`,
        subject.timtbNm && `시간=${subject.timtbNm.replace(/\s+/g, " ")}`,
        subject.appcsPcnt &&
          subject.appcsLmttPcnt &&
          `신청=${subject.appcsPcnt}/${subject.appcsLmttPcnt}`
      ]
        .filter(Boolean)
        .join(" | ");
      return meta ? `${title}\n   ${meta}` : title;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// private helpers
// ---------------------------------------------------------------------------

/**
 * 목록/검색 API 공통 dsParam 요청을 만든다
 * @private
 */
function createListStyleRequest(
  path: string,
  context: Partial<CourseRegTermContext> & { stuno?: string },
  fields: Partial<Record<(typeof LIST_SEARCH_COLUMNS)[number], string>>,
  options: { baseUrl?: string; menuId?: string; pgmId?: string } = {},
  rowType = "N"
): CourseRegSsvPostRequest {
  const term = normalizeTerm(context);
  const baseUrl = options.baseUrl ?? COURSE_REG_BASE_URL;
  const row = {
    _rowType: rowType,
    syy: term.syy,
    smtCd: term.smtCd,
    unvfrStdrDeptCd: term.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
    cmpsjHyDivCd: fields.cmpsjHyDivCd ?? "",
    cmpsjDivCd: fields.cmpsjDivCd ?? "",
    serchDiv: fields.serchDiv ?? "0",
    estblCrseDivCd: fields.estblCrseDivCd ?? "",
    stuno: context.stuno ?? term.stuno ?? "",
    asignDeprtCd: fields.asignDeprtCd ?? context.asignDeprtCd ?? "",
    subjtCd: fields.subjtCd ?? "",
    corseDvclsNo: fields.corseDvclsNo ?? ""
  };

  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: [...LIST_SEARCH_COLUMNS],
      rows: [row]
    }
  ]);

  return createSsvPost(
    path,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PGM_ID
    },
    baseUrl
  );
}

/**
 * 등록/취소 공통 요청을 만든다
 * @private
 */
function createMutationRequest(
  path: string,
  options: CourseRegMutationOptions,
  baseUrl: string,
  overrides: Partial<Record<(typeof MUTATION_COLUMNS)[number], string>> = {}
): CourseRegSsvPostRequest {
  const term = normalizeTerm(options);
  const body = encodeSsvRequest({ requestTimeStr: createSsvRequestTimeStr() }, [
    {
      id: "dsParam",
      columns: [...MUTATION_COLUMNS],
      rows: [
        {
          _rowType: "I",
          syy: term.syy,
          smtCd: term.smtCd,
          stuno: options.stuno ?? term.stuno ?? "",
          unvfrStdrDeptCd: term.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
          subjtCd: options.subjtCd,
          corseDvclsNo: options.corseDvclsNo,
          ceckTrgetGbn: overrides.ceckTrgetGbn ?? options.ceckTrgetGbn ?? COURSE_REG_CHECK_TARGET,
          hiPass: overrides.hiPass ?? options.hiPass ?? "0",
          ttcMapngNo: overrides.ttcMapngNo ?? options.ttcMapngNo ?? "",
          gschSubjtYn: overrides.gschSubjtYn ?? options.gschSubjtYn ?? "0",
          stdntChngLmttYn: overrides.stdntChngLmttYn ?? options.stdntChngLmttYn ?? "",
          bchdmCntcSubjtYn: overrides.bchdmCntcSubjtYn ?? options.bchdmCntcSubjtYn ?? "",
          cmpsjDivCd: overrides.cmpsjDivCd ?? options.cmpsjDivCd ?? ""
        }
      ]
    }
  ]);

  return createSsvPost(
    path,
    body,
    {
      menuId: options.menuId ?? COURSE_REG_MENU_ID,
      pgmId: options.pgmId ?? COURSE_REG_PGM_ID
    },
    baseUrl
  );
}

/**
 * SSV POST 요청 객체를 조립한다
 * @private
 */
function createSsvPost(
  path: string,
  body: string,
  query: Record<string, string>,
  baseUrl: string
): CourseRegSsvPostRequest {
  const url = new URL(absoluteUrl(path, baseUrl));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return {
    method: "POST",
    url: url.toString(),
    query,
    body,
    contentType: "text/xml",
    accept: "application/xml, text/xml, */*"
  };
}

/**
 * 학년도/학기 문맥 기본값을 채운다
 * @private
 */
function normalizeTerm(context: Partial<CourseRegTermContext>): CourseRegTermContext {
  return {
    syy: context.syy ?? "",
    smtCd: context.smtCd ?? "",
    unvfrStdrDeptCd: context.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
    stuno: context.stuno,
    asignDeprtCd: context.asignDeprtCd
  };
}

/**
 * dsSession 행을 세션 정보로 변환한다
 * @private
 */
function mapSession(row: SsvRow): CourseRegSessionInfo {
  return {
    msg: row.msg ?? "",
    userNm: row.userNm ?? "",
    persNo: row.persNo ?? "",
    encStr: row.encStr ?? "",
    deptNm: row.deptNm ?? "",
    wasInfo: row.wasInfo ?? "",
    initPswdYn: row.initPswdYn ?? "",
    needChangePwd: row.needChangePwd ?? "",
    userSupport: row.userSupport ?? "",
    locale: row.locale ?? "",
    raw: row
  };
}

/**
 * dsStunoInfo 행을 학생 정보로 변환한다 (SugangStudentInfo 재사용)
 * @private
 */
function mapStudent(row: SsvRow): SugangStudentInfo {
  return {
    stuno: row.stuno ?? "",
    stdntNm: row.stdntNm ?? "",
    deptCd: row.deptCd ?? "",
    deprtCd: row.deprtCd ?? "",
    deprtNm: row.deprtNm ?? "",
    hy: row.hy ?? "",
    syy: row.syy ?? "",
    smtCd: row.smtCd ?? "",
    unvfrStdrDeptCd: row.unvfrStdrDeptCd ?? COURSE_REG_DEFAULT_DEPT_CD,
    schrgSttusCd: row.schrgSttusCd ?? "",
    schrgSttusNm: row.schrgSttusNm ?? "",
    minCdtNum: row.minCdtNum ?? "",
    maxCdtNum: row.maxCdtNum ?? "",
    cmpsjSecnt: row.cmpsjSecnt ?? "",
    dghtDivCd: row.dghtDivCd ?? "",
    univCd: row.univCd ?? "",
    entnsDt: row.entnsDt ?? "",
    raw: row
  };
}

/**
 * dsSapl231 행을 신청 과목 모델로 변환한다
 * @private
 */
function mapRegisteredSubject(row: SsvRow): CourseRegRegisteredSubject {
  return {
    subjtCd: row.subjtCd ?? "",
    subjtNm: row.subjtNm ?? "",
    orgSubjtNm: row.orgSubjtNm ?? row.subjtNm ?? "",
    corseDvclsNo: row.corseDvclsNo ?? "",
    estblDeprtCd: row.estblDeprtCd ?? "",
    estblDeprtNm: row.estblDeprtNm ?? "",
    asignDeprtNm: row.asignDeprtNm ?? "",
    univCd: row.univCd ?? "",
    univNm: row.univNm ?? "",
    cmpsjCdt: row.cmpsjCdt ?? "",
    cmpsjDivCd: row.cmpsjDivCd ?? "",
    estblCrseDivCd: row.estblCrseDivCd ?? "",
    estblCrseDivNm: row.estblCrseDivNm ?? "",
    cmpsjHyDivCd: row.cmpsjHyDivCd ?? "",
    dghtDivCd: row.dghtDivCd ?? "",
    timtbNm: row.timtbNm ?? "",
    syy: row.syy ?? "",
    smtCd: row.smtCd ?? "",
    unvfrStdrDeptCd: row.unvfrStdrDeptCd ?? "",
    stuno: row.stuno ?? "",
    chrgInstrEmpno: row.chrgInstrEmpno ?? "",
    chrgInstrEmpnm: row.chrgInstrEmpnm ?? "",
    appcsLmttPcnt: row.appcsLmttPcnt ?? "",
    appcsPcnt: row.appcsPcnt ?? "",
    ttCmpsjCdt: row.ttCmpsjCdt ?? "",
    applyCrseCd: row.applyCrseCd ?? "",
    chk: row.chk ?? "",
    ttcMapngNo: row.ttcMapngNo ?? "",
    lessnChoicAttrbItemVal114: row.lessnChoicAttrbItemVal114 ?? "",
    lessnChoicAttrbItemVal115: row.lessnChoicAttrbItemVal115 ?? "",
    lessnChoicAttrbItemVal116: row.lessnChoicAttrbItemVal116 ?? "",
    lessnChoicAttrbItemVal119: row.lessnChoicAttrbItemVal119 ?? "",
    lessnChoicAttrbItemVal121: row.lessnChoicAttrbItemVal121 ?? "",
    lessnChoicAttrbItemVal125: row.lessnChoicAttrbItemVal125 ?? "",
    glioDeptCd: row.glioDeptCd ?? "",
    raw: row
  };
}

/**
 * dsSles131 행을 검색용 SugangSubject 로 변환한다
 * @private
 */
function mapSearchSubject(row: SsvRow): SugangSubject {
  return {
    subjtCd: row.subjtCd ?? "",
    subjtNm: row.subjtNm ?? "",
    orgSubjtNm: row.orgSubjtNm ?? row.subjtNm ?? "",
    corseDvclsNo: row.corseDvclsNo ?? "",
    estblDeprtCd: row.estblDeprtCd ?? row.asignDeprtCd ?? "",
    estblDeprtNm: row.estblDeprtNm ?? row.deptNm ?? "",
    asignDeprtCd: row.asignDeprtCd ?? row.estblDeprtCd ?? "",
    univCd: row.univCd ?? "",
    univNm: row.univNm ?? "",
    cmpsjCdt: row.cmpsjCdt ?? "",
    cmpsjDivCd: row.cmpsjDivCd ?? "",
    cmpsjHyDivCd: row.cmpsjHyDivCd ?? "",
    dghtDivCd: row.dghtDivCd ?? "",
    estblCrseDivCd: row.estblCrseDivCd ?? "",
    timtbNm: row.timtbNm ?? "",
    syy: row.syy ?? "",
    smtCd: row.smtCd ?? "",
    unvfrStdrDeptCd: row.unvfrStdrDeptCd ?? "",
    chk: row.chk ?? "",
    remrk: row.remrk ?? "",
    chrgInstrEmpnm: row.chrgInstrEmpnm ?? "",
    chrgInstrEmpno: row.chrgInstrEmpno ?? "",
    hopeAppcsCnt: row.hopeAppcsCnt ?? "",
    appcsLmttPcnt: row.appcsLmttPcnt ?? row.atnlcPosblPcnt ?? "",
    thryHrs: row.thryHrs ?? "",
    prctsHrs: row.prctsHrs ?? "",
    slesLessnItem: row.slesLessnItem,
    sourceList: "general",
    raw: row
  };
}
