import { CookieJar, type SerializedCookieJar } from "tough-cookie";

/**
 * 세션 유지 여부를 판단하기 위해 유효한(만료되지 않은) 쿠키가 존재하는지 검사한다.
 * @param {SerializedCookieJar | undefined} serialized - 직렬화된 데이터
 * @param {number} [now=Date.now()] - 기준 시각
 * @returns {boolean} 즉시 사용 가능한 유효 쿠키 존재 여부
 */
export function isSerializedCookieJarUsable(
  serialized: SerializedCookieJar | undefined,
  now: number = Date.now()
): boolean {
  if (!serialized?.cookies?.length) return false;

  return serialized.cookies.some((cookie) => {
    const expires = cookie.expires;
    // 세션 쿠키(null/Infinity)이거나 아직 기한이 남은 영구 쿠키인지 확인
    if (typeof expires !== "string" || expires === "Infinity") return true;
    const expiresAt = Date.parse(expires);
    return !Number.isNaN(expiresAt) && expiresAt > now;
  });
}

/**
 * 현재 활성화된 세션 저장소 내에 유효한 쿠키가 있는지 확인한다.
 * 학교 쿠키는 프로세스 메모리의 CookieJar 에만 둔다. 디스크에는 쓰지 않는다.
 * @param {CookieJar} cookieJar - 검사 대상
 * @param {number} [now=Date.now()] - 기준 시각
 * @returns {boolean} 유효 세션 유지 여부
 */
export function isCookieJarUsable(cookieJar: CookieJar, now: number = Date.now()): boolean {
  return isSerializedCookieJarUsable(cookieJar.serializeSync(), now);
}
