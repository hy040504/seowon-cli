/**
 * 텍스트 내의 불필요한 연속 공백을 단일 공백으로 치환한다.
 * 데이터 파싱 시 HTML 태그 사이의 줄바꿈이나 탭을 제거하여 문자열 비교의 정확도를 높이기 위해 사용한다.
 * @param {string} value - 공백을 정리할 원본 문자열
 * @returns {string} 연속 공백이 제거되고 앞뒤 트림 처리가 완료된 문자열
 */
export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 상대 경로를 포함한 경로 문자열을 절대 URL로 변환한다.
 * @param {string} pathOrUrl - 변환할 경로 또는 URL
 * @param {string} baseUrl - 기준이 되는 도메인 및 경로
 * @returns {string} 브라우저에서 바로 사용 가능한 절대 URL 문자열
 */
export function absoluteUrl(pathOrUrl: string, baseUrl: string): string {
  return new URL(pathOrUrl, baseUrl).toString();
}

/**
 * HTTP 응답/요청 전체 메시지에서 헤더와 본문을 분리한다.
 * 프록시 로그나 SAZ 파일에서 추출된 원시 HTTP 데이터를 처리하기 위해 사용한다.
 * @param {string} message - 파싱할 HTTP 전문
 * @returns {[string, string]} [헤더 섹션, 본문 섹션] 튜플
 */
export function splitHttpMessage(message: string): [string, string] {
  // RFC 표준에 따른 2연속 개행(CRLF)을 기준으로 분리 시도
  const crlfIndex = message.indexOf("\r\n\r\n");
  if (crlfIndex >= 0) {
    return [message.slice(0, crlfIndex), message.slice(crlfIndex + 4)];
  }

  // CRLF가 없는 환경(유닉스 스타일 등)을 고려한 LF 기준 분리
  const lfIndex = message.indexOf("\n\n");
  if (lfIndex >= 0) {
    return [message.slice(0, lfIndex), message.slice(lfIndex + 2)];
  }

  return [message, ""];
}

/**
 * application/x-www-form-urlencoded 형식의 문자열을 객체 형태로 변환한다.
 * @param {string} body - 폼 본문 문자열
 * @returns {Record<string, string>} 키-값 쌍으로 구성된 데이터 객체
 */
export function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body.trim());
  const result: Record<string, string> = {};

  for (const [key, value] of params) {
    result[key] = value;
  }

  return result;
}

/**
 * JavaScript 함수 호출 구문(String) 내부의 인자값들을 추출한다.
 * HTML 내 onclick 핸들러 등에서 식별자(ID)를 뽑아내기 위해 정규식을 사용한다.
 * @param {string} source - 예: "javascript:openWindow('ARG1', 'ARG2')"
 * @returns {string[]} 추출된 인자값 배열
 */
export function parseFunctionArguments(source: string): string[] {
  const match = source.match(/\((.*)\)/);
  if (!match?.[1]) {
    return [];
  }

  const args: string[] = [];
  // 따옴표 종류에 상관없이 값을 캡처하되, 쉼표와 공백을 기준으로 구분
  const regex = /'([^']*)'|"([^"]*)"|([^,\s)]+)/g;
  let arg: RegExpExecArray | null;

  while ((arg = regex.exec(match[1]))) {
    args.push(arg[1] ?? arg[2] ?? arg[3] ?? "");
  }

  return args;
}

/** @see {@link escapeRegExp} — 공통 구현은 lib/back/engine/utils.ts */
export { escapeRegExp } from "../utils.js";
