/**
 * 프로젝트 공통 유틸리티.
 *
 * e-campus / 희망바구니 / HTTP 모듈이 서로를 직접 참조하지 않도록
 * 중복 헬퍼를 한곳에서 관리한다.
 */
import os from "node:os";

/**
 * unknown 에러에서 메시지 문자열을 안전하게 추출한다.
 * @param err - catch 절의 unknown 값
 * @returns 사람이 읽을 수 있는 메시지
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Promise 에 시간 제한을 건다.
 * @param promise - 대기할 작업
 * @param ms - 제한 밀리초
 * @param label - 초과 시 메시지에 붙일 이름
 * @returns 원본 결과 또는 시간 초과 거부
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간이 초과되었습니다.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 배열을 동시에 최대 n개만 돌린다.
 * 학교 서버 부하를 막기 위해 조회 병렬도를 제한할 때 사용한다.
 * @param items - 처리할 항목
 * @param limit - 동시 실행 수
 * @param fn - 항목 처리 함수
 * @returns 원래 순서의 결과 배열
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) continue;
      out[i] = await fn(item, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * SVG/HTML 텍스트에 넣을 문자열을 이스케이프한다.
 * @param value - 원문
 * @returns 이스케이프된 문자열
 */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 기기의 비루프백 IPv4 주소를 모은다. 시작 로그용.
 * @returns IPv4 주소 목록
 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === "IPv4" && !it.internal) out.push(it.address);
    }
  }
  return out;
}

/**
 * HTML 태그를 걷어 낸 평문을 만든다.
 * @param html - 원본 HTML
 * @returns 공백이 정리된 텍스트
 */
export function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
