// 커스텀 라이브러리
#include "parse.h"
#include "../util.h"

// 기본 라이브러리
#include <ctype.h>

#ifndef CJSON_HIDE_SYMBOLS
#define CJSON_HIDE_SYMBOLS
#endif
#include "cJSON.h"

// 이 파일 안에서만 쓰는 파서 도우미
static const char *json_str(cJSON *o, const char *key);             // JSON 문자열 키
static int extract_quoted(const char *s, char *out, size_t outsz, const char **next); // 따옴표 안 글자
static void copy_inner_tag(const char *html, const char *tag, char *out, size_t outsz); // 태그 안 텍스트
static void extract_labeled(const char *text, const char *label, char *out, size_t outsz); // 라벨 뒤 값
static void extract_status(const char *text, char *out, size_t outsz); // 과제 상태 글자
static void find_week_for(const char *html, const char *schedule_id, char *week, size_t weeksz); // 주차
static int walk_prgr(cJSON *n, int *percent);                       // 학습률 필드 찾기

// 과목 목록 해제
void sw_free_courses(SwCourseData *list, size_t n)
{
    size_t i;                       // 과목 인덱스
    if (!list) return;
    for (i = 0; i < n; i++) {
        free(list[i].assignments);
        free(list[i].lessons);
    }
    free(list);
}

// 과제 추가
void sw_course_add_assignment(SwCourseData *c, const SwAssignment *a)
{
    if (c->n_asg == c->cap_asg) {
        c->cap_asg = c->cap_asg ? c->cap_asg * 2 : 8;
        c->assignments = (SwAssignment *)sw_xrealloc(c->assignments, c->cap_asg * sizeof(SwAssignment));
    }
    c->assignments[c->n_asg++] = *a;
}

// 차시 추가
void sw_course_add_lesson(SwCourseData *c, const SwLesson *l)
{
    if (c->n_les == c->cap_les) {
        c->cap_les = c->cap_les ? c->cap_les * 2 : 8;
        c->lessons = (SwLesson *)sw_xrealloc(c->lessons, c->cap_les * sizeof(SwLesson));
    }
    c->lessons[c->n_les++] = *l;
}

// JSON 객체에서 문자열 키를 읽는다
static const char *json_str(cJSON *o, const char *key)
{
    cJSON *it = cJSON_GetObjectItemCaseSensitive(o, key); // 키에 해당하는 값

    if (cJSON_IsString(it) && it->valuestring) return it->valuestring;
    return NULL;
}

// 로그인 JSON 파싱 (RETURN: SW_OK)
int sw_parse_login_json(const char *json, SwLoginResult *out)
{
    cJSON *root;                    // 전체 JSON
    const char *redir;              // redirectUrl
    const char *otp;                // otpLogin
    const char *otp_user;           // otpUserYn
    const char *otp_type;           // otpUserType
    const char *uid;                // userId
    const char *uno;                // userNo
    const char *msg;                // message

    memset(out, 0, sizeof(*out));
    out->type = 0;
    sw_str_copy(out->message, sizeof(out->message), "아이디 또는 비밀번호가 맞지 않습니다.");
    if (!json || !*json) return SW_ERR_PARSE;
    root = cJSON_Parse(json);
    if (!root) return SW_ERR_PARSE;

    // 성공이면 redirectUrl 이 있고, 실패면 비어 있다
    redir = json_str(root, "redirectUrl");
    uid = json_str(root, "userId");
    uno = json_str(root, "userNo");
    msg = json_str(root, "message");
    if (uid) sw_str_copy(out->user_id, sizeof(out->user_id), uid);
    if (uno) sw_str_copy(out->user_no, sizeof(out->user_no), uno);
    if (msg) sw_str_copy(out->message, sizeof(out->message), msg);
    if (!redir || !*redir) {
        out->type = 0;
        cJSON_Delete(root);
        return SW_OK;
    }
    sw_str_copy(out->redirect, sizeof(out->redirect), redir);

    // OTP 대상이면 이 프로그램은 더 진행하지 않는다
    otp = json_str(root, "otpLogin");
    otp_user = json_str(root, "otpUserYn");
    otp_type = json_str(root, "otpUserType");
    if (otp && otp_user && otp[0] == 'Y' && otp_user[0] == 'Y' && otp_type &&
        sw_str_contains(otp_type, "LEARNER") && out->user_id[0] && out->user_no[0]) {
        out->type = 2;
        snprintf(out->message, sizeof(out->message),
                 "OTP 로그인이 필요합니다. 이 프로그램은 OTP를 지원하지 않습니다.");
        cJSON_Delete(root);
        return SW_OK;
    }
    out->type = 1;
    sw_str_copy(out->message, sizeof(out->message), "로그인 성공");
    cJSON_Delete(root);
    return SW_OK;
}

// HTML/JS 에서 '값' 또는 "값" 을 꺼낸다
static int extract_quoted(const char *s, char *out, size_t outsz, const char **next)
{
    const char *p = s;              // 현재 위치
    char q;                         // 여는 따옴표
    size_t n = 0;                   // 복사한 글자 수
    while (*p && *p != '\'' && *p != '"') p++;
    if (!*p) return 0;
    q = *p++;
    while (*p && *p != q && n + 1 < outsz) out[n++] = *p++;
    out[n] = 0;
    if (*p == q) p++;
    if (next) *next = p;
    return n > 0;
}

// <tag>안쪽</tag> 텍스트를 꺼낸다
static void copy_inner_tag(const char *html, const char *tag, char *out, size_t outsz)
{
    char open[32];                  // "<tag"
    const char *a;                  // 태그 시작
    const char *b;                  // 닫는 태그
    snprintf(open, sizeof(open), "<%s", tag);
    a = strstr(html, open);
    if (!a) {
        out[0] = 0;
        return;
    }
    a = strchr(a, '>');
    if (!a) {
        out[0] = 0;
        return;
    }
    a++;
    b = strstr(a, "</");
    if (!b) b = a + strlen(a);
    if ((size_t)(b - a) >= outsz) {
        memcpy(out, a, outsz - 1);
        out[outsz - 1] = 0;
    } else {
        memcpy(out, a, (size_t)(b - a));
        out[b - a] = 0;
    }
    sw_decode_entities(out);
    sw_normalize_space(out);
}

// 과목 HTML 파싱 (RETURN: SW_OK)
int sw_parse_courses_html(const char *html, SwCourseData **out_list, size_t *out_n)
{
    const char *p;                  // classRoomMain 검색 위치
    SwCourseData *list = NULL;      // 모은 과목
    size_t n = 0;                   // 과목 개수
    size_t cap = 0;                 // 배열 용량
    *out_list = NULL;
    *out_n = 0;
    if (!html) return SW_ERR_PARSE;
    p = html;
    while ((p = strstr(p, "classRoomMain")) != NULL) {
        const char *q = p + 13;     // 함수 인자 시작
        char cd[SW_STR_ID];         // 강의실 코드
        char ty[SW_STR_TINY];       // 과목 유형
        char title[SW_STR_TITLE];   // 과목명
        char label[SW_STR_TINY];    // 비교과 등 라벨
        SwCourseData item;          // 한 과목
        const char *win_end;        // 잘라 볼 HTML 끝
        char window[1024];          // 한 칸 HTML
        size_t wlen;                // window 길이
        if (!extract_quoted(q, cd, sizeof(cd), &q)) {
            p += 13;
            continue;
        }
        if (!extract_quoted(q, ty, sizeof(ty), &q)) {
            p += 13;
            continue;
        }
        win_end = q + 800;
        if (win_end > html + strlen(html)) win_end = html + strlen(html);
        wlen = (size_t)(win_end - p);
        if (wlen >= sizeof(window)) wlen = sizeof(window) - 1;
        memcpy(window, p, wlen);
        window[wlen] = 0;
        copy_inner_tag(window, "span", title, sizeof(title));
        copy_inner_tag(window, "label", label, sizeof(label));
        if (!title[0] || !cd[0]) {
            p += 13;
            continue;
        }
        memset(&item, 0, sizeof(item));
        sw_str_copy(item.course.title, sizeof(item.course.title), title);
        sw_str_copy(item.course.crs_cre_cd, sizeof(item.course.crs_cre_cd), cd);
        sw_str_copy(item.course.crs_type_cd, sizeof(item.course.crs_type_cd), ty);
        sw_str_copy(item.course.label, sizeof(item.course.label), label);
        if (strcmp(ty, "CO") == 0 || sw_str_contains(label, "비교과"))
            sw_str_copy(item.course.category, sizeof(item.course.category), "extracurricular");
        else
            sw_str_copy(item.course.category, sizeof(item.course.category), "curricular");
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            list = (SwCourseData *)sw_xrealloc(list, cap * sizeof(SwCourseData));
        }
        list[n++] = item;
        p = q;
    }
    if (n == 0 && sw_looks_like_login_html(html)) return SW_ERR_SESSION;
    *out_list = list;
    *out_n = n;
    return SW_OK;
}

// "제출기간 2026.08.10 ~ ..." 처럼 라벨 뒤 값을 잘라 낸다
static void extract_labeled(const char *text, const char *label, char *out, size_t outsz)
{
    const char *p = strstr(text, label); // 라벨 위치
    const char *stops[] = {"제출기간", "기간 외 학습기간", "기간", "출결상태", "강의시간",
                           "수업내용", "과제를 제출", "미제출", "종료", "진행중", NULL}; // 여기서 끊는다
    size_t i;                       // stop 단어 인덱스
    size_t n;                       // 복사할 길이
    const char *end;                // 값의 끝
    out[0] = 0;
    if (!p) return;
    p += strlen(label);
    while (*p == ' ' || *p == '\t' || *p == ':' || *p == '\n') p++;
    end = p + strlen(p);
    for (i = 0; stops[i]; i++) {
        const char *s;
        if (strcmp(stops[i], label) == 0) continue;
        s = strstr(p, stops[i]);
        if (s && s < end) end = s;
    }
    n = (size_t)(end - p);
    while (n && (p[n - 1] == ' ' || p[n - 1] == '\t')) n--;
    if (n >= outsz) n = outsz - 1;
    memcpy(out, p, n);
    out[n] = 0;
    sw_normalize_space(out);
}

static void extract_status(const char *text, char *out, size_t outsz)
{
    if (sw_str_contains(text, "과제를 제출하였습니다"))
        sw_str_copy(out, outsz, "과제를 제출하였습니다");
    else if (sw_str_contains(text, "미제출"))
        sw_str_copy(out, outsz, "미제출");
    else if (sw_str_contains(text, "진행중"))
        sw_str_copy(out, outsz, "진행중");
    else if (sw_str_contains(text, "종료"))
        sw_str_copy(out, outsz, "종료");
    else
        out[0] = 0;
}

// 과제 HTML 파싱 (RETURN: SW_OK)
int sw_parse_assignments_html(const char *html, const char *crs_cre_cd, SwAssignment **out, size_t *out_n)
{
    const char *p;                  // asmntView 검색 위치
    SwAssignment *list = NULL;      // 모은 과제
    size_t n = 0;                   // 과제 개수
    size_t cap = 0;                 // 배열 용량
    *out = NULL;
    *out_n = 0;
    if (!html) return SW_ERR_PARSE;
    p = html;
    while ((p = strstr(p, "asmntView")) != NULL) {
        const char *q = p + 9;      // 과제 코드 인자
        char id[SW_STR_ID];         // 과제 코드
        char title[SW_STR_TITLE];   // 과제 제목
        char period[SW_STR_PERIOD]; // 제출 기간
        char status[SW_STR_STATUS]; // 제출 상태
        char *text;                 // HTML 을 푼 텍스트
        char window[2048];          // 한 칸 HTML
        const char *start;          // window 시작
        const char *end;            // window 끝
        size_t wlen;                // window 길이
        SwAssignment a;             // 한 과제
        if (!extract_quoted(q, id, sizeof(id), &q)) {
            p += 9;
            continue;
        }
        start = p - 200;
        if (start < html) start = html;
        end = q + 600;
        if (end > html + strlen(html)) end = html + strlen(html);
        wlen = (size_t)(end - start);
        if (wlen >= sizeof(window)) wlen = sizeof(window) - 1;
        memcpy(window, start, wlen);
        window[wlen] = 0;
        copy_inner_tag(window, "a", title, sizeof(title));
        if (!title[0]) {
            /* href 뒤 텍스트 */
            const char *gt = strchr(window, '>');
            if (gt) copy_inner_tag(gt - 2 < window ? window : gt - 2, "a", title, sizeof(title));
        }
        text = sw_html_to_text(window);
        extract_labeled(text, "제출기간", period, sizeof(period));
        extract_status(text, status, sizeof(status));
        free(text);
        if (!id[0] || !title[0]) {
            p = q;
            continue;
        }
        memset(&a, 0, sizeof(a));
        sw_str_copy(a.id, sizeof(a.id), id);
        sw_str_copy(a.title, sizeof(a.title), title);
        sw_str_copy(a.period, sizeof(a.period), period);
        sw_str_copy(a.status, sizeof(a.status), status);
        sw_str_copy(a.crs_cre_cd, sizeof(a.crs_cre_cd), crs_cre_cd ? crs_cre_cd : "");
        sw_mark_assignment_flags(&a, time(NULL));
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            list = (SwAssignment *)sw_xrealloc(list, cap * sizeof(SwAssignment));
        }
        list[n++] = a;
        p = q;
    }
    *out = list;
    *out_n = n;
    return SW_OK;
}

// 차시 일정 ID 근처에서 "n주차" 를 찾는다
static void find_week_for(const char *html, const char *schedule_id, char *week, size_t weeksz)
{
    char key[SW_STR_ID + 16];       // dropdown_LESN_... 또는 id="..."
    const char *p;                  // 검색 위치
    week[0] = 0;
    if (!schedule_id || !*schedule_id) return;
    snprintf(key, sizeof(key), "dropdown_%s", schedule_id);
    p = strstr(html, key);
    if (!p) {
        snprintf(key, sizeof(key), "id=\"%s\"", schedule_id);
        p = strstr(html, key);
    }
    if (!p) return;
    {
        char window[800];
        size_t n = 800;
        if (p + n > html + strlen(html)) n = (size_t)(html + strlen(html) - p);
        memcpy(window, p, n);
        window[n] = 0;
        copy_inner_tag(window, "section", week, weeksz);
        if (!week[0]) {
            char *t = sw_html_to_text(window);
            if (strstr(t, "주차")) {
                const char *w = strstr(t, "주차");
                const char *s = w;
                while (s > t && (isdigit((unsigned char)s[-1]) || s[-1] == ' ')) s--;
                snprintf(week, weeksz, "%.*s주차", (int)(w - s), s);
                sw_normalize_space(week);
            }
            free(t);
        }
    }
}

// 차시 HTML 파싱 (RETURN: SW_OK)
int sw_parse_lessons_html(const char *html, const char *crs_cre_cd, SwLesson **out, size_t *out_n)
{
    const char *p;                  // CNTS_ 검색 위치
    SwLesson *list = NULL;          // 모은 차시
    size_t n = 0;                   // 차시 개수
    size_t cap = 0;                 // 배열 용량
    *out = NULL;
    *out_n = 0;
    if (!html) return SW_ERR_PARSE;
    p = html;
    while ((p = strstr(p, "CNTS_")) != NULL) {
        const char *q;              // ID 복사 위치
        char cnts[SW_STR_ID];       // 콘텐츠 ID
        char lesn[SW_STR_ID];       // 일정 ID
        char title[SW_STR_TITLE];   // 차시 제목
        char period[SW_STR_PERIOD]; // 학습 기간
        char att[SW_STR_STATUS];    // 출결 상태
        char week[SW_STR_TITLE];    // n주차
        char window[2500];          // 한 칸 HTML
        const char *start;          // window 시작
        const char *end;            // window 끝
        size_t wlen;                // window 길이
        char *text;                 // HTML 을 푼 텍스트
        SwLesson l;                 // 한 차시
        q = p;
        /* ID 자체 복사 */
        {
            size_t i = 0;
            while (q[i] && (isalnum((unsigned char)q[i]) || q[i] == '_') && i + 1 < sizeof(cnts)) {
                cnts[i] = q[i];
                i++;
            }
            cnts[i] = 0;
        }
        lesn[0] = 0;
        start = p - 400;
        if (start < html) start = html;
        {
            const char *ls = start;
            const char *found = NULL;
            while (ls < p && (ls = strstr(ls, "LESN_")) != NULL && ls < p) {
                found = ls;
                ls += 5;
            }
            if (found) {
                size_t i = 0;
                while (found[i] && (isalnum((unsigned char)found[i]) || found[i] == '_') &&
                       i + 1 < sizeof(lesn)) {
                    lesn[i] = found[i];
                    i++;
                }
                lesn[i] = 0;
            }
        }
        end = p + 700;
        if (end > html + strlen(html)) end = html + strlen(html);
        wlen = (size_t)(end - start);
        if (wlen >= sizeof(window)) wlen = sizeof(window) - 1;
        memcpy(window, start, wlen);
        window[wlen] = 0;
        copy_inner_tag(window, "a", title, sizeof(title));
        text = sw_html_to_text(window);
        extract_labeled(text, "기간 외 학습기간", period, sizeof(period));
        if (!period[0]) extract_labeled(text, "기간", period, sizeof(period));
        extract_labeled(text, "출결상태", att, sizeof(att));
        free(text);
        find_week_for(html, lesn, week, sizeof(week));
        if (!title[0] || !cnts[0]) {
            p += 5;
            continue;
        }
        /* 같은 차시 중복 제거 */
        {
            size_t i;
            int dup = 0;
            for (i = 0; i < n; i++) {
                if (strcmp(list[i].lesson_cnts_id, cnts) == 0) {
                    dup = 1;
                    break;
                }
            }
            if (dup) {
                p += 5;
                continue;
            }
        }
        memset(&l, 0, sizeof(l));
        sw_str_copy(l.lesson_cnts_id, sizeof(l.lesson_cnts_id), cnts);
        sw_str_copy(l.lesson_schedule_id, sizeof(l.lesson_schedule_id), lesn);
        sw_str_copy(l.title, sizeof(l.title), title);
        sw_str_copy(l.period, sizeof(l.period), period);
        sw_str_copy(l.attendance, sizeof(l.attendance), att);
        sw_str_copy(l.week, sizeof(l.week), week);
        sw_str_copy(l.crs_cre_cd, sizeof(l.crs_cre_cd), crs_cre_cd ? crs_cre_cd : "");
        l.progress_percent = -1;
        sw_mark_lesson_flags(&l, time(NULL));
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            list = (SwLesson *)sw_xrealloc(list, cap * sizeof(SwLesson));
        }
        list[n++] = l;
        p += 5;
    }
    *out = list;
    *out_n = n;
    return SW_OK;
}

// 과제 상세 파싱 (RETURN: SW_OK)
int sw_parse_assignment_detail(const char *html, char *out, size_t outsz)
{
    const char *p;                  // "과제내용" 위치
    const char *end;                // 본문 끝
    char *text;                     // HTML 을 푼 텍스트
    if (!out || outsz == 0) return SW_ERR;
    out[0] = 0;
    if (!html) return SW_ERR_PARSE;
    p = strstr(html, "과제내용");
    if (!p) {
        text = sw_html_to_text(html);
        sw_str_copy(out, outsz, text);
        free(text);
        return out[0] ? SW_OK : SW_ERR_PARSE;
    }
    end = strstr(p + 8, "label-title");
    if (!end) end = p + 4000;
    if (end > html + strlen(html)) end = html + strlen(html);
    {
        size_t n = (size_t)(end - p);
        char *chunk = (char *)sw_xmalloc(n + 1);
        memcpy(chunk, p, n);
        chunk[n] = 0;
        text = sw_html_to_text(chunk);
        free(chunk);
        sw_str_copy(out, outsz, text);
        free(text);
    }
    return SW_OK;
}

// JSON 트리를 돌며 prgrRatio / progressPercent 를 찾는다
static int walk_prgr(cJSON *n, int *percent)
{
    if (!n) return 0;
    if (n->string && (strcmp(n->string, "prgrRatio") == 0 || strcmp(n->string, "progressPercent") == 0)) {
        if (cJSON_IsNumber(n)) {
            *percent = (int)n->valuedouble;
            return 1;
        }
        if (cJSON_IsString(n) && n->valuestring) {
            *percent = atoi(n->valuestring);
            return 1;
        }
    }
    if (walk_prgr(n->child, percent)) return 1;
    return walk_prgr(n->next, percent);
}

// 학습률 JSON 파싱 (RETURN: SW_OK)
int sw_parse_progress_json(const char *json, int *percent)
{
    cJSON *root;                    // 전체 JSON
    const char *p;                  // 문자열 백업 검색
    *percent = -1;
    if (!json) return SW_ERR_PARSE;
    root = cJSON_Parse(json);
    if (root) {
        if (walk_prgr(root, percent)) {
            cJSON_Delete(root);
            return SW_OK;
        }
        cJSON_Delete(root);
    }
    p = strstr(json, "prgrRatio");
    if (p) {
        p = strchr(p, ':');
        if (p) {
            while (*p && (*p == ':' || *p == ' ' || *p == '"')) p++;
            *percent = atoi(p);
            return SW_OK;
        }
    }
    return SW_ERR_PARSE;
}

// 미제출인지
int sw_assignment_unsubmitted(const SwAssignment *a)
{
    if (!a->status[0]) return 1;
    if (sw_str_contains(a->status, "과제를 제출") || sw_str_contains(a->status, "제출하")) return 0;
    return 1;
}

// 미제출·진행중인지
int sw_assignment_missing_or_progress(const SwAssignment *a)
{
    if (strcmp(a->status, "미제출") == 0) return 1;
    if (sw_str_contains(a->status, "진행중")) return 1;
    return 0;
}

// 미학습·학습중인지
int sw_lesson_unwatched(const SwLesson *l)
{
    if (!l->attendance[0]) return 0;
    return sw_str_contains(l->attendance, "학습중(지각)") || sw_str_contains(l->attendance, "미학습(결석)");
}

// 과제 dueNow 표시
void sw_mark_assignment_flags(SwAssignment *a, time_t now)
{
    a->due_now = sw_period_active(a->period, now) && sw_assignment_unsubmitted(a);
}

// 차시 needsWatch 표시
void sw_mark_lesson_flags(SwLesson *l, time_t now)
{
    l->needs_watch = sw_period_active(l->period, now) && sw_lesson_unwatched(l);
}

// 학기 문자열
const char *sw_course_semester(const SwCourseData *list, size_t n)
{
    static char sem[16];            // 학기 문자열 (호출자 버퍼 없음)
    size_t i;                       // 과목 인덱스
    time_t t = time(NULL);          // 지금
    struct tm tmv;                  // 로컬 시각
    int y;                          // 코드에서 읽은 연도
    int term;                       // 코드에서 읽은 학기
#ifdef _WIN32
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    snprintf(sem, sizeof(sem), "%d-%d", tmv.tm_year + 1900, tmv.tm_mon + 1 >= 8 ? 2 : 1);
    for (i = 0; i < n; i++) {
        y = 0;
        term = 0;
        if (sscanf(list[i].course.crs_cre_cd, "%d_%d", &y, &term) == 2 && y >= 2000) {
            snprintf(sem, sizeof(sem), "%d-%d", y, term);
            if (strcmp(list[i].course.category, "curricular") == 0) break;
        }
    }
    return sem;
}
