import axios, { AxiosError, CanceledError, type AxiosInstance } from "axios";

const SCHOOL_ORIGINS = [
  "https://ecampus.seowon.ac.kr",
  "https://info.seowon.ac.kr",
  "https://sugangh.seowon.ac.kr"
] as const;
export const ELEARNING_MEDIA_ORIGINS = [
  "https://ecampus.seowon.ac.kr",
  "https://eplus.seowon.ac.kr"
] as const;

class HttpSecurityError extends Error {
  readonly code = "ERR_UNSAFE_URL";
  constructor() {
    super("허용되지 않은 HTTPS 요청 또는 리다이렉트 주소입니다.");
    this.name = "HttpSecurityError";
  }
}

/** URL에 포함된 토큰이나 사용자 정보를 오류 메시지에 넣지 않는다. */
export function assertApprovedUrl(
  value: string,
  baseUrl: string,
  allowedOrigins: readonly string[]
): URL {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new HttpSecurityError();
  }
  if (
    url.protocol !== "https:" ||
    !allowedOrigins.includes(url.origin) ||
    url.username ||
    url.password
  ) {
    throw new HttpSecurityError();
  }
  return url;
}

/** 학교의 다른 하위 도메인도 인증 쿠키를 받을 수 없도록 동일 출처만 허용한다. */
export function assertSchoolUrl(value: string, baseUrl: string): URL {
  const base = assertApprovedUrl(baseUrl, baseUrl, SCHOOL_ORIGINS);
  return assertApprovedUrl(value, base.toString(), [base.origin]);
}

/** 클라이언트 종류마다 명시된 서비스 출처만 기본 URL로 사용할 수 있다. */
export function assertClientBaseUrl(baseUrl: string, serviceOrigin: string): void {
  assertApprovedUrl(baseUrl, serviceOrigin, [new URL(serviceOrigin).origin]);
}

const SAFE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ERR_NETWORK",
  "ERR_BAD_RESPONSE",
  "ERR_BAD_REQUEST",
  "ERR_CANCELED",
  "ERR_FR_TOO_MANY_REDIRECTS",
  "ERR_FR_REDIRECTION_FAILURE",
  "ERR_INVALID_URL",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
]);

/** Axios의 config/request/response/cause에는 계정 정보가 있으므로 안전한 메타데이터만 복사한다. */
export function sanitizeHttpError(error: unknown): Error {
  if (error instanceof HttpSecurityError) return error;
  const original = error as {
    code?: unknown;
    response?: { status?: unknown };
    status?: unknown;
  } | null;
  const code =
    typeof original?.code === "string" && SAFE_ERROR_CODES.has(original.code)
      ? original.code
      : undefined;
  const candidate = original?.response?.status ?? original?.status;
  const status =
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= 100 &&
    candidate <= 599
      ? candidate
      : undefined;
  if (code === "ERR_CANCELED") return new CanceledError("HTTP 요청이 취소되었습니다.");
  const safe = new AxiosError(
    status ? `HTTP 요청에 실패했습니다 (상태 ${status}).` : "HTTP 요청에 실패했습니다.",
    code
  );
  if (status !== undefined) {
    safe.status = status;
    // 기존 response.status를 사용하는 세션 검사와 호출부와의 호환성을 유지한다.
    safe.response = { status, statusText: "", data: undefined, headers: {}, config: undefined! };
  }
  return safe;
}

/** 최초 요청과 모든 리다이렉트에 HTTPS 및 동일 출처 정책을 적용한다. */
export function protectHttpClient(
  http: AxiosInstance,
  baseUrl: string,
  allowedOrigins: readonly string[] = [new URL(baseUrl).origin]
): void {
  assertApprovedUrl(baseUrl, baseUrl, allowedOrigins);
  // 단위 테스트용 함수 객체는 네트워크를 전송하지 않는다. 실제 Axios 주입에는 항상 적용된다.
  if (!http.interceptors?.request || !http.interceptors?.response) return;
  http.interceptors.request.use((config) => {
    const base = assertApprovedUrl(config.baseURL ?? baseUrl, baseUrl, allowedOrigins);
    const target = assertApprovedUrl(config.url ?? "", base.toString(), allowedOrigins);
    config.baseURL = base.toString();
    config.url = target.toString();
    config.allowAbsoluteUrls = true;
    config.maxRedirects =
      typeof config.maxRedirects === "number" && Number.isInteger(config.maxRedirects)
        ? Math.max(0, Math.min(5, config.maxRedirects))
        : 5;
    // HTML·JSON·첨부를 메모리로 받는 요청과 업로드 크기를 제한한다. 스트림 영상은 별도 저장기가 처리한다.
    const responseLimit = 64 * 1024 * 1024;
    const requestLimit = 128 * 1024 * 1024;
    config.maxContentLength =
      typeof config.maxContentLength === "number" && Number.isFinite(config.maxContentLength) && config.maxContentLength >= 0
        ? Math.min(config.maxContentLength, responseLimit)
        : responseLimit;
    config.maxBodyLength =
      typeof config.maxBodyLength === "number" && Number.isFinite(config.maxBodyLength) && config.maxBodyLength >= 0
        ? Math.min(config.maxBodyLength, requestLimit)
        : requestLimit;
    // Node HTTP 어댑터만 리다이렉트 훅을 실행한다. 주입한 함수 어댑터는 호출자가 신뢰하는 코드다.
    if (typeof config.adapter !== "function") config.adapter = "http";
    // 로컬 소켓과 환경변수 프록시로 요청 경계를 우회하지 못하게 한다.
    if (config.socketPath) throw new HttpSecurityError();
    config.proxy = false;
    config.beforeRedirect = (options) => {
      const destination = assertApprovedUrl(
        typeof options.href === "string"
          ? options.href
          : `${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path ?? "/"}`,
        target.toString(),
        allowedOrigins
      );
      if (options.protocol || options.hostname) {
        const transportDestination = assertApprovedUrl(
          `${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ""}/`,
          target.toString(),
          allowedOrigins
        );
        if (transportDestination.origin !== destination.origin) throw new HttpSecurityError();
      }
      // 307/308 요청 본문, 쿠키, Referer가 다른 허용 출처에도 재전송되지 않도록 제한한다.
      if (destination.origin !== target.origin || options.auth) throw new HttpSecurityError();
    };
    return config;
  });
  http.interceptors.response.use(undefined, (error: unknown) =>
    Promise.reject(sanitizeHttpError(error))
  );
}

/** 전달받은 인증 Axios의 어댑터/제한 시간만 사용하고 쿠키·헤더·인증·인터셉터는 공유하지 않는다. */
export function createIsolatedMediaHttp(source: AxiosInstance): AxiosInstance {
  const media = axios.create();
  // axios.create()도 전역 기본값을 상속한다. 소비 애플리케이션의 전역 인증 설정까지 제외한다.
  // Axios 호출 함수는 기존 defaults 객체를 참조하므로 객체를 교체하지 않고 내용을 갱신한다.
  const safeDefaults = {
    adapter: source.defaults?.adapter ?? "http",
    timeout: source.defaults?.timeout ?? 30_000,
    withCredentials: false,
    proxy: false,
    transformRequest: [],
    transformResponse: [],
    validateStatus: (status: number) => status >= 200 && status < 300,
    headers: {
      common: { Accept: "text/html,video/mp4,*/*;q=0.8" },
      get: {},
      head: {},
      post: {},
      put: {},
      delete: {},
      patch: {}
    }
  };
  for (const key of Object.keys(media.defaults)) {
    delete (media.defaults as Record<string, unknown>)[key];
  }
  Object.assign(media.defaults, safeDefaults);
  protectHttpClient(media, ELEARNING_MEDIA_ORIGINS[0], ELEARNING_MEDIA_ORIGINS);
  return media;
}

/** 로그인 화면이 정상 데이터로 파싱되는 것을 막는다. 원문에는 개인정보가 있어 오류에 싣지 않는다. */
export function assertNotLoginPage(body: unknown): void {
  if (typeof body !== "string") return;
  if (
    /<input\b[^>]*type\s*=\s*["']?password\b/i.test(body) ||
    /(?:location(?:\.href)?\s*=|location\.replace\()\s*["'][^"']*\/login\b/i.test(body)
  ) {
    throw new Error("인증 세션이 만료되었습니다. 다시 로그인하세요.");
  }
}

/** HTML 오류 페이지나 깨진 응답을 정상적인 빈 SSV로 해석하지 않는다. */
export function requireSsv(body: string): string {
  if (!body.startsWith("SSV:")) throw new Error("학교 서버가 SSV 형식이 아닌 응답을 반환했습니다.");
  return body;
}
/** 서버가 만료를 알리면 다음 호출에서 인증을 다시 준비한다. 변경 요청을 자동 재전송하지 않는다. */
export function observeSessionExpiration(
  http: AxiosInstance,
  active: () => boolean,
  invalidate: () => void
): void {
  if (!http.interceptors?.response) return;
  http.interceptors.response.use(
    (response) => {
      if (response.status === 401 || response.status === 403) {
        invalidate();
        throw new Error("인증 세션이 만료되었습니다.");
      }
      if (active()) {
        try {
          assertNotLoginPage(response.data);
        } catch (error) {
          invalidate();
          throw error;
        }
      }
      return response;
    },
    (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) invalidate();
      return Promise.reject(error);
    }
  );
}
