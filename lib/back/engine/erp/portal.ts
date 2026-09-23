/**
 * ERP 포털 로그인·SSO·메뉴·공지 요청 생성/응답 파싱.
 *
 * 호스트: info.seowon.ac.kr
 * e-campus 로그인(encryptData) 및 sugangh findAppcsLogin 과 별개다.
 */

import { absoluteUrl } from "../ecampus/utils.js";
import {
  ERP_BASE_URL,
  ERP_GRADE_OVERALL_PORTAL_MENU_ID,
  ERP_NOTICE_MENU_ID,
  ERP_PATHS,
  ERP_PORTAL_SERVICES
} from "./constants.js";
import {
  cellNumber,
  cellString,
  createErpGet,
  createErpJsonPost,
  parseJsonBody,
  readJsonDataset,
  readJsonRows
} from "./json.js";
import type {
  ErpFormPostRequest,
  ErpGetRequest,
  ErpGlioInfo,
  ErpJsonPostRequest,
  ErpLoginCredentials,
  ErpLoginResult,
  ErpMenuItem,
  ErpNoticeDetail,
  ErpNoticeListItem,
  ErpNoticeListOptions,
  ErpSessionInfo
} from "./types/portal.js";

export type {
  ErpClientOptions,
  ErpFormPostRequest,
  ErpGetRequest,
  ErpGlioInfo,
  ErpJsonPostRequest,
  ErpLoginCredentials,
  ErpLoginResult,
  ErpMenuItem,
  ErpNoticeDetail,
  ErpNoticeListItem,
  ErpNoticeListOptions,
  ErpSazSummary,
  ErpSessionInfo
} from "./types/portal.js";

/**
 * 포털 로그인 화면 GET 요청을 만든다
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpGetRequest} 로그인 화면 요청
 */
export function createErpLoginPageRequest(baseUrl = ERP_BASE_URL): ErpGetRequest {
  return createErpGet(ERP_PATHS.loginPage, undefined, baseUrl);
}

/**
 * 포털 메인 GET 요청을 만든다
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpGetRequest} 메인 요청
 */
export function createErpMainRequest(baseUrl = ERP_BASE_URL): ErpGetRequest {
  return createErpGet(ERP_PATHS.main, undefined, baseUrl);
}

/**
 * 포털 로그인 POST 요청을 만든다 (application/x-www-form-urlencoded)
 * @param {ErpLoginCredentials} credentials - 학번/비밀번호
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpFormPostRequest} 로그인 요청
 */
export function createErpPortalLoginRequest(
  credentials: ErpLoginCredentials,
  baseUrl = ERP_BASE_URL
): ErpFormPostRequest {
  const params = new URLSearchParams();
  params.set("uid", credentials.uid);
  params.set("password", credentials.password);
  return {
    method: "POST",
    url: absoluteUrl(ERP_PATHS.login, baseUrl),
    body: params.toString(),
    contentType: "application/x-www-form-urlencoded",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
}

/**
 * Vue SSO 진입 GET 요청을 만든다
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpGetRequest} ssoLogin.do?sysCd=vue
 */
export function createErpVueSsoRequest(baseUrl = ERP_BASE_URL): ErpGetRequest {
  return createErpGet(ERP_PATHS.ssoLogin, { sysCd: "vue" }, baseUrl);
}

/**
 * sso_login JSON POST 요청을 만든다
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} sso_login 요청
 */
export function createErpSsoLoginJsonRequest(baseUrl = ERP_BASE_URL): ErpJsonPostRequest {
  return createErpJsonPost(ERP_PATHS.ssoLoginJson, { dsParam: {} }, {}, baseUrl);
}

/**
 * 로그인 여부 확인 요청을 만든다
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} isLogin 요청
 */
export function createErpIsLoginRequest(baseUrl = ERP_BASE_URL): ErpJsonPostRequest {
  return createErpJsonPost(ERP_PATHS.isLogin, { dsParam: {} }, {}, baseUrl);
}

/**
 * GLIO(접속 정보) 조회 요청을 만든다
 * @param {{ menuId?: string; pgmId?: string; fields?: string; baseUrl?: string }} [options] - 메뉴 문맥
 * @returns {ErpJsonPostRequest} findMyGLIOList 요청
 */
export function createErpGlioRequest(
  options: { menuId?: string; pgmId?: string; fields?: string; baseUrl?: string } = {}
): ErpJsonPostRequest {
  const fields = options.fields ?? "|persNo|userNm";
  return createErpJsonPost(
    ERP_PATHS.findMyGLIOList,
    { dsParam: fields },
    {
      menuId: options.menuId ?? "",
      pgmId: options.pgmId ?? ""
    },
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 서버 시각 조회 요청을 만든다
 * @param {{ menuId?: string; pgmId?: string; baseUrl?: string }} [options] - 메뉴 문맥
 * @returns {ErpJsonPostRequest} findSysdate 요청
 */
export function createErpSysdateRequest(
  options: { menuId?: string; pgmId?: string; baseUrl?: string } = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findSysdate,
    { dsParam: "" },
    { menuId: options.menuId ?? "", pgmId: options.pgmId ?? "" },
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 포털 메뉴 트리 조회 요청을 만든다 (SVC0100)
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} 메뉴 트리 요청
 */
export function createErpPortalMenuTreeRequest(baseUrl = ERP_BASE_URL): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.portalApi,
    { dsParam: { sysCd: "POR", sysId: "POR" } },
    { serviceId: ERP_PORTAL_SERVICES.menuTree },
    baseUrl
  );
}

/**
 * 단일 메뉴 상세 조회 요청을 만든다 (SVC0101)
 * @param {string} [strMenuId=ERP_GRADE_OVERALL_PORTAL_MENU_ID] - 포털 메뉴 ID
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} 메뉴 상세 요청
 */
export function createErpPortalMenuInfoRequest(
  strMenuId = ERP_GRADE_OVERALL_PORTAL_MENU_ID,
  baseUrl = ERP_BASE_URL
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.portalApi,
    "",
    { serviceId: ERP_PORTAL_SERVICES.menuInfo, strMenuId },
    baseUrl
  );
}

/**
 * Vue 메뉴 정보 조회 요청을 만든다 (findMenu)
 * @param {string} strMenuId - Vue 메뉴 ID (예: M106021)
 * @param {{ menuId?: string; pgmId?: string; baseUrl?: string }} [options] - 쿼리
 * @returns {ErpJsonPostRequest} findMenu 요청
 */
export function createErpFindMenuRequest(
  strMenuId: string,
  options: { menuId?: string; pgmId?: string; baseUrl?: string } = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.findMenu,
    { strMenuId },
    { menuId: options.menuId ?? "", pgmId: options.pgmId ?? "" },
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * 포털 공지 목록 조회 요청을 만든다
 * @param {ErpNoticeListOptions} [options={}] - 페이징/분류
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} 공지 목록 요청
 */
export function createErpNoticeListRequest(
  options: ErpNoticeListOptions = {},
  baseUrl = ERP_BASE_URL
): ErpJsonPostRequest {
  const payload = {
    startRowIndex: options.startRowIndex ?? 0,
    startRowNum: options.startRowNum ?? 1,
    endRowNum: options.endRowNum ?? 1,
    isTotalCount: true,
    countPerPage: options.countPerPage ?? 10,
    notcLwprtCatgrCd: "",
    notcTagList: "",
    select01: "1",
    condition: "",
    rowStatus: "insert",
    notcCatgrCd: options.notcCatgrCd ?? ""
  };
  return createErpJsonPost(
    ERP_PATHS.noticeList,
    payload,
    { menuId: options.menuId ?? ERP_NOTICE_MENU_ID },
    baseUrl
  );
}

/**
 * 포털 공지 상세 조회 요청을 만든다
 * @param {number | string} notcNo - 공지 번호
 * @param {{ loginId?: string; menuId?: string; baseUrl?: string }} [options] - 로그인 ID
 * @returns {ErpJsonPostRequest} 공지 상세 요청
 */
export function createErpNoticeDetailRequest(
  notcNo: number | string,
  options: { loginId?: string; menuId?: string; baseUrl?: string } = {}
): ErpJsonPostRequest {
  return createErpJsonPost(
    ERP_PATHS.noticeDetail,
    {
      notcNo,
      notcInqirRspnsDivCd: "1",
      loginLoginId: options.loginId ?? ""
    },
    { menuId: options.menuId ?? ERP_NOTICE_MENU_ID },
    options.baseUrl ?? ERP_BASE_URL
  );
}

/**
 * /por/mn HTML 에서 학번을 추출한다
 * @param {string} html - 메인 HTML
 * @returns {string} persNo. 없으면 빈 문자열
 */
export function parseErpMainPersNo(html: string): string {
  const match = html.match(/userInfo\.persNo\s*=\s*"([^"]+)"/);
  return match?.[1] ?? "";
}

/**
 * 포털 로그인 성공 여부를 HTML/리다이렉트 단서로 판별한다
 * @param {{ status?: number; location?: string; html?: string }} input - 응답 단서
 * @returns {ErpLoginResult} 로그인 결과
 */
export function parseErpPortalLoginResponse(input: {
  status?: number;
  location?: string;
  html?: string;
}): ErpLoginResult {
  const html = input.html ?? "";
  const persNo = parseErpMainPersNo(html);
  const location = input.location ?? "";
  const redirectedToMain = /(?:^|[/?])mn(?:$|[/?#])/i.test(location);
  const success = Boolean(persNo) || redirectedToMain;

  return {
    success,
    persNo: persNo || undefined,
    message: success ? "ERP 포털 로그인에 성공했습니다." : "ERP 포털 로그인에 실패했습니다.",
    raw: { mainHtml: html || undefined }
  };
}

/**
 * isLogin JSON 을 세션 정보로 정규화한다
 * @param {string} body - 응답 본문
 * @returns {ErpSessionInfo | undefined} 세션. 없으면 undefined
 */
export function parseErpIsLoginResponse(body: string): ErpSessionInfo | undefined {
  const sessionRow = readJsonDataset(body, "DS_SESSIONINFO")[0];
  if (!sessionRow) return undefined;
  const confirm = readJsonDataset(body, "DS_LOGINCONFIRM")[0];
  return {
    msg: cellString(sessionRow, "msg"),
    userNm: cellString(sessionRow, "userNm"),
    persNo: cellString(sessionRow, "persNo"),
    deptNm: cellString(sessionRow, "deptNm"),
    locale: cellString(sessionRow, "locale"),
    needChangePwd: cellString(sessionRow, "needChangePwd"),
    wasInfo: cellString(sessionRow, "wasInfo"),
    encStr: cellString(sessionRow, "encStr"),
    userSupport: cellString(sessionRow, "userSupport"),
    isLogin: cellString(confirm ?? {}, "isLogin") === "1" || cellString(sessionRow, "msg") === "success",
    raw: sessionRow
  };
}

/**
 * findMyGLIOList JSON 을 접속 정보로 정규화한다
 * @param {string} body - 응답 본문
 * @returns {ErpGlioInfo | undefined} GLIO. 없으면 undefined
 */
export function parseErpGlioResponse(body: string): ErpGlioInfo | undefined {
  const row = readJsonDataset(body, "DS_GLIO")[0];
  if (!row) return undefined;
  return {
    persNo: cellString(row, "persNo"),
    loginId: cellString(row, "loginId"),
    userNm: cellString(row, "userNm"),
    deptCd: cellString(row, "deptCd"),
    deptNm: cellString(row, "deptNm"),
    deptId: cellString(row, "deptId"),
    univCd: cellString(row, "univCd"),
    univNm: cellString(row, "univNm"),
    acntYy: cellString(row, "acntYy"),
    locale: cellString(row, "locale"),
    socpsCd: cellString(row, "socpsCd"),
    userDivCd: cellString(row, "userDivCd"),
    menuId: cellString(row, "menuId"),
    logNo: cellString(row, "logNo"),
    loginIp: cellString(row, "loginIp"),
    raw: row
  };
}

/**
 * 메뉴 행을 ErpMenuItem 으로 변환한다
 * @param {Record<string, unknown>} row - JSON 행
 * @returns {ErpMenuItem} 메뉴 항목
 */
function mapMenuItem(row: Record<string, unknown>): ErpMenuItem {
  return {
    menuId: cellString(row, "menuId"),
    menuNm: cellString(row, "menuNm"),
    upperMenuId: cellString(row, "upperMenuId"),
    menuLevel: cellNumber(row, "menuLevel") ?? cellNumber(row, "menuGrade"),
    menuDivCd: cellString(row, "menuDivCd"),
    pgmId: cellString(row, "pgmId"),
    pgmNm: cellString(row, "pgmNm"),
    pgmPathNm: cellString(row, "pgmPathNm"),
    menuPath: cellString(row, "menuPath"),
    sysCd: cellString(row, "sysCd"),
    vueYn: cellString(row, "vueYn"),
    mobYn: cellString(row, "mobYn"),
    useYn: cellString(row, "useYn"),
    raw: row
  };
}

/**
 * 포털 메뉴 트리(SVC0100) 또는 배열 JSON 을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpMenuItem[]} 메뉴 목록
 */
export function parseErpPortalMenuTreeResponse(body: string): ErpMenuItem[] {
  return readJsonRows(body).map(mapMenuItem);
}

/**
 * SVC0101 / findMenu 응답을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpMenuItem[]} 메뉴 목록
 */
export function parseErpFindMenuResponse(body: string): ErpMenuItem[] {
  const fromDataset = readJsonDataset(body, "dsMenuInfo");
  if (fromDataset.length) return fromDataset.map(mapMenuItem);
  return readJsonRows(body).map(mapMenuItem);
}

/**
 * 공지 목록 JSON 을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpNoticeListItem[]} 공지 목록
 */
export function parseErpNoticeListResponse(body: string): ErpNoticeListItem[] {
  return readJsonRows(body).map(mapNoticeListItem);
}

/**
 * 공지 상세 JSON 을 파싱한다
 * @param {string} body - 응답 본문
 * @returns {ErpNoticeDetail | undefined} 상세. 없으면 undefined
 */
export function parseErpNoticeDetailResponse(body: string): ErpNoticeDetail | undefined {
  const row = readJsonRows(body)[0];
  if (!row) return undefined;
  return {
    ...mapNoticeListItem(row),
    noticeSntncCn: cellString(row, "noticeSntncCn"),
    portaNotcPrscgNm: cellString(row, "portaNotcPrscgNm"),
    portaNotcPrscgDeptNm: cellString(row, "portaNotcPrscgDeptNm"),
    portaNotcPrscgEmail: cellString(row, "portaNotcPrscgEmail")
  };
}

/**
 * findSysdate JSON 에서 서버 시각 문자열을 읽는다
 * @param {string} body - 응답 본문
 * @returns {string} _sysdate. 없으면 빈 문자열
 */
export function parseErpSysdateResponse(body: string): string {
  const parsed = parseJsonBody(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  return cellString(parsed as Record<string, unknown>, "_sysdate");
}

/**
 * 로그인 HTML + isLogin + GLIO 를 하나의 결과로 합친다
 * @param {{ mainHtml?: string; isLoginBody?: string; glioBody?: string }} parts - 응답 조각
 * @returns {ErpLoginResult} 합친 로그인 결과
 */
export function composeErpLoginResult(parts: {
  mainHtml?: string;
  isLoginBody?: string;
  glioBody?: string;
}): ErpLoginResult {
  const fromHtml = parseErpPortalLoginResponse({ html: parts.mainHtml });
  const session = parts.isLoginBody ? parseErpIsLoginResponse(parts.isLoginBody) : undefined;
  const glio = parts.glioBody ? parseErpGlioResponse(parts.glioBody) : undefined;
  const persNo = fromHtml.persNo || session?.persNo || glio?.persNo;
  const success = Boolean(persNo) && (fromHtml.success || session?.isLogin === true);

  return {
    success,
    persNo,
    session,
    glio,
    message: success ? "ERP 포털 로그인에 성공했습니다." : "ERP 포털 로그인에 실패했습니다.",
    raw: {
      mainHtml: parts.mainHtml,
      isLogin: parts.isLoginBody ? parseJsonBody(parts.isLoginBody) : undefined,
      glio: parts.glioBody ? parseJsonBody(parts.glioBody) : undefined
    }
  };
}

/**
 * 공지 목록 행을 정규화한다
 * @param {Record<string, unknown>} row - JSON 행
 * @returns {ErpNoticeListItem} 공지 항목
 */
function mapNoticeListItem(row: Record<string, unknown>): ErpNoticeListItem {
  return {
    notcNo: cellNumber(row, "notcNo"),
    notcTitle: cellString(row, "notcTitle"),
    notcCatgrCd: cellString(row, "notcCatgrCd"),
    notcCatgrNm: cellString(row, "notcCatgrNm"),
    writngUserNm: cellString(row, "writngUserNm"),
    writngUserDeptNm: cellString(row, "writngUserDeptNm"),
    inqryCnt: cellNumber(row, "inqryCnt"),
    gopubDt: cellString(row, "gopubDt"),
    frstInputDttm: cellString(row, "frstInputDttm"),
    attflUuid: cellString(row, "attflUuid"),
    totalCount: cellNumber(row, "totalCount"),
    raw: row
  };
}
