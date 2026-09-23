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
  composeSugangLoginResult,
  createSugangAppcsScheduleListRequest,
  createSugangBasketAddRequest,
  createSugangBasketCancelRequest,
  createSugangBasketCheckRequest,
  createSugangCultureDomainListRequest,
  createSugangDepartmentListRequest,
  buildHopeBasketTimetable,
  createSugangGeneralSubjectListRequest,
  createSugangHomeRequest,
  createSugangLoginCheckRequest,
  createSugangLoginRequest,
  createSugangMyHopeBasketListRequest,
  createSugangStudentInfoRequest,
  createSugangTermCodeRequest,
  createSugangTimetableDepartmentListRequest,
  createSugangTimetableDetailListRequest,
  DEFAULT_SUGANG_BASE_URL,
  DEFAULT_UNVFR_STDR_DEPT_CD,
  exportHopeBasketTimetableImage,
  filterTimetableSubjectsForStudentYear,
  formatHopeBasketTimetableGrid,
  renderHopeBasketTimetableSvg,
  parseSugangAppcsScheduleListResponse,
  parseSugangBasketMutationResponse,
  parseSugangCultureDomainListResponse,
  parseSugangDepartmentListResponse,
  parseSugangSubjectListResponse,
  parseSugangTermCodeResponse,
  parseSugangTimetableDepartmentListResponse,
  parseSugangTimetableDetailListResponse,
  type SugangAppcsSchedule,
  type SugangBasketMutationOptions,
  type SugangBasketMutationResult,
  type HopeBasketClientOptions,
  type SugangCultureDomain,
  type SugangDepartment,
  type SugangHopeBasketTimetable,
  type SugangLoginCredentials,
  type SugangLoginResult,
  type SugangMajorAutoAddOptions,
  type SugangMajorAutoAddResult,
  type SugangMyHopeBasketListOptions,
  type SugangStudentInfo,
  type SugangSubject,
  type SugangSubjectSearchOptions,
  type SugangSsvPostRequest,
  type SugangTermCodeInfo,
  type SugangTermContext,
  type SugangTimetableDepartment,
  type SugangTimetableDeptSearchOptions,
  type SugangTimetableDetailSearchOptions,
  type SugangTimetableSubject
} from "./basket.js";

export type { HopeBasketClientOptions } from "./types/basket.js";

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
 * 수강희망바구니(예비 담기) 전용 클라이언트.
 *
 * 범위:
 * - 포함: 로그인, 개설 검색, 내 바구니 목록, 담기/취소, 간이 시간표, 관련 일정/학과 개설 시간표
 * - 미포함: 정식 수강신청(본신청), ClipReport 원본 합산 시간표 이미지
 *
 * 호스트는 sugangh.seowon.ac.kr 이지만, 이 클래스는 hope-basket 기능만 다룬다.
 * 정식 수강신청은 추후 별도 모듈로 구현한다.
 */
export class HopeBasketClient {
  readonly baseUrl: string;
  readonly cookieJar: CookieJar;
  readonly http: AxiosInstance;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private onProgress?: (message: string) => void;
  private credentials?: SugangLoginCredentials;
  private term: SugangTermContext;
  private student?: SugangStudentInfo;

  /**
   * 클라이언트 인스턴스를 초기화하고 통신 인터셉터를 구성한다.
   * @param {HopeBasketClientOptions} [options={}] - 설정 옵션
   */
  constructor(options: HopeBasketClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_SUGANG_BASE_URL);
    this.credentials = options.credentials;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRY_COUNT;
    this.onProgress = options.onProgress;
    this.term = {
      syy: options.defaultSyy ?? "",
      smtCd: options.defaultSmtCd ?? "",
      unvfrStdrDeptCd: options.unvfrStdrDeptCd ?? DEFAULT_UNVFR_STDR_DEPT_CD
    };
    // 본신청과 호스트가 같아도 jar 는 나눈다. 파일로는 저장하지 않는다.
    this.cookieJar = new CookieJar();
    this.http =
      options.axios ??
      wrapper(
        axios.create({
          baseURL: this.baseUrl,
          jar: this.cookieJar,
          withCredentials: true,
          timeout: this.requestTimeoutMs,
          // keep-alive 소켓이 서버에서 먼저 닫히면 ECONNRESET이 나기 쉬워 요청마다 연결을 닫는다.
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
   * @param {SugangLoginCredentials} credentials - 보관할 계정 정보
   * @returns {void} 반환값 없음
   */
  setCredentials(credentials: SugangLoginCredentials): void {
    this.credentials = credentials;
  }

  /**
   * 저장된 계정 정보를 조회한다
   * @returns {SugangLoginCredentials | undefined} 현재 설정된 계정 정보
   */
  getCredentials(): SugangLoginCredentials | undefined {
    return this.credentials;
  }

  /**
   * 현재 학년도/학기 문맥을 조회한다
   * @returns {SugangTermContext} 학년도/학기/부서 문맥
   */
  getTermContext(): SugangTermContext {
    return { ...this.term };
  }

  /**
   * 학년도/학기 문맥을 수동 설정한다
   * @param {Partial<SugangTermContext>} context - 덮어쓸 문맥 값
   * @returns {void} 반환값 없음
   */
  setTermContext(context: Partial<SugangTermContext>): void {
    this.term = {
      syy: context.syy ?? this.term.syy,
      smtCd: context.smtCd ?? this.term.smtCd,
      unvfrStdrDeptCd:
        context.unvfrStdrDeptCd ?? this.term.unvfrStdrDeptCd ?? DEFAULT_UNVFR_STDR_DEPT_CD,
      stuno: context.stuno ?? this.term.stuno
    };
  }

  /**
   * 최근 로그인으로 확보한 학생 정보를 반환한다
   * @returns {SugangStudentInfo | undefined} 학생 기본 정보
   */
  getStudentInfo(): SugangStudentInfo | undefined {
    return this.student;
  }

  /**
   * 진행 상황 콜백을 교체한다
   * @param {(message: string) => void} [handler] - 진행 메시지 핸들러
   * @returns {void} 반환값 없음
   */
  setProgressHandler(handler?: (message: string) => void): void {
    this.onProgress = handler;
  }

  /**
   * SESSIONID 확보를 위해 /nx/ 홈을 방문한다
   * @returns {Promise<void>} 홈 방문과 쿠키 저장 완료 시 resolve
   */
  async prepareSession(): Promise<void> {
    this.emitProgress("세션 쿠키 확보 중 (/nx/)...");
    const request = createSugangHomeRequest(this.baseUrl);
    await this.requestWithRetry({
      method: "GET",
      url: request.url,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      responseType: "text",
      transformResponse: [(data) => data]
    });
    this.emitProgress("세션 쿠키 확보 완료");
  }

  /**
   * 서버 학사일정 코드로 학년도/학기를 동기화한다
   * @returns {Promise<SugangTermCodeInfo>} 동기화된 학사일정 코드
   * @throws {Error} 학년도/학기를 확인하지 못한 경우
   */
  async syncTermContext(): Promise<SugangTermCodeInfo> {
    await this.ensureSessionCookie();
    this.emitProgress("학년도/학기 코드 조회 중...");
    const request = createSugangTermCodeRequest({
      baseUrl: this.baseUrl,
      regDeptCd: this.term.unvfrStdrDeptCd
    });
    const body = await this.postSsv(request);
    const term = parseSugangTermCodeResponse(body);
    if (!term?.syy || !term.smtCd) {
      throw new Error("학사일정 코드(syy/smtCd)를 확인하지 못했습니다.");
    }
    this.setTermContext({
      syy: term.syy,
      smtCd: term.smtCd,
      unvfrStdrDeptCd: this.term.unvfrStdrDeptCd
    });
    this.emitProgress(`학년도/학기 동기화 완료: ${term.syy}-${term.smtCd}`);
    return term;
  }

  /**
   * 희망바구니에 로그인하고 학생 정보/관련 일정을 확보한다.
   * 정식 수강신청 본신청 로그인이 아니다.
   * @param {SugangLoginCredentials} credentials - 학번/비밀번호
   * @returns {Promise<SugangLoginResult>} 희망바구니 로그인 결과
   */
  async login(credentials: SugangLoginCredentials): Promise<SugangLoginResult> {
    this.credentials = credentials;
    await this.ensureSessionCookie(true);

    if (!this.term.syy || !this.term.smtCd) {
      await this.syncTermContext();
    }

    this.emitProgress("희망바구니 로그인 요청 중...");
    const loginRequest = createSugangLoginRequest(credentials, this.term, {
      baseUrl: this.baseUrl
    });
    const loginBody = await this.postSsv(loginRequest);
    const loginPartial = composeSugangLoginResult({ loginBody });
    if (!loginPartial.success) {
      this.emitProgress(`로그인 실패: ${loginPartial.message}`);
      return loginPartial;
    }

    this.emitProgress("학생 정보 조회 중...");
    const studentRequest = createSugangStudentInfoRequest(credentials, this.term, {
      baseUrl: this.baseUrl
    });
    const studentBody = await this.postSsv(studentRequest);
    const resultWithStudent = composeSugangLoginResult({ loginBody, studentBody });
    this.student = resultWithStudent.student;
    if (this.student) {
      this.setTermContext({
        syy: this.student.syy || this.term.syy,
        smtCd: this.student.smtCd || this.term.smtCd,
        unvfrStdrDeptCd: this.student.unvfrStdrDeptCd || this.term.unvfrStdrDeptCd,
        stuno: this.student.stuno
      });
    }

    let loginCheckBody: string | undefined;
    if (this.student) {
      this.emitProgress("신청 가능 일정 확인 중...");
      const checkRequest = createSugangLoginCheckRequest(credentials, this.student, this.term, {
        baseUrl: this.baseUrl
      });
      loginCheckBody = await this.postSsv(checkRequest);
    }

    const result = composeSugangLoginResult({ loginBody, studentBody, loginCheckBody });
    this.student = result.student ?? this.student;
    this.emitProgress(result.success ? "로그인 완료" : `로그인 실패: ${result.message}`);
    return result;
  }

  /**
   * 희망바구니 관련 일정 목록을 조회한다
   * @returns {Promise<SugangAppcsSchedule[]>} 일정 목록
   */
  async getAppcsSchedules(): Promise<SugangAppcsSchedule[]> {
    await this.ensureReady();
    const request = createSugangAppcsScheduleListRequest(this.term, { baseUrl: this.baseUrl });
    const body = await this.postSsv(request);
    return parseSugangAppcsScheduleListResponse(body);
  }

  /**
   * 개설 학과 목록을 조회한다
   * @returns {Promise<SugangDepartment[]>} 개설 학과 목록
   */
  async getDepartments(): Promise<SugangDepartment[]> {
    await this.ensureReady();
    const request = createSugangDepartmentListRequest(this.withStudentContext(), {
      baseUrl: this.baseUrl
    });
    const body = await this.postSsv(request);
    return parseSugangDepartmentListResponse(body);
  }

  /**
   * 교양 영역 목록을 조회한다
   * @returns {Promise<SugangCultureDomain[]>} 교양 영역 목록
   */
  async getCultureDomains(): Promise<SugangCultureDomain[]> {
    await this.ensureReady();
    const request = createSugangCultureDomainListRequest(this.withStudentContext(), {
      baseUrl: this.baseUrl
    });
    const body = await this.postSsv(request);
    return parseSugangCultureDomainListResponse(body);
  }

  /**
   * 개설 교과목을 검색한다 (findEstblSubjtGnrlList)
   *
   * 내 희망바구니 목록이 필요하면 getMyHopeBasketList 를 사용한다.
   * listType 은 과거 호환용이며 검색 경로에 영향을 주지 않는다.
   *
   * @param {SugangSubjectSearchOptions} [options={}] - 검색 조건
   * @returns {Promise<SugangSubject[]>} 개설 과목 목록
   */
  async searchSubjects(options: SugangSubjectSearchOptions = {}): Promise<SugangSubject[]> {
    await this.ensureReady();
    const query = this.withStudentContext(options);
    const request = createSugangGeneralSubjectListRequest(query, this.baseUrl);
    const body = await this.postSsv(request);
    return dedupeSubjects(parseSugangSubjectListResponse(body, "general"));
  }

  /**
   * 내가 담은 희망바구니 목록을 조회한다 (findEstblSubjtShpbsList)
   *
   * 홈 화면 하단 그리드 "수강희망바구니 신청 교과목"과 동일 API다.
   *
   * @param {SugangMyHopeBasketListOptions} [options={}] - 조회 옵션
   * @returns {Promise<SugangSubject[]>} 내 바구니 과목 목록
   */
  async getMyHopeBasketList(options: SugangMyHopeBasketListOptions = {}): Promise<SugangSubject[]> {
    await this.ensureReady();
    const query = this.withStudentContext(options);
    // 화면은 학과 콤보 값을 같이 보내지만, 비워도 학번 기준으로 내 목록이 내려온다
    const request = createSugangMyHopeBasketListRequest(query, this.baseUrl);
    const body = await this.postSsv(request);
    return dedupeSubjects(parseSugangSubjectListResponse(body, "basket"));
  }

  /**
   * 내 희망바구니 목록을 가져와 timtbNm 기반 간이 시간표를 구성한다
   *
   * ShpbsList 응답에 담당교수 필드가 비어 있는 경우가 많아,
   * 과목코드로 개설 검색(GnrlList)을 한 번 더 조회해 교수명을 보강한다.
   *
   * @param {SugangMyHopeBasketListOptions} [options={}] - 목록 조회 옵션
   * @returns {Promise<SugangHopeBasketTimetable>} 간이 시간표 집계
   */
  async getMyHopeBasketTimetable(
    options: SugangMyHopeBasketListOptions = {}
  ): Promise<SugangHopeBasketTimetable> {
    const subjects = await this.getMyHopeBasketList(options);
    const enriched = await this.enrichBasketSubjectsWithInstructor(subjects);
    return buildHopeBasketTimetable(enriched);
  }

  /**
   * 바구니 목록에 담당 교수명이 비어 있으면 개설 검색으로 보강한다
   * @param {SugangSubject[]} subjects - 원본 바구니 목록
   * @returns {Promise<SugangSubject[]>} 교수명이 채워진 목록
   * @private
   */
  private async enrichBasketSubjectsWithInstructor(
    subjects: SugangSubject[]
  ): Promise<SugangSubject[]> {
    if (!subjects.length) return subjects;

    // 과목코드별 개설 검색 결과 캐시 (동일 코드 중복 호출 방지)
    const byCode = new Map<string, SugangSubject[]>();
    const needCodes = [
      ...new Set(
        subjects
          .filter((item) => !item.chrgInstrEmpnm?.trim() && item.subjtCd)
          .map((item) => item.subjtCd)
      )
    ];

    for (const code of needCodes) {
      try {
        this.emitProgress(`교수명 보강 중: ${code}`);
        const found = await this.searchSubjects({
          keyword: code,
          subjtCd: code
        });
        byCode.set(
          code,
          found.filter((item) => item.subjtCd === code && item.chrgInstrEmpnm)
        );
      } catch {
        byCode.set(code, []);
      }
    }

    return subjects.map((subject) => {
      if (subject.chrgInstrEmpnm?.trim()) return subject;
      const candidates = byCode.get(subject.subjtCd) ?? [];
      const match =
        candidates.find((item) => item.corseDvclsNo === subject.corseDvclsNo) || candidates[0];
      if (!match?.chrgInstrEmpnm) return subject;
      return {
        ...subject,
        chrgInstrEmpnm: match.chrgInstrEmpnm,
        chrgInstrEmpno: match.chrgInstrEmpno || subject.chrgInstrEmpno
      };
    });
  }

  /**
   * 내 희망바구니 간이 시간표를 콘솔용 그리드 문자열로 반환한다
   * @param {SugangMyHopeBasketListOptions} [options={}] - 목록 조회 옵션
   * @returns {Promise<string>} ASCII 시간표 그리드
   */
  async formatMyHopeBasketTimetable(options: SugangMyHopeBasketListOptions = {}): Promise<string> {
    const timetable = await this.getMyHopeBasketTimetable(options);
    return formatHopeBasketTimetableGrid(timetable);
  }

  /**
   * 내 희망바구니 시간표를 SVG/PNG 이미지 파일로 저장한다
   *
   * AI 이미지 생성이 아니라 데이터 기반 렌더다.
   * PNG는 로컬 Chrome/Edge + puppeteer-core 가 있을 때 시도한다.
   *
   * @param {SugangMyHopeBasketListOptions & { outputDir?: string; fileBaseName?: string; title?: string; tryPng?: boolean }} [options] - 조회·저장 옵션
   * @returns {Promise<{ timetable: SugangHopeBasketTimetable; htmlPath: string; pngPath?: string }>} 집계와 파일 경로
   */
  async exportMyHopeBasketTimetableImage(
    options: SugangMyHopeBasketListOptions & {
      outputDir?: string;
      fileBaseName?: string;
      title?: string;
      tryPng?: boolean;
    } = {}
  ): Promise<{
    timetable: SugangHopeBasketTimetable;
    htmlPath: string;
    pngPath?: string;
  }> {
    const timetable = await this.getMyHopeBasketTimetable(options);
    const files = await exportHopeBasketTimetableImage(timetable, {
      outputDir: options.outputDir,
      fileBaseName: options.fileBaseName,
      title: options.title,
      tryPng: options.tryPng
    });
    return { timetable, ...files };
  }

  /**
   * 내 희망바구니 시간표 SVG 문자열을 반환한다
   * @param {SugangMyHopeBasketListOptions & { title?: string }} [options] - 조회·렌더 옵션
   * @returns {Promise<string>} SVG 문서
   */
  async renderMyHopeBasketTimetableSvg(
    options: SugangMyHopeBasketListOptions & { title?: string } = {}
  ): Promise<string> {
    const timetable = await this.getMyHopeBasketTimetable(options);
    return renderHopeBasketTimetableSvg(timetable, { title: options.title });
  }

  /**
   * 희망바구니 담기 전 검증을 수행한다
   * @param {SugangSubjectSearchOptions & { subjtCd: string }} options - 검증 대상 과목
   * @returns {Promise<SugangBasketMutationResult>} 검증 결과
   */
  async checkBasketItem(
    options: SugangSubjectSearchOptions & { subjtCd: string }
  ): Promise<SugangBasketMutationResult> {
    await this.ensureReady();
    const query = this.withStudentContext(options);
    const request = createSugangBasketCheckRequest(query, this.baseUrl);
    const body = await this.postSsv(request);
    return parseSugangBasketMutationResponse(body, "check", {
      subjtCd: options.subjtCd,
      corseDvclsNo: options.corseDvclsNo ?? ""
    });
  }

  /**
   * 희망바구니에 과목을 담는다
   * @param {SugangBasketMutationOptions} options - 담을 과목 정보
   * @returns {Promise<SugangBasketMutationResult>} 담기 결과
   */
  async addToBasket(options: SugangBasketMutationOptions): Promise<SugangBasketMutationResult> {
    await this.ensureReady();
    const mutation = this.withStudentContext(options);
    if (!options.skipCheck) {
      await this.checkBasketItem({
        ...mutation,
        subjtCd: options.subjtCd,
        corseDvclsNo: options.corseDvclsNo,
        keyword: options.subjtCd
      });
    }
    const request = createSugangBasketAddRequest(mutation, this.baseUrl);
    const body = await this.postSsv(request);
    return parseSugangBasketMutationResponse(body, "add", options);
  }

  /**
   * 희망바구니에서 과목을 취소한다
   * @param {SugangBasketMutationOptions} options - 취소할 과목 정보
   * @returns {Promise<SugangBasketMutationResult>} 취소 결과
   */
  async cancelFromBasket(
    options: SugangBasketMutationOptions
  ): Promise<SugangBasketMutationResult> {
    await this.ensureReady();
    const mutation = this.withStudentContext(options);
    const request = createSugangBasketCancelRequest(mutation, this.baseUrl);
    const body = await this.postSsv(request);
    return parseSugangBasketMutationResponse(body, "cancel", options);
  }

  /**
   * 검색 후 분반을 선택해 바구니에 담는 편의 메서드
   * @param {string} keyword - 과목명 또는 과목코드 검색어
   * @param {{ asignDeprtCd?: string; listType?: SugangSubjectSearchOptions["listType"]; pick?: (subjects: SugangSubject[]) => SugangSubject | undefined }} [options={}] - 검색/선택 옵션
   * @returns {Promise<{ subject: SugangSubject; result: SugangBasketMutationResult }>} 선택된 과목과 담기 결과
   * @throws {Error} 검색 결과가 없을 때 발생
   */
  async addSubjectToBasketByKeyword(
    keyword: string,
    options: {
      asignDeprtCd?: string;
      /** @deprecated 검색은 항상 개설 목록(GnrlList)만 사용 */
      listType?: SugangSubjectSearchOptions["listType"];
      pick?: (subjects: SugangSubject[]) => SugangSubject | undefined;
    } = {}
  ): Promise<{ subject: SugangSubject; result: SugangBasketMutationResult }> {
    const subjects = await this.searchSubjects({
      keyword,
      asignDeprtCd: options.asignDeprtCd ?? this.student?.deptCd
    });
    if (!subjects.length) {
      throw new Error(`검색 결과가 없습니다: ${keyword}`);
    }
    const subject = options.pick?.(subjects) ?? subjects[0];
    if (!subject) {
      throw new Error(`검색 결과가 없습니다: ${keyword}`);
    }
    const result = await this.addToBasket({
      subjtCd: subject.subjtCd,
      corseDvclsNo: subject.corseDvclsNo
    });
    return { subject, result };
  }

  /**
   * 전공 강의시간표 학과 목록을 조회한다
   * @param {SugangTimetableDeptSearchOptions} [options={}] - 학과 검색 옵션
   * @returns {Promise<SugangTimetableDepartment[]>} 시간표 학과 목록
   */
  async getTimetableDepartments(
    options: SugangTimetableDeptSearchOptions = {}
  ): Promise<SugangTimetableDepartment[]> {
    await this.ensureReady();
    const request = createSugangTimetableDepartmentListRequest(
      this.withStudentContext(options),
      this.baseUrl
    );
    const body = await this.postSsv(request);
    return parseSugangTimetableDepartmentListResponse(body);
  }

  /**
   * 전공 강의시간표 상세(분반) 목록을 조회한다
   * @param {SugangTimetableDetailSearchOptions} options - 분반 검색 옵션
   * @returns {Promise<SugangTimetableSubject[]>} 시간표 분반 목록
   */
  async getTimetableSubjects(
    options: SugangTimetableDetailSearchOptions
  ): Promise<SugangTimetableSubject[]> {
    await this.ensureReady();
    const request = createSugangTimetableDetailListRequest(
      this.withStudentContext(options),
      this.baseUrl
    );
    const body = await this.postSsv(request);
    return parseSugangTimetableDetailListResponse(body);
  }

  /**
   * 로그인 학생의 학과·학년·학기(학년도)에 맞는 전공 개설 과목을 찾아 희망바구니에 담는다
   *
   * 흐름:
   * 1) 학생 정보(deptCd, hy, syy, smtCd) 확보
   * 2) 학과별 개설 강의시간표(findEstblCorseDtlList) 조회
   * 3) 이수학년(cmpsjHyDivCd)이 학생 학년과 맞는 분반 필터
   * 4) dryRun이 아니면 순차 담기
   *
   * @param {SugangMajorAutoAddOptions} [options={}] - 필터/담기 옵션
   * @returns {Promise<SugangMajorAutoAddResult>} 후보·담기 결과
   */
  async addMajorCoursesForStudent(
    options: SugangMajorAutoAddOptions = {}
  ): Promise<SugangMajorAutoAddResult> {
    await this.ensureReady();
    const student = this.student;
    if (!student?.stuno) {
      throw new Error("학생 정보가 없습니다. 먼저 로그인하세요.");
    }

    const deptCd = options.asignDeprtCd || student.deptCd || student.deprtCd;
    const hy = options.hy || student.hy;
    const syy = student.syy || this.term.syy;
    const smtCd = student.smtCd || this.term.smtCd;

    if (!deptCd) {
      throw new Error("학생 학과 코드(deptCd)를 확인할 수 없습니다.");
    }
    if (!hy) {
      throw new Error("학생 학년(hy)을 확인할 수 없습니다.");
    }

    this.emitProgress(`학과 전공 시간표 조회 중... (학과=${deptCd}, 학년=${hy}, ${syy}-${smtCd})`);
    const allSubjects = await this.getTimetableSubjects({
      asignDeprtCd: deptCd,
      syy,
      smtCd
    });
    const candidates = filterTimetableSubjectsForStudentYear(
      allSubjects,
      { hy },
      { includeUnknownYear: options.includeUnknownYear }
    );

    const results: SugangMajorAutoAddResult["results"] = [];
    if (!options.dryRun) {
      for (const subject of candidates) {
        this.emitProgress(`담는 중: ${subject.subjtCd}-${subject.corseDvclsNo} ${subject.subjtNm}`);
        try {
          const result = await this.addToBasket({
            subjtCd: subject.subjtCd,
            corseDvclsNo: subject.corseDvclsNo,
            skipCheck: options.skipCheck
          });
          results.push({ subject, result });
        } catch (err: unknown) {
          results.push({
            subject,
            result: {
              success: false,
              message: errorMessage(err),
              action: "add",
              subjtCd: subject.subjtCd,
              corseDvclsNo: subject.corseDvclsNo,
              raw: { encoding: "utf-8", params: {}, datasets: [], raw: "" }
            }
          });
        }
      }
    }

    return {
      student,
      deptCd,
      hy,
      syy,
      smtCd,
      allSubjects,
      candidates,
      results
    };
  }

  /**
   * 요청 옵션에 로그인 문맥(syy/smtCd/stuno)을 채운다
   * @param {T} [options] - 부분 문맥 옵션
   * @returns {T & SugangTermContext} 문맥이 보강된 옵션
   * @private
   */
  private withStudentContext<T extends Partial<SugangTermContext>>(
    options: T = {} as T
  ): T & SugangTermContext {
    return {
      ...options,
      syy: options.syy || this.term.syy,
      smtCd: options.smtCd || this.term.smtCd,
      unvfrStdrDeptCd:
        options.unvfrStdrDeptCd || this.term.unvfrStdrDeptCd || DEFAULT_UNVFR_STDR_DEPT_CD,
      stuno: options.stuno || this.term.stuno || this.student?.stuno || this.credentials?.stuno
    };
  }

  /**
   * 보호 API 호출 전 세션/학기/로그인 상태를 맞춘다
   * @returns {Promise<void>} 준비 완료 시 resolve
   * @private
   */
  private async ensureReady(): Promise<void> {
    await this.ensureSessionCookie();
    if (!this.term.syy || !this.term.smtCd) {
      await this.syncTermContext();
    }
    if (!this.student?.stuno && this.credentials) {
      await this.login(this.credentials);
    }
  }

  /**
   * SESSIONID가 없으면 /nx/ 로 세션을 다시 연다
   * @param {boolean} [force=false] - true면 기존 쿠키와 무관하게 재진입
   * @returns {Promise<void>} 세션 확보 완료 시 resolve
   * @private
   */
  private async ensureSessionCookie(force = false): Promise<void> {
    if (!force && (await this.hasSessionIdCookie())) return;
    await this.prepareSession();
  }

  /**
   * sugangh SESSIONID 보유 여부를 확인한다
   * @returns {Promise<boolean>} SESSIONID 존재 여부
   * @private
   */
  private async hasSessionIdCookie(): Promise<boolean> {
    try {
      const cookies = await this.cookieJar.getCookies(this.baseUrl);
      return cookies.some((cookie) => cookie.key.toUpperCase() === "SESSIONID" && !!cookie.value);
    } catch {
      // jar 조회 실패 시 일반 쿠키 사용 가능 여부로 폴백
      return isCookieJarUsable(this.cookieJar);
    }
  }

  /**
   * SSV POST를 재시도 포함해 전송한다
   * @param {SugangSsvPostRequest} request - SSV 요청 정보
   * @returns {Promise<string>} 응답 본문
   * @private
   */
  private async postSsv(request: SugangSsvPostRequest): Promise<string> {
    const response = await this.requestWithRetry({
      method: "POST",
      url: request.url,
      data: request.body,
      headers: {
        ...COMMON_AJAX_HEADERS,
        Accept: request.accept,
        "Content-Type": request.contentType,
        Origin: this.baseUrl.replace(/\/$/, ""),
        Referer: new URL("/nx/", this.baseUrl).toString(),
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
   * @throws {Error} 재시도 소진 후 정규화된 네트워크 오류
   * @private
   */
  private async requestWithRetry(config: AxiosRequestConfig) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.http.request(config);
      } catch (error) {
        lastError = error;
        const retryable = isRetryableNetworkError(error);
        if (!retryable || attempt >= this.maxRetries) break;

        // ECONNRESET 직후 즉시 재시도하면 같은 실패가 반복되는 경우가 있어 간격을 둔다
        const waitMs = 400 * attempt * attempt;
        const code = getErrorCode(error);
        this.emitProgress(
          `네트워크 오류(${code || "unknown"}) 재시도 ${attempt}/${this.maxRetries - 1}...`
        );
        await sleep(waitMs);
      }
    }
    throw normalizeNetworkError(lastError);
  }

  /**
   * 진행 콜백이 있으면 메시지를 전달한다
   * @param {string} message - 진행 메시지
   * @returns {void} 반환값 없음
   * @private
   */
  private emitProgress(message: string): void {
    this.onProgress?.(message);
  }
}

/**
 * 수강희망바구니 클라이언트를 생성하는 팩토리 함수
 * @param {HopeBasketClientOptions} [options={}] - 초기화 옵션
 * @returns {HopeBasketClient} 희망바구니 클라이언트
 */
export function createHopeBasketClient(options: HopeBasketClientOptions = {}): HopeBasketClient {
  return new HopeBasketClient(options);
}

/**
 * 동일 과목코드-분반 중복을 제거한다
 * @param {SugangSubject[]} subjects - 원본 목록
 * @returns {SugangSubject[]} 중복 제거 목록
 * @private
 */
function dedupeSubjects(subjects: SugangSubject[]): SugangSubject[] {
  const map = new Map<string, SugangSubject>();
  for (const subject of subjects) {
    const key = `${subject.subjtCd}::${subject.corseDvclsNo}`;
    if (!map.has(key)) map.set(key, subject);
  }
  return [...map.values()];
}

/**
 * 재시도해도 안전한 네트워크 오류인지 판별한다
 * @param {unknown} error - 원본 오류
 * @returns {boolean} 재시도 가능 여부
 * @private
 */
function isRetryableNetworkError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && RETRYABLE_CODES.has(code)) return true;
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("timeout") ||
    message.includes("network error")
  );
}

/**
 * axios/Node 오류에서 code를 추출한다
 * @param {unknown} error - 원본 오류
 * @returns {string} 오류 코드
 * @private
 */
function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const maybe = error as { code?: string; cause?: { code?: string } };
  return String(maybe.code || maybe.cause?.code || "");
}

/**
 * 오류 메시지를 추출한다
 * @param {unknown} error - 원본 오류
 * @returns {string} 메시지
 * @private
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/**
 * 네트워크 오류를 사용자 메시지로 정규화한다
 * @param {unknown} error - 원본 오류
 * @returns {Error} 정규화된 오류
 * @private
 */
function normalizeNetworkError(error: unknown): Error {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  if (code === "ECONNRESET" || message.toLowerCase().includes("econnreset")) {
    return new Error(
      "희망바구니 서버 연결이 중간에 끊겼습니다(ECONNRESET). 네트워크 상태를 확인한 뒤 다시 시도하세요."
    );
  }
  if (code === "ETIMEDOUT" || message.toLowerCase().includes("timeout")) {
    return new Error("희망바구니 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
  }
  if (error instanceof Error) return error;
  return new Error(message || "희망바구니 요청 중 알 수 없는 오류가 발생했습니다.");
}

/**
 * 지정 시간 동안 대기한다
 * @param {number} ms - 대기 시간(ms)
 * @returns {Promise<void>} 대기 완료 시 resolve
 * @private
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
