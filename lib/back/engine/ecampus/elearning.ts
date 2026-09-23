import type {
  EcampusLessonGetRequest,
  EcampusLessonItem,
  EcampusLessonParseOptions,
  EcampusLessonPostRequest,
  EcampusLessonRecordOptions,
  EcampusLessonRequestBundle,
  EcampusLessonRequestBundleOptions,
  EcampusLessonSchedule,
  EcampusLessonStudyStatus,
  EcampusLessonStudyWindow,
  EcampusStudyRecordSnapshot,
  EcampusStudyRecordSnapshotInput,
  ElearningDownloadResult,
  ElearningMp4UrlResult
} from "./types/elearning.js";

export type {
  EcampusLessonGetRequest,
  EcampusLessonItem,
  EcampusLessonParseOptions,
  EcampusLessonPostRequest,
  EcampusLessonRecordOptions,
  EcampusLessonRequestBundle,
  EcampusLessonRequestBundleOptions,
  EcampusLessonSchedule,
  EcampusLessonStudyStatus,
  EcampusLessonStudyWindow,
  EcampusStudyRecordSnapshot,
  EcampusStudyRecordSnapshotInput,
  ElearningDownloadResult,
  ElearningMp4UrlResult
} from "./types/elearning.js";

import * as cheerio from "cheerio";
import { absoluteUrl, escapeRegExp, normalizeSpace, parseFunctionArguments } from "./utils.js";

import util from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { AxiosInstance } from "axios";

const DEFAULT_BASE_URL = "https://ecampus.seowon.ac.kr";
const DEFAULT_PROGRESS_TYPE_CD = "WEEK";
const LESSON_VIEW_PATH = "/lesson/lessonLect/Form/mainLesson";
const LESSON_WINDOW_PATH = "/lesson/lessonOpen/lessonNewWindow";
const ADD_STUDY_RECORD_PATH = "/lesson/lessonHome/addStudyRecord";
const VIEW_STUDY_DETAIL_PATH = "/lesson/lessonLect/viewLessonStudyDetail";
const VIEW_LESSON_CMNT_PATH = "/lesson/lessonLect/viewLessonCmnt";
const EXIT_STUDY_PATH = "/lesson/lessonPop/Form/exitStudy";

/**
 * e-learning 학습 세션 라이프사이클을 관리하는 핵심 클래스.
 * 서버가 기대하는 브라우저 호출 순서를 맞춰 학습 이력을 안정적으로 적재한다.
 */
export class ElearningSession {
  private studyDetailId: string | null = null;
  private totalStudyTime: number = 0;
  private progressPercent: number = 0;
  private progressPercentText: string = "0%";
  private intervalId: NodeJS.Timeout | null = null;
  private isWatching = false;

  /**
   * 학습 세션을 구성한다.
   * @param {AxiosInstance} http - 인증된 HTTP 클라이언트
   * @param {string} baseUrl - LMS 도메인
   * @param {string} lessonCntsId - 대상 콘텐츠 ID
   * @param {string} crsCreCd - 대상 강의실 ID
   * @param {string} stdNo - 사용자 식별자 (학번 기반 패킷 데이터)
   */
  constructor(
    private readonly http: AxiosInstance,
    private readonly baseUrl: string,
    private readonly lessonCntsId: string,
    private readonly crsCreCd: string,
    private readonly stdNo: string
  ) {}

  /**
   * 서버 응답의 진행률 값을 표시 가능한 퍼센트 문자열로 정규화한다.
   * @param {unknown} rawRatio - 서버가 내려준 진행률 원본 값
   * @returns {string} 퍼센트 기호가 포함된 진행률 문자열
   */
  private formatProgressPercent(rawRatio: unknown): string {
    const ratioText =
      typeof rawRatio === "string" ? rawRatio.trim().replace(/%$/, "").trim() : rawRatio;
    const parsedRatio = Number(ratioText);
    if (!Number.isFinite(parsedRatio)) return "0%";
    return `${ratioText}%`;
  }

  /**
   * 현재 학습 진행 상태를 운영 로그로 남긴다.
   * @returns {void} 반환값 없음
   */
  private logStudyProgressStatus(): void {
    console.log(
      `[ElearningSession] 학습 중... (서버 학습 률: ${this.progressPercentText}, 누적 ${this.totalStudyTime}초)`
    );
  }

  /**
   * 서버 측 시퀀스를 하나씩 실행하여 실제 학습 중인 상태로 전환한다.
   * @returns {Promise<void>} 시청 세션 시작 완료 시 resolve
   */
  async startWatchingLesson(): Promise<void> {
    if (this.isWatching) return;
    console.log(`[ElearningSession] 🎬 ${this.lessonCntsId} 자연스러운 학습 시작`);

    // 1. 재생 환경 초기화
    await this.openLessonWindow();

    // 2. 콘텐츠 데이터 매핑 확인
    await this.enterLessonContent();

    // 3. 최초 학습 이력 생성 및 세션 키(studyDetailId) 확보
    await this.initializeStudyRecord();

    // 4. 인간적인 시청 패턴을 모사한 주기적 기록 갱신 모드 진입
    this.startPeriodicStudyRecord();

    this.isWatching = true;
  }

  /**
   * 학습 기록 API가 요구하는 재생 창 컨텍스트를 먼저 생성한다.
   * @returns {Promise<void>} 재생 창 컨텍스트 생성 완료 시 resolve
   */
  private async openLessonWindow(): Promise<void> {
    await this.http.get(LESSON_WINDOW_PATH, {
      params: { crsCreCd: this.crsCreCd }
    });
    console.log("[ElearningSession] ✅ lessonNewWindow 호출 완료");
  }

  /**
   * 콘텐츠 진입 API를 호출해 서버 세션을 시청 상태로 전환한다.
   * @returns {Promise<void>} 콘텐츠 진입 처리 완료 시 resolve
   */
  private async enterLessonContent(): Promise<void> {
    const params = new URLSearchParams({
      lessonCntsId: this.lessonCntsId,
      progressTypeCd: DEFAULT_PROGRESS_TYPE_CD,
      stdNo: this.stdNo,
      crsCreCd: this.crsCreCd
    });
    await this.http.post(VIEW_LESSON_CMNT_PATH, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    console.log("[ElearningSession] ✅ viewLessonCmnt (콘텐츠 진입)");
  }

  /**
   * 이후 기록 갱신에 필요한 studyDetailId를 확보한다.
   * @returns {Promise<void>} 초기 학습 기록 처리 완료 시 resolve
   */
  private async initializeStudyRecord(): Promise<void> {
    // 서버가 0초 기록을 무시할 수 있어 첫 요청은 최소 학습 시간으로 시작한다.
    const initialTm = 60;
    const res = await this.callAddStudyRecord(initialTm);

    let data = res;
    if (typeof data === "string" && data.trim().startsWith("{")) {
      try {
        data = JSON.parse(data);
      } catch {}
    }

    if (data?.returnVO?.studyDetailId) {
      this.studyDetailId = data.returnVO.studyDetailId;
      this.totalStudyTime = initialTm;
      this.logStudyProgressStatus();
      console.log(`[ElearningSession] ✅ studyDetailId 생성: ${this.studyDetailId}`);
    } else {
      console.warn("[ElearningSession] ⚠️ studyDetailId 확보 실패: 기록 누락 우려");
    }
  }

  /**
   * 단일 학습 기록을 전송하고 서버 진행률을 내부 상태와 동기화한다.
   * @param {number} studyTotalTm - 서버에 전달할 누적 학습 시간(초)
   * @returns {Promise<any>} 서버의 addStudyRecord 응답 데이터
   */
  private async callAddStudyRecord(studyTotalTm: number): Promise<any> {
    const query = {
      lessonCntsId: this.lessonCntsId,
      stdNo: this.stdNo,
      studyDetailId: this.studyDetailId || "",
      studyTotalTm: studyTotalTm.toString(),
      studyAfterTm: "0",
      studyStatusCd: "STUDY",
      crsCreCd: this.crsCreCd
    };
    const response = await this.http.get(ADD_STUDY_RECORD_PATH, {
      params: query,
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    let data = response.data;
    if (typeof data === "string" && data.trim().startsWith("{")) {
      try {
        data = JSON.parse(data);
      } catch {}
    }

    // 응답 위치가 화면/버전에 따라 달라 두 경로를 모두 허용한다.
    const rawRatio = data?.returnVO?.prgrRatio ?? data?.prgrRatio;
    if (rawRatio !== undefined && rawRatio !== null) {
      const parsedRatio = Number(rawRatio);
      if (!isNaN(parsedRatio)) {
        this.progressPercent = parsedRatio;
        this.progressPercentText = this.formatProgressPercent(rawRatio);
      }
    }

    return data;
  }

  /**
   * 서버가 기대하는 주기적 학습 기록 흐름을 유지한다.
   * @returns {void} 반환값 없음
   */
  private startPeriodicStudyRecord(): void {
    /**
     * 다음 학습 기록을 전송하고 다음 호출을 예약한다.
     * @returns {Promise<void>} 이번 기록 전송 완료 시 resolve
     */
    const sendNext = async () => {
      if (!this.isWatching) return;

      const randomDelay = 45000 + Math.random() * 30000;
      this.totalStudyTime += 60;

      console.log(`[ElearningSession] ⏰ addStudyRecord 호출 → 누적 ${this.totalStudyTime}초`);
      await this.callAddStudyRecord(this.totalStudyTime);
      this.logStudyProgressStatus();

      // 실제 브라우저 흐름과 맞추기 위해 상세 조회를 함께 호출한다.
      await this.verifyStudyDetail();

      this.intervalId = setTimeout(sendNext, randomDelay);
    };

    // 모든 세션이 같은 시점에 기록되는 것을 피하기 위해 첫 호출도 분산한다.
    this.intervalId = setTimeout(sendNext, 25000 + Math.random() * 10000);
  }

  /**
   * 학습 상세 조회를 호출해 서버 세션 흐름을 실제 화면과 맞춘다.
   * @returns {Promise<void>} 상세 조회 완료 시 resolve
   */
  private async verifyStudyDetail(): Promise<void> {
    const params = new URLSearchParams({
      lessonCntsId: this.lessonCntsId,
      prgrRatioTypeCd: "STUDY_TOTAL_TM",
      stdNo: this.stdNo,
      crsCreCd: this.crsCreCd,
      pageIndex: "1",
      listScale: "10"
    });
    await this.http.post(VIEW_STUDY_DETAIL_PATH, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    console.log("[ElearningSession] ✅ viewLessonStudyDetail (학습 이력 확인)");
  }

  /**
   * 학습 세션을 종료하고 서버에 창 닫기 패킷(exitStudy)을 전송한다.
   * @returns {Promise<void>} 종료 처리 완료 시 resolve
   */
  async stopWatchingLesson(): Promise<void> {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    if (!this.isWatching) return;

    try {
      const params = new URLSearchParams({
        lessonCntsId: this.lessonCntsId,
        seekFile: "",
        downloadYn: "",
        progressTypeCd: DEFAULT_PROGRESS_TYPE_CD
      });
      await this.http.post(EXIT_STUDY_PATH, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      console.log(
        `[ElearningSession] 🛑 학습 종료 패킷(exitStudy) 전송 완료 (총 ${this.totalStudyTime}초)`
      );
    } catch (error) {
      console.error(
        "[ElearningSession] ⚠️ 종료 패킷 전송 오류:",
        error instanceof Error ? error.message : error
      );
    } finally {
      this.isWatching = false;
    }
  }

  /**
   * 서버 측에 반영된 최종 진행률을 조회한다.
   * @returns {number} 진행률 퍼센트 숫자
   */
  getProgressPercent(): number {
    return this.progressPercent;
  }
}

/**
 * 학습 세션을 생성하고 즉시 시청 흐름을 시작한다.
 * @param {AxiosInstance} http - 인증된 HTTP 클라이언트
 * @param {string} baseUrl - e-campus 기본 URL
 * @param {string} lessonCntsId - 강의 콘텐츠 ID
 * @param {string} crsCreCd - 강의실 생성 코드
 * @param {string} stdNo - 학생-강의실 식별값
 * @returns {Promise<ElearningSession>} 시작된 학습 세션
 */
export async function watchLesson(
  http: AxiosInstance,
  baseUrl: string,
  lessonCntsId: string,
  crsCreCd: string,
  stdNo: string
): Promise<ElearningSession> {
  const session = new ElearningSession(http, baseUrl, lessonCntsId, crsCreCd, stdNo);
  await session.startWatchingLesson();
  return session;
}

/**
 * HTML 목록에서 주차별 강의 구조를 분석한다.
 * @param {string} html - 이러닝 목록 HTML
 * @param {EcampusLessonParseOptions} options - 파싱 옵션
 * @returns {EcampusLessonSchedule[]} 주차별 강의 일정 배열
 */
export function parseEcampusLessonSchedulesHtml(
  html: string,
  options: EcampusLessonParseOptions = {}
): EcampusLessonSchedule[] {
  const $ = cheerio.load(html);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const crsCreCd =
    options.crsCreCd ??
    extractFirstValue(html, /crsCreCd["']?\s*(?:value=|:)\s*["']([^"']+)/) ??
    "";
  const schedules: EcampusLessonSchedule[] = [];

  $(".title.header[id^='dropdown_']").each((_, element) => {
    const header = $(element);
    const lessonScheduleId = (header.attr("id") ?? "").replace(/^dropdown_/, "");
    const content = $(`#${escapeCssId(lessonScheduleId)}`);

    if (!lessonScheduleId || content.length === 0) return;

    const schedule: EcampusLessonSchedule = {
      lessonScheduleId,
      title: normalizeSpace(header.find("section").first().text()),
      period: extractLabeledText(header.text(), "기간"),
      summary: extractLabeledText(header.text(), "수업내용"),
      lessons: []
    };

    content.find(".card").each((__, cardElement) => {
      const card = $(cardElement);
      const href = card.find("a.header").first().attr("href") ?? "";
      const buttonOnclick = card.find("button[onclick]").first().attr("onclick") ?? "";
      const viewArgs = parseFunctionArguments(href);
      const buttonArgs = parseFunctionArguments(buttonOnclick);
      const lessonCntsId = viewArgs[1] ?? buttonArgs[0] ?? "";

      if (!lessonCntsId) return;

      const text = normalizeSpace(card.text());
      const durationText = extractDurationText(text);
      const period = extractLabeledText(text, "기간");
      const item: EcampusLessonItem = {
        lessonScheduleId,
        scheduleTitle: schedule.title,
        lessonCntsId,
        title: normalizeSpace(card.find("a.header").first().text()),
        period,
        extraPeriod: extractLabeledText(text, "기간 외 학습기간"),
        durationText,
        durationSeconds: parseDurationSeconds(durationText),
        attendanceStatus: extractLabeledText(text, "출결상태"),
        viewRequest: createLessonViewRequest(baseUrl, crsCreCd, lessonScheduleId, lessonCntsId),
        studyWindowRequest: createLessonStudyWindowRequest(baseUrl, crsCreCd, lessonCntsId)
      };

      schedule.lessons.push(item);
    });

    schedules.push(schedule);
  });

  return schedules;
}

/**
 * 주차 컨테이너 없이 카드만 있는 HTML 응답을 보정 파싱한다.
 * @param {string} html - 이러닝 목록 HTML
 * @param {EcampusLessonParseOptions} options - 파싱 옵션
 * @returns {EcampusLessonItem[]} 평탄화된 강의 항목 배열
 */
function parseLooseLessonCards(
  html: string,
  options: EcampusLessonParseOptions = {}
): EcampusLessonItem[] {
  const $ = cheerio.load(html);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const crsCreCd =
    options.crsCreCd ??
    extractFirstValue(html, /crsCreCd["']?\s*(?:value=|:)\s*["']([^"']+)/) ??
    "";
  const lessons: EcampusLessonItem[] = [];

  $(".card").each((_, cardElement) => {
    const card = $(cardElement);
    const href = card.find("a.header").first().attr("href") ?? "";
    const buttonOnclick = card.find("button[onclick]").first().attr("onclick") ?? "";
    const viewArgs = parseFunctionArguments(href);
    const buttonArgs = parseFunctionArguments(buttonOnclick);
    const lessonScheduleId =
      viewArgs[0] ??
      extractFirstValue(html, /lessonScheduleId["']?\s*(?:value=|:)\s*["']([^"']+)/) ??
      "";
    const lessonCntsId = viewArgs[1] ?? buttonArgs[0] ?? "";

    if (!lessonScheduleId || !lessonCntsId) return;

    const text = normalizeSpace(card.text());
    const durationText = extractDurationText(text);
    const period = extractAnyLabeledText(text, ["기간"]);
    lessons.push({
      lessonScheduleId,
      lessonCntsId,
      title: normalizeSpace(card.find("a.header").first().text()),
      period,
      extraPeriod: cleanOptionalText(extractAnyLabeledText(text, ["기간 외 학습기간"])),
      durationText,
      durationSeconds: parseDurationSeconds(durationText),
      attendanceStatus: extractAnyLabeledText(text, ["출결상태"]),
      viewRequest: createLessonViewRequest(baseUrl, crsCreCd, lessonScheduleId, lessonCntsId),
      studyWindowRequest: createLessonStudyWindowRequest(baseUrl, crsCreCd, lessonCntsId)
    });
  });

  return lessons;
}

/**
 * HTML 차시 목록을 평탄화된 배열로 추출한다.
 * @param {string} html - 이러닝 목록 HTML
 * @param {EcampusLessonParseOptions} options - 파싱 옵션
 * @returns {EcampusLessonItem[]} 강의 항목 배열
 */
export function parseEcampusLessonListHtml(
  html: string,
  options: EcampusLessonParseOptions = {}
): EcampusLessonItem[] {
  const lessons = parseEcampusLessonSchedulesHtml(html, options).flatMap((s) => s.lessons);
  return lessons.length > 0 ? lessons : parseLooseLessonCards(html, options);
}

/**
 * 시청 창 HTML에서 재생과 기록 갱신에 필요한 메타데이터를 추출한다.
 * @param {string} html - 시청 창 HTML
 * @param {EcampusLessonParseOptions} options - 파싱 옵션
 * @returns {EcampusLessonStudyWindow} 시청 창 메타데이터
 */
export function parseEcampusLessonStudyWindowHtml(
  html: string,
  options: EcampusLessonParseOptions = {}
): EcampusLessonStudyWindow {
  const $ = cheerio.load(html);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const contentUrl = extractFirstValue(html, /var\s+cntsUrl\s*=\s*"([^*]*)"/);
  const crsCreCd = options.crsCreCd ?? extractFirstValue(html, /"crsCreCd"\s*:\s*"([^"]+)"/) ?? "";
  const lessonCntsId = extractFirstValue(html, /"lessonCntsId"\s*:\s*"([^"]+)"/) ?? "";

  return {
    crsCreCd,
    lessonCntsId,
    contentUrl,
    contentKind: classifyContentUrl(contentUrl),
    studyDetailId:
      $("#studyDetailId").attr("value") ||
      extractFirstValue(html, /studyDetailId["']?\s*:\s*["']([^"']+)/)
  };
}

/**
 * 학습 창 정보에서 재사용 가능한 학습 기록 스냅샷을 생성한다.
 * @param {EcampusLessonStudyWindow | EcampusStudyRecordSnapshotInput} input - 시청 창 또는 기록 입력 데이터
 * @returns {EcampusStudyRecordSnapshot} 재호출 가능한 학습 기록 스냅샷
 */
export function parseStudyRecordSnapshot(
  input: EcampusLessonStudyWindow | EcampusStudyRecordSnapshotInput
): EcampusStudyRecordSnapshot {
  const snapshotInput = input as EcampusStudyRecordSnapshotInput &
    Partial<EcampusLessonStudyWindow>;
  const baseUrl = snapshotInput.baseUrl ?? DEFAULT_BASE_URL;
  const lessonCntsId = input.lessonCntsId ?? "";
  const crsCreCd = input.crsCreCd ?? "";
  const stdNo = input.stdNo;
  const studyDetailId = input.studyDetailId;
  const studyStatusCd =
    "currentStudyStatusCd" in input ? input.currentStudyStatusCd : snapshotInput.studyStatusCd;

  const recordRequest =
    "recordRequest" in input && input.recordRequest
      ? input.recordRequest
      : stdNo
        ? createStudyRecordRequest(baseUrl, {
            crsCreCd,
            lessonCntsId,
            stdNo,
            studyDetailId,
            studyStatusCd,
            studyTotalTm: snapshotInput.studyTotalTm,
            studyAfterTm: snapshotInput.studyAfterTm,
            studySessionLoc: snapshotInput.studySessionLoc,
            studyMaxLoc: snapshotInput.studyMaxLoc,
            playerTm: snapshotInput.playerTm,
            progressTm: snapshotInput.progressTm
          })
        : undefined;

  return {
    baseUrl,
    lessonScheduleId: snapshotInput.lessonScheduleId,
    lessonCntsId,
    crsCreCd,
    stdNo,
    studyDetailId,
    currentStudyStatusCd: studyStatusCd,
    contentUrl: input.contentUrl,
    contentKind: input.contentKind ?? "unknown",
    recordRequest
  };
}

/**
 * lesson 객체 하나로 진입, 재생 창, 학습 기록 요청을 묶는다.
 * @param {EcampusLessonItem} lesson - 요청 정보를 만들 강의 항목
 * @param {EcampusLessonRequestBundleOptions} options - 요청 생성 옵션
 * @returns {EcampusLessonRequestBundle} 강의 진입 관련 요청 묶음
 */
export function createEcampusLessonRequestBundle(
  lesson: EcampusLessonItem,
  options: EcampusLessonRequestBundleOptions = {}
): EcampusLessonRequestBundle {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const crsCreCd = options.crsCreCd ?? "";
  const snapshot = parseStudyRecordSnapshot({
    ...options,
    baseUrl,
    crsCreCd,
    lessonScheduleId: lesson.lessonScheduleId,
    lessonCntsId: lesson.lessonCntsId
  });

  return {
    viewRequest: createLessonViewRequest(
      baseUrl,
      crsCreCd,
      lesson.lessonScheduleId,
      lesson.lessonCntsId
    ),
    studyWindowRequest: createLessonStudyWindowRequest(baseUrl, crsCreCd, lesson.lessonCntsId),
    recordRequest: snapshot.recordRequest,
    snapshot
  };
}

/**
 * 강의 정보를 CLI 출력에 적합한 JSON으로 직렬화한다.
 * @param {EcampusLessonItem[] | EcampusLessonSchedule[]} lessons - 강의 항목 또는 일정 배열
 * @returns {string} 들여쓰기된 JSON 문자열
 */
export function stringifyEcampusLessons(
  lessons: EcampusLessonItem[] | EcampusLessonSchedule[]
): string {
  return JSON.stringify(lessons, null, 2);
}

/**
 * 강의 진입용 POST 요청 객체를 생성한다.
 * @param {string} baseUrl - e-campus 기본 URL
 * @param {string} crsCreCd - 강의실 생성 코드
 * @param {string} lessonScheduleId - 주차 일정 ID
 * @param {string} lessonCntsId - 강의 콘텐츠 ID
 * @returns {EcampusLessonPostRequest} 강의 진입 POST 요청 정보
 */
export function createLessonViewRequest(
  baseUrl: string,
  crsCreCd: string,
  lessonScheduleId: string,
  lessonCntsId: string
): EcampusLessonPostRequest {
  return {
    method: "POST",
    url: absoluteUrl(LESSON_VIEW_PATH, baseUrl),
    body: {
      crsCreCd,
      lessonScheduleId,
      crsOperTypeCd: "",
      progressTypeCd: DEFAULT_PROGRESS_TYPE_CD,
      lessonCntsId,
      goUrl: "",
      subParam: ""
    }
  };
}

/**
 * 재생 창 로드용 POST 요청 객체를 생성한다.
 * @param {string} baseUrl - e-campus 기본 URL
 * @param {string} crsCreCd - 강의실 생성 코드
 * @param {string} lessonCntsId - 강의 콘텐츠 ID
 * @returns {EcampusLessonPostRequest} 재생 창 POST 요청 정보
 */
export function createLessonStudyWindowRequest(
  baseUrl: string,
  crsCreCd: string,
  lessonCntsId: string
): EcampusLessonPostRequest {
  return {
    method: "POST",
    url: absoluteUrl(`${LESSON_WINDOW_PATH}?crsCreCd=${encodeURIComponent(crsCreCd)}`, baseUrl),
    body: { lessonCntsId, seekFile: "", downloadYn: "", progressTypeCd: DEFAULT_PROGRESS_TYPE_CD }
  };
}

/**
 * 학습 기록용 GET 요청 객체를 생성한다.
 * @param {string} baseUrl - e-campus 기본 URL
 * @param {EcampusLessonRecordOptions} options - 학습 기록 요청 옵션
 * @returns {EcampusLessonGetRequest} 학습 기록 GET 요청 정보
 */
export function createStudyRecordRequest(
  baseUrl: string,
  options: EcampusLessonRecordOptions
): EcampusLessonGetRequest {
  const query = {
    lessonCntsId: options.lessonCntsId,
    stdNo: options.stdNo,
    studyDetailId: options.studyDetailId || "",
    studyTotalTm: String(options.studyTotalTm ?? 0),
    studyAfterTm: String(options.studyAfterTm ?? 0),
    studyStatusCd: options.studyStatusCd ?? "STUDY",
    crsCreCd: options.crsCreCd
  };
  return { method: "GET", url: absoluteUrl(ADD_STUDY_RECORD_PATH, baseUrl), query };
}

/**
 * 학습 이력 확인용 GET 요청 객체를 생성한다.
 * @param {string} baseUrl - e-campus 기본 URL
 * @param {string} lessonCntsId - 강의 콘텐츠 ID
 * @param {string} crsCreCd - 강의실 생성 코드
 * @returns {EcampusLessonGetRequest} 학습 이력 확인 GET 요청 정보
 */
export function createViewLessonStudyDetailRequest(
  baseUrl: string,
  lessonCntsId: string,
  crsCreCd: string
): EcampusLessonGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(VIEW_STUDY_DETAIL_PATH, baseUrl),
    query: { lessonCntsId, crsCreCd }
  };
}

/**
 * 콘텐츠 URL을 분석하여 미디어 타입을 분류한다.
 * @param {string | undefined} contentUrl - 콘텐츠 URL
 * @returns {EcampusLessonStudyWindow["contentKind"]} 분류된 콘텐츠 종류
 */
function classifyContentUrl(
  contentUrl: string | undefined
): EcampusLessonStudyWindow["contentKind"] {
  if (!contentUrl) return "unknown";
  const lower = contentUrl.toLowerCase();
  if (lower.endsWith(".mp4")) return "mp4";
  if (lower.endsWith(".m3u8")) return "hls";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("ted.com")) return "ted";
  if (lower.includes("doczoom")) return "doczoom";
  return "url";
}

/**
 * 정규식 첫 번째 캡처 그룹을 안전하게 추출한다.
 * @param {string} source - 검색 대상 문자열
 * @param {RegExp} pattern - 캡처 그룹이 포함된 정규식
 * @returns {string | undefined} 첫 번째 캡처 값
 */
function extractFirstValue(source: string, pattern: RegExp): string | undefined {
  return source.match(pattern)?.[1];
}

/**
 * e-campus 카드 텍스트에서 특정 라벨에 해당하는 값을 추출한다.
 * @param {string} text - 카드 전체 텍스트
 * @param {string} label - 추출할 라벨명
 * @returns {string | undefined} 라벨 뒤에 이어지는 값
 */
function extractLabeledText(text: string, label: string): string | undefined {
  const norm = normalizeSpace(text);
  const labels = ["기간 외 학습기간", "기간", "수업내용", "강의시간", "출결상태"];
  const other = labels
    .filter((c) => c !== label)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(`${escapeRegExp(label)}\\s*(.*?)(?=\\s*(?:${other})\\s*|$)`);
  return norm.match(pattern)?.[1]?.trim() || undefined;
}

/**
 * 여러 라벨 후보 중 처음 발견되는 값을 추출한다.
 * @param {string} text - 카드 전체 텍스트
 * @param {string[]} labels - 확인할 라벨 후보 배열
 * @returns {string | undefined} 첫 번째 유효 라벨 값
 */
function extractAnyLabeledText(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const value = extractLabeledText(text, label);
    if (value) return value;
  }
  return undefined;
}

/**
 * 화면에서 비어 있음을 의미하는 값을 undefined로 정규화한다.
 * @param {string | undefined} value - 정리할 선택 텍스트
 * @returns {string | undefined} 유효한 텍스트 또는 undefined
 */
function cleanOptionalText(value: string | undefined): string | undefined {
  if (!value || value.trim() === "-") return undefined;
  return value.trim();
}

/**
 * 카드 텍스트에서 강의 시간 표시값을 추출한다.
 * @param {string} text - 카드 전체 텍스트
 * @returns {string | undefined} 강의 시간 텍스트
 */
function extractDurationText(text: string): string | undefined {
  return text
    .match(/강의시간\s*([0-9]+\s*분(?:\s*[0-9]+\s*초)?|[0-9]+\s*초)/)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
}

/**
 * e-campus 강의 시간 텍스트를 초 단위로 변환한다.
 * @param {string | undefined} durationText - "N분 M초" 형식의 시간 텍스트
 * @returns {number | undefined} 초 단위 강의 시간
 */
function parseDurationSeconds(durationText: string | undefined): number | undefined {
  if (!durationText) return undefined;
  const m = Number(durationText.match(/(\d+)\s*분/)?.[1] ?? 0);
  const s = Number(durationText.match(/(\d+)\s*초/)?.[1] ?? 0);
  return m * 60 + s;
}

/**
 * jQuery 스타일 선택자에서 사용할 수 있도록 ID 값을 이스케이프한다.
 * @param {string} value - 원본 ID 값
 * @returns {string} CSS 선택자에 안전한 ID 값
 */
function escapeCssId(value: string): string {
  return value.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1");
}

/**
 * 콘텐츠 페이지에서 실제 다운로드 가능한 MP4 주소를 도출한다.
 * @param {AxiosInstance} http - 인증된 HTTP 클라이언트
 * @param {string | undefined} contentUrl - 시청 창에서 추출한 콘텐츠 URL
 * @param {{ crsCreCd: string; lessonCntsId: string }} context - 실패 디버깅용 강의 문맥
 * @returns {Promise<ElearningMp4UrlResult>} MP4 주소 추출 결과
 */
export async function getElearningMp4Url(
  http: AxiosInstance,
  contentUrl: string | undefined,
  context: { crsCreCd: string; lessonCntsId: string }
): Promise<ElearningMp4UrlResult> {
  const { crsCreCd, lessonCntsId } = context;
  if (!contentUrl)
    return { success: false, message: "URL 유실", debugInfo: { crsCreCd, lessonCntsId } };

  try {
    const res = await http.get<string>(contentUrl);
    const html = res.data;
    const $ = cheerio.load(html);

    // 표준 video source가 있으면 가장 신뢰도가 높다.
    let mp4Url =
      $('source[type="video/mp4"]').first()?.attr("src") || $("source#lessonVodSrc")?.attr("src");

    // 일부 콘텐츠는 source 없이 스토리지 URL만 스크립트에 노출된다.
    if (!mp4Url) {
      const match = html.match(
        /https:\/\/eplus\.seowon\.ac\.kr\/WebContentStorage\/[^"\s]+\.mp4\?tsdata=[^"\s]+/
      );
      if (match?.[0]) mp4Url = match[0];
    }

    // VideoPlayer 설정이 Base64로만 들어오는 구버전 콘텐츠를 보정한다.
    const viewModel = html.match(/new VideoPlayerWidgetViewModel\('([^']+)'/);
    if (!mp4Url && viewModel?.[1]) {
      try {
        const json = Buffer.from(viewModel[1], "base64").toString("utf8");
        const parsed = JSON.parse(json);
        if (parsed?.videoUrl) mp4Url = parsed.videoUrl;
      } catch {}
    }

    if (mp4Url) return { success: true, mp4Url };
    return { success: false, message: "MP4 주소 도출 실패", debugInfo: { crsCreCd, lessonCntsId } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message, debugInfo: { crsCreCd, lessonCntsId } };
  }
}

/**
 * MP4 스트림을 로컬 파일로 다운로드한다.
 * @param {AxiosInstance} http - 인증된 HTTP 클라이언트
 * @param {string} mp4Url - 다운로드할 MP4 URL
 * @param {string} courseTitle - 저장 경로에 사용할 과목명
 * @param {string} lessonTitle - 저장 파일명에 사용할 강의명
 * @param {string} [baseDir="./downloads"] - 다운로드 기준 디렉터리
 * @param {(p: { percent: number; loaded: number }) => void} [progressCallback] - 진행률 콜백
 * @returns {Promise<ElearningDownloadResult>} 다운로드 성공 여부와 파일 경로
 */
export async function downloadElearningMp4(
  http: AxiosInstance,
  mp4Url: string,
  courseTitle: string,
  lessonTitle: string,
  baseDir: string = "./downloads",
  progressCallback?: (p: { percent: number; loaded: number }) => void
): Promise<ElearningDownloadResult> {
  try {
    const sanitizedCourse = sanitizeFilename(courseTitle);
    const sanitizedLesson = sanitizeFilename(lessonTitle);
    const downloadPath = path.resolve(baseDir, sanitizedCourse);
    const filePath = path.resolve(downloadPath, `${sanitizedLesson}.mp4`);

    fs.mkdirSync(downloadPath, { recursive: true });

    // 대용량 강의 파일 다운로드 시 메모리/디스크 I/O 튜닝을 환경별로 조정한다.
    const hwmConfig = process.env.DOWNLOAD_HIGH_WATER_MARK
      ? parseInt(process.env.DOWNLOAD_HIGH_WATER_MARK)
      : 1024;
    const hwmBytes = (isNaN(hwmConfig) ? 1024 : hwmConfig) * 1024;

    const res = await http.get(mp4Url, {
      responseType: "stream",
      onDownloadProgress: (ev) => {
        if (progressCallback && ev.total) {
          progressCallback({
            loaded: ev.loaded,
            percent: Math.round((ev.loaded / ev.total) * 100)
          });
        }
      }
    });

    const writer = fs.createWriteStream(filePath, { highWaterMark: hwmBytes });
    res.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve({ success: true, filePath }));
      writer.on("error", (err) => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        reject(err);
      });
    });
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : util.inspect(err) };
  }
}

/**
 * 파일 시스템에서 사용할 수 없는 문자를 안전한 파일명으로 정제한다.
 * @param {string} name - 원본 파일 또는 폴더 이름
 * @returns {string} 저장 가능한 파일명
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
}
