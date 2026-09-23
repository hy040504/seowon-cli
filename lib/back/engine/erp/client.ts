/**
 * 서원대 통합정보시스템 ERP 전용 클라이언트.
 *
 * 호스트: info.seowon.ac.kr
 * 미포함:
 * - e-campus LMS → EcampusClient
 * - 수강희망바구니 → HopeBasketClient
 * - 수강신청 본신청 → CourseRegistrationClient
 *
 * 주 범위: 포털 로그인, Vue SSO, 전체학기성적조회, 학적, 포털 공지, 강의평가 기간 체크.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

import { isCookieJarUsable } from "../ecampus/cookies.js";
import {
  COMMON_AJAX_HEADERS,
  DEFAULT_BROWSER_USER_AGENT,
  errorMessage,
  normalizeBaseUrl
} from "../utils.js";
import {
  createErpAcademicProfileRequest,
  createErpGradeCodeComboRequest,
  createErpGradeScheduleRequest,
  createErpLectureEvalCheckRequest,
  createErpVoteListRequest,
  parseErpAcademicProfileResponse,
  parseErpGradeCodeComboResponse,
  parseErpGradeScheduleResponse,
  parseErpLectureEvalCheckResponse,
  parseErpVoteListResponse,
  type ErpAcademicProfile,
  type ErpCodeComboSet,
  type ErpLectureEvalCheck,
  type ErpLectureEvalCheckOptions,
  type ErpScheduleWindow,
  type ErpVoteInfo
} from "./academic.js";
import { ERP_BASE_URL, ERP_VOTE_VUE_MENU_ID } from "./constants.js";
import {
  composeErpOverallGrades,
  createErpGradeDetailListRequest,
  createErpGradeTotalListRequest,
  createErpGradeYearListRequest,
  parseErpGradeDetailListResponse,
  parseErpGradeTotalListResponse,
  parseErpGradeYearListResponse,
  resolveErpGradeMenu,
  type ErpGradeMenuKind,
  type ErpGradeQueryOptions,
  type ErpGradeSubject,
  type ErpGradeTermTotal,
  type ErpGradeYear,
  type ErpOverallGrades
} from "./grades.js";
import {
  composeErpLoginResult,
  createErpFindMenuRequest,
  createErpGlioRequest,
  createErpIsLoginRequest,
  createErpLoginPageRequest,
  createErpMainRequest,
  createErpNoticeDetailRequest,
  createErpNoticeListRequest,
  createErpPortalLoginRequest,
  createErpPortalMenuInfoRequest,
  createErpPortalMenuTreeRequest,
  createErpSsoLoginJsonRequest,
  createErpSysdateRequest,
  createErpVueSsoRequest,
  parseErpFindMenuResponse,
  parseErpGlioResponse,
  parseErpIsLoginResponse,
  parseErpNoticeDetailResponse,
  parseErpNoticeListResponse,
  parseErpPortalLoginResponse,
  parseErpPortalMenuTreeResponse,
  parseErpSysdateResponse,
  type ErpClientOptions,
  type ErpGetRequest,
  type ErpGlioInfo,
  type ErpJsonPostRequest,
  type ErpLoginCredentials,
  type ErpLoginResult,
  type ErpMenuItem,
  type ErpNoticeDetail,
  type ErpNoticeListItem,
  type ErpNoticeListOptions,
  type ErpSessionInfo
} from "./portal.js";

export type { ErpClientOptions } from "./types/portal.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 3;
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ERR_NETWORK",
  "ERR_BAD_RESPONSE"
]);

/**
 * 서원대 통합정보시스템 ERP 클라이언트.
 *
 * 범위:
 * - 포함: 포털 로그인, Vue 세션, 전체학기성적, 학적, 공지, 코드콤보, 강의평가 기간 체크
 * - 미포함: e-campus 교과 성적, 수강신청
 */
export class ErpClient {
  readonly baseUrl: string;
  readonly cookieJar: CookieJar;
  readonly http: AxiosInstance;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private onProgress?: (message: string) => void;
  private credentials?: ErpLoginCredentials;
  private gradeMenuKind: ErpGradeMenuKind;
  private session?: ErpSessionInfo;
  private glio?: ErpGlioInfo;
  private student?: ErpAcademicProfile;

  /**
   * 클라이언트 인스턴스를 초기화하고 통신 인터셉터를 구성한다.
   * @param {ErpClientOptions} [options={}] - 설정 옵션
   */
  constructor(options: ErpClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? ERP_BASE_URL);
    this.credentials = options.credentials;
    this.gradeMenuKind = options.gradeMenu ?? "overall";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRY_COUNT;
    this.onProgress = options.onProgress;
    // 학교 Set-Cookie 는 이 jar 에만 남긴다. 재시작 뒤 파일을 읽지 않는다.
    this.cookieJar = new CookieJar();
    this.http =
      options.axios ??
      wrapper(
        axios.create({
          baseURL: this.baseUrl,
          jar: this.cookieJar,
          withCredentials: true,
          timeout: this.requestTimeoutMs,
          headers: {
            "User-Agent": DEFAULT_BROWSER_USER_AGENT,
            "Accept-Language": "ko,ko-KR;q=0.9,en-US;q=0.8,en;q=0.7",
            Accept: "*/*",
            Connection: "close",
            "Accept-Encoding": "gzip, deflate",
            ...COMMON_AJAX_HEADERS
          },
          transitional: {
            clarifyTimeoutError: true
          }
        })
      );
  }

  /**
   * 자동 재로그인용 계정 정보를 수동으로 업데이트한다
   * @param {ErpLoginCredentials} credentials - 보관할 계정 정보
   * @returns {void}
   */
  setCredentials(credentials: ErpLoginCredentials): void {
    this.credentials = credentials;
  }

  /**
   * 저장된 계정 정보를 조회한다
   * @returns {ErpLoginCredentials | undefined} 현재 설정된 계정 정보
   */
  getCredentials(): ErpLoginCredentials | undefined {
    return this.credentials;
  }

  /**
   * 성적 조회 기본 메뉴를 바꾼다
   * @param {ErpGradeMenuKind} kind - overall | undergrad
   * @returns {void}
   */
  setGradeMenu(kind: ErpGradeMenuKind): void {
    this.gradeMenuKind = kind;
  }

  /**
   * 현재 성적 조회 메뉴 종류를 반환한다
   * @returns {ErpGradeMenuKind} overall | undergrad
   */
  getGradeMenu(): ErpGradeMenuKind {
    return this.gradeMenuKind;
  }

  /**
   * 최근 로그인 세션 정보를 반환한다
   * @returns {ErpSessionInfo | undefined} isLogin 세션
   */
  getSessionInfo(): ErpSessionInfo | undefined {
    return this.session;
  }

  /**
   * 최근 GLIO 접속 정보를 반환한다
   * @returns {ErpGlioInfo | undefined} GLIO
   */
  getGlioInfo(): ErpGlioInfo | undefined {
    return this.glio;
  }

  /**
   * 최근 학적 기본정보를 반환한다
   * @returns {ErpAcademicProfile | undefined} 학적
   */
  getStudentProfile(): ErpAcademicProfile | undefined {
    return this.student;
  }

  /**
   * 진행 상황 콜백을 교체한다
   * @param {(message: string) => void} [handler] - 진행 메시지 핸들러
   * @returns {void}
   */
  setProgressHandler(handler?: (message: string) => void): void {
    this.onProgress = handler;
  }

  /**
   * 현재 쿠키 jar를 파일에 저장한다
   * @returns {Promise<void>}
   */
  async saveCookies(): Promise<void> {
  }

  /**
   * 로그인 화면을 열어 SESSIONID 를 확보한다
   * @returns {Promise<void>}
   */
  async prepareSession(): Promise<void> {
    this.emitProgress("ERP 로그인 화면 접속 중 (/por/ln)...");
    const request = createErpLoginPageRequest(this.baseUrl);
    await this.getHtml(request);
    this.emitProgress("세션 쿠키 확보 완료");
  }

  /**
   * 포털 로그인을 수행하고 Vue SSO 세션을 붙인다
   * @param {ErpLoginCredentials} [credentials] - 학번/비밀번호 (미지정 시 저장 계정)
   * @returns {Promise<ErpLoginResult>} 로그인 결과
   * @throws {Error} 계정 정보 부재
   */
  async login(credentials?: ErpLoginCredentials): Promise<ErpLoginResult> {
    const creds = credentials ?? this.credentials;
    if (!creds?.uid || !creds.password) {
      throw new Error("학번(uid)과 비밀번호가 필요합니다.");
    }
    this.credentials = creds;

    await this.ensureSessionCookie(true);
    this.emitProgress("ERP 포털 로그인 요청 중...");
    const loginRequest = createErpPortalLoginRequest(creds, this.baseUrl);
    const loginResponse = await this.requestWithRetry({
      method: "POST",
      url: loginRequest.url,
      data: loginRequest.body,
      headers: {
        Accept: loginRequest.accept,
        "Content-Type": loginRequest.contentType,
        Origin: this.origin(),
        Referer: createErpLoginPageRequest(this.baseUrl).url,
        Connection: "close"
      },
      maxRedirects: 5,
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true
    });

    let html = typeof loginResponse.data === "string" ? loginResponse.data : "";
    const locationHeader = String(loginResponse.headers.location ?? "");
    const loginPartial = parseErpPortalLoginResponse({
      status: loginResponse.status,
      location: locationHeader,
      html
    });

    if (!parsePersNo(html)) {
      this.emitProgress("포털 메인 확인 중...");
      const main = await this.getHtml(createErpMainRequest(this.baseUrl));
      html = main || html;
    }

    const fromMain = parseErpPortalLoginResponse({ html, location: locationHeader });
    if (!fromMain.success && !loginPartial.success) {
      this.emitProgress(`로그인 실패: ${fromMain.message}`);
      return { ...fromMain, raw: { mainHtml: html } };
    }

    this.emitProgress("Vue SSO 세션 연결 중...");
    await this.bootstrapVueSession();

    this.emitProgress("학적 기본정보 조회 중...");
    try {
      this.student = await this.getAcademicProfile();
    } catch {
      this.emitProgress("학적 조회 실패 (세션은 유지)");
    }

    const result = composeErpLoginResult({
      mainHtml: html,
      isLoginBody: this.lastIsLoginBody,
      glioBody: this.lastGlioBody
    });
    result.student = this.student;
    this.emitProgress(result.success ? "ERP 로그인 완료" : `로그인 실패: ${result.message}`);
    return result;
  }

  private lastIsLoginBody?: string;
  private lastGlioBody?: string;

  /**
   * 현재 세션이 유효한지 확인하고, 만료 시 자동 재로그인한다
   * @returns {Promise<void>}
   */
  async ensureLoggedIn(): Promise<void> {
    await this.ensureReady();
  }

  /**
   * isLogin 으로 세션을 갱신한다
   * @returns {Promise<ErpSessionInfo | undefined>} 세션
   */
  async refreshSession(): Promise<ErpSessionInfo | undefined> {
    const body = await this.postJson(createErpIsLoginRequest(this.baseUrl));
    this.lastIsLoginBody = body;
    this.session = parseErpIsLoginResponse(body);
    return this.session;
  }

  /**
   * 포털 메뉴 트리를 조회한다 (SVC0100)
   * @returns {Promise<ErpMenuItem[]>} 메뉴 목록
   */
  async getPortalMenuTree(): Promise<ErpMenuItem[]> {
    await this.ensureReady();
    const body = await this.postJson(createErpPortalMenuTreeRequest(this.baseUrl));
    return parseErpPortalMenuTreeResponse(body);
  }

  /**
   * 포털 단일 메뉴 상세를 조회한다 (SVC0101)
   * @param {string} [strMenuId] - 포털 메뉴 ID
   * @returns {Promise<ErpMenuItem[]>} 메뉴 상세
   */
  async getPortalMenuInfo(strMenuId?: string): Promise<ErpMenuItem[]> {
    await this.ensureReady();
    const menuId = strMenuId ?? resolveErpGradeMenu(this.gradeMenuKind).portalMenuId;
    const body = await this.postJson(createErpPortalMenuInfoRequest(menuId, this.baseUrl));
    return parseErpFindMenuResponse(body);
  }

  /**
   * Vue findMenu 로 메뉴 정보를 조회한다
   * @param {string} [strMenuId] - Vue 메뉴 ID
   * @returns {Promise<ErpMenuItem[]>} 메뉴 정보
   */
  async getVueMenu(strMenuId?: string): Promise<ErpMenuItem[]> {
    await this.ensureReady();
    const menu = resolveErpGradeMenu(this.gradeMenuKind);
    const body = await this.postJson(
      createErpFindMenuRequest(strMenuId ?? menu.vueMenuId, {
        baseUrl: this.baseUrl
      })
    );
    return parseErpFindMenuResponse(body);
  }

  /**
   * 서버 시각을 조회한다
   * @returns {Promise<string>} _sysdate
   */
  async getSysdate(): Promise<string> {
    await this.ensureReady();
    const menu = resolveErpGradeMenu(this.gradeMenuKind);
    const body = await this.postJson(
      createErpSysdateRequest({
        menuId: menu.vueMenuId,
        pgmId: menu.vuePgmId,
        baseUrl: this.baseUrl
      })
    );
    return parseErpSysdateResponse(body);
  }

  /**
   * 학적 기본정보를 조회한다
   * @returns {Promise<ErpAcademicProfile | undefined>} 학적
   */
  async getAcademicProfile(): Promise<ErpAcademicProfile | undefined> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpAcademicProfileRequest(this.gradeQuery()),
      this.vueReferer()
    );
    const profile = parseErpAcademicProfileResponse(body);
    if (profile) this.student = profile;
    return profile;
  }

  /**
   * 성적 코드콤보(학기/이수구분/등급)를 조회한다
   * @returns {Promise<ErpCodeComboSet>} 코드 묶음
   */
  async getGradeCodeCombos(): Promise<ErpCodeComboSet> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpGradeCodeComboRequest(this.gradeQuery()),
      this.vueReferer()
    );
    return parseErpGradeCodeComboResponse(body);
  }

  /**
   * 성적 공개 학사일정을 조회한다
   * @returns {Promise<ErpScheduleWindow | undefined>} 일정 창
   */
  async getGradeSchedule(): Promise<ErpScheduleWindow | undefined> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpGradeScheduleRequest(this.gradeQuery()),
      this.vueReferer()
    );
    return parseErpGradeScheduleResponse(body);
  }

  /**
   * 이수학기 목록을 조회한다
   * @returns {Promise<ErpGradeYear[]>} 이수학기
   */
  async getGradeYears(): Promise<ErpGradeYear[]> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpGradeYearListRequest(this.gradeQuery({ stuno: this.stuno() })),
      this.vueReferer()
    );
    return parseErpGradeYearListResponse(body);
  }

  /**
   * 학기별 평점 합계를 조회한다
   * @returns {Promise<ErpGradeTermTotal[]>} 학기 합계
   */
  async getGradeTotals(): Promise<ErpGradeTermTotal[]> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpGradeTotalListRequest(this.gradeQuery()),
      this.vueReferer()
    );
    return parseErpGradeTotalListResponse(body);
  }

  /**
   * 한 학기 과목 성적 상세를 조회한다
   * @param {{ syy: string; smtCd: string }} term - 학년도/학기
   * @returns {Promise<ErpGradeSubject[]>} 과목 성적
   */
  async getGradeDetails(term: { syy: string; smtCd: string }): Promise<ErpGradeSubject[]> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpGradeDetailListRequest({ ...this.gradeQuery(), syy: term.syy, smtCd: term.smtCd }),
      this.vueReferer()
    );
    return parseErpGradeDetailListResponse(body);
  }

  /**
   * 이수학기·합계·전 학기 상세를 한 번에 조회한다
   * @returns {Promise<ErpOverallGrades>} 전체 성적
   */
  async getOverallGrades(): Promise<ErpOverallGrades> {
    const years = await this.getGradeYears();
    const totals = await this.getGradeTotals();
    const subjects: ErpGradeSubject[] = [];
    const terms = years.length ? years : totals.map((item) => ({ syy: item.syy, smtCd: item.smtCd }));
    for (const term of terms) {
      if (!term.syy || !term.smtCd) continue;
      this.emitProgress(`성적 상세 조회: ${term.syy}-${term.smtCd}`);
      try {
        subjects.push(...(await this.getGradeDetails({ syy: term.syy, smtCd: term.smtCd })));
      } catch {
        this.emitProgress(`성적 상세 조회 실패: ${term.syy}-${term.smtCd}`);
      }
    }
    return composeErpOverallGrades(years, totals, subjects);
  }

  /**
   * 강의평가 기간인지 확인한다 (Nexacro SSV)
   * @param {ErpLectureEvalCheckOptions} [options={}] - 학년도/학기
   * @returns {Promise<ErpLectureEvalCheck>} 기간 여부
   */
  async checkLectureEvalPeriod(
    options: ErpLectureEvalCheckOptions = {}
  ): Promise<ErpLectureEvalCheck> {
    await this.ensureReady();
    const request = createErpLectureEvalCheckRequest({
      ...options,
      stuno: options.stuno ?? this.stuno(),
      baseUrl: this.baseUrl
    });
    const body = await this.postSsv(request);
    return parseErpLectureEvalCheckResponse(body);
  }

  /**
   * 온라인투표 목록을 조회한다
   * @param {{ syy: string; smtCd: string }} term - 학년도/학기
   * @returns {Promise<ErpVoteInfo[]>} 투표 목록
   */
  async getVoteList(term: { syy: string; smtCd: string }): Promise<ErpVoteInfo[]> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpVoteListRequest({ ...term, baseUrl: this.baseUrl }),
      `${this.origin()}/vue/${ERP_VOTE_VUE_MENU_ID}`
    );
    return parseErpVoteListResponse(body);
  }

  /**
   * 포털 공지 목록을 조회한다
   * @param {ErpNoticeListOptions} [options={}] - 페이징
   * @returns {Promise<ErpNoticeListItem[]>} 공지 목록
   */
  async getNoticeList(options: ErpNoticeListOptions = {}): Promise<ErpNoticeListItem[]> {
    await this.ensureReady();
    const body = await this.postJson(createErpNoticeListRequest(options, this.baseUrl));
    return parseErpNoticeListResponse(body);
  }

  /**
   * 포털 공지 상세를 조회한다
   * @param {number | string} notcNo - 공지 번호
   * @returns {Promise<ErpNoticeDetail | undefined>} 상세
   */
  async getNotice(notcNo: number | string): Promise<ErpNoticeDetail | undefined> {
    await this.ensureReady();
    const body = await this.postJson(
      createErpNoticeDetailRequest(notcNo, {
        loginId: this.stuno(),
        baseUrl: this.baseUrl
      })
    );
    return parseErpNoticeDetailResponse(body);
  }

  /**
   * Vue SSO + isLogin + GLIO 를 붙인다
   * @returns {Promise<void>}
   * @private
   */
  private async bootstrapVueSession(): Promise<void> {
    const sso = createErpVueSsoRequest(this.baseUrl);
    await this.requestWithRetry({
      method: "GET",
      url: sso.url,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: `${this.origin()}/por/mn`,
        Connection: "close"
      },
      maxRedirects: 5,
      responseType: "text",
      transformResponse: [(data) => data],
      validateStatus: () => true
    });
    await this.postJson(createErpSsoLoginJsonRequest(this.baseUrl));
    this.lastIsLoginBody = await this.postJson(createErpIsLoginRequest(this.baseUrl));
    this.session = parseErpIsLoginResponse(this.lastIsLoginBody);
    const menu = resolveErpGradeMenu(this.gradeMenuKind);
    this.lastGlioBody = await this.postJson(
      createErpGlioRequest({
        menuId: menu.vueMenuId,
        pgmId: menu.vuePgmId,
        baseUrl: this.baseUrl
      }),
      this.vueReferer()
    );
    this.glio = parseErpGlioResponse(this.lastGlioBody);
  }

  /**
   * 보호 API 호출 전 세션/로그인을 맞춘다
   * @returns {Promise<void>}
   * @private
   */
  private async ensureReady(): Promise<void> {
    await this.ensureSessionCookie();
    if (this.session?.isLogin || this.glio?.persNo) return;
    try {
      const session = await this.refreshSession();
      if (session?.isLogin) {
        const menu = resolveErpGradeMenu(this.gradeMenuKind);
        this.lastGlioBody = await this.postJson(
          createErpGlioRequest({
            menuId: menu.vueMenuId,
            pgmId: menu.vuePgmId,
            baseUrl: this.baseUrl
          }),
          this.vueReferer()
        );
        this.glio = parseErpGlioResponse(this.lastGlioBody);
        if (this.glio?.persNo) return;
      }
    } catch {
      // 세션 조회 실패 시 재로그인
    }
    if (this.credentials) {
      await this.login(this.credentials);
    }
  }

  /**
   * SESSIONID가 없으면 로그인 화면으로 세션을 연다
   * @param {boolean} [force=false] - true면 재진입
   * @returns {Promise<void>}
   * @private
   */
  private async ensureSessionCookie(force = false): Promise<void> {
    if (!force && (await this.hasSessionIdCookie())) return;
    await this.prepareSession();
  }

  /**
   * SESSIONID 보유 여부를 확인한다
   * @returns {Promise<boolean>} 존재 여부
   * @private
   */
  private async hasSessionIdCookie(): Promise<boolean> {
    try {
      const cookies = await this.cookieJar.getCookies(this.baseUrl);
      return cookies.some((cookie) => cookie.key.toUpperCase() === "SESSIONID" && !!cookie.value);
    } catch {
      return isCookieJarUsable(this.cookieJar);
    }
  }

  /**
   * 성적 API 기본 쿼리를 만든다
   * @param {ErpGradeQueryOptions} [extra] - 덮어쓸 값
   * @returns {ErpGradeQueryOptions} 쿼리
   * @private
   */
  private gradeQuery(extra: ErpGradeQueryOptions = {}): ErpGradeQueryOptions {
    const menu = resolveErpGradeMenu(this.gradeMenuKind);
    return {
      stuno: extra.stuno ?? this.stuno(),
      syy: extra.syy,
      smtCd: extra.smtCd,
      menuId: extra.menuId ?? menu.vueMenuId,
      pgmId: extra.pgmId ?? menu.vuePgmId,
      baseUrl: extra.baseUrl ?? this.baseUrl
    };
  }

  /**
   * 현재 학번을 세션에서 고른다
   * @returns {string} 학번
   * @private
   */
  private stuno(): string {
    return (
      this.glio?.persNo ||
      this.session?.persNo ||
      this.student?.stuno ||
      this.credentials?.uid ||
      ""
    );
  }

  /**
   * Vue 성적 화면 Referer
   * @returns {string} Referer URL
   * @private
   */
  private vueReferer(): string {
    const menu = resolveErpGradeMenu(this.gradeMenuKind);
    return `${this.origin()}/vue/${menu.vueMenuId}`;
  }

  /**
   * origin (슬래시 없음)
   * @returns {string} origin
   * @private
   */
  private origin(): string {
    return this.baseUrl.replace(/\/$/, "");
  }

  /**
   * HTML GET
   * @param {ErpGetRequest} request - GET 요청
   * @returns {Promise<string>} 본문
   * @private
   */
  private async getHtml(request: ErpGetRequest): Promise<string> {
    const response = await this.requestWithRetry({
      method: "GET",
      url: request.url,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Connection: "close"
      },
      responseType: "text",
      transformResponse: [(data) => data]
    });
    return typeof response.data === "string" ? response.data : String(response.data ?? "");
  }

  /**
   * JSON POST
   * @param {ErpJsonPostRequest} request - JSON 요청
   * @param {string} [referer] - Referer
   * @returns {Promise<string>} 본문
   * @private
   */
  private async postJson(request: ErpJsonPostRequest, referer?: string): Promise<string> {
    const response = await this.requestWithRetry({
      method: "POST",
      url: request.url,
      data: request.body || undefined,
      headers: {
        ...COMMON_AJAX_HEADERS,
        Accept: request.accept,
        "Content-Type": request.contentType,
        Origin: this.origin(),
        Referer: referer ?? `${this.origin()}/por/mn`,
        Connection: "close"
      },
      responseType: "text",
      transformResponse: [(data) => data],
      timeout: this.requestTimeoutMs
    });
    return typeof response.data === "string" ? response.data : String(response.data ?? "");
  }

  /**
   * SSV POST (강의평가 등 Nexacro)
   * @param {{ url: string; body: string; contentType: string; accept: string }} request - SSV 요청
   * @returns {Promise<string>} 본문
   * @private
   */
  private async postSsv(request: {
    url: string;
    body: string;
    contentType: string;
    accept: string;
  }): Promise<string> {
    const response = await this.requestWithRetry({
      method: "POST",
      url: request.url,
      data: request.body,
      headers: {
        ...COMMON_AJAX_HEADERS,
        Accept: request.accept,
        "Content-Type": request.contentType,
        Origin: this.origin(),
        Referer: `${this.origin()}/nx/`,
        Connection: "close"
      },
      responseType: "text",
      transformResponse: [(data) => data],
      timeout: this.requestTimeoutMs
    });
    return typeof response.data === "string" ? response.data : String(response.data ?? "");
  }

  /**
   * 일시적 네트워크 오류에 지수 백오프 재시도를 적용한다
   * @param {AxiosRequestConfig} config - axios 요청 설정
   * @returns {Promise<import("axios").AxiosResponse>} 응답
   * @private
   */
  private async requestWithRetry(config: AxiosRequestConfig) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.http.request(config);
      } catch (error) {
        lastError = error;
        if (!isRetryableNetworkError(error) || attempt >= this.maxRetries) break;
        const waitMs = 400 * attempt * attempt;
        this.emitProgress(
          `네트워크 오류(${getErrorCode(error) || "unknown"}) 재시도 ${attempt}/${this.maxRetries - 1}...`
        );
        await sleep(waitMs);
      }
    }
    throw normalizeNetworkError(lastError);
  }

  /**
   * 진행 콜백이 있으면 메시지를 전달한다
   * @param {string} message - 진행 메시지
   * @returns {void}
   * @private
   */
  private emitProgress(message: string): void {
    this.onProgress?.(message);
  }
}

/**
 * ERP 클라이언트를 생성하는 팩토리 함수
 * @param {ErpClientOptions} [options={}] - 초기화 옵션
 * @returns {ErpClient} ERP 클라이언트
 */
export function createErpClient(options: ErpClientOptions = {}): ErpClient {
  return new ErpClient(options);
}

/**
 * HTML 에서 persNo 존재 여부만 본다
 * @param {string} html - HTML
 * @returns {boolean} 존재 여부
 */
function parsePersNo(html: string): boolean {
  return /userInfo\.persNo\s*=\s*"[^"]+"/.test(html);
}

/**
 * 재시도해도 안전한 네트워크 오류인지 판별한다
 * @param {unknown} error - 원본 오류
 * @returns {boolean} 재시도 가능 여부
 */
function isRetryableNetworkError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && RETRYABLE_CODES.has(code)) return true;
  const message = errorMessage(error).toLowerCase();
  return message.includes("timeout") || message.includes("socket hang up");
}

/**
 * axios 오류 코드를 읽는다
 * @param {unknown} error - 원본 오류
 * @returns {string} 코드
 */
function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: string };
  return record.code ?? "";
}

/**
 * 네트워크 오류를 Error 로 정규화한다
 * @param {unknown} error - 원본 오류
 * @returns {Error} 정규화 오류
 */
function normalizeNetworkError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(errorMessage(error));
}

/**
 * 지정 ms 만큼 대기한다
 * @param {number} ms - 대기 시간
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
