/**
 * 프로젝트 공통 유틸리티.
 *
 * e-campus / 희망바구니 / 본신청 / ERP 모듈이 서로를 직접 참조하지 않도록
 * 중복 헬퍼를 한곳에서 관리한다.
 */

/** 브라우저 요청에 가까운 기본 User-Agent */
export const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/**
 * AJAX/XHR 공통 헤더.
 * Origin·Referer·Content-Type 등 요청별 값은 호출부에서 추가한다.
 */
export const COMMON_AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache"
} as const;

/**
 * baseURL 끝 슬래시를 라이브러리 관례에 맞춘다.
 * @param baseUrl - 원본 URL
 * @returns 경로 끝 슬래시가 보장된 URL 문자열
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/?$/, "/");
  return url.toString();
}

/**
 * 정규식 특수문자를 이스케이프한다.
 * 사용자 입력·식별자를 RegExp 패턴에 넣을 때 사용한다.
 * @param value - 원본 문자열
 * @returns 정규식 리터럴로 안전하게 사용 가능한 문자열
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * unknown 에러에서 메시지 문자열을 안전하게 추출한다.
 * @param err - catch 절의 unknown 값
 * @returns 사람이 읽을 수 있는 메시지
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
