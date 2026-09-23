/**
 * ERP Vue/포털 JSON 요청 생성과 응답 읽기 헬퍼.
 * Nexacro SSV 코덱(lib/back/engine/hope-basket/ssv.ts)과 별개다.
 */

import { absoluteUrl } from "../ecampus/utils.js";
import { ERP_BASE_URL } from "./constants.js";
import type { ErpGetRequest, ErpJsonPostRequest } from "./types/portal.js";

/**
 * JSON POST 요청을 만든다
 * @param {string} path - API 경로
 * @param {unknown} payload - JSON 본문
 * @param {Record<string, string>} [query={}] - menuId/pgmId 등
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpJsonPostRequest} JSON POST 요청
 */
export function createErpJsonPost(
  path: string,
  payload: unknown,
  query: Record<string, string> = {},
  baseUrl = ERP_BASE_URL
): ErpJsonPostRequest {
  const url = new URL(absoluteUrl(path, baseUrl));
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }

  return {
    method: "POST",
    url: url.toString(),
    query,
    body: payload === undefined || payload === "" ? "" : JSON.stringify(payload),
    contentType: "application/json",
    accept: "application/json, text/plain, */*"
  };
}

/**
 * GET 요청을 만든다
 * @param {string} path - 경로
 * @param {Record<string, string>} [query] - 쿼리
 * @param {string} [baseUrl=ERP_BASE_URL] - ERP 기본 URL
 * @returns {ErpGetRequest} GET 요청
 */
export function createErpGet(
  path: string,
  query?: Record<string, string>,
  baseUrl = ERP_BASE_URL
): ErpGetRequest {
  const url = new URL(absoluteUrl(path, baseUrl));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return { method: "GET", url: url.toString(), query };
}

/**
 * JSON 본문을 파싱한다. 실패 시 undefined
 * @param {string} body - 응답 본문
 * @returns {unknown} 파싱 결과
 */
export function parseJsonBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * JSON 객체에서 데이터셋 배열을 읽는다
 * @param {string} body - 응답 본문
 * @param {string} key - 데이터셋 키
 * @returns {Record<string, unknown>[]} 행 배열
 */
export function readJsonDataset(body: string, key: string): Record<string, unknown>[] {
  const parsed = parseJsonBody(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const value = (parsed as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)
  );
}

/**
 * JSON 루트가 배열이면 그대로, 객체면 key 데이터셋을 읽는다
 * @param {string} body - 응답 본문
 * @param {string} [key] - 객체일 때 데이터셋 키
 * @returns {Record<string, unknown>[]} 행 배열
 */
export function readJsonRows(body: string, key?: string): Record<string, unknown>[] {
  const parsed = parseJsonBody(body);
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === "object" && !Array.isArray(row)
    );
  }
  if (key) return readJsonDataset(body, key);
  return [];
}

/**
 * 행에서 문자열 셀을 읽는다
 * @param {Record<string, unknown>} row - JSON 행
 * @param {string} key - 필드명
 * @returns {string} 문자열. null/undefined 는 빈 문자열
 */
export function cellString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * 행에서 숫자 셀을 읽는다
 * @param {Record<string, unknown>} row - JSON 행
 * @param {string} key - 필드명
 * @returns {number | null} 유한 숫자 또는 null
 */
export function cellNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 알 수 없는 값을 레코드로 좁힌다
 * @param {unknown} value - JSON 값
 * @returns {Record<string, unknown> | undefined} 객체이면 레코드
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
