// 커스텀 라이브러리
#include "fs.h"
#include "http.h"
#include "parse.h"
#include "../util.h"

#ifndef CJSON_HIDE_SYMBOLS
#define CJSON_HIDE_SYMBOLS
#endif
#include "cJSON.h"

// 이 파일 안에서만 쓰는 JSON 도우미
static const char *js_str(cJSON *o, const char *k, const char *def); // 문자열 키
static int js_bool(cJSON *o, const char *k, int def);               // 불리언 키

// 기본 설정 채우기
void sw_config_default(SwConfig *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->save_session = 1;
    cfg->save_result = 1;
    sw_str_copy(cfg->data_dir, sizeof(cfg->data_dir), "./db");
    sw_str_copy(cfg->base_url, sizeof(cfg->base_url), SW_BASE_URL);
    sw_str_copy(cfg->config_path, sizeof(cfg->config_path), "config.json");
}

// JSON 문자열 키 읽기
static const char *js_str(cJSON *o, const char *k, const char *def)
{
    cJSON *it = cJSON_GetObjectItemCaseSensitive(o, k); // 키에 해당하는 값

    if (cJSON_IsString(it) && it->valuestring) return it->valuestring;
    return def;
}

// JSON 불리언 키 읽기
static int js_bool(cJSON *o, const char *k, int def)
{
    cJSON *it = cJSON_GetObjectItemCaseSensitive(o, k); // 키에 해당하는 값
    if (cJSON_IsBool(it)) return cJSON_IsTrue(it);
    if (cJSON_IsNumber(it)) return it->valueint != 0;
    return def;
}

// config.json 불러오기 (RETURN: SW_OK)
int sw_config_load(const char *path, SwConfig *cfg)
{
    SwBuf raw;                      // 파일 원문
    cJSON *root;                    // 전체 JSON
    sw_config_default(cfg);
    if (path && *path) sw_str_copy(cfg->config_path, sizeof(cfg->config_path), path);
    if (sw_read_file(cfg->config_path, &raw) != SW_OK) {
        sw_buf_free(&raw);
        return SW_ERR_IO;
    }
    root = cJSON_Parse(raw.p);
    sw_buf_free(&raw);
    if (!root) return SW_ERR_PARSE;
    sw_str_copy(cfg->last_student_id, sizeof(cfg->last_student_id), js_str(root, "lastStudentId", ""));
    cfg->save_session = js_bool(root, "saveSession", 1);
    cfg->save_result = js_bool(root, "saveResult", 1);
    sw_str_copy(cfg->data_dir, sizeof(cfg->data_dir), js_str(root, "dataDir", "./db"));
    sw_str_copy(cfg->base_url, sizeof(cfg->base_url), js_str(root, "baseUrl", SW_BASE_URL));
    cJSON_Delete(root);
    return SW_OK;
}

// config.json 저장 (RETURN: SW_OK)
int sw_config_save(const SwConfig *cfg)
{
    cJSON *root = cJSON_CreateObject(); // 저장할 JSON
    char *txt;                      // pretty 문자열
    int rc;                         // 파일 쓰기 결과
    cJSON_AddStringToObject(root, "lastStudentId", cfg->last_student_id);
    cJSON_AddBoolToObject(root, "saveSession", cfg->save_session);
    cJSON_AddBoolToObject(root, "saveResult", cfg->save_result);
    cJSON_AddStringToObject(root, "dataDir", cfg->data_dir);
    txt = cJSON_Print(root);
    cJSON_Delete(root);
    if (!txt) return SW_ERR;
    rc = sw_write_file(cfg->config_path, txt, strlen(txt));
    cJSON_free(txt);
    return rc;
}

// 세션·결과 파일 경로 만들기
void sw_config_paths(const SwConfig *cfg, char *session_path, size_t ssz, char *result_path, size_t rsz)
{
    sw_path_join(session_path, ssz, cfg->data_dir, "session.json");
    sw_path_join(result_path, rsz, cfg->data_dir, "result.json");
}

// session.json 불러오기 (RETURN: SW_OK)
int sw_session_load(const char *path, SwSession *sess)
{
    SwBuf raw;                      // 파일 원문
    cJSON *root;                    // 전체 JSON
    cJSON *cookies;                 // cookies 배열
    cJSON *it;                      // 배열 항목
    memset(sess, 0, sizeof(*sess));
    sw_cookie_jar_init(&sess->cookies);
    if (sw_read_file(path, &raw) != SW_OK) {
        sw_buf_free(&raw);
        return SW_ERR_IO;
    }
    root = cJSON_Parse(raw.p);
    sw_buf_free(&raw);
    if (!root) return SW_ERR_PARSE;
    sw_str_copy(sess->student_id, sizeof(sess->student_id), js_str(root, "studentId", ""));
    sw_str_copy(sess->user_no, sizeof(sess->user_no), js_str(root, "userNo", sess->student_id));
    sw_str_copy(sess->saved_at, sizeof(sess->saved_at), js_str(root, "savedAt", ""));
    cookies = cJSON_GetObjectItemCaseSensitive(root, "cookies");
    cJSON_ArrayForEach(it, cookies)
    {
        const char *name = js_str(it, "name", "");     // 쿠키 이름
        const char *value = js_str(it, "value", "");   // 쿠키 값
        const char *domain = js_str(it, "domain", SW_HOST); // 도메인
        if (name[0]) sw_cookie_jar_set(&sess->cookies, name, value, domain);
    }
    cJSON_Delete(root);
    return SW_OK;
}

// session.json 저장 (RETURN: SW_OK)
int sw_session_save(const char *path, const SwSession *sess)
{
    cJSON *root = cJSON_CreateObject(); // 저장할 JSON
    cJSON *arr = cJSON_CreateArray();   // cookies 배열
    char *txt;                      // pretty 문자열
    int rc;                         // 파일 쓰기 결과
    size_t i;                       // 쿠키 인덱스
    char dir[SW_STR_PATH];          // 부모 폴더
    sw_str_copy(dir, sizeof(dir), path);
    {
        char *slash = strrchr(dir, '/');   // POSIX 구분
        char *bslash = strrchr(dir, '\\'); // Windows 구분
        if (bslash > slash) slash = bslash;
        if (slash) {
            *slash = 0;
            sw_mkdir_p(dir);            // 부모 폴더가 없으면 만든다
        }
    }
    cJSON_AddStringToObject(root, "studentId", sess->student_id);
    cJSON_AddStringToObject(root, "userNo", sess->user_no);
    cJSON_AddStringToObject(root, "savedAt", sess->saved_at);
    for (i = 0; i < sess->cookies.count; i++) {
        cJSON *c = cJSON_CreateObject();
        cJSON_AddStringToObject(c, "name", sess->cookies.items[i].name);
        cJSON_AddStringToObject(c, "value", sess->cookies.items[i].value);
        cJSON_AddStringToObject(c, "domain", sess->cookies.items[i].domain);
        cJSON_AddItemToArray(arr, c);
    }
    cJSON_AddItemToObject(root, "cookies", arr);
    txt = cJSON_Print(root);
    cJSON_Delete(root);
    if (!txt) return SW_ERR;
    rc = sw_write_file(path, txt, strlen(txt));
    cJSON_free(txt);
    return rc;
}

// result.json 저장 (RETURN: SW_OK)
int sw_result_save(const char *path, const SwCourseData *list, size_t n, const char *semester)
{
    cJSON *root = cJSON_CreateObject(); // 저장할 JSON
    cJSON *courses = cJSON_CreateArray(); // 과목 배열
    cJSON *summary = cJSON_CreateArray(); // 한 표 요약
    char now[32];                   // 저장 시각
    char dir[SW_STR_PATH];          // 부모 폴더
    char *txt;                      // pretty 문자열
    int rc;                         // 파일 쓰기 결과
    size_t i;                       // 과목 인덱스
    sw_now_iso(now, sizeof(now));
    sw_str_copy(dir, sizeof(dir), path);
    {
        char *slash = strrchr(dir, '/');
        char *bslash = strrchr(dir, '\\');
        if (bslash > slash) slash = bslash;
        if (slash) {
            *slash = 0;
            sw_mkdir_p(dir);
        }
    }
    cJSON_AddStringToObject(root, "savedAt", now);
    cJSON_AddStringToObject(root, "semester", semester ? semester : "");
    for (i = 0; i < n; i++) {
        cJSON *co = cJSON_CreateObject(); // 한 과목
        cJSON *as = cJSON_CreateArray();   // 과제 배열
        cJSON *el = cJSON_CreateArray();   // 이러닝 배열
        cJSON *sm = cJSON_CreateObject();  // 요약 한 줄
        size_t j;                       // 과제/차시 인덱스
        int due = 0;                    // 미제출 과제 수
        int pend = 0;                   // 미완료 이러닝 수
        cJSON_AddStringToObject(co, "courseTitle", list[i].course.title);
        cJSON_AddStringToObject(co, "crsCreCd", list[i].course.crs_cre_cd);
        for (j = 0; j < list[i].n_asg; j++) {
            cJSON *a = cJSON_CreateObject();
            cJSON_AddStringToObject(a, "title", list[i].assignments[j].title);
            cJSON_AddStringToObject(a, "period", list[i].assignments[j].period);
            cJSON_AddStringToObject(a, "status", list[i].assignments[j].status);
            cJSON_AddBoolToObject(a, "dueNow", list[i].assignments[j].due_now);
            if (list[i].assignments[j].due_now) due++;
            cJSON_AddItemToArray(as, a);
        }
        for (j = 0; j < list[i].n_les; j++) {
            cJSON *l = cJSON_CreateObject();
            cJSON_AddStringToObject(l, "week", list[i].lessons[j].week);
            cJSON_AddStringToObject(l, "title", list[i].lessons[j].title);
            cJSON_AddStringToObject(l, "period", list[i].lessons[j].period);
            cJSON_AddStringToObject(l, "attendanceStatus", list[i].lessons[j].attendance);
            cJSON_AddBoolToObject(l, "needsWatch", list[i].lessons[j].needs_watch);
            if (list[i].lessons[j].progress_percent >= 0)
                cJSON_AddNumberToObject(l, "progressPercent", list[i].lessons[j].progress_percent);
            else
                cJSON_AddNullToObject(l, "progressPercent");
            if (list[i].lessons[j].needs_watch) pend++;
            cJSON_AddItemToArray(el, l);
        }
        cJSON_AddItemToObject(co, "assignments", as);
        cJSON_AddItemToObject(co, "elearning", el);
        cJSON_AddItemToArray(courses, co);
        cJSON_AddStringToObject(sm, "courseTitle", list[i].course.title);
        cJSON_AddNumberToObject(sm, "dueAssignments", due);
        cJSON_AddNumberToObject(sm, "pendingLessons", pend);
        cJSON_AddItemToArray(summary, sm);
    }
    cJSON_AddItemToObject(root, "courses", courses);
    cJSON_AddItemToObject(root, "summary", summary);
    txt = cJSON_Print(root);
    cJSON_Delete(root);
    if (!txt) return SW_ERR;
    rc = sw_write_file(path, txt, strlen(txt));
    cJSON_free(txt);
    return rc;
}

// result.json 불러오기 (RETURN: SW_OK)
int sw_result_load(const char *path, SwCourseData **out_list, size_t *out_n, char *semester, size_t semsz)
{
    SwBuf raw;                      // 파일 원문
    cJSON *root;                    // 전체 JSON
    cJSON *courses;                 // courses 배열
    cJSON *co;                      // 한 과목
    SwCourseData *list = NULL;      // 복원한 과목 목록
    size_t n = 0;                   // 과목 개수
    size_t cap = 0;                 // 배열 용량
    *out_list = NULL;
    *out_n = 0;
    if (semester && semsz) semester[0] = 0;
    if (sw_read_file(path, &raw) != SW_OK) {
        sw_buf_free(&raw);
        return SW_ERR_IO;
    }
    root = cJSON_Parse(raw.p);
    sw_buf_free(&raw);
    if (!root) return SW_ERR_PARSE;
    if (semester) sw_str_copy(semester, semsz, js_str(root, "semester", ""));
    courses = cJSON_GetObjectItemCaseSensitive(root, "courses");
    cJSON_ArrayForEach(co, courses)
    {
        SwCourseData item;          // 복원할 한 과목
        cJSON *as;                  // assignments 배열
        cJSON *el;                  // elearning 배열
        cJSON *it;                  // 배열 항목
        memset(&item, 0, sizeof(item));
        sw_str_copy(item.course.title, sizeof(item.course.title), js_str(co, "courseTitle", ""));
        sw_str_copy(item.course.crs_cre_cd, sizeof(item.course.crs_cre_cd), js_str(co, "crsCreCd", ""));
        as = cJSON_GetObjectItemCaseSensitive(co, "assignments");
        cJSON_ArrayForEach(it, as)
        {
            SwAssignment a;         // 한 과제
            memset(&a, 0, sizeof(a));
            sw_str_copy(a.title, sizeof(a.title), js_str(it, "title", ""));
            sw_str_copy(a.period, sizeof(a.period), js_str(it, "period", ""));
            sw_str_copy(a.status, sizeof(a.status), js_str(it, "status", ""));
            sw_str_copy(a.crs_cre_cd, sizeof(a.crs_cre_cd), item.course.crs_cre_cd);
            a.due_now = js_bool(it, "dueNow", 0);
            sw_course_add_assignment(&item, &a);
        }
        el = cJSON_GetObjectItemCaseSensitive(co, "elearning");
        cJSON_ArrayForEach(it, el)
        {
            SwLesson l;             // 한 차시
            cJSON *pr;              // progressPercent
            memset(&l, 0, sizeof(l));
            sw_str_copy(l.week, sizeof(l.week), js_str(it, "week", ""));
            sw_str_copy(l.title, sizeof(l.title), js_str(it, "title", ""));
            sw_str_copy(l.period, sizeof(l.period), js_str(it, "period", ""));
            sw_str_copy(l.attendance, sizeof(l.attendance), js_str(it, "attendanceStatus", ""));
            sw_str_copy(l.crs_cre_cd, sizeof(l.crs_cre_cd), item.course.crs_cre_cd);
            l.needs_watch = js_bool(it, "needsWatch", 0);
            pr = cJSON_GetObjectItemCaseSensitive(it, "progressPercent");
            l.progress_percent = cJSON_IsNumber(pr) ? (int)pr->valuedouble : -1;
            sw_course_add_lesson(&item, &l);
        }
        item.fetched_asg = 1;
        item.fetched_les = 1;
        if (n == cap) {
            cap = cap ? cap * 2 : 4;
            list = (SwCourseData *)sw_xrealloc(list, cap * sizeof(SwCourseData));
        }
        list[n++] = item;
    }
    cJSON_Delete(root);
    *out_list = list;
    *out_n = n;
    return SW_OK;
}
