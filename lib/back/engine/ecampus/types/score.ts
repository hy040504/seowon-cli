/** 성적 조회 옵션 */
export interface GetScoreOptions {
  crsCreCd: string; // 과목/강의실 코드
  checkSurvey?: boolean; // 설문 게이트 확인 여부
  stdNo?: string; // 학생-강의실 식별값
}

/** 성적 응답 파싱 옵션 */
export interface EcampusScoreParseOptions {
  crsCreCd?: string; // 과목/강의실 코드
  stdNo?: string; // 학생-강의실 식별값
}

/** 성적 조회 접근 상태 */
export type EcampusScoreAccessStatus =
  | "open"
  | "not_open_period"
  | "private"
  | "unavailable"
  | "survey_check_required"
  | "survey_required"
  | "survey_closed"
  | "survey_check_failed";

/** 성적 페이지 응답 형식 */
export type EcampusScorePageResponseFormat = "html" | "json" | "text";

/** 성적 조회 GET 요청 정보 */
export interface EcampusScoreGetRequest {
  method: "GET"; // HTTP 메서드
  url: string; // 요청 URL
  query: Record<string, string>; // 쿼리 파라미터
}

/** 성적 조회 POST 요청 정보 */
export interface EcampusScorePostRequest {
  method: "POST"; // HTTP 메서드
  url: string; // 요청 URL
  body: Record<string, string>; // 폼 본문
}

/** 성적 공개 여부 API returnVO */
export interface EcampusScoreOpenReturnVO {
  scoreOpenYn?: string; // 성적 공개 여부
  scoreOpenDttm?: string; // 성적 공개 일시
  scoreViewReschYn?: string; // 성적 조회 전 설문 여부
  scoreViewReschCd?: string; // 성적 조회 설문 코드
  [key: string]: unknown; // 추가 응답 필드
}

/** 성적 공개 여부 API 응답 */
export interface EcampusScoreOpenJsonResponse {
  message?: string; // 서버 메시지 또는 서버 현재 시각
  result?: number; // 처리 결과 코드
  returnVO?: EcampusScoreOpenReturnVO | null; // 성적 공개 정보
  [key: string]: unknown; // 추가 응답 필드
}

/** 성적 설문 확인 API returnVO */
export interface EcampusScoreSurveyReturnVO {
  reschJoinYn?: string; // 설문 참여 여부
  reschDttmYn?: string; // 설문 기간 여부
  [key: string]: unknown; // 추가 응답 필드
}

/** 성적 설문 확인 API 응답 */
export interface EcampusScoreSurveyJsonResponse {
  message?: string; // 서버 메시지
  result?: number; // 처리 결과 코드
  returnVO?: EcampusScoreSurveyReturnVO | null; // 설문 확인 정보
  [key: string]: unknown; // 추가 응답 필드
}

/** 성적 공개 상태 정보 */
export interface EcampusScoreOpenInfo {
  crsCreCd: string; // 과목/강의실 코드
  status: EcampusScoreAccessStatus; // 성적 접근 상태
  canViewScore: boolean; // 성적 조회 가능 여부
  message: string; // 사용자 표시 메시지
  result?: number; // 처리 결과 코드
  serverTimeRaw: string; // 서버 현재 시각 원문
  serverDateTime?: string; // 서버 현재 시각 표시값
  scoreOpenYn: string; // 성적 공개 여부
  scoreOpenDttmRaw: string; // 성적 공개 일시 원문
  scoreOpenDateTime?: string; // 성적 공개 일시 표시값
  scoreViewReschYn: string; // 성적 조회 전 설문 여부
  scoreViewReschCd: string; // 성적 조회 설문 코드
  raw: unknown; // 원본 응답
}

/** 성적 설문 참여 상태 정보 */
export interface EcampusScoreSurveyInfo {
  scoreViewReschCd: string; // 성적 조회 설문 코드
  result?: number; // 처리 결과 코드
  message: string; // 서버 메시지
  reschJoinYn: string; // 설문 참여 여부
  reschDttmYn: string; // 설문 기간 여부
  raw: unknown; // 원본 응답
}

/** SAZ에서 복원한 성적 설문 확인 정보 */
export interface EcampusScoreSurveyCapture extends EcampusScoreSurveyInfo {
  crsCreCd: string; // 과목/강의실 코드
  url: string; // 캡처된 요청 URL
}

/** 최종 성적 접근 정보 */
export interface EcampusScoreAccessInfo extends EcampusScoreOpenInfo {
  survey?: EcampusScoreSurveyInfo; // 설문 확인 결과
}

/** 성적 페이지 응답 정보 */
export interface EcampusScorePage {
  crsCreCd: string; // 과목/강의실 코드
  stdNo?: string; // 학생-강의실 식별값
  format: EcampusScorePageResponseFormat; // 응답 형식
  text: string; // 화면 텍스트
  html?: string; // HTML 원문
  json?: unknown; // JSON 응답
  raw: string; // 응답 원문
  summaryRequest?: EcampusScorePostRequest; // 성적 요약 조회 요청 정보
}

/** SAZ에서 복원한 성적 페이지 응답 정보 */
export interface EcampusScorePageCapture extends EcampusScorePage {
  url: string; // 캡처된 요청 URL
  contentType: string; // 응답 Content-Type
}

/** 성적 요약 항목 종류 */
export type EcampusScoreItemKind = "item" | "total" | "grade";

/** 성적 요약 항목 */
export interface EcampusScoreItem {
  title: string; // 항목명
  value: string; // 화면 표시값
  numericValue?: number; // 숫자 점수
  kind: EcampusScoreItemKind; // 항목 종류
}

/** 성적 요약 정보 */
export interface EcampusScoreSummary {
  crsCreCd: string; // 과목/강의실 코드
  stdNo?: string; // 학생-강의실 식별값
  items: EcampusScoreItem[]; // 성적 항목 목록
  total?: string; // 총점 표시값
  totalNumericValue?: number; // 총점 숫자값
  grade?: string; // 등급 표시값
  text: string; // 화면 텍스트
  html: string; // HTML 원문
  raw: string; // 응답 원문
}

/** SAZ에서 복원한 성적 요약 정보 */
export interface EcampusScoreSummaryCapture extends EcampusScoreSummary {
  url: string; // 캡처된 요청 URL
  contentType: string; // 응답 Content-Type
  request: EcampusScorePostRequest; // 캡처된 요청 정보
}

/** 성적 페이지 조회 결과 */
export interface EcampusScorePageResult extends EcampusScoreAccessInfo {
  html?: string; // 성적 페이지 HTML
  page?: EcampusScorePage; // 성적 페이지 파싱 결과
  summary?: EcampusScoreSummary; // 성적 요약 파싱 결과
}
