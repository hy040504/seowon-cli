import type {
  EcampusScoreAccessInfo,
  EcampusScoreGetRequest,
  EcampusScoreItemKind,
  EcampusScoreOpenInfo,
  EcampusScoreOpenJsonResponse,
  EcampusScorePage,
  EcampusScorePostRequest,
  EcampusScoreParseOptions,
  EcampusScoreSummary,
  EcampusScoreSurveyInfo,
  EcampusScoreSurveyJsonResponse
} from "./types/score.js";

export type {
  EcampusScoreAccessInfo,
  EcampusScoreAccessStatus,
  EcampusScoreGetRequest,
  EcampusScoreItem,
  EcampusScoreItemKind,
  EcampusScoreOpenInfo,
  EcampusScoreOpenJsonResponse,
  EcampusScoreOpenReturnVO,
  EcampusScorePage,
  EcampusScorePageCapture,
  EcampusScorePageResult,
  EcampusScorePageResponseFormat,
  EcampusScorePostRequest,
  EcampusScoreParseOptions,
  EcampusScoreSummary,
  EcampusScoreSummaryCapture,
  EcampusScoreSurveyCapture,
  EcampusScoreSurveyInfo,
  EcampusScoreSurveyJsonResponse,
  EcampusScoreSurveyReturnVO,
  GetScoreOptions
} from "./types/score.js";

import * as cheerio from "cheerio";
import { absoluteUrl, normalizeSpace } from "./utils.js";

const DEFAULT_BASE_URL = "https://ecampus.seowon.ac.kr";
const SCORE_OPEN_PATH = "/crs/scoreLect/scoreOpenJson";
const SCORE_SURVEY_CHECK_PATH = "/crs/scoreLect/cheeckStdReshJoin";
const SCORE_PAGE_PATH = "/crs/scoreLect/Form/viewStdScore";
const SCORE_SUMMARY_PATH = "/crs/scoreHome/viewStdScoreSumm";

/**
 * 성적 공개 여부 확인 API 요청 정보를 만든다
 * @param {string} crsCreCd - 조회할 강의실 코드
 * @param {string} baseUrl - e-campus 기본 URL
 * @returns {EcampusScoreGetRequest} 성적 공개 여부 확인용 GET 요청 정보
 */
export function createEcampusScoreOpenRequest(
  crsCreCd: string,
  baseUrl = DEFAULT_BASE_URL
): EcampusScoreGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(SCORE_OPEN_PATH, baseUrl),
    query: { crsCreCd }
  };
}

/**
 * 성적 조회 전 설문 참여 여부 확인 API 요청 정보를 만든다
 * @param {string} crsCreCd - 조회할 강의실 코드
 * @param {string} scoreViewReschCd - 성적 조회에 연결된 설문 코드
 * @param {string} baseUrl - e-campus 기본 URL
 * @returns {EcampusScoreGetRequest} 설문 참여 여부 확인용 GET 요청 정보
 */
export function createEcampusScoreSurveyCheckRequest(
  crsCreCd: string,
  scoreViewReschCd: string,
  baseUrl = DEFAULT_BASE_URL
): EcampusScoreGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(SCORE_SURVEY_CHECK_PATH, baseUrl),
    query: { scoreViewReschCd, crsCreCd }
  };
}

/**
 * 성적 페이지 진입 요청 정보를 만든다
 * @param {string} crsCreCd - 조회할 강의실 코드
 * @param {string} baseUrl - e-campus 기본 URL
 * @returns {EcampusScoreGetRequest} 성적 페이지 GET 요청 정보
 */
export function createEcampusScorePageRequest(
  crsCreCd: string,
  baseUrl = DEFAULT_BASE_URL
): EcampusScoreGetRequest {
  return {
    method: "GET",
    url: absoluteUrl(SCORE_PAGE_PATH, baseUrl),
    query: { crsCreCd }
  };
}

/**
 * 성적 요약 영역 조회 요청 정보를 만든다
 * @param {string} crsCreCd - 조회할 강의실 코드
 * @param {string} stdNo - 성적 페이지 hidden input에서 얻는 학생-강의실 식별값
 * @param {string} baseUrl - e-campus 기본 URL
 * @returns {EcampusScorePostRequest} 성적 요약 POST 요청 정보
 */
export function createEcampusScoreSummaryRequest(
  crsCreCd: string,
  stdNo: string,
  baseUrl = DEFAULT_BASE_URL
): EcampusScorePostRequest {
  return {
    method: "POST",
    url: absoluteUrl(SCORE_SUMMARY_PATH, baseUrl),
    body: { stdNo, crsCreCd }
  };
}

/**
 * scoreOpenJson 응답을 화면과 같은 차단 사유로 정규화한다
 * @param {EcampusScoreOpenJsonResponse | null | undefined} data - scoreOpenJson 원본 응답
 * @param {EcampusScoreParseOptions} options - 파싱에 필요한 강의실 문맥
 * @returns {EcampusScoreOpenInfo} 성적 공개 상태와 차단 사유
 */
export function parseEcampusScoreOpenResponse(
  data: EcampusScoreOpenJsonResponse | null | undefined,
  options: EcampusScoreParseOptions = {}
): EcampusScoreOpenInfo {
  const raw = data ?? {};
  const returnVO = isRecord(data?.returnVO) ? data.returnVO : undefined;
  const result = typeof data?.result === "number" ? data.result : undefined;
  const serverTimeRaw = toText(data?.message);
  const crsCreCd = options.crsCreCd ?? "";

  if (!returnVO) {
    return {
      crsCreCd,
      status: "unavailable",
      canViewScore: false,
      message: "아직 성적을 조회 할 수 없습니다.",
      result,
      serverTimeRaw,
      serverDateTime: formatEcampusTimestamp(serverTimeRaw),
      scoreOpenYn: "",
      scoreOpenDttmRaw: "",
      scoreViewReschYn: "",
      scoreViewReschCd: "",
      raw
    };
  }

  const scoreOpenYn = toText(returnVO.scoreOpenYn);
  const scoreOpenDttmRaw = toText(returnVO.scoreOpenDttm);
  const scoreViewReschYn = toText(returnVO.scoreViewReschYn);
  const scoreViewReschCd = toText(returnVO.scoreViewReschCd);
  const base = {
    crsCreCd,
    result,
    serverTimeRaw,
    serverDateTime: formatEcampusTimestamp(serverTimeRaw),
    scoreOpenYn,
    scoreOpenDttmRaw,
    scoreOpenDateTime: formatEcampusTimestamp(scoreOpenDttmRaw),
    scoreViewReschYn,
    scoreViewReschCd,
    raw
  };

  if (scoreOpenYn !== "Y") {
    return {
      ...base,
      status: "private",
      canViewScore: false,
      message: "해당 과목의 성적은 비공개입니다."
    };
  }

  if (!isScoreOpenTimeReached(serverTimeRaw, scoreOpenDttmRaw)) {
    return {
      ...base,
      status: "not_open_period",
      canViewScore: false,
      message: "성적 조회 기간이 아닙니다."
    };
  }

  if (scoreViewReschYn === "Y") {
    return {
      ...base,
      status: "survey_check_required",
      canViewScore: false,
      message: "성적 조회 전 설문 확인이 필요합니다."
    };
  }

  return {
    ...base,
    status: "open",
    canViewScore: true,
    message: "성적 조회가 가능합니다."
  };
}

/**
 * 설문 확인 응답을 성적 조회 게이트 판단에 필요한 값으로 정규화한다
 * @param {EcampusScoreSurveyJsonResponse | null | undefined} data - 설문 확인 원본 응답
 * @param {string} scoreViewReschCd - 성적 조회에 연결된 설문 코드
 * @returns {EcampusScoreSurveyInfo} 설문 참여 상태 정보
 */
export function parseEcampusScoreSurveyResponse(
  data: EcampusScoreSurveyJsonResponse | null | undefined,
  scoreViewReschCd = ""
): EcampusScoreSurveyInfo {
  const returnVO = isRecord(data?.returnVO) ? data.returnVO : undefined;
  return {
    scoreViewReschCd,
    result: typeof data?.result === "number" ? data.result : undefined,
    message: toText(data?.message),
    reschJoinYn: toText(returnVO?.reschJoinYn),
    reschDttmYn: toText(returnVO?.reschDttmYn),
    raw: data ?? {}
  };
}

/**
 * 성적 페이지 HTML을 성공 패킷 분석에 필요한 최소 정보로 정규화한다
 * @param {string} html - 성적 페이지 HTML 원문
 * @param {EcampusScoreParseOptions} options - 파싱에 필요한 강의실 문맥
 * @returns {EcampusScorePage} HTML 원문과 화면 텍스트
 */
export function parseEcampusScorePageHtml(
  html: string,
  options: EcampusScoreParseOptions = {}
): EcampusScorePage {
  const $ = cheerio.load(html);
  const crsCreCd = options.crsCreCd ?? $("input[name='crsCreCd']").first().attr("value") ?? "";
  const stdNo = options.stdNo ?? $("input[name='stdNo']").first().attr("value") ?? undefined;
  const summaryRequest =
    crsCreCd && stdNo ? createEcampusScoreSummaryRequest(crsCreCd, stdNo) : undefined;

  $("script, style, noscript").remove();
  $("br").replaceWith(" ");
  $("th, td, li, p, div, section, article, dd, dt, label, span, strong, em").append(" ");

  return {
    crsCreCd,
    stdNo,
    format: "html",
    text: normalizeSpace($.root().text()),
    html,
    raw: html,
    summaryRequest
  };
}

/**
 * 성적 요약 HTML에서 항목별 점수, 총점, 등급을 추출한다
 * @param {string} html - /crs/scoreHome/viewStdScoreSumm 응답 HTML
 * @param {EcampusScoreParseOptions} options - 파싱에 필요한 강의실/학생 문맥
 * @returns {EcampusScoreSummary} 성적 요약 데이터
 */
export function parseEcampusScoreSummaryHtml(
  html: string,
  options: EcampusScoreParseOptions = {}
): EcampusScoreSummary {
  const $ = cheerio.load(html);
  const items = $(".tbl_container .tbl_item")
    .toArray()
    .map((element) => {
      const node = $(element);
      const title = normalizeSpace(node.find(".title").first().text());
      const value = normalizeSpace(node.find(".text").first().text());
      const numericValue = parseScoreNumber(value);
      const kind = classifyScoreItem(title);

      return {
        title,
        value,
        ...(numericValue === undefined ? {} : { numericValue }),
        kind
      };
    })
    .filter((item) => item.title || item.value);

  const totalItem = items.find((item) => item.kind === "total");
  const gradeItem = items.find((item) => item.kind === "grade");

  $("script, style, noscript").remove();
  $("br").replaceWith(" ");
  $("th, td, li, p, div, section, article, dd, dt, label, span, strong, em").append(" ");

  return {
    crsCreCd: options.crsCreCd ?? "",
    stdNo: options.stdNo,
    items,
    total: totalItem?.value,
    totalNumericValue: totalItem?.numericValue,
    grade: gradeItem?.value,
    text: normalizeSpace($.root().text()),
    html,
    raw: html
  };
}

/**
 * 공개 시간과 설문 조건을 합쳐 최종 성적 조회 가능 여부를 판정한다
 * @param {EcampusScoreOpenInfo} openInfo - 성적 공개 여부 응답에서 파생된 상태
 * @param {EcampusScoreSurveyInfo} [survey] - 설문 참여 여부 상태
 * @returns {EcampusScoreAccessInfo} 최종 성적 조회 접근 상태
 */
export function resolveEcampusScoreAccess(
  openInfo: EcampusScoreOpenInfo,
  survey?: EcampusScoreSurveyInfo
): EcampusScoreAccessInfo {
  if (openInfo.status !== "survey_check_required") return openInfo;
  if (!survey) return openInfo;

  if ((survey.result ?? 0) <= 0) {
    return {
      ...openInfo,
      survey,
      status: "survey_check_failed",
      canViewScore: false,
      message: survey.message || "성적 설문 확인에 실패했습니다."
    };
  }

  if (survey.reschJoinYn === "N" && survey.reschDttmYn === "N") {
    return {
      ...openInfo,
      survey,
      status: "survey_closed",
      canViewScore: false,
      message: "설문 기간이 종료되었습니다."
    };
  }

  if (survey.reschJoinYn === "N") {
    return {
      ...openInfo,
      survey,
      status: "survey_required",
      canViewScore: false,
      message: "성적 조회 전 설문 참여가 필요합니다."
    };
  }

  return {
    ...openInfo,
    survey,
    status: "open",
    canViewScore: true,
    message: "성적 조회가 가능합니다."
  };
}

/**
 * 성적 공개 상태 목록을 사람이 읽기 쉬운 JSON으로 직렬화한다
 * @param {EcampusScoreOpenInfo[]} items - 성적 공개 상태 목록
 * @returns {string} 들여쓰기된 JSON 문자열
 */
export function stringifyEcampusScoreOpenInfo(items: EcampusScoreOpenInfo[]): string {
  return JSON.stringify(items, null, 2);
}

/**
 * e-campus가 내려주는 yyyyMMddHHmmss 문자열 순서를 그대로 이용해 공개 시각을 비교한다
 * @param {string} serverTimeRaw - 서버 현재 시각 문자열
 * @param {string} scoreOpenDttmRaw - 성적 공개 시각 문자열
 * @returns {boolean} 공개 시각 도달 여부
 */
function isScoreOpenTimeReached(serverTimeRaw: string, scoreOpenDttmRaw: string): boolean {
  return serverTimeRaw >= scoreOpenDttmRaw;
}

/**
 * e-campus 타임스탬프를 로그와 결과 확인에 쉬운 형태로 바꾼다
 * @param {string} value - yyyyMMddHHmmss 형식의 시간 문자열
 * @returns {string | undefined} 변환된 시간 문자열
 */
function formatEcampusTimestamp(value: string): string | undefined {
  if (!/^\d{14}$/.test(value)) return undefined;

  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 서버 응답의 nullable 값을 비교 가능한 문자열로 맞춘다
 * @param {unknown} value - 문자열로 변환할 값
 * @returns {string} nullish 값을 빈 문자열로 처리한 결과
 */
function toText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * 동적 JSON 응답에서 객체 필드 접근을 안전하게 제한한다
 * @param {unknown} value - 검사할 값
 * @returns {boolean} null이 아닌 객체 여부
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 성적 항목 값이 숫자일 경우 number로 변환한다
 * @param {string} value - 화면에 표시된 점수 또는 등급 문자열
 * @returns {number | undefined} 숫자 점수
 */
function parseScoreNumber(value: string): number | undefined {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 항목명을 기준으로 일반 점수, 총점, 등급을 구분한다
 * @param {string} title - 성적 요약 항목명
 * @returns {EcampusScoreItemKind} 항목 분류
 */
function classifyScoreItem(title: string): EcampusScoreItemKind {
  const key = normalizeScoreItemTitle(title);
  const lowerKey = key.toLowerCase();

  if (key.includes("총점") || key.includes("합계")) return "total";
  if (key.includes("등급") || lowerKey.includes("grade")) return "grade";
  return "item";
}

/**
 * 화면별 공백과 장식 문자를 제거해 성적 항목명을 안정적으로 비교한다.
 * @param {string} title - 정규화할 성적 항목명
 * @returns {string} 비교용으로 축약된 항목명
 */
function normalizeScoreItemTitle(title: string): string {
  return title.replace(/[\s:：()[\]{}<>._-]+/g, "");
}
