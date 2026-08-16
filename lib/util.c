// 커스텀 라이브러리
#include "util.h"

// 기본 라이브러리
#include <ctype.h>
#include <stdarg.h>
#include <sys/stat.h>

#ifdef _WIN32
#include <conio.h>
#include <direct.h>
#include <io.h>
#define sw_mkdir(p) _mkdir(p)
#else
#include <unistd.h>
#define sw_mkdir(p) mkdir((p), 0755)
#endif

// 이 파일 안에서만 쓰는 도우미
static int is_voidish_tag(const char *name);                        // 줄바꿈 태그인지
static int parse_one_date(const char *s, const char **end, int end_of_day, time_t *out); // 날짜 하나
#ifdef _WIN32
static void paint_password_line(const char *prompt, const char *pw, size_t n, int reveal_last,
                                size_t *vis_cols);                  // 비밀번호 줄 다시 그리기
#endif

// 메모리 할당
void *sw_xmalloc(size_t n)
{
    void *p = calloc(1, n ? n : 1); // 0으로 채운 새 블록
    if (!p) {
        fprintf(stderr, "메모리 부족 (%zu bytes)\n", n);
        exit(1);
    }
    return p;
}

// 메모리 재할당
void *sw_xrealloc(void *p, size_t n)
{
    void *q = realloc(p, n ? n : 1);
    if (!q) {
        fprintf(stderr, "메모리 부족 (realloc %zu)\n", n);
        exit(1);
    }
    return q;
}

// 문자열 복사본
char *sw_strdup(const char *s)
{
    size_t n;                       // 널 포함 길이
    char *d;                        // 복사본
    if (!s) s = "";
    n = strlen(s) + 1;
    d = (char *)sw_xmalloc(n);
    memcpy(d, s, n);
    return d;
}

// 안전 문자열 복사
void sw_str_copy(char *dst, size_t dstsz, const char *src)
{
    size_t n;                       // 복사할 글자 수
    if (!dst || dstsz == 0) return;
    if (!src) src = "";
    n = strlen(src);
    if (n >= dstsz) n = dstsz - 1;
    memcpy(dst, src, n);
    dst[n] = 0;
}

// 앞뒤 공백 제거
void sw_str_trim(char *s)
{
    char *a;                        // 앞쪽 공백을 지난 위치
    char *b;                        // 뒤쪽 공백 앞
    if (!s) return;
    a = s;
    while (*a && isspace((unsigned char)*a)) a++;
    if (a != s) memmove(s, a, strlen(a) + 1);
    b = s + strlen(s);
    while (b > s && isspace((unsigned char)b[-1])) b--;
    *b = 0;
}

// 연속 공백을 하나로
void sw_normalize_space(char *s)
{
    char *r;                        // 읽기 위치
    char *w;                        // 쓰기 위치
    int sp;                         // 직전이 공백이었는지
    if (!s) return;
    r = s;
    w = s;
    sp = 1;
    while (*r) {
        if (isspace((unsigned char)*r)) {
            if (!sp) {
                *w++ = ' ';
                sp = 1;
            }
        } else {
            *w++ = *r;
            sp = 0;
        }
        r++;
    }
    if (w > s && w[-1] == ' ') w--;
    *w = 0;
}

// 대소문자 무시 비교
int sw_str_ieq(const char *a, const char *b)
{
    if (!a || !b) return a == b;
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
        a++;
        b++;
    }
    return *a == *b;
}

// 부분 문자열 포함 여부
int sw_str_contains(const char *hay, const char *needle)
{
    if (!hay || !needle || !*needle) return 0;
    return strstr(hay, needle) != NULL;
}

// 버퍼 초기화
void sw_buf_init(SwBuf *b)
{
    b->p = NULL;
    b->n = 0;
    b->cap = 0;
}

// 버퍼 해제
void sw_buf_free(SwBuf *b)
{
    free(b->p);
    b->p = NULL;
    b->n = 0;
    b->cap = 0;
}

// 버퍼 비우기
void sw_buf_clear(SwBuf *b)
{
    if (b->p) b->p[0] = 0;
    b->n = 0;
}

// 버퍼 용량 확보
int sw_buf_reserve(SwBuf *b, size_t need)
{
    size_t cap;                     // 새 용량
    if (need <= b->cap) return SW_OK;
    cap = b->cap ? b->cap : 256;
    while (cap < need) cap *= 2;
    b->p = (char *)sw_xrealloc(b->p, cap);
    b->cap = cap;
    return SW_OK;
}

// 버퍼에 문자열 추가
int sw_buf_append(SwBuf *b, const char *s, size_t n)
{
    if (!s) return SW_OK;
    if (sw_buf_reserve(b, b->n + n + 1) != SW_OK) return SW_ERR;
    memcpy(b->p + b->n, s, n);
    b->n += n;
    b->p[b->n] = 0;
    return SW_OK;
}

// 버퍼에 서식 출력
int sw_buf_printf(SwBuf *b, const char *fmt, ...)
{
    va_list ap;                     // 가변 인자
    int need;                       // 필요한 글자 수
    char tmp[1024];                 // 짧은 문자열용 임시 버퍼
    va_start(ap, fmt);
    need = vsnprintf(tmp, sizeof(tmp), fmt, ap);
    va_end(ap);
    if (need < 0) return SW_ERR;
    if ((size_t)need < sizeof(tmp)) return sw_buf_append(b, tmp, (size_t)need);
    if (sw_buf_reserve(b, b->n + (size_t)need + 1) != SW_OK) return SW_ERR;
    va_start(ap, fmt);
    vsnprintf(b->p + b->n, b->cap - b->n, fmt, ap);
    va_end(ap);
    b->n += (size_t)need;
    return SW_OK;
}

// HTML 엔티티 복원
void sw_decode_entities(char *s)
{
    char *r;                        // 읽기 위치
    char *w;                        // 쓰기 위치
    if (!s) return;
    r = s;
    w = s;
    while (*r) {
        if (*r == '&') {
            if (strncmp(r, "&amp;", 5) == 0) {
                *w++ = '&';
                r += 5;
                continue;
            }
            if (strncmp(r, "&lt;", 4) == 0) {
                *w++ = '<';
                r += 4;
                continue;
            }
            if (strncmp(r, "&gt;", 4) == 0) {
                *w++ = '>';
                r += 4;
                continue;
            }
            if (strncmp(r, "&quot;", 6) == 0) {
                *w++ = '"';
                r += 6;
                continue;
            }
            if (strncmp(r, "&nbsp;", 6) == 0) {
                *w++ = ' ';
                r += 6;
                continue;
            }
            if (r[1] == '#' && isdigit((unsigned char)r[2])) {
                int code = 0;
                char *p = r + 2;
                while (isdigit((unsigned char)*p)) {
                    code = code * 10 + (*p - '0');
                    p++;
                }
                if (*p == ';') {
                    if (code > 0 && code < 128) *w++ = (char)code;
                    else *w++ = '?';
                    r = p + 1;
                    continue;
                }
            }
        }
        *w++ = *r++;
    }
    *w = 0;
}

// br/p/div 처럼 텍스트에서 줄바꿈으로 바꿀 태그
static int is_voidish_tag(const char *name)
{
    return sw_str_ieq(name, "br") || sw_str_ieq(name, "hr") || sw_str_ieq(name, "p") ||
           sw_str_ieq(name, "div") || sw_str_ieq(name, "li") || sw_str_ieq(name, "tr") ||
           sw_str_ieq(name, "h1") || sw_str_ieq(name, "h2") || sw_str_ieq(name, "h3");
}

// HTML을 일반 텍스트로
char *sw_html_to_text(const char *html)
{
    SwBuf b;                        // 결과 텍스트
    const char *p;                  // HTML 읽는 위치
    int skip = 0;                   // script/style 안이면 1
    if (!html) return sw_strdup("");
    sw_buf_init(&b);
    p = html;

    // 태그는 버리고, script/style 안은 건너뛰고, br/p 는 줄바꿈으로 바꾼다
    while (*p) {
        if (*p == '<') {
            const char *gt = strchr(p, '>'); // 태그 끝
            char name[32];                  // 태그 이름
            size_t i = 0;                   // 이름 길이
            const char *q = p + 1;          // 이름 시작
            if (!gt) break;
            if (*q == '/') q++;
            while (q < gt && i + 1 < sizeof(name) && (isalnum((unsigned char)*q) || *q == '-')) {
                name[i++] = (char)tolower((unsigned char)*q);
                q++;
            }
            name[i] = 0;
            if (strcmp(name, "script") == 0 || strcmp(name, "style") == 0 ||
                strcmp(name, "noscript") == 0) {
                const char *end;
                if (p[1] == '/') {
                    skip = 0;
                } else {
                    skip = 1;
                    if (strcmp(name, "script") == 0) end = strstr(gt, "</script");
                    else if (strcmp(name, "style") == 0) end = strstr(gt, "</style");
                    else end = strstr(gt, "</noscript");
                    if (end) {
                        p = strchr(end, '>');
                        if (p) {
                            p++;
                            skip = 0;
                            continue;
                        }
                    }
                }
            }
            if (!skip && is_voidish_tag(name)) sw_buf_append(&b, "\n", 1);
            p = gt + 1;
            continue;
        }
        if (!skip) sw_buf_append(&b, p, 1);
        p++;
    }
    if (b.p) {
        sw_decode_entities(b.p);
        sw_normalize_space(b.p);
    }
    if (!b.p) return sw_strdup("");
    return b.p;
}

// URL 인코딩
int sw_url_encode(const char *in, char *out, size_t outsz)
{
    static const char *hex = "0123456789ABCDEF"; // %HH 용
    size_t o = 0;                   // 출력 위치
    const unsigned char *p;         // 입력 위치
    if (!in || !out || outsz == 0) return SW_ERR;
    p = (const unsigned char *)in;
    while (*p) {
        unsigned char c = *p++;
        int keep = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                   c == '-' || c == '_' || c == '.' || c == '!' || c == '~' || c == '*' ||
                   c == '\'' || c == '(' || c == ')';
        if (keep) {
            if (o + 1 >= outsz) return SW_ERR;
            out[o++] = (char)c;
        } else {
            if (o + 3 >= outsz) return SW_ERR;
            out[o++] = '%';
            out[o++] = hex[c >> 4];
            out[o++] = hex[c & 15];
        }
    }
    out[o] = 0;
    return SW_OK;
}

// form 필드 추가
int sw_form_add(SwBuf *body, const char *key, const char *value)
{
    char ek[256];                   // 인코딩한 키
    char ev[2048];                  // 인코딩한 값
    if (sw_url_encode(key, ek, sizeof(ek)) != SW_OK) return SW_ERR;
    if (sw_url_encode(value ? value : "", ev, sizeof(ev)) != SW_OK) return SW_ERR;
    if (body->n > 0) sw_buf_append(body, "&", 1);
    sw_buf_append(body, ek, strlen(ek));
    sw_buf_append(body, "=", 1);
    sw_buf_append(body, ev, strlen(ev));
    return SW_OK;
}

// 파일 읽기 (RETURN: SW_OK)
int sw_read_file(const char *path, SwBuf *out)
{
    FILE *fp;                       // 파일 핸들
    char chunk[4096];               // 한 번에 읽는 덩어리
    size_t n;                       // 이번에 읽은 바이트
    sw_buf_init(out);
    fp = fopen(path, "rb");
    if (!fp) return SW_ERR_IO;
    while ((n = fread(chunk, 1, sizeof(chunk), fp)) > 0) {
        sw_buf_append(out, chunk, n);
    }
    fclose(fp);
    return SW_OK;
}

// 파일 쓰기 (RETURN: SW_OK)
int sw_write_file(const char *path, const char *data, size_t n)
{
    FILE *fp = fopen(path, "wb");
    if (!fp) return SW_ERR_IO;
    if (n && fwrite(data, 1, n, fp) != n) {
        fclose(fp);
        return SW_ERR_IO;
    }
    fclose(fp);
    return SW_OK;
}

// 폴더 만들기
int sw_mkdir_p(const char *path)
{
    char tmp[SW_STR_PATH];          // 경로 복사본
    char *p;                        // 구분자를 따라가는 포인터
    sw_str_copy(tmp, sizeof(tmp), path);
    for (p = tmp; *p; p++) {
        if (*p == '/' || *p == '\\') {
            char c = *p;
            if (p == tmp || (p == tmp + 2 && tmp[1] == ':')) continue;
            *p = 0;
            if (tmp[0]) sw_mkdir(tmp);
            *p = c;
        }
    }
    if (tmp[0]) sw_mkdir(tmp);
    return SW_OK;
}

// 경로 합치기
int sw_path_join(char *out, size_t outsz, const char *a, const char *b)
{
    size_t n;                       // 앞쪽 경로 길이
    if (!a || !*a) {
        sw_str_copy(out, outsz, b);
        return SW_OK;
    }
    sw_str_copy(out, outsz, a);
    n = strlen(out);
    if (n && out[n - 1] != '/' && out[n - 1] != '\\') {
        if (n + 1 < outsz) {
            out[n++] = '/';
            out[n] = 0;
        }
    }
    sw_str_copy(out + n, outsz - n, b);
    return SW_OK;
}

// 현재 시각 ISO 문자열
void sw_now_iso(char *out, size_t outsz)
{
    time_t t = time(NULL);          // 지금
    struct tm tmv;                  // 로컬 시각
#ifdef _WIN32
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    snprintf(out, outsz, "%04d-%02d-%02dT%02d:%02d:%02d", tmv.tm_year + 1900, tmv.tm_mon + 1,
             tmv.tm_mday, tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
}

// 로컬 시각 만들기
time_t sw_local_ymdhms(int y, int mo, int d, int h, int mi, int s)
{
    struct tm tmv;                  // 로컬 시각 조각
    memset(&tmv, 0, sizeof(tmv));
    tmv.tm_year = y - 1900;
    tmv.tm_mon = mo - 1;
    tmv.tm_mday = d;
    tmv.tm_hour = h;
    tmv.tm_min = mi;
    tmv.tm_sec = s;
    tmv.tm_isdst = -1;
    return mktime(&tmv);
}

// 날짜 하나 파싱
// "2026.08.10 23:59" 한 개를 time_t 로 바꾼다
static int parse_one_date(const char *s, const char **end, int end_of_day, time_t *out)
{
    int y = 0, mo = 0, d = 0;       // 년·월·일
    int h = -1, mi = 0;             // 시·분 (없으면 하루 시작/끝)
    const char *p = s;              // 숫자 찾는 위치
    while (*p && !(*p == '2' && p[1] == '0')) p++;
    if (strncmp(p, "20", 2) != 0) return 0;
    if (sscanf(p, "%d", &y) != 1 || y < 2000 || y > 2100) return 0;
    p += 4;
    while (*p && !isdigit((unsigned char)*p)) p++;
    if (sscanf(p, "%d", &mo) != 1 || mo < 1 || mo > 12) return 0;
    while (isdigit((unsigned char)*p)) p++;
    while (*p && !isdigit((unsigned char)*p)) p++;
    if (sscanf(p, "%d", &d) != 1 || d < 1 || d > 31) return 0;
    while (isdigit((unsigned char)*p)) p++;
    while (*p && !isdigit((unsigned char)*p) && *p != ' ' && *p != '\t' && *p != '~') p++;
    while (*p == ' ' || *p == '\t') p++;
    if (isdigit((unsigned char)*p)) {
        int hh = 0, mm = 0;
        if (sscanf(p, "%d:%d", &hh, &mm) == 2) {
            h = hh;
            mi = mm;
            while (isdigit((unsigned char)*p)) p++;
            if (*p == ':') p++;
            while (isdigit((unsigned char)*p)) p++;
        }
    }
    if (h < 0) {
        h = end_of_day ? 23 : 0;
        mi = end_of_day ? 59 : 0;
    }
    *out = sw_local_ymdhms(y, mo, d, h, mi, end_of_day ? 59 : 0);
    if (end) *end = p;
    return *out != (time_t)-1;
}

// 기간 문자열 파싱
int sw_period_range(const char *period, time_t *start, time_t *end)
{
    const char *p;                  // 원문 읽는 위치
    char cleaned[256];              // 요일 괄호를 뺀 문자열
    int i = 0;                      // cleaned 길이
    int skip = 0;                   // 괄호 안이면 1
    time_t a, b;                    // 시작·끝
    if (!period || !start || !end) return 0;
    /* 괄호 안 요일 표시는 날짜 파싱을 방해하므로 제거한다. */
    for (p = period; *p && i + 1 < (int)sizeof(cleaned); p++) {
        if (*p == '(') skip = 1;
        if (!skip) cleaned[i++] = *p;
        if (*p == ')') skip = 0;
    }
    cleaned[i] = 0;

    // 앞 날짜는 하루 시작, 뒤 날짜는 하루 끝
    if (!parse_one_date(cleaned, &p, 0, &a)) return 0;
    if (!parse_one_date(p, NULL, 1, &b)) return 0;
    *start = a;
    *end = b;
    return 1;
}

// 기간 안인지 확인
int sw_period_active(const char *period, time_t now)
{
    time_t a, b;                    // 기간 시작·끝
    if (!sw_period_range(period, &a, &b)) return 0;
    return a <= now && now <= b;
}

// UTF-8 콘솔 설정
void sw_enable_console(void)
{
#ifdef _WIN32
    HANDLE h;                       // 콘솔 핸들
    DWORD mode;                     // 콘솔 모드
    SetConsoleOutputCP(65001);
    SetConsoleCP(65001);
    h = GetStdHandle(STD_OUTPUT_HANDLE);
    if (h != INVALID_HANDLE_VALUE && GetConsoleMode(h, &mode)) {
        mode |= 0x0004; /* ENABLE_VIRTUAL_TERMINAL_PROCESSING */
        SetConsoleMode(h, mode);
    }
#endif
    setvbuf(stdout, NULL, _IONBF, 0);
}

// 한 줄 입력
int sw_read_line(const char *prompt, char *out, size_t outsz)
{
    if (prompt) fputs(prompt, stdout);
    fflush(stdout);
    if (!fgets(out, (int)outsz, stdin)) {
        if (outsz) out[0] = 0;
        return SW_ERR;
    }
    sw_str_trim(out);
    return SW_OK;
}

#ifdef _WIN32
// 비밀번호 줄 다시 그리기 (reveal_last 이면 마지막 한 글자만 평문)
static void paint_password_line(const char *prompt, const char *pw, size_t n, int reveal_last,
                                size_t *vis_cols)
{
    size_t i;                       // 글자 인덱스
    size_t cols;                    // 이번에 그린 칸 수
    fputc('\r', stdout);
    if (prompt) fputs(prompt, stdout);
    for (i = 0; i < n; i++) {
        unsigned char c = (unsigned char)pw[i];
        if (reveal_last && i + 1 == n && c >= 32 && c < 127)
            fputc(c, stdout);
        else
            fputc('*', stdout);
    }
    cols = (prompt ? strlen(prompt) : 0) + n;
    if (*vis_cols > cols) {
        size_t extra = *vis_cols - cols;
        for (i = 0; i < extra; i++) fputc(' ', stdout);
        for (i = 0; i < extra; i++) fputc('\b', stdout);
    }
    *vis_cols = cols;
    fflush(stdout);
}
#endif

// 비밀번호 입력 (마지막 글자만 잠깐 보임)
int sw_read_password(const char *prompt, char *out, size_t outsz)
{
#ifdef _WIN32
    size_t n = 0;                   // 지금까지 친 글자 수
    size_t vis = prompt ? strlen(prompt) : 0; // 화면에 그린 칸 수
    int ch;                         // _getch 한 글자
    if (!out || outsz == 0) return SW_ERR;
    if (prompt) fputs(prompt, stdout);
    fflush(stdout);
    while ((ch = _getch()) != '\r' && ch != '\n') {
        if (ch == 3) {
            out[0] = 0;
            fputc('\n', stdout);
            return SW_ERR;
        }
        if (ch == 8 || ch == 127) {
            if (n > 0) n--;
            paint_password_line(prompt, out, n, 0, &vis);
            continue;
        }
        if (ch == 0 || ch == 224) {
            (void)_getch();
            continue;
        }
        if (ch < 32) continue;
        if (n + 1 < outsz) {
            out[n++] = (char)ch;
            /* 직전 글자는 * 로 덮고, 방금 친 한 글자만 잠깐 보여 준다. */
            paint_password_line(prompt, out, n, 1, &vis);
        }
    }
    out[n] = 0;
    /* Enter 후에는 마지막 글자도 * 로 가린 뒤 줄을 바꾼다. */
    paint_password_line(prompt, out, n, 0, &vis);
    fputc('\n', stdout);
    return SW_OK;
#else
    return sw_read_line(prompt, out, outsz);
#endif
}

// Enter 대기
void sw_pause(void)
{
    char buf[16];                   // Enter 를 삼키는 버퍼
    fputs("\nEnter 키를 누르면 메뉴로 돌아갑니다. ", stdout);
    fflush(stdout);
    if (!fgets(buf, sizeof(buf), stdin)) {
        /* ignore */
    }
}

// 로그인 화면인지 확인
int sw_looks_like_login_html(const char *html)
{
    char low[4096];                 // 소문자로 바꾼 앞부분
    size_t n;                       // 복사 길이
    size_t i;                       // 글자 인덱스
    if (!html) return 1;
    n = strlen(html);
    if (n > sizeof(low) - 1) n = sizeof(low) - 1;
    for (i = 0; i < n; i++) low[i] = (char)tolower((unsigned char)html[i]);
    low[n] = 0;
    return sw_str_contains(low, "encryptdata") || sw_str_contains(low, "userhome") ||
           sw_str_contains(low, "popup/login");
}

// testdata 폴더 찾기
void sw_find_testdata(const char *exe_dir, char *out, size_t outsz)
{
    const char *cands[] = {"db/testdata", "./db/testdata", "testdata", "./testdata", NULL}; // 후보 경로
    char try_path[SW_STR_PATH];     // exe 옆 db/testdata
    size_t i;                       // 후보 인덱스
    if (exe_dir && *exe_dir) {
        sw_path_join(try_path, sizeof(try_path), exe_dir, "db/testdata");
#ifdef _WIN32
        if (GetFileAttributesA(try_path) != INVALID_FILE_ATTRIBUTES) {
            sw_str_copy(out, outsz, try_path);
            return;
        }
#else
        {
            struct stat st;
            if (stat(try_path, &st) == 0) {
                sw_str_copy(out, outsz, try_path);
                return;
            }
        }
#endif
    }
    for (i = 0; cands[i]; i++) {
#ifdef _WIN32
        if (GetFileAttributesA(cands[i]) != INVALID_FILE_ATTRIBUTES) {
            sw_str_copy(out, outsz, cands[i]);
            return;
        }
#else
        struct stat st;
        if (stat(cands[i], &st) == 0) {
            sw_str_copy(out, outsz, cands[i]);
            return;
        }
#endif
    }
    sw_str_copy(out, outsz, "testdata");
}

// 밀리초 대기 (Windows Sleep / POSIX usleep)
void sw_sleep_ms(int ms)
{
    if (ms <= 0) return;
#ifdef _WIN32
    Sleep((DWORD)ms);
#else
    usleep((useconds_t)ms * 1000);
#endif
}

// 터미널 텍스트 전부 삭제
void sw_term_clear(void)
{
    sw_gotoxy(1, 1);
    printf("\033[2J\033[H");
    fflush(stdout);
}

// x: 가로, y: 세로
void sw_gotoxy(int x, int y)
{
    if (x < 1) x = 1;
    if (y < 1) y = 1;
    printf("\033[%d;%df", y, x);
    fflush(stdout);
}

// 글자가 집합 문자열에 있는지
int sw_char_in(char value, const char *set)
{
    if (!set || value == 0) return 0; // '\0' 은 집합 끝이므로 제외
    return strchr(set, value) != NULL;
}

// 로딩 이펙트 (SeowonProject LoadSpin)
void sw_load_spin(int total_speed, const char *plus_text)
{
    int download_speed = 10;        // 한 프레임당 진행량
    int total_time;                 // 프레임 수
    int i;                          // 프레임 인덱스
    int current_size;               // 지금까지 진행량
    float ratio;                    // 0~1 비율
    float percent;                  // 퍼센트
    const char *cursor = "|/-\\";   // 스피너 글자

    if (total_speed <= 0) total_speed = 10;
    if (!plus_text) plus_text = "";
    total_time = total_speed / download_speed + 1;

    for (i = 0; i < total_time; i++) {
        current_size = i * download_speed;
        ratio = (float)current_size / (float)total_speed;
        if (ratio > 1.0f) ratio = 1.0f;
        percent = ratio * 100.0f;
        printf("\r%s[%.1f%%] Loading... %c", plus_text, percent, cursor[i % 4]);
        fflush(stdout);
        sw_sleep_ms(100);
    }
    printf("\r%s[100.0%%] Loading... *\n", plus_text);
    fflush(stdout);
}

// 실제 진행률이 있을 때 쓰는 스피너 (과제 n과목 중 i번째)
void sw_load_spin_step(int current, int total, const char *plus_text)
{
    const char *cursor = "|/-\\";   // 스피너 글자
    float percent;                  // 퍼센트
    int frame;                      // 스피너 프레임

    if (!plus_text) plus_text = "";
    if (total <= 0) total = 1;
    if (current < 0) current = 0;
    if (current > total) current = total;
    percent = (100.0f * (float)current) / (float)total;
    frame = current % 4;
    printf("\r%s[%.1f%%] Loading... %c                    ", plus_text, percent, cursor[frame]);
    fflush(stdout);
}

// 스피너 한 줄을 지운다
void sw_load_spin_done(void)
{
    printf("\r                                                                  \r");
    fflush(stdout);
}

// 텍스트 사라짐 효과 (종료 화면)
void sw_disappear_text(const char *text)
{
    int text_length;                // 텍스트 길이
    int i;                          // 깜빡임 횟수
    int j;                          // 글자 인덱스
    int color_code;                 // 30=검정, 37=흰색

    if (!text) text = "";
    text_length = (int)strlen(text);

    for (i = 0; i < 2; i++) {
        color_code = (i % 2) ? 30 : 37;
        printf("\033[%dm", color_code);
        for (j = 0; j < text_length; j++) {
            printf("%c", text[j]);
            fflush(stdout);
            sw_sleep_ms(100);
        }
        printf("\033[0m");
        printf("\r");
        sw_sleep_ms(500);
    }
    printf("\n");
}
