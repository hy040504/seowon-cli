// 커스텀 라이브러리
#include "http.h"
#include "../util.h"

#ifdef _WIN32
#ifdef __TINYC__
#include "winhttp_min.h"
// TCC + Windows 헤더가 기대하는 MSVC 내재 함수 스텁 (링커가 찾으므로 static 아님)
void __stosb(unsigned char *dest, unsigned char c, size_t count)
{
    while (count--) *dest++ = c;
}
#else
#include <winhttp.h>
#endif
#endif

#ifndef _WIN32
int sw_http_init(SwHttp *http, const char *base_url)
{
    (void)base_url;
    memset(http, 0, sizeof(*http));
    sw_str_copy(http->last_error, sizeof(http->last_error), "이 프로그램은 Windows 전용입니다.");
    return SW_ERR;
}
void sw_http_free(SwHttp *http) { (void)http; }
int sw_http_get(SwHttp *http, const char *path, const char *referer, int ajax, SwBuf *body, int *status)
{
    (void)path;
    (void)referer;
    (void)ajax;
    (void)body;
    (void)status;
    sw_str_copy(http->last_error, sizeof(http->last_error), "WinHTTP 없음");
    return SW_ERR_NET;
}
int sw_http_post(SwHttp *http, const char *path, const char *referer, const char *content_type,
                 const char *payload, size_t payload_n, int ajax, SwBuf *body, int *status)
{
    (void)path;
    (void)referer;
    (void)content_type;
    (void)payload;
    (void)payload_n;
    (void)ajax;
    (void)body;
    (void)status;
    return SW_ERR_NET;
}
#endif

// 쿠키 저장소 초기화
void sw_cookie_jar_init(SwCookieJar *jar)
{
    jar->items = NULL;
    jar->count = 0;
    jar->cap = 0;
}

// 쿠키 저장소 해제
void sw_cookie_jar_free(SwCookieJar *jar)
{
    free(jar->items);
    jar->items = NULL;
    jar->count = 0;
    jar->cap = 0;
}

// 쿠키 넣기 (같은 이름이 있으면 값만 바꾼다)
int sw_cookie_jar_set(SwCookieJar *jar, const char *name, const char *value, const char *domain)
{
    size_t i;                       // 쿠키 인덱스

    if (!name || !*name) return SW_ERR;

    // 이미 있으면 값만 갱신
    for (i = 0; i < jar->count; i++) {
        if (strcmp(jar->items[i].name, name) == 0) {
            sw_str_copy(jar->items[i].value, sizeof(jar->items[i].value), value ? value : "");
            if (domain && *domain) sw_str_copy(jar->items[i].domain, sizeof(jar->items[i].domain), domain);
            return SW_OK;
        }
    }

    // 없으면 자리를 늘려 추가
    if (jar->count == jar->cap) {
        jar->cap = jar->cap ? jar->cap * 2 : 8;
        jar->items = (SwCookie *)sw_xrealloc(jar->items, jar->cap * sizeof(SwCookie));
    }
    memset(&jar->items[jar->count], 0, sizeof(SwCookie));
    sw_str_copy(jar->items[jar->count].name, sizeof(jar->items[jar->count].name), name);
    sw_str_copy(jar->items[jar->count].value, sizeof(jar->items[jar->count].value), value ? value : "");
    sw_str_copy(jar->items[jar->count].domain, sizeof(jar->items[jar->count].domain),
                domain && *domain ? domain : SW_HOST);
    sw_str_copy(jar->items[jar->count].path, sizeof(jar->items[jar->count].path), "/");
    jar->count++;
    return SW_OK;
}

// 쓸 수 있는 쿠키 있는지
int sw_cookie_jar_usable(const SwCookieJar *jar)
{
    size_t i;                       // 쿠키 인덱스

    if (!jar) return 0;
    for (i = 0; i < jar->count; i++) {
        if (jar->items[i].name[0] && jar->items[i].value[0]) return 1;
    }
    return 0;
}

// Cookie 헤더 만들기 (name=value; name=value)
void sw_cookie_header(const SwCookieJar *jar, char *out, size_t outsz)
{
    size_t i;                       // 쿠키 인덱스
    size_t n = 0;                   // 지금까지 쓴 글자 수
    int w;                          // snprintf 가 쓴 길이

    if (!out || outsz == 0) return;
    out[0] = 0;
    for (i = 0; i < jar->count; i++) {
        if (!jar->items[i].name[0]) continue;
        w = snprintf(out + n, outsz - n, "%s%s=%s", n ? "; " : "", jar->items[i].name,
                     jar->items[i].value);
        if (w < 0 || (size_t)w >= outsz - n) break;
        n += (size_t)w;
    }
}

#ifdef _WIN32

// 이 파일 안에서만 쓰는 WinHTTP 도우미
static wchar_t *utf8_to_wide(const char *s);                        // UTF-8 → wchar
static void parse_set_cookie(SwHttp *http, const char *line);       // Set-Cookie 한 줄
static void collect_set_cookies(SwHttp *http, HINTERNET req);       // 응답 헤더에서 쿠키 모으기
static int parse_base(const char *base, char *host, size_t hostsz, int *port, int *https); // URL 분해
static int http_exchange(SwHttp *http, const wchar_t *method, const char *path, const char *referer,
                         const char *content_type, const char *payload, size_t payload_n, int ajax,
                         SwBuf *body, int *status);                 // 실제 패킷 전송

// UTF-8 문자열을 WinHTTP 가 쓰는 wchar 로 바꾼다
static wchar_t *utf8_to_wide(const char *s)
{
    int n;                          // wchar 개수 (널 포함)
    wchar_t *w;                     // 변환 결과

    if (!s) s = "";
    n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (n <= 0) return NULL;
    w = (wchar_t *)sw_xmalloc((size_t)n * sizeof(wchar_t));
    MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
    return w;
}

// Set-Cookie: name=value; Path=/ 에서 name=value 만 꺼낸다
static void parse_set_cookie(SwHttp *http, const char *line)
{
    char copy[SW_STR_COOKIE + 64];  // 헤더 한 줄 복사본
    char *semi;                     // 속성 앞 ';'
    char *eq;                       // name=value 의 '='
    char *name;                     // 쿠키 이름
    char *value;                    // 쿠키 값

    sw_str_copy(copy, sizeof(copy), line);
    semi = strchr(copy, ';');
    if (semi) *semi = 0;
    eq = strchr(copy, '=');
    if (!eq) return;
    *eq = 0;
    name = copy;
    value = eq + 1;
    sw_str_trim(name);
    sw_str_trim(value);
    sw_cookie_jar_set(&http->jar, name, value, http->host);
}

// 응답 헤더에서 Set-Cookie 줄을 모두 모아 jar 에 넣는다
static void collect_set_cookies(SwHttp *http, HINTERNET req)
{
    DWORD sz = 0;                   // 헤더 버퍼 크기
    wchar_t *wbuf;                  // WinHTTP 원본 헤더
    char *utf8;                     // UTF-8 로 바꾼 헤더
    char *p;                        // 한 줄씩 읽는 포인터
    WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, NULL, &sz,
                         WINHTTP_NO_HEADER_INDEX);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || sz == 0) return;
    wbuf = (wchar_t *)sw_xmalloc(sz + 2);
    if (!WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, wbuf, &sz,
                             WINHTTP_NO_HEADER_INDEX)) {
        free(wbuf);
        return;
    }
    utf8 = (char *)sw_xmalloc(sz + 2);
    WideCharToMultiByte(CP_UTF8, 0, wbuf, -1, utf8, (int)sz + 2, NULL, NULL);
    free(wbuf);
    p = utf8;
    while (p && *p) {
        char *nl = strstr(p, "\r\n"); // 다음 줄
        if (nl) *nl = 0;
        if (_strnicmp(p, "Set-Cookie:", 11) == 0) parse_set_cookie(http, p + 11);
        p = nl ? nl + 2 : NULL;
    }
    free(utf8);
}

// https://host:port/path 를 host / port / https 로 나눈다
static int parse_base(const char *base, char *host, size_t hostsz, int *port, int *https)
{
    const char *p = base ? base : SW_BASE_URL; // 주소 앞부분

    *https = 1;
    *port = 443;
    if (strncmp(p, "https://", 8) == 0) {
        p += 8;
        *https = 1;
        *port = 443;
    } else if (strncmp(p, "http://", 7) == 0) {
        p += 7;
        *https = 0;
        *port = 80;
    }
    sw_str_copy(host, hostsz, p);
    {
        char *slash = strchr(host, '/'); // 경로 시작
        char *colon;                    // 포트 앞 ':'
        if (slash) *slash = 0;
        colon = strchr(host, ':');
        if (colon) {
            *colon = 0;
            *port = atoi(colon + 1);
        }
    }
    return SW_OK;
}

int sw_http_init(SwHttp *http, const char *base_url)
{
    wchar_t *ua;                    // User-Agent (wchar)
    DWORD proto;                    // 허용 TLS 버전

    memset(http, 0, sizeof(*http));
    parse_base(base_url, http->host, sizeof(http->host), &http->port, &http->https);
    sw_cookie_jar_init(&http->jar);
    ua = utf8_to_wide(SW_USER_AGENT);
    http->session = WinHttpOpen(ua, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME,
                                WINHTTP_NO_PROXY_BYPASS, 0);
    free(ua);
    if (!http->session) {
        sw_str_copy(http->last_error, sizeof(http->last_error), "WinHTTP 세션을 열 수 없습니다.");
        return SW_ERR_NET;
    }
    proto = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_1 |
            WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
    WinHttpSetOption((HINTERNET)http->session, WINHTTP_OPTION_SECURE_PROTOCOLS, &proto, sizeof(proto));
    return SW_OK;
}

void sw_http_free(SwHttp *http)
{
    if (http->session) WinHttpCloseHandle((HINTERNET)http->session);
    http->session = NULL;
    sw_cookie_jar_free(&http->jar);
}

// GET/POST 한 번 보내고 본문·쿠키·상태 코드를 받는다
static int http_exchange(SwHttp *http, const wchar_t *method, const char *path, const char *referer,
                         const char *content_type, const char *payload, size_t payload_n, int ajax,
                         SwBuf *body, int *status)
{
    HINTERNET conn = NULL;          // 서버 연결
    HINTERNET req = NULL;           // 요청 핸들
    wchar_t *whost = NULL;          // 호스트 (wchar)
    wchar_t *wpath = NULL;          // 경로 (wchar)
    wchar_t *wref = NULL;           // Referer (wchar)
    wchar_t extra[2048];            // 추가 헤더
    char cookie[4096];              // Cookie 헤더 값
    char path_only[1024];           // 요청 경로
    DWORD flags = http->https ? WINHTTP_FLAG_SECURE : 0; // HTTPS 이면 보안 플래그
    DWORD code = 0;                 // HTTP 상태 코드
    DWORD clen = sizeof(code);      // 상태 코드 버퍼 크기
    int rc = SW_ERR_NET;            // 함수 결과

    sw_buf_init(body);
    if (status) *status = 0;
    sw_str_copy(path_only, sizeof(path_only), path ? path : "/");

    // 서버에 연결한 뒤 요청 핸들을 만든다
    whost = utf8_to_wide(http->host);
    wpath = utf8_to_wide(path_only);
    conn = WinHttpConnect((HINTERNET)http->session, whost, (INTERNET_PORT)http->port, 0);
    if (!conn) {
        sw_str_copy(http->last_error, sizeof(http->last_error), "서버에 연결하지 못했습니다.");
        goto done;
    }
    wref = referer ? utf8_to_wide(referer) : NULL;
    req = WinHttpOpenRequest(conn, method, wpath, NULL, wref ? wref : WINHTTP_NO_REFERER,
                             WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!req) {
        sw_str_copy(http->last_error, sizeof(http->last_error), "요청을 만들지 못했습니다.");
        goto done;
    }

    // 브라우저와 비슷한 헤더를 붙인다
    extra[0] = 0;
    wcscat(extra, L"Cache-Control: no-cache, no-store\r\nPragma: no-cache\r\n");
    if (ajax) wcscat(extra, L"X-Requested-With: XMLHttpRequest\r\n");
    if (content_type) {
        wchar_t *wct = utf8_to_wide(content_type);
        wcscat(extra, L"Content-Type: ");
        wcscat(extra, wct);
        wcscat(extra, L"\r\n");
        free(wct);
    }
    {
        char origin[256];
        wchar_t *wo;
        snprintf(origin, sizeof(origin), "Origin: %s://%s\r\n", http->https ? "https" : "http", http->host);
        wo = utf8_to_wide(origin);
        wcscat(extra, wo);
        free(wo);
    }
    sw_cookie_header(&http->jar, cookie, sizeof(cookie));
    if (cookie[0]) {
        wchar_t *wc = utf8_to_wide(cookie);
        wchar_t *wh = utf8_to_wide("Cookie");
        WinHttpAddRequestHeaders(req, L"Cookie: ", (ULONG)-1L, WINHTTP_ADDREQ_FLAG_ADD);
        /* Cookie 값은 헤더 한 줄로 붙인다. */
        {
            wchar_t line[4200];
            _snwprintf(line, 4199, L"Cookie: %s", wc);
            line[4199] = 0;
            WinHttpAddRequestHeaders(req, line, (ULONG)-1L, WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
        }
        free(wc);
        free(wh);
    }
    WinHttpAddRequestHeaders(req, extra, (ULONG)-1L, WINHTTP_ADDREQ_FLAG_ADD);

    // 패킷을 보내고 응답을 받은 뒤 쿠키와 본문을 읽는다
    if (!WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                            (LPVOID)(payload ? payload : WINHTTP_NO_REQUEST_DATA),
                            (DWORD)payload_n, (DWORD)payload_n, 0)) {
        sw_str_copy(http->last_error, sizeof(http->last_error), "요청 전송에 실패했습니다.");
        goto done;
    }
    if (!WinHttpReceiveResponse(req, NULL)) {
        sw_str_copy(http->last_error, sizeof(http->last_error), "응답을 받지 못했습니다.");
        goto done;
    }
    collect_set_cookies(http, req);
    if (WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &code,
                            &clen, WINHTTP_NO_HEADER_INDEX) &&
        status) {
        *status = (int)code;
    }
    for (;;) {
        DWORD avail = 0, got = 0;
        char chunk[4096];
        if (!WinHttpQueryDataAvailable(req, &avail)) break;
        if (avail == 0) break;
        if (avail > sizeof(chunk)) avail = sizeof(chunk);
        if (!WinHttpReadData(req, chunk, avail, &got) || got == 0) break;
        sw_buf_append(body, chunk, got);
    }
    rc = SW_OK;
done:
    if (req) WinHttpCloseHandle(req);
    if (conn) WinHttpCloseHandle(conn);
    free(whost);
    free(wpath);
    free(wref);
    return rc;
}

int sw_http_get(SwHttp *http, const char *path, const char *referer, int ajax, SwBuf *body, int *status)
{
    return http_exchange(http, L"GET", path, referer, NULL, NULL, 0, ajax, body, status);
}

int sw_http_post(SwHttp *http, const char *path, const char *referer, const char *content_type,
                 const char *payload, size_t payload_n, int ajax, SwBuf *body, int *status)
{
    return http_exchange(http, L"POST", path, referer,
                         content_type ? content_type : "application/x-www-form-urlencoded; charset=UTF-8",
                         payload, payload_n, ajax, body, status);
}

#endif
