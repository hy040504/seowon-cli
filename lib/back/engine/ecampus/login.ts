/**
 * e-campus HTTP 클라이언트.
 *
 * 로그인·쿠키·과제 제출·이러닝 조회를 한 세션에서 보낸다.
 * HTML 파싱은 classroom.ts / score.ts / elearning.ts 에 맡긴다.
 */
import type {
  EcampusAssignmentDetail,
  EcampusClassroomAttachment,
  EcampusClassroomItem,
  EcampusClassroomResources,
  EcampusDownloadedFile
} from "./types/classroom.js";
import type { EcampusCourseGroups, EcampusCourseListItem } from "./types/courses.js";
import type { LoginEncryptOptions } from "./types/crypto.js";
import type {
  EcampusLessonItem,
  EcampusLessonRecordOptions,
  EcampusLessonStudyWindow,
  ElearningDownloadResult,
  ElearningMp4UrlResult
} from "./types/elearning.js";
import type {
  EcampusScoreAccessInfo,
  EcampusScoreOpenInfo,
  EcampusScoreOpenJsonResponse,
  EcampusScorePageResult,
  EcampusScoreSummary,
  EcampusScoreSurveyInfo,
  EcampusScoreSurveyJsonResponse,
  GetScoreOptions
} from "./types/score.js";
import type {
  EcampusClientOptions,
  EcampusLoginResponse,
  GetClassroomAssignmentListOptions,
  GetClassroomBoardListOptions,
  GetClassroomResourcesOptions,
  GetElearningLessonListOptions,
  LoginCredentials,
  LoginResult,
  LoginWithEncryptDataOptions,
  OpenElearningLessonOptions
} from "./types/login.js";

export type {
  EcampusClientOptions,
  EcampusLoginResponse,
  GetClassroomAssignmentListOptions,
  GetClassroomBoardListOptions,
  GetClassroomResourcesOptions,
  GetElearningLessonListOptions,
  LoginCredentials,
  LoginResult,
  LoginWithEncryptDataOptions,
  OpenElearningLessonOptions
} from "./types/login.js";

export type {
  EcampusScoreAccessInfo,
  EcampusScoreAccessStatus,
  EcampusScoreGetRequest,
  EcampusScoreOpenInfo,
  EcampusScoreOpenJsonResponse,
  EcampusScoreOpenReturnVO,
  EcampusScorePageResult,
  EcampusScoreParseOptions,
  EcampusScoreSummary,
  EcampusScoreSummaryCapture,
  EcampusScoreSurveyInfo,
  EcampusScoreSurveyJsonResponse,
  EcampusScoreSurveyReturnVO,
  GetScoreOptions
} from "./types/score.js";

import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import util from "node:util";
import { COMMON_AJAX_HEADERS, DEFAULT_BROWSER_USER_AGENT, errorMessage, normalizeBaseUrl } from "../utils.js";
import { isCookieJarUsable } from "./cookies.js";
import {
  ASMNT_RIGHT_VIEW_PATH,
  ASMNT_SEND_VIEW_PATH,
  SEND_ASMNT_PATH,
  EDIT_SEND_ASMNT_PATH,
  EDIT_STD_ASMNT_PATH,
  assignmentDetailCandidateUrls,
  buildEcampusAssignmentSubmitForm,
  createEmptyEcampusClassroomResources,
  isHtmlFileBody,
  looksLikeAssignmentDetailHtml,
  parseEcampusAssignmentDetailHtml,
  parseEcampusAssignmentListHtml,
  parseEcampusAssignmentSendType,
  parseEcampusAssignmentSubmittedFiles,
  parseEcampusAssignmentUploadUrl,
  collectEcampusAssignmentDownloadLinks,
  parseEcampusClassroomAttachmentsHtml,
  parseEcampusMaterialListHtml,
  parseEcampusNoticeListHtml,
  stringifyEcampusClassroomItems,
  stringifyEcampusClassroomResources
} from "./classroom.js";
import {
  parseEcampusCourseGroups,
  parseEcampusCourseList,
  parseEcampusCourseListJson,
  parseEcampusCourseNamesJson
} from "./courses.js";
import { createLoginEncryptData } from "./crypto.js";
import {
  createStudyRecordRequest,
  createViewLessonStudyDetailRequest,
  downloadElearningMp4 as downloadElearningMp4File,
  parseEcampusLessonListHtml,
  parseEcampusLessonSchedulesHtml,
  parseEcampusLessonStudyWindowHtml,
  stringifyEcampusLessons
} from "./elearning.js";
import {
  parseEcampusScoreOpenResponse,
  parseEcampusScorePageHtml,
  parseEcampusScoreSummaryHtml,
  parseEcampusScoreSurveyResponse,
  resolveEcampusScoreAccess
} from "./score.js";

const DEFAULT_BASE_URL = "https://ecampus.seowon.ac.kr";
const LOGIN_PAGE_PATH = "/home/mainPop/popup/login";
const LOGIN_API_PATH = "/user/userHome/login";
const MAIN_PAGE_PATH = "/home/mainHome/Form/main";
const DEFAULT_LESSON_MENU_CODE = "MH_210504T143020d03000a";
const DEFAULT_PROGRESS_TYPE_CD = "WEEK";

/**
 * e-campus 연동을 총괄하는 코어 클라이언트 클래스.
 * Senior Engineer 원칙에 따라 데이터 파싱 로직은 외부로 위임하고 세션 및 라이프사이클 관리에 집중한다.
 */
export class EcampusClient {
  readonly baseUrl: string;
  readonly cookieJar: CookieJar;
  readonly http: AxiosInstance;
  private loginCredentials?: LoginCredentials;

  /**
   * 클라이언트 인스턴스를 초기화하고 통신 인터셉터를 구성한다.
   * @param {EcampusClientOptions} options - 설정 옵션
   */
  constructor(options: EcampusClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.loginCredentials = options.loginCredentials;
    // 학교 Set-Cookie 는 이 jar 에만 남긴다. 재시작 뒤 파일을 읽지 않는다.
    this.cookieJar = new CookieJar();

    // jar 를 요청에 붙이지 않으면 학교 세션 쿠키를 다음 호출이 못 가져간다.
    this.http =
      options.axios ??
      wrapper(
        axios.create({
          baseURL: this.baseUrl,
          jar: this.cookieJar,
          withCredentials: true,
          timeout: 15000,
          headers: {
            "User-Agent": DEFAULT_BROWSER_USER_AGENT,
            ...COMMON_AJAX_HEADERS
          }
        })
      );
  }

  /**
   * 백그라운드 자동 갱신을 위해 계정 정보를 수동으로 업데이트한다.
   * @param {LoginCredentials} credentials - 보관할 계정 정보
   * @returns {void} 반환값 없음
   */
  setCredentials(credentials: LoginCredentials): void {
    this.loginCredentials = credentials;
  }

  /**
   * 저장된 계정 정보를 조회한다.
   * @returns {LoginCredentials | undefined} 현재 설정된 계정 정보
   */
  getCredentials(): LoginCredentials | undefined {
    return this.loginCredentials;
  }

  /**
   * 세션 유효성을 확인하고 필요 시 백그라운드 자동 로그인을 수행한다.
   * @returns {Promise<void>} 인증 가능한 세션 확보 시 resolve
   * @throws {Error} 세션 만료 및 재로그인 정보 부재 시 발생
   */
  async ensureAuthenticated(): Promise<void> {
    if (isCookieJarUsable(this.cookieJar)) return;

    if (!this.loginCredentials) {
      throw new Error("세션이 만료되었습니다. 로그인을 먼저 수행하십시오.");
    }

    await this.login(this.loginCredentials);
  }

  /**
   * 로그인 전에 로그인 페이지를 연다. 학교가 심는 쿠키는 메모리 jar 에만 쌓인다.
   * @returns {Promise<void>} 로그인 페이지 요청이 끝난 뒤 resolve
   */
  async prepareLoginSession(): Promise<void> {
    await this.http.get(LOGIN_PAGE_PATH, {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    });
  }

  /**
   * 계정 정보를 서버가 요구하는 암호화 포맷으로 변환하여 로그인을 시도한다.
   * @param {LoginCredentials} credentials - 로그인 계정
   * @returns {Promise<LoginResult>} 인증 결과
   */
  async login(credentials: LoginCredentials): Promise<LoginResult> {
    this.loginCredentials = credentials;
    // 레거시 암호화 모듈을 통해 복잡한 인증 패킷 생성 (서버 요구사항 준수)
    const encryptData = createLoginEncryptData(credentials.userId, credentials.password, {
      reason: credentials.reason,
      foreigner: credentials.foreigner
    });

    return this.loginWithEncryptData({ encryptData });
  }

  /**
   * 생성된 암호화 패킷을 이용해 서버와 실제 세션 합의를 진행한다.
   * @param {LoginWithEncryptDataOptions} options - 암호화 데이터
   * @returns {Promise<LoginResult>} 최종 세션 획득 결과
   */
  async loginWithEncryptData(options: LoginWithEncryptDataOptions): Promise<LoginResult> {
    await this.prepareLoginSession();

    const params = new URLSearchParams();
    params.set("encryptData", options.encryptData);

    const response = await this.http.post<EcampusLoginResponse>(LOGIN_API_PATH, params, {
      headers: {
        ...COMMON_AJAX_HEADERS,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: this.baseUrl.replace(/\/$/, ""),
        Referer: new URL(LOGIN_PAGE_PATH, this.baseUrl).toString()
      }
    });

    const result = parseLoginResponse(response.data);
    return result;
  }

  /**
   * 로그인 완료 후 진입하는 메인 대시보드 HTML을 조회한다.
   * @returns {Promise<string>} 메인 대시보드 HTML
   */
  async getMainPageHtml(): Promise<string> {
    await this.ensureAuthenticated();
    const response = await this.http.get<string>(MAIN_PAGE_PATH, {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    });
    return response.data;
  }

  /**
   * 수강 중인 과목들을 교과와 비교과 카테고리로 분류하여 조회한다.
   * @returns {Promise<EcampusCourseGroups>} 교과/비교과로 분류된 과목 묶음
   */
  async getCourseGroups(): Promise<EcampusCourseGroups> {
    const html = await this.getCourseListHtml();
    return parseEcampusCourseGroups(html);
  }

  /**
   * 수강 중인 전체 과목 목록을 배열 형태로 조회한다.
   * @returns {Promise<EcampusCourseListItem[]>} 과목 목록 배열
   */
  async getCourseList(): Promise<EcampusCourseListItem[]> {
    const html = await this.getCourseListHtml();
    return parseEcampusCourseList(html);
  }

  /**
   * 과목 목록을 외부 저장이나 CLI 출력에 바로 쓰기 쉬운 JSON으로 조회한다
   * @returns {Promise<string>} 과목 목록 JSON 문자열
   */
  async getCourseListJson(): Promise<string> {
    const html = await this.getCourseListHtml();
    return parseEcampusCourseListJson(html);
  }

  /**
   * 기존 호출부 호환을 위해 과목 목록 JSON 별칭을 유지한다
   * @returns {Promise<string>} 과목 목록 JSON 문자열
   */
  async getCourseNamesJson(): Promise<string> {
    return this.getCourseListJson();
  }

  /**
   * 과목 드롭다운 메뉴를 구성하는 AJAX HTML 소스를 가져온다
   * @param {string} crsCreCd - 선택된 과목 코드
   * @returns {Promise<string>} 과목 목록 HTML 조각
   */
  async getCourseListHtml(crsCreCd = ""): Promise<string> {
    await this.ensureAuthenticated();
    return this.postForm("/crs/creCrsHome/classRoomCrsCreList", { crsCreCd });
  }

  /**
   * 강의실 내 주요 리소스(공지, 자료, 과제)를 병렬 조회를 통해 통합 패키지로 가져온다.
   * @param {GetClassroomResourcesOptions} options - 조회 정보
   * @returns {Promise<EcampusClassroomResources>} 통합된 리소스 묶음
   */
  async getClassroomResources(
    options: GetClassroomResourcesOptions
  ): Promise<EcampusClassroomResources> {
    const resources = createEmptyEcampusClassroomResources();
    const [notices, materials, assignments] = await Promise.all([
      this.getNoticeList(options),
      this.getMaterialList(options),
      this.getAssignmentList(options)
    ]);

    resources.notices = notices;
    resources.materials = materials;
    resources.assignments = assignments;
    return resources;
  }

  /**
   * 공지사항 목록을 조회하고 공통 게시판 항목으로 파싱한다.
   * @param {GetClassroomBoardListOptions} options - 게시판 조회 옵션
   * @returns {Promise<EcampusClassroomItem[]>} 공지사항 항목 배열
   */
  async getNoticeList(options: GetClassroomBoardListOptions): Promise<EcampusClassroomItem[]> {
    const bbsId = `BBS_${options.crsCreCd}_N`;
    const html = await this.postBoardList(options, "NOTICE", bbsId);
    return parseEcampusNoticeListHtml(html, {
      baseUrl: this.baseUrl,
      crsCreCd: options.crsCreCd,
      bbsId
    });
  }

  /**
   * 강의자료실 목록을 조회하고 공통 게시판 항목으로 파싱한다.
   * @param {GetClassroomBoardListOptions} options - 게시판 조회 옵션
   * @returns {Promise<EcampusClassroomItem[]>} 강의자료 항목 배열
   */
  async getMaterialList(options: GetClassroomBoardListOptions): Promise<EcampusClassroomItem[]> {
    const bbsId = `BBS_${options.crsCreCd}_P`;
    const html = await this.postBoardList(options, "PDS", bbsId);
    return parseEcampusMaterialListHtml(html, {
      baseUrl: this.baseUrl,
      crsCreCd: options.crsCreCd,
      bbsId
    });
  }

  /**
   * 과제함 목록과 개인별 제출 상태를 조회한다.
   * @param {GetClassroomAssignmentListOptions} options - 과제함 조회 옵션
   * @returns {Promise<EcampusClassroomItem[]>} 과제 항목 배열
   */
  async getAssignmentList(
    options: GetClassroomAssignmentListOptions
  ): Promise<EcampusClassroomItem[]> {
    const html = await this.postForm("/asmnt/asmntHome/stuAsmntGridList", {
      pageIndex: "1",
      listScale: String(options.listScale ?? 10),
      searchValue: "",
      crsCreCd: options.crsCreCd,
      userNo: options.userNo,
      userName: options.userName ?? ""
    });
    return parseEcampusAssignmentListHtml(html, {
      baseUrl: this.baseUrl,
      crsCreCd: options.crsCreCd
    });
  }

  /**
   * 성적 조회 공개 여부와 차단 사유를 조회한다
   * @param {GetScoreOptions} options - 조회할 강의실 코드와 설문 확인 옵션
   * @returns {Promise<EcampusScoreOpenInfo>} 성적 공개 상태와 차단 사유
   */
  async getScoreOpenInfo(options: GetScoreOptions): Promise<EcampusScoreOpenInfo> {
    await this.ensureAuthenticated();
    const response = await this.http.get<EcampusScoreOpenJsonResponse>(
      "/crs/scoreLect/scoreOpenJson",
      {
        params: { crsCreCd: options.crsCreCd },
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          ...COMMON_AJAX_HEADERS
        }
      }
    );
    return parseEcampusScoreOpenResponse(response.data, { crsCreCd: options.crsCreCd });
  }

  /**
   * 성적 조회 가능 여부를 프론트엔드와 같은 순서로 판정한다
   * @param {GetScoreOptions} options - 조회할 강의실 코드와 설문 확인 옵션
   * @returns {Promise<EcampusScoreAccessInfo>} 최종 성적 조회 접근 상태
   */
  async getScoreAccessInfo(options: GetScoreOptions): Promise<EcampusScoreAccessInfo> {
    const openInfo = await this.getScoreOpenInfo(options);
    if (openInfo.status !== "survey_check_required" || options.checkSurvey === false) {
      return openInfo;
    }

    const survey = await this.getScoreSurveyInfo(options.crsCreCd, openInfo.scoreViewReschCd);
    return resolveEcampusScoreAccess(openInfo, survey);
  }

  /**
   * 성적 조회 페이지를 열고, 조회 불가 상태면 상태 정보만 반환한다
   * @param {GetScoreOptions} options - 조회할 강의실 코드와 설문 확인 옵션
   * @returns {Promise<EcampusScorePageResult>} 접근 상태와 성적 페이지 HTML
   */
  async getScorePage(options: GetScoreOptions): Promise<EcampusScorePageResult> {
    const access = await this.getScoreAccessInfo(options);
    if (!access.canViewScore) return access;

    await this.enterClassroomContext(options.crsCreCd);
    const html = await this.fetchScorePageHtml(options.crsCreCd);
    return { ...access, html, page: parseEcampusScorePageHtml(html, options) };
  }

  /**
   * 성적 조회의 고수준 진입점이다
   * @param {GetScoreOptions} options - 조회할 강의실 코드와 설문 확인 옵션
   * @returns {Promise<EcampusScorePageResult>} 접근 상태와 성적 페이지 HTML
   */
  async getScore(options: GetScoreOptions): Promise<EcampusScorePageResult> {
    return this.getScorePage(options);
  }

  /**
   * 실제 성적 요약 영역을 조회하고 항목별 점수와 등급을 파싱한다
   * @param {GetScoreOptions} options - 조회할 강의실 코드, 설문 확인 옵션, 선택적 stdNo
   * @returns {Promise<EcampusScoreSummary>} 성적 요약 항목, 총점, 등급
   * @throws {Error} 성적 조회가 차단되거나 stdNo를 찾지 못한 경우 발생
   */
  async getScoreSummary(options: GetScoreOptions): Promise<EcampusScoreSummary> {
    const pageResult = await this.getScorePage(options);
    if (!pageResult.canViewScore || !pageResult.html) {
      throw new Error(pageResult.message);
    }

    const page = pageResult.page ?? parseEcampusScorePageHtml(pageResult.html, options);
    const stdNo = options.stdNo ?? page.stdNo;
    if (!stdNo) {
      throw new Error("성적 요약 조회에 필요한 stdNo를 성적 페이지에서 찾지 못했습니다.");
    }

    const html = await this.fetchScoreSummaryHtml(options.crsCreCd, stdNo);
    return parseEcampusScoreSummaryHtml(html, { crsCreCd: options.crsCreCd, stdNo });
  }

  /**
   * 성적 조회 페이지 HTML만 필요할 때 사용한다
   * @param {GetScoreOptions} options - 조회할 강의실 코드와 설문 확인 옵션
   * @returns {Promise<string>} 성적 페이지 HTML
   * @throws {Error} 성적 조회가 차단된 경우 발생
   */
  async getScorePageHtml(options: GetScoreOptions): Promise<string> {
    const result = await this.getScorePage(options);
    if (!result.canViewScore || result.html == null) {
      throw new Error(result.message);
    }
    return result.html;
  }

  /**
   * 온라인 강의 전체 차시 목록을 조회한다
   * @param {GetElearningLessonListOptions} options - 조회할 강의실과 진도 방식 옵션
   * @returns {Promise<EcampusLessonItem[]>} 이러닝 차시 목록
   */
  async getElearningLessonList(
    options: GetElearningLessonListOptions
  ): Promise<EcampusLessonItem[]> {
    const progressTypeCd = await this.resolveLessonProgressType(options);
    const parseOptions = {
      baseUrl: this.baseUrl,
      crsCreCd: options.crsCreCd,
      progressTypeCd
    };
    const html = await this.collectLessonListHtml(options, progressTypeCd, "");
    const lessons = parseEcampusLessonListHtml(html, parseOptions);
    const seen = new Set(lessons.map((item) => item.lessonCntsId));
    const covered = new Set(lessons.map((item) => item.lessonScheduleId));
    const pending = parseEcampusLessonSchedulesHtml(html, parseOptions).filter(
      (schedule) => schedule.lessonScheduleId && !covered.has(schedule.lessonScheduleId)
    );
    for (const schedule of pending.slice(0, 40)) {
      const moreHtml = await this.postLessonListPage(options, progressTypeCd, schedule.lessonScheduleId, 1);
      const more = parseEcampusLessonListHtml(moreHtml, parseOptions);
      let gained = 0;
      for (const item of more) {
        if (!item.lessonCntsId || seen.has(item.lessonCntsId)) continue;
        seen.add(item.lessonCntsId);
        lessons.push(item);
        gained += 1;
      }
      // 주차 id 를 무시하고 같은 전체 목록을 다시 주면 남은 주차도 같다.
      if (gained === 0 && more.length > 0) break;
    }
    return lessons;
  }

  /**
   * 이러닝 차시 목록을 외부 저장이나 CLI 출력에 바로 쓰기 쉬운 JSON으로 조회한다
   * @param {GetElearningLessonListOptions} options - 조회할 강의실과 진도 방식 옵션
   * @returns {Promise<string>} 이러닝 차시 목록 JSON 문자열
   */
  async getElearningLessonListJson(options: GetElearningLessonListOptions): Promise<string> {
    const lessons = await this.getElearningLessonList(options);
    return stringifyEcampusLessons(lessons);
  }

  /**
   * 온라인 강의 목록 화면의 핵심 HTML 데이터와 메타데이터를 통합 획득한다
   * @param {GetElearningLessonListOptions} options - 조회할 강의실과 진도 방식 옵션
   * @returns {Promise<string>} 이러닝 목록 HTML 조각
   */
  async getElearningLessonListHtml(options: GetElearningLessonListOptions): Promise<string> {
    const progressTypeCd = await this.resolveLessonProgressType(options);
    return this.collectLessonListHtml(options, progressTypeCd, "");
  }

  /** 과목의 진도 방식. 호출자가 지정하지 않으면 강의실 정보에서 읽는다. */
  private async resolveLessonProgressType(options: GetElearningLessonListOptions): Promise<string> {
    if (options.progressTypeCd) return options.progressTypeCd;
    await this.ensureAuthenticated();
    const formUrl = new URL("/lesson/lessonLect/Form/lessonListForm", this.baseUrl);
    formUrl.searchParams.set("mcd", options.mcd ?? DEFAULT_LESSON_MENU_CODE);
    formUrl.searchParams.set("crsCreCd", options.crsCreCd);
    await this.http.get<string>(formUrl.pathname + formUrl.search, {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    });
    const creInfoRes = await this.http.post<{
      result?: number;
      returnVO?: { progressTypeCd?: string };
    }>("/crs/creCrsLect/creInfo", new URLSearchParams({ crsCreCd: options.crsCreCd }), {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        ...COMMON_AJAX_HEADERS
      }
    });
    return creInfoRes.data.returnVO?.progressTypeCd || DEFAULT_PROGRESS_TYPE_CD;
  }

  /**
   * 이러닝 목록을 페이지와 주차까지 모은다.
   * 지금 열린 주차만 있는 첫 화면에서 끊기지 않게 한다.
   */
  /** 이러닝 목록 한 페이지. 빈 주차는 이 한 번만 다시 묻는다. */
  private async postLessonListPage(
    options: GetElearningLessonListOptions,
    progressTypeCd: string,
    lessonScheduleId: string,
    pageIndex: number
  ): Promise<string> {
    await this.ensureAuthenticated();
    const response = await this.http.post<string>(
      "/lesson/lessonLect/lessonList",
      new URLSearchParams({
        pageIndex: String(pageIndex),
        listScale: "100",
        searchValue: "",
        crsCreCd: options.crsCreCd,
        lessonScheduleId,
        subParam: "GRID",
        progressTypeCd
      }),
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.baseUrl.replace(/\/$/, ""),
          ...COMMON_AJAX_HEADERS
        }
      }
    );
    return response.data || "";
  }

  /**
   * 이러닝 목록을 페이지 끝까지 모은다.
   * 100건 미만이면 다음 페이지는 없다.
   */
  private async collectLessonListHtml(
    options: GetElearningLessonListOptions,
    progressTypeCd: string,
    lessonScheduleId: string
  ): Promise<string> {
    const chunks: string[] = [];
    let previous = "";
    for (let page = 1; page <= 20; page++) {
      const html = await this.postLessonListPage(options, progressTypeCd, lessonScheduleId, page);
      if (!html || html === previous) break;
      previous = html;
      chunks.push(html);
      const count = parseEcampusLessonListHtml(html, {
        baseUrl: this.baseUrl,
        crsCreCd: options.crsCreCd,
        progressTypeCd
      }).length;
      if (count < 100) break;
    }
    return chunks.join("\n");
  }

  /**
   * 특정 차시의 시청 창을 활성화하고 관련 메타데이터를 획득한다.
   * @param {OpenElearningLessonOptions} options - 시청 창 열기 옵션
   * @returns {Promise<EcampusLessonStudyWindow>} 시청 창 메타데이터
   */
  async openLessonWindow(options: OpenElearningLessonOptions): Promise<EcampusLessonStudyWindow> {
    const html = await this.postForm(
      `/lesson/lessonOpen/lessonNewWindow?crsCreCd=${encodeURIComponent(options.crsCreCd)}`,
      {
        lessonCntsId: options.lessonCntsId,
        seekFile: options.seekFile ?? "",
        downloadYn: options.downloadYn ?? "",
        progressTypeCd: options.progressTypeCd ?? DEFAULT_PROGRESS_TYPE_CD
      }
    );

    return parseEcampusLessonStudyWindowHtml(html, {
      baseUrl: this.baseUrl,
      crsCreCd: options.crsCreCd,
      progressTypeCd: options.progressTypeCd ?? DEFAULT_PROGRESS_TYPE_CD
    });
  }

  /**
   * 실제 스트리밍 가능한 MP4 파일의 직주소를 도출한다.
   * @param {string} crsCreCd - 강의실 생성 코드
   * @param {string} lessonCntsId - 강의 콘텐츠 ID
   * @returns {Promise<ElearningMp4UrlResult>} MP4 URL 추출 결과
   */
  async getElearningMp4Url(crsCreCd: string, lessonCntsId: string): Promise<ElearningMp4UrlResult> {
    try {
      const windowInfo = await this.openLessonWindow({ crsCreCd, lessonCntsId });
      if (!windowInfo.contentUrl) {
        return {
          success: false,
          message: "콘텐츠 페이지 경로 확보 실패",
          debugInfo: { crsCreCd, lessonCntsId }
        };
      }
      return getElearningMp4Url(this.http, windowInfo.contentUrl, { crsCreCd, lessonCntsId });
    } catch (error: unknown) {
      return {
        success: false,
        message: `URL 분석 과정 중 예외 발생: ${errorMessage(error)}`,
        debugInfo: { crsCreCd, lessonCntsId }
      };
    }
  }

  /**
   * 원본 영상을 스트림 방식으로 로컬에 다운로드한다.
   * @param {string} crsCreCd - 강의실 생성 코드
   * @param {string} lessonCntsId - 강의 콘텐츠 ID
   * @param {string} courseTitle - 저장 경로에 사용할 과목명
   * @param {string} lessonTitle - 저장 파일명에 사용할 강의명
   * @param {string} [baseDir="./downloads"] - 다운로드 기준 디렉터리
   * @param {(progress: { percent: number; loaded: number }) => void} [progressCallback] - 진행률 콜백
   * @returns {Promise<ElearningDownloadResult>} 다운로드 결과
   */
  async downloadElearningMp4(
    crsCreCd: string,
    lessonCntsId: string,
    courseTitle: string,
    lessonTitle: string,
    baseDir: string = "./downloads",
    progressCallback?: (progress: { percent: number; loaded: number }) => void
  ): Promise<ElearningDownloadResult> {
    try {
      const urlResult = await this.getElearningMp4Url(crsCreCd, lessonCntsId);
      if (!urlResult.success || !urlResult.mp4Url) {
        return { success: false, message: urlResult.message || "스트리밍 주소 유실" };
      }
      return await downloadElearningMp4File(
        this.http,
        urlResult.mp4Url,
        courseTitle,
        lessonTitle,
        baseDir,
        progressCallback
      );
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : util.inspect(error)
      };
    }
  }

  /**
   * 단일 시청 기록 패킷을 서버로 전송하여 학습 시간을 적재한다.
   * @param {EcampusLessonRecordOptions} options - 학습 기록 요청 옵션
   * @returns {Promise<any>} 서버의 학습 기록 응답 데이터
   */
  async addStudyRecord(options: EcampusLessonRecordOptions): Promise<any> {
    await this.ensureAuthenticated();
    const request = createStudyRecordRequest(this.baseUrl, options);
    const response = await this.http.get<any>(new URL(request.url).pathname, {
      params: request.query,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        ...COMMON_AJAX_HEADERS
      }
    });
    return response.data;
  }

  /**
   * 현재 세션의 전체 학습 이력 및 상세 정보를 조회한다.
   * @param {string} lessonCntsId - 강의 콘텐츠 ID
   * @param {string} crsCreCd - 강의실 생성 코드
   * @returns {Promise<any>} 서버의 학습 상세 응답 데이터
   */
  async viewLessonStudyDetail(lessonCntsId: string, crsCreCd: string): Promise<any> {
    await this.ensureAuthenticated();
    const request = createViewLessonStudyDetailRequest(this.baseUrl, lessonCntsId, crsCreCd);
    const response = await this.http.get<any>(new URL(request.url).pathname, {
      params: request.query,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        ...COMMON_AJAX_HEADERS
      }
    });
    return response.data;
  }

  /**
   * 게시판류 리소스 조회를 위한 내부 POST 요청을 수행한다.
   * @param {GetClassroomBoardListOptions} options - 게시판 조회 옵션
   * @param {"NOTICE" | "PDS"} bbsCd - 게시판 종류 코드
   * @param {string} bbsId - 게시판 식별자
   * @returns {Promise<string>} 게시판 목록 HTML
   */
  private async postBoardList(
    options: GetClassroomBoardListOptions,
    bbsCd: "NOTICE" | "PDS",
    bbsId: string
  ): Promise<string> {
    return this.postForm("/bbs/bbsLect/atclList", {
      formType: "LIST",
      bbsId,
      atclId: "",
      searchKey: "all",
      searchValue: "",
      listScale: String(options.listScale ?? 10),
      pageIndex: "1",
      headCd: "",
      bbsCd,
      crsCreCd: options.crsCreCd
    });
  }

  /**
   * e-campus의 form-urlencoded AJAX 호출을 공통 처리한다.
   * @param {string} path - 호출할 서버 경로
   * @param {Record<string, string>} body - 전송할 폼 데이터
   * @returns {Promise<string>} 응답 HTML 또는 텍스트
   */
  private async postForm(path: string, body: Record<string, string>): Promise<string> {
    await this.ensureAuthenticated();
    const params = new URLSearchParams(body);
    const response = await this.http.post<string>(path, params, {
      headers: {
        Accept: "text/html, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: this.baseUrl.replace(/\/$/, ""),
        ...COMMON_AJAX_HEADERS
      }
    });
    return response.data;
  }

  /**
   * 강의실 메인 진입 요청으로 서버 측 과목 컨텍스트를 생성한다.
   * 성적 요약 fragment는 이 컨텍스트가 없으면 강의평가 미실시 상태로 축약될 수 있다.
   * @param {string} crsCreCd - 진입할 강의실 코드
   * @returns {Promise<void>} 강의실 컨텍스트 생성 완료 시 resolve
   */
  private async enterClassroomContext(crsCreCd: string): Promise<void> {
    await this.ensureAuthenticated();
    await this.http.post<string>(
      "/crs/creCrsLect/Form/classRoomMainForm",
      new URLSearchParams({ crsCreCd, mcd: "" }),
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.baseUrl.replace(/\/$/, ""),
          Referer: new URL(MAIN_PAGE_PATH, this.baseUrl).toString(),
          ...COMMON_AJAX_HEADERS
        }
      }
    );
  }

  /**
   * 성적 조회 전 설문 참여 상태를 확인한다
   * @param {string} crsCreCd - 조회할 강의실 코드
   * @param {string} scoreViewReschCd - 성적 조회에 연결된 설문 코드
   * @returns {Promise<EcampusScoreSurveyInfo>} 설문 참여 상태 정보
   */
  private async getScoreSurveyInfo(
    crsCreCd: string,
    scoreViewReschCd: string
  ): Promise<EcampusScoreSurveyInfo> {
    await this.ensureAuthenticated();
    const response = await this.http.get<EcampusScoreSurveyJsonResponse>(
      "/crs/scoreLect/cheeckStdReshJoin",
      {
        params: { scoreViewReschCd, crsCreCd },
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          ...COMMON_AJAX_HEADERS
        }
      }
    );
    return parseEcampusScoreSurveyResponse(response.data, scoreViewReschCd);
  }

  /**
   * 공개 조건을 통과한 뒤 실제 성적 페이지 HTML을 가져온다
   * @param {string} crsCreCd - 조회할 강의실 코드
   * @returns {Promise<string>} 성적 페이지 HTML
   */
  private async fetchScorePageHtml(crsCreCd: string): Promise<string> {
    await this.ensureAuthenticated();
    const response = await this.http.get<string>("/crs/scoreLect/Form/viewStdScore", {
      params: { crsCreCd },
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...COMMON_AJAX_HEADERS
      }
    });
    return response.data;
  }

  /**
   * 성적 페이지의 요약 fragment를 가져온다
   * @param {string} crsCreCd - 조회할 강의실 코드
   * @param {string} stdNo - 성적 페이지 hidden input에서 얻는 학생-강의실 식별값
   * @returns {Promise<string>} 성적 요약 HTML fragment
   */
  private async fetchScoreSummaryHtml(crsCreCd: string, stdNo: string): Promise<string> {
    await this.ensureAuthenticated();
    const response = await this.http.post<string>(
      "/crs/scoreHome/viewStdScoreSumm",
      new URLSearchParams({ stdNo, crsCreCd }),
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.baseUrl.replace(/\/$/, ""),
          ...COMMON_AJAX_HEADERS
        }
      }
    );
    return response.data;
  }

  /**
   * 강의자료 상세 HTML(fetchClassroomDetailHtml)을 가져온다
   * @param {EcampusClassroomItem} item - getMaterialList 등으로 얻은 항목
   * @returns {Promise<string>} 상세 화면 HTML
   */
  private async fetchClassroomDetailHtml(item: EcampusClassroomItem): Promise<string> {
    await this.ensureAuthenticated();
    const requestUrl = new URL(item.request.url, this.baseUrl);
    const response = await this.http.post<string>(
      requestUrl.pathname + requestUrl.search,
      new URLSearchParams(item.request.body),
      {
        headers: {
          Accept: "text/html, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.baseUrl.replace(/\/$/, ""),
          Referer: this.baseUrl,
          ...COMMON_AJAX_HEADERS
        }
      }
    );
    return response.data;
  }

  /**
   * 강의자료의 첨부파일 목록을 조회한다.
   * request 객체를 사용해 상세 HTML을 가져온 뒤,
   * parseEcampusClassroomAttachmentsHtml로 fileDown('TOKEN') 패턴 등을 파싱하여
   * 실제 다운로드 가능한 /file/download/<token> URL 목록을 반환한다.
   * @param {EcampusClassroomItem} item - 강의자료 항목 (id, request 포함)
   * @returns {Promise<EcampusClassroomAttachment[]>} 첨부파일 {title, url} 배열
   */
  async getMaterialAttachments(item: EcampusClassroomItem): Promise<EcampusClassroomAttachment[]> {
    const html = await this.fetchClassroomDetailHtml(item);
    return parseEcampusClassroomAttachmentsHtml(html, { baseUrl: this.baseUrl });
  }

  /**
   * 과제 상세 HTML·첨부·제출 폼을 가져온다.
   * 브라우저와 같이 Form/asmntStuMain 을 연 뒤 우측 asmntRightView 를 붙인다.
   * @param {EcampusClassroomItem} item - getAssignmentList 항목
   * @returns {Promise<EcampusAssignmentDetail>} 상세 HTML, 첨부, 제출 폼
   */
  async getAssignmentDetail(item: EcampusClassroomItem): Promise<EcampusAssignmentDetail> {
    const body: Record<string, string> = {
      goUrl: "0",
      rltnCd: "",
      stdRole: "",
      teamCd: "",
      ...item.request?.body,
      asmntCd: item.id || item.request?.body?.asmntCd || "",
      crsCreCd: item.request?.body?.crsCreCd || ""
    };
    const crsCreCd = body.crsCreCd;
    if (crsCreCd) {
      try {
        await this.enterClassroomContext(crsCreCd);
      } catch {
        // 컨텍스트 실패해도 상세 요청은 시도한다
      }
    }

    const urls = assignmentDetailCandidateUrls(item.request?.url || "", this.baseUrl);
    let html = "";
    let best = "";
    for (const url of urls) {
      html = await this.fetchClassroomDetailHtml({
        ...item,
        request: { method: "POST", url, body }
      });
      if (looksLikeAssignmentDetailHtml(html)) {
        best = html;
        break;
      }
      if ((html || "").length > (best || "").length) best = html;
    }
    html = best || html;
    const parsed = parseEcampusAssignmentDetailHtml(html, { baseUrl: this.baseUrl });

    let rightHtml = "";
    try {
      rightHtml = await this.postForm(ASMNT_RIGHT_VIEW_PATH, {
        asmntCd: body.asmntCd || "",
        crsCreCd: crsCreCd || "",
        sendType: parsed.sendType || "F",
        asmntCtgrCd: "NORMAL",
        stdRole: body.stdRole || "",
        teamCd: body.teamCd || ""
      });
    } catch {
      rightHtml = "";
    }

    const sendType =
      parsed.sendType || parseEcampusAssignmentSendType(rightHtml) || parseEcampusAssignmentSendType(html) || "F";
    const rightAsgSn =
      rightHtml.match(/(?:asgSn|asgSN|studentAsmntSn|stdAsmntSn)\s*["']?\s*[:=,]\s*["']([^"']+)["']/i)?.[1] ||
      rightHtml.match(/name\s*=\s*["'](?:asgSn|stdAsmntSn)["'][^>]*value\s*=\s*["']([^"']+)["']/i)?.[1] ||
      "";
    const rightAsmntSendCd =
      rightAsgSn ||
      rightHtml.match(/asmntSendCd["']\s*,\s*["']([^"']+)["']/i)?.[1] ||
      rightHtml.match(/["']#asmntSendCd["']\)\.val\s*\(\s*["']([^"']+)["']\)/i)?.[1] ||
      rightHtml.match(/name\s*=\s*["']asmntSendCd["'][^>]*value\s*=\s*["']([^"']+)["']/i)?.[1] ||
      rightHtml.match(/value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']asmntSendCd["']/i)?.[1] ||
      rightHtml.match(/(?:asmntSendCd|ASMNT_SEND_CD)\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
      "";
    let sendHtml = "";
    try {
      sendHtml = await this.postForm(ASMNT_SEND_VIEW_PATH, {
        asmntCd: body.asmntCd || "",
        crsCreCd: crsCreCd || "",
        teamCd: body.teamCd || "",
        sendType: sendType || "F",
        asmntSendCd: rightAsmntSendCd
      });
    } catch {
      sendHtml = "";
    }
    const asmntSendCdMatch =
      rightAsmntSendCd ||
      sendHtml.match(/["']#asmntSendCd["']\)\.val\s*\(\s*["']([^"']+)["']\)/)?.[1] ||
      sendHtml.match(/name\s*=\s*["']asmntSendCd["'][^>]*value\s*=\s*["']([^"']+)["']/)?.[1] ||
      "";

    const fields = {
      ...body,
      asmntCd: item.id || body.asmntCd || "",
      crsCreCd: crsCreCd || body.crsCreCd || "",
      ...(parsed.submitForm?.fields || {}),
      asmntSendCd: asmntSendCdMatch || parsed.submitForm?.fields?.asmntSendCd || ""
    };
    if (!fields.asmntCd) fields.asmntCd = item.id || "";
    if (!fields.asmntSendCd && asmntSendCdMatch) fields.asmntSendCd = asmntSendCdMatch;

    const submitForm = buildEcampusAssignmentSubmitForm(fields, sendType, this.baseUrl);
    const attachments =
      parsed.attachments.length > 0
        ? parsed.attachments
        : parseEcampusClassroomAttachmentsHtml(html, { baseUrl: this.baseUrl });
    const professorUrls = new Set(attachments.map((a) => a.url));
    const submittedAttachments = [
      ...parseEcampusAssignmentSubmittedFiles(html, { baseUrl: this.baseUrl }, true),
      ...collectEcampusAssignmentDownloadLinks(rightHtml, { baseUrl: this.baseUrl }),
      ...collectEcampusAssignmentDownloadLinks(sendHtml, { baseUrl: this.baseUrl })
    ].filter((a, i, arr) => a.url && !professorUrls.has(a.url) && arr.findIndex((b) => b.url === a.url) === i);
    return {
      html,
      text: parsed.text,
      sendType,
      attachments,
      submittedAttachments,
      submitForm,
      canSubmit: Boolean(fields.asmntCd)
    };
  }

  /**
   * 우측 제출 칸·제출 화면에서 학생이 이미 낸 파일만 읽는다.
   * @param {EcampusClassroomItem} item
   * @returns {Promise<EcampusClassroomAttachment[]>}
   */
  async getAssignmentSubmittedFiles(item: EcampusClassroomItem): Promise<EcampusClassroomAttachment[]> {
    const body = item.request?.body || {};
    const asmntCd = item.id || body.asmntCd || "";
    const crsCreCd = body.crsCreCd || "";
    if (crsCreCd) {
      try {
        await this.enterClassroomContext(crsCreCd);
      } catch {
        // 컨텍스트 실패해도 제출 칸은 시도한다
      }
    }
    let rightHtml = "";
    try {
      rightHtml = await this.postForm(ASMNT_RIGHT_VIEW_PATH, {
        asmntCd,
        crsCreCd,
        sendType: "F",
        asmntCtgrCd: "NORMAL",
        stdRole: body.stdRole || "",
        teamCd: body.teamCd || ""
      });
    } catch {
      rightHtml = "";
    }
    let files = collectEcampusAssignmentDownloadLinks(rightHtml, { baseUrl: this.baseUrl });
    if (files.length) return files;
    let sendHtml = "";
    try {
      sendHtml = await this.postForm(ASMNT_SEND_VIEW_PATH, {
        asmntCd,
        crsCreCd,
        teamCd: body.teamCd || "",
        sendType: "F"
      });
    } catch {
      sendHtml = "";
    }
    return collectEcampusAssignmentDownloadLinks(sendHtml, { baseUrl: this.baseUrl });
  }

  /**
   * 우측 제출 칸에서 기제출 식별자만 읽는다. 전체 상세 조회보다 가볍다.
   * @param {EcampusClassroomItem} item
   * @returns {Promise<string>} asmntSendCd. 없으면 빈 문자열
   */
  private async peekAsmntSendCd(item: EcampusClassroomItem): Promise<string> {
    const body = item.request?.body || {};
    const asmntCd = item.id || body.asmntCd || "";
    const crsCreCd = body.crsCreCd || "";
    try {
      const rightHtml = await this.postForm(ASMNT_RIGHT_VIEW_PATH, {
        asmntCd,
        crsCreCd,
        sendType: "F",
        asmntCtgrCd: "NORMAL",
        stdRole: body.stdRole || "",
        teamCd: body.teamCd || ""
      });
      return (
        rightHtml.match(/(?:asgSn|asgSN|studentAsmntSn|stdAsmntSn)\s*["']?\s*[:=,]\s*["']([^"']+)["']/i)?.[1] ||
        rightHtml.match(/name\s*=\s*["'](?:asgSn|stdAsmntSn|asmntSendCd)["'][^>]*value\s*=\s*["']([^"']+)["']/i)?.[1] ||
        rightHtml.match(/value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["'](?:asgSn|stdAsmntSn|asmntSendCd)["']/i)?.[1] ||
        rightHtml.match(/["']#asmntSendCd["']\)\.val\s*\(\s*["']([^"']+)["']\)/i)?.[1] ||
        rightHtml.match(/asmntSendCd["']\s*,\s*["']([^"']+)["']/i)?.[1] ||
        ""
      );
    } catch {
      return "";
    }
  }

  /**
   * e-campus 과제 첨부파일을 삭제한다.
   * 이미 과제에 묶인 파일은 bindDataSn(asmntSendCd)을 같이 보내야 목록에서도 빠진다.
   * @param {string} crsCreCd - 강의실 코드
   * @param {string} encFileSn - 암호화된 파일 번호
   * @param {string} [bindDataSn] - 기제출 과제 식별자
   * @returns {Promise<boolean>}
   */
  async deleteAssignmentFile(crsCreCd: string, encFileSn: string, bindDataSn = ""): Promise<boolean> {
    const sn = String(encFileSn || "").trim();
    if (!sn) return false;
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: this.baseUrl.replace(/\/$/, ""),
      Referer: `${this.baseUrl.replace(/\/$/, "")}/asmnt/asmntHome/asmntSendView`,
      ...COMMON_AJAX_HEADERS
    };
    const form: Record<string, string> = {};
    if (crsCreCd) form.crsCreCd = crsCreCd;
    if (bindDataSn) form.bindDataSn = bindDataSn;
    const attempts: Array<{ method: "get" | "post"; url: string; params?: Record<string, string>; data?: Record<string, string> }> = [
      { method: "get", url: `/file/delete/${sn}`, params: crsCreCd ? { crsCreCd } : undefined },
      { method: "get", url: `/file/delete/${sn}`, params: Object.keys(form).length ? form : undefined },
      { method: "get", url: "/file/deletes", params: { files: sn, ...form } },
      { method: "post", url: "/file/deletes", data: { files: sn, ...form } },
      { method: "post", url: `/file/delete/${sn}`, data: form },
      { method: "get", url: `/file/delete/${encodeURIComponent(sn)}`, params: crsCreCd ? { crsCreCd } : undefined }
    ];
    for (const attempt of attempts) {
      try {
        const response = await this.http.request({
          method: attempt.method,
          url: attempt.url,
          params: attempt.params,
          data: attempt.data ? new URLSearchParams(attempt.data) : undefined,
          headers:
            attempt.method === "post"
              ? { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
              : headers,
          validateStatus: () => true,
          timeout: 20000
        });
        if (isFileDeleteSuccess(response.data, response.status)) return true;
        console.warn(
          `[deleteAssignmentFile] ${attempt.method} ${attempt.url} status=${response.status} data=`,
          typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data).slice(0, 200)
        );
      } catch (err) {
        console.warn(`[deleteAssignmentFile] ${attempt.url} 요청 실패:`, errorMessage(err));
      }
    }
    return false;
  }

  /**
   * 과제 파일을 올린 뒤 sendAsmnt / editSendAsmnt 로 제출한다.
   * 상세 HTML을 다시 긁지 않고, 이름 변경은 서버에서 받아 새 이름으로 다시 올린다.
   * @param {EcampusClassroomItem} item - 과제 항목
   * @param {{ file?: { filename: string, mime: string, data: Buffer }, asmntSendCd?: string, deletedEncFileSns?: string[], renamedFiles?: { url: string, newName: string }[] }} payload
   * @returns {Promise<{ ok: true; status: number; hasSubmittedFile: boolean }>}
   */
  async submitAssignment(
    item: EcampusClassroomItem,
    payload: {
      file?: { filename: string; mime: string; data: Buffer };
      asmntSendCd?: string;
      deletedEncFileSns?: string[];
      deletedFileUrls?: string[];
      keepFileUrls?: string[];
      renamedFiles?: { url: string; newName: string }[];
    }
  ): Promise<{ ok: true; status: number; hasSubmittedFile: boolean }> {
    const body = item.request?.body || {};
    const asmntCd = item.id || body.asmntCd || "";
    const crsCreCd = body.crsCreCd || "";
    if (crsCreCd) {
      try {
        await this.enterClassroomContext(crsCreCd);
      } catch {
        // 컨텍스트 실패해도 업로드·삭제는 시도한다
      }
    }

    const renamedFiles = Array.isArray(payload.renamedFiles) ? payload.renamedFiles : [];
    const deletedEncFileSns = uniqueNonEmpty([
      ...(Array.isArray(payload.deletedEncFileSns) ? payload.deletedEncFileSns : []),
      ...(Array.isArray(payload.deletedFileUrls) ? payload.deletedFileUrls : []).map((u) => extractEncFileSnFromUrl(u)),
      ...renamedFiles.map((rf) => extractEncFileSnFromUrl(rf.url))
    ]);
    const deletedSet = new Set(deletedEncFileSns);
    const keepEncFileSns = uniqueNonEmpty(
      (Array.isArray(payload.keepFileUrls) ? payload.keepFileUrls : []).map((u) => extractEncFileSnFromUrl(u))
    ).filter((sn) => !deletedSet.has(sn));

    let asmntSendCd = String(payload.asmntSendCd || "").trim();
    const needsEdit =
      Boolean(asmntSendCd) ||
      deletedEncFileSns.length > 0 ||
      renamedFiles.length > 0 ||
      keepEncFileSns.length > 0;
    if (needsEdit && !asmntSendCd) {
      asmntSendCd = await this.peekAsmntSendCd(item);
    }

    const uploadedSns: string[] = [];
    for (const rf of renamedFiles) {
      if (!rf?.url || !rf?.newName) continue;
      const downloaded = await this.downloadClassroomFile(rf.url);
      const fallbackName = filenameFromDispositionHeader(downloaded.disposition) || "upload.bin";
      const filename = preserveFilenameExtension(rf.newName, fallbackName);
      uploadedSns.push(
        await this.uploadAssignmentFile(item, {
          filename,
          mime: downloaded.contentType || "application/octet-stream",
          data: downloaded.data
        })
      );
    }

    for (const encSn of deletedEncFileSns) {
      console.log(`[submitAssignment] Deleting file ${encSn} for crsCreCd ${crsCreCd}`);
      const deleted = await this.deleteAssignmentFile(crsCreCd, encSn, asmntSendCd);
      if (!deleted) {
        throw new Error("기존 제출 파일을 삭제하지 못했습니다. 파일이 중복 제출되지 않도록 제출을 중단했습니다. e-campus에서 파일 상태를 확인한 뒤 다시 시도하세요.");
      }
    }

    if (payload.file) {
      uploadedSns.push(await this.uploadAssignmentFile(item, payload.file));
    }

    const attachFileSns = uniqueNonEmpty([...keepEncFileSns, ...uploadedSns]).join("!@!");
    if (!attachFileSns && deletedEncFileSns.length === 0) {
      throw new Error("제출할 파일을 선택하세요.");
    }
    if (!attachFileSns) {
      return { ok: true, status: 200, hasSubmittedFile: false };
    }

    const isEdit = Boolean(asmntSendCd);
    const data: Record<string, string> = {
      asmntCd,
      crsCreCd,
      attachFileSns,
      fileEncSns: attachFileSns,
      teamCd: body.teamCd || "",
      sendCnt: "1",
      asmntSubmitStatusCd: "Submit",
      asmntTitle: item.title || ""
    };
    if (isEdit) data.asmntSendCd = asmntSendCd;

    const requestSubmit = (url: string, form: Record<string, string>) =>
      this.http.post<{ result?: number | string; success?: boolean; message?: string }>(url, new URLSearchParams(form), {
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: this.baseUrl.replace(/\/$/, ""),
          Referer: item.request?.url || this.baseUrl,
          ...COMMON_AJAX_HEADERS
        },
        validateStatus: () => true,
        timeout: 60000
      });
    const editData = isEdit
      ? { ...data, asgSn: asmntSendCd, asmntSeq: body.asmntSeq || asmntCd, stdNo: body.stdNo || body.userNo || "", fileSn: attachFileSns }
      : data;
    // 신규는 sendAsmnt, 수정은 같은 계열의 editSendAsmnt를 먼저 쓴다.
    const targetUrl = isEdit ? EDIT_SEND_ASMNT_PATH : SEND_ASMNT_PATH;
    console.log(`[submitAssignment] Sending data to ${targetUrl} (isEdit=${isEdit}, asmntSendCd=${asmntSendCd}):`, JSON.stringify(data));
    let response = await requestSubmit(targetUrl, isEdit ? editData : data);
    console.log("[submitAssignment] Response status:", response.status, "data:", JSON.stringify(response.data));
    const isSuccess = (res: typeof response) => {
      const result = res.data?.result;
      return res.status < 400 && (res.data?.success === true || Number(result) > 0 || /^(success|ok|true|1|y)$/i.test(String(result || "")));
    };
    if (!isSuccess(response) && isEdit) {
      response = await requestSubmit(EDIT_STD_ASMNT_PATH, editData);
      console.log("[submitAssignment] Legacy edit response status:", response.status, "data:", JSON.stringify(response.data));
    }
    const msg = response.data?.message;
    if (!isSuccess(response)) {
      const detailMsg = msg ? `: ${msg}` : "";
      throw new Error(`과제 제출에 실패하였습니다. e-campus 에서 확인하세요.${detailMsg}`);
    }
    return { ok: true, status: response.status, hasSubmittedFile: true };
  }

  /**
   * 제출 화면을 연 뒤 파일을 올려 fileSn 을 받는다.
   * @param {EcampusClassroomItem} item
   * @param {{ filename: string, mime: string, data: Buffer }} file
   * @returns {Promise<string>} attachFileSns
   */
  private async uploadAssignmentFile(
    item: EcampusClassroomItem,
    file: { filename: string; mime: string; data: Buffer }
  ): Promise<string> {
    const body = item.request?.body || {};
    const crsCreCd = body.crsCreCd || "";
    const fn = file.filename || "upload.bin";

    // e-campus 파일 업로드 규격 form-data 생성 (form-data npm 패키지 사용)
    const FormDataPkg = (await import("form-data")).default;
    const fd = new FormDataPkg();
    fd.append("repository", "ASMNT");
    fd.append("organization", "ORG0000001");
    fd.append("type", "file");
    fd.append("sendToFileBoxYn", "N");
    if (crsCreCd) fd.append("crsCreCd", crsCreCd);
    fd.append("file", file.data, {
      filename: fn,
      contentType: file.mime || "application/octet-stream"
    });

    const uploadUrl = new URL("/file/upload", this.baseUrl).toString();
    try {
      const response = await this.http.post("/file/upload", fd, {
        headers: {
          ...fd.getHeaders(),
          Accept: "application/json, text/javascript, */*; q=0.01",
          Origin: this.baseUrl.replace(/\/$/, ""),
          Referer: item.request?.url || `${this.baseUrl.replace(/\/$/, "")}/asmnt/asmntHome/asmntSendView`,
          ...COMMON_AJAX_HEADERS
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
        validateStatus: () => true
      });
      const sn = extractUploadFileSn(response.data);
      if (sn) return sn;
      console.warn(`[uploadAssignmentFile] ${uploadUrl} 응답 파싱 실패 (status=${response.status}):`, typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data).slice(0, 300));
    } catch (err) {
      console.error(`[uploadAssignmentFile] ${uploadUrl} 요청 실패:`, errorMessage(err));
    }
    throw new Error("파일 업로드 응답에서 파일 번호를 읽지 못했습니다.");
  }

  /**
   * e-campus 첨부 URL을 받아 버퍼로 돌려준다.
   * HTML 오류 페이지가 오면 실패로 본다.
   * @param {string} url - 첨부 절대·상대 URL
   * @returns {Promise<EcampusDownloadedFile>} 파일 본문과 헤더
   */
  async downloadClassroomFile(url: string): Promise<EcampusDownloadedFile> {
    await this.ensureAuthenticated();
    const abs = new URL(url, this.baseUrl);
    if (!abs.hostname.endsWith("seowon.ac.kr")) {
      throw new Error("허용되지 않은 주소입니다.");
    }
    const response = await this.http.get<ArrayBuffer>(abs.pathname + abs.search, {
      responseType: "arraybuffer",
      headers: {
        Accept: "*/*",
        Referer: this.baseUrl,
        Origin: this.baseUrl.replace(/\/$/, "")
      },
      maxContentLength: 50 * 1024 * 1024,
      timeout: 120000,
      validateStatus: () => true
    });
    const data = Buffer.from(response.data as ArrayBuffer);
    const contentType = String(response.headers["content-type"] || "application/octet-stream");
    const disposition = String(response.headers["content-disposition"] || "");
    if (response.status >= 400 || isHtmlFileBody(data, contentType)) {
      throw new Error("첨부 파일을 받지 못했습니다. e-campus 에서 다시 받아 보세요.");
    }
    return { data, contentType, disposition };
  }

  /**
   * 첨부파일의 용량(Content-Length)을 HEAD 요청으로 빠르게 얻는다.
   * @param {string} url - 첨부 파일 URL
   * @returns {Promise<number>} 바이트 수 (실패 시 0)
   */
  async getClassroomFileSize(url: string): Promise<number> {
    try {
      await this.ensureAuthenticated();
      const abs = new URL(url, this.baseUrl);
      if (!abs.hostname.endsWith("seowon.ac.kr")) return 0;
      
      const response = await this.http.head(abs.pathname + abs.search, {
        headers: {
          Accept: "*/*",
          Referer: this.baseUrl,
          Origin: this.baseUrl.replace(/\/$/, "")
        },
        validateStatus: () => true
      });
      const cl = response.headers["content-length"];
      if (cl && !isNaN(Number(cl))) {
        return Number(cl);
      }
      return 0;
    } catch {
      return 0;
    }
  }
}

/**
 * 다운로드 URL에서 encFileSn 토큰을 읽는다.
 * @param {string} url
 * @returns {string}
 */
function extractEncFileSnFromUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const path = raw.match(/\/file\/(?:download|delete)\/([^?&#]+)/i);
  if (path?.[1]) {
    try {
      return decodeURIComponent(path[1]);
    } catch {
      return path[1];
    }
  }
  try {
    const u = new URL(raw, "https://ecampus.seowon.ac.kr");
    for (const key of ["encFileSn", "fileEncSn", "fileEncSns", "fileSn"]) {
      const v = u.searchParams.get(key);
      if (v && v.trim()) return v.trim();
    }
  } catch {
    // 상대 경로가 아니어도 아래 fileDown 패턴을 본다
  }
  const down = raw.match(/fileDown\s*\(\s*['"]([^'"]+)['"]/i);
  return down?.[1] || "";
}

/**
 * 빈 값을 빼고 중복을 제거한다.
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = String(raw || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * 새 이름에 확장자가 없으면 기존 확장자를 붙인다.
 * @param {string} newName
 * @param {string} fallbackName
 * @returns {string}
 */
function preserveFilenameExtension(newName: string, fallbackName: string): string {
  const next = String(newName || "").trim() || fallbackName || "upload.bin";
  if (/\.[A-Za-z0-9]{1,8}$/.test(next)) return next;
  const ext = (String(fallbackName || "").match(/(\.[A-Za-z0-9]{1,8})$/) || [])[1] || "";
  return ext ? `${next}${ext}` : next;
}

/**
 * Content-Disposition 헤더에서 파일명을 읽는다.
 * @param {string} disposition
 * @returns {string}
 */
function filenameFromDispositionHeader(disposition: string): string {
  const star = String(disposition || "").match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      return star[1].trim();
    }
  }
  const quoted = String(disposition || "").match(/filename="([^"]+)"/i);
  return quoted?.[1] || "";
}

/**
 * /file/delete 응답이 성공인지 본다. result === "success" 만 인정하면 실제 삭제가 무시된다.
 * @param {unknown} data
 * @param {number} status
 * @returns {boolean}
 */
function isFileDeleteSuccess(data: unknown, status: number): boolean {
  if (status >= 400) return false;
  if (data == null || data === "") return false;
  if (typeof data === "string") {
    const t = data.trim();
    if (!t) return false;
    if (/^<!DOCTYPE|^<html/i.test(t)) return false;
    try {
      return isFileDeleteSuccess(JSON.parse(t), status);
    } catch {
      if (/fail|error|오류|실패|invalid/i.test(t)) return false;
      return /success|ok|deleted|삭제/i.test(t);
    }
  }
  if (typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  if (rec.success === true) return true;
  if (rec.success === false) return false;
  const result = rec.result ?? rec.status ?? rec.code ?? rec.result_code;
  if (result != null) {
    const s = String(result).trim().toLowerCase();
    if (s === "success" || s === "ok") return true;
    if (["fail", "failed", "error", "false", "0", "n"].includes(s)) return false;
  }
  const msg = String(rec.result_message ?? rec.message ?? "");
  if (msg && !/fail|error|오류|실패/i.test(msg)) return true;
  return false;
}

/**
 * 파일 업로드 JSON에서 fileSn 값을 찾는다.
 * @param {unknown} data - 업로드 응답
 * @returns {string} fileSn. 없으면 빈 문자열
 */
function extractUploadFileSn(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      const res = extractUploadFileSn(parsed);
      if (res) return res;
    } catch {
      // JSON 아닐 경우 Regex / HTML 파싱
    }
    const m = /(?:fileSn|attachFileSn|attachFileSns|fileId|fileNo|atchFileId|uploadFileSn|file_sn|file_id)["']?\s*[:=]\s*["']?([A-Za-z0-9_=-]+)/i.exec(trimmed);
    if (m?.[1]) return m[1];
    const mHtml = /(?:fileSn|attachFileSn|fileId|atchFileId)\s*=\s*["']?([A-Za-z0-9_=-]+)["']?/i.exec(trimmed);
    if (mHtml?.[1]) return mHtml[1];
    return "";
  }
  if (typeof data === "number" && Number.isFinite(data)) return String(data);
  if (Array.isArray(data) && data.length > 0) {
    for (const item of data) {
      const sn = extractUploadFileSn(item);
      if (sn) return sn;
    }
  }
  if (typeof data !== "object") return "";
  const rec = data as Record<string, unknown>;
  const keys = ["fileSn", "attachFileSn", "attachFileSns", "fileId", "fileNo", "atchFileId", "uploadFileSn", "file_sn", "file_id", "sn", "id"];
  for (const key of keys) {
    const val = rec[key];
    if (val != null && String(val).trim()) return String(val);
  }
  for (const k of ["returnVO", "data", "file", "result", "fileList", "files", "item", "vo"]) {
    if (rec[k]) {
      const sn = extractUploadFileSn(rec[k]);
      if (sn) return sn;
    }
  }
  return "";
}

/**
 * 신규 e-campus 클라이언트를 생성한다.
 * @param {EcampusClientOptions} [options={}] - 클라이언트 초기화 옵션
 * @returns {EcampusClient} 생성된 e-campus 클라이언트
 */
export function createEcampusClient(options: EcampusClientOptions = {}): EcampusClient {
  return new EcampusClient(options);
}

/**
 * 로그인 API 응답을 후속 흐름에서 쓰기 쉬운 상태로 캡슐화한다
 * @param {EcampusLoginResponse} data - 로그인 API 원본 응답
 * @returns {LoginResult} 리다이렉트, 새로고침, 오류 중 하나로 정규화된 결과
 */
export function parseLoginResponse(data: EcampusLoginResponse): LoginResult {
  if (!data.redirectUrl)
    return {
      type: "error",
      data,
      message: data.message ?? "아이디 또는 비밀번호가 맞지 않습니다."
    };
  if (
    data.otpLogin === "Y" &&
    data.otpUserYn === "Y" &&
    data.otpUserType?.includes("LEARNER") &&
    data.userId &&
    data.userNo
  ) {
    const url = new URL(data.redirectUrl, DEFAULT_BASE_URL);
    url.searchParams.set("userId", data.userId);
    url.searchParams.set("userNo", data.userNo);
    return { type: "redirect", data, url: url.toString() };
  }
  return { type: "reload", data };
}

import { getElearningMp4Url } from "./elearning.js";
