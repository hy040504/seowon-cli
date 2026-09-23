/**
 * 수강신청 본신청 에러 정의.
 * 본신청 전용 — 수강희망바구니와 다름.
 * 패킷 분석에서 확인된 실제 서버 응답 패턴 기반.
 *
 * SSV 응답 레벨:
 *  - ErrorCode:int=0 이면서 dsFlag.flag=0 → 로그인 실패 (서버 과부하 허위 오류 포함)
 *  - ErrorCode:int=-20001 + ErrorMsg → 수강신청 처리 오류
 *
 * TCP/HTTP 레벨:
 *  - TimedOut (0x274c) → 서버 연결 자체 불가 (과부하 시 발생)
 */

/**
 * 수강신청 본신청 에러 유형.
 * 패킷 분석에서 확인된 실제 서버 응답 패턴 기반.
 */
export enum CourseRegErrorType {
  /** ErrorCode=0, flag=0: 로그인 실패 (서버 과부하로 허위 발생 가능) */
  LOGIN_FAILED = "LOGIN_FAILED",
  /** ErrorCode=-20001: 학점 초과 ("총 신청 가능학점 초과이어서 신청할 수 없습니다") */
  CREDIT_LIMIT_EXCEEDED = "CREDIT_LIMIT_EXCEEDED",
  /** ErrorCode=-20001: 이미 신청한 과목 ("금학기에 이미 신청한 교과목입니다.") */
  ALREADY_REGISTERED = "ALREADY_REGISTERED",
  /** ErrorCode=-20001: 정원 초과 (ErrorMsg에서 패턴 확인 필요) */
  CAPACITY_EXCEEDED = "CAPACITY_EXCEEDED",
  /** ErrorCode=-20001: 시간표 충돌 */
  TIME_CONFLICT = "TIME_CONFLICT",
  /** ErrorCode=-20001: 수강신청 기간 아님 */
  NOT_IN_PERIOD = "NOT_IN_PERIOD",
  /** ErrorCode=-20001: 학과 제한 */
  DEPARTMENT_RESTRICTED = "DEPARTMENT_RESTRICTED",
  /** TCP 레벨: TimedOut (0x274c) — 서버 과부하 시 연결 자체 불가 */
  CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
  /** 네트워크: ECONNRESET */
  CONNECTION_RESET = "CONNECTION_RESET",
  /** 네트워크: ETIMEDOUT */
  REQUEST_TIMEOUT = "REQUEST_TIMEOUT",
  /** ErrorCode=-20001이지만 알 수 없는 ErrorMsg */
  UNKNOWN_SERVER_ERROR = "UNKNOWN_SERVER_ERROR",
  /** 분류 불가 */
  UNKNOWN = "UNKNOWN"
}

/**
 * SSV 응답 본문을 파싱하여 에러 유형을 분류한다.
 * ErrorCode=0이고 flag=0인 경우 LOGIN_FAILED를 반환한다.
 * @param {number} errorCode - SSV ErrorCode 값 (0 = 성공, 음수 = 오류)
 * @param {string} [errorMsg] - SSV ErrorMsg 값 (오류 시 한글 메시지)
 * @param {{ flag?: string }} [options] - 로그인 flag 등 부가 정보
 * @returns {CourseRegErrorType} 분류된 에러 유형
 */
export function classifyCourseRegError(
  errorCode: number,
  errorMsg?: string,
  options: { flag?: string } = {}
): CourseRegErrorType {
  // 로그인: HTTP/SSV ErrorCode=0 이어도 dsFlag.flag=0 이면 실패
  if (errorCode === 0) {
    if (options.flag === "0") return CourseRegErrorType.LOGIN_FAILED;
    return CourseRegErrorType.UNKNOWN; // 성공 경로는 호출 측에서 처리
  }

  const msg = errorMsg ?? "";
  if (msg.includes("학점 초과") || msg.includes("신청 가능학점 초과")) {
    return CourseRegErrorType.CREDIT_LIMIT_EXCEEDED;
  }
  if (msg.includes("이미 신청한 교과목") || msg.includes("이미 신청한")) {
    return CourseRegErrorType.ALREADY_REGISTERED;
  }
  if (msg.includes("정원") && (msg.includes("초과") || msg.includes("마감"))) {
    return CourseRegErrorType.CAPACITY_EXCEEDED;
  }
  if (
    (msg.includes("인원") && msg.includes("초과")) ||
    msg.includes("수강인원") ||
    msg.includes("신청인원")
  ) {
    return CourseRegErrorType.CAPACITY_EXCEEDED;
  }
  if (msg.includes("시간") && (msg.includes("중복") || msg.includes("겹") || msg.includes("충돌"))) {
    return CourseRegErrorType.TIME_CONFLICT;
  }
  if (msg.includes("기간") || msg.includes("신청 시간이 아닙니다") || msg.includes("신청기간")) {
    return CourseRegErrorType.NOT_IN_PERIOD;
  }
  if (msg.includes("학과") && (msg.includes("제한") || msg.includes("학생만"))) {
    return CourseRegErrorType.DEPARTMENT_RESTRICTED;
  }
  return CourseRegErrorType.UNKNOWN_SERVER_ERROR;
}

/**
 * 네트워크 오류 코드/메시지를 CourseRegErrorType 으로 분류한다.
 * @param {string} [code] - Node/axios 오류 코드
 * @param {string} [message] - 오류 메시지
 * @returns {CourseRegErrorType} 분류된 네트워크 에러 유형
 */
export function classifyCourseRegNetworkError(code?: string, message?: string): CourseRegErrorType {
  const c = String(code ?? "").toUpperCase();
  const m = String(message ?? "").toLowerCase();
  if (c === "ECONNRESET" || m.includes("econnreset") || m.includes("socket hang up")) {
    return CourseRegErrorType.CONNECTION_RESET;
  }
  if (
    c === "ETIMEDOUT" ||
    c === "ECONNABORTED" ||
    m.includes("timeout") ||
    m.includes("timedout")
  ) {
    return CourseRegErrorType.CONNECTION_TIMEOUT;
  }
  if (c === "EPIPE" || c === "ECONNREFUSED") {
    return CourseRegErrorType.CONNECTION_RESET;
  }
  return CourseRegErrorType.REQUEST_TIMEOUT;
}

/**
 * 에러 유형에 대한 사용자 친화적 한글 메시지를 반환한다.
 * @param {CourseRegErrorType} errorType - 분류된 에러 유형
 * @param {string} [serverMsg] - 서버 원본 ErrorMsg (있을 경우 우선 표시)
 * @returns {string} 한글 에러 메시지
 */
export function formatCourseRegError(errorType: CourseRegErrorType, serverMsg?: string): string {
  if (serverMsg) return serverMsg; // 서버 메시지 우선
  switch (errorType) {
    case CourseRegErrorType.LOGIN_FAILED:
      return "로그인에 실패하였습니다. 서버 과부하 시 올바른 비밀번호도 거부될 수 있으니 재시도하세요.";
    case CourseRegErrorType.CREDIT_LIMIT_EXCEEDED:
      return "신청 가능 학점을 초과하였습니다.";
    case CourseRegErrorType.ALREADY_REGISTERED:
      return "이미 신청한 교과목입니다.";
    case CourseRegErrorType.CAPACITY_EXCEEDED:
      return "수강 정원이 초과되었습니다.";
    case CourseRegErrorType.TIME_CONFLICT:
      return "시간표가 중복됩니다.";
    case CourseRegErrorType.NOT_IN_PERIOD:
      return "수강신청 기간이 아닙니다.";
    case CourseRegErrorType.DEPARTMENT_RESTRICTED:
      return "해당 학과 학생만 신청 가능한 과목입니다.";
    case CourseRegErrorType.CONNECTION_TIMEOUT:
      return "서버 연결 시간이 초과되었습니다. 수강신청 시간대 서버 과부하일 수 있습니다.";
    case CourseRegErrorType.CONNECTION_RESET:
      return "서버 연결이 끊어졌습니다.";
    case CourseRegErrorType.REQUEST_TIMEOUT:
      return "서버 응답 시간이 초과되었습니다.";
    default:
      return "알 수 없는 오류가 발생하였습니다.";
  }
}
