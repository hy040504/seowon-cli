// 커스텀 라이브러리
#include "data_manager.h"
#include "http.h"
#include "crypto.h"
#include "parse.h"
#include "fs.h"
#include "sugang.h"
#include "../front/tui/ui.h"
#include "../util.h"

// 이 파일 안에서만 쓰는 조회 도우미
static void apply_session_cookies(SwApp *app);                      // 저장된 쿠키를 HTTP에 넣기
static void snapshot_cookies(SwApp *app);                           // 현재 HTTP 쿠키를 세션에 복사
static int demo_read(SwApp *app, const char *name, SwBuf *out);     // testdata 파일 읽기
static int fetch_one_assignments(SwApp *app, SwCourseData *c);      // 한 과목 과제
static int fetch_one_lessons(SwApp *app, SwCourseData *c);          // 한 과목 이러닝
static void say_ok(SwApp *app, const char *msg);
static void say_err(SwApp *app, const char *msg);
static void say_info(SwApp *app, const char *msg);
static void say_warn(SwApp *app, const char *msg);
static void spin(SwApp *app, int speed, const char *text);

static void say_ok(SwApp *app, const char *msg)
{
    if (!app->quiet) sw_ui_ok(msg);
}

static void say_err(SwApp *app, const char *msg)
{
    if (!app->quiet) sw_ui_err(msg);
    if (msg) sw_str_copy(app->last_error, sizeof(app->last_error), msg);
}

static void say_info(SwApp *app, const char *msg)
{
    if (!app->quiet) sw_ui_info(msg);
}

static void say_warn(SwApp *app, const char *msg)
{
    if (!app->quiet) sw_ui_warn(msg);
}

static void spin(SwApp *app, int speed, const char *text)
{
    if (!app->quiet) sw_load_spin(speed, text);
}

// 저장된 쿠키를 HTTP 세션에 넣기
static void apply_session_cookies(SwApp *app)
{
    size_t i;                       // 쿠키 인덱스

    for (i = 0; i < app->sess.cookies.count; i++) {
        sw_cookie_jar_set(&app->http.jar, app->sess.cookies.items[i].name,
                          app->sess.cookies.items[i].value, app->sess.cookies.items[i].domain);
    }
}

// 현재 HTTP 쿠키를 세션에 복사
static void snapshot_cookies(SwApp *app)
{
    size_t i;                       // 쿠키 인덱스

    sw_cookie_jar_free(&app->sess.cookies);
    sw_cookie_jar_init(&app->sess.cookies);
    for (i = 0; i < app->http.jar.count; i++) {
        sw_cookie_jar_set(&app->sess.cookies, app->http.jar.items[i].name, app->http.jar.items[i].value,
                          app->http.jar.items[i].domain);
    }
}

// testdata 파일 읽기 (데모 모드)
static int demo_read(SwApp *app, const char *name, SwBuf *out)
{
    char path[SW_STR_PATH];         // testdata 안 파일 경로

    sw_path_join(path, sizeof(path), app->testdata_dir, name);
    return sw_read_file(path, out);
}

// 프로그램 상태 만들기 (RETURN: SW_OK)
int sw_app_init(SwApp *app, const char *exe_dir)
{
    memset(app, 0, sizeof(*app));
    sw_config_default(&app->cfg);
    sw_cookie_jar_init(&app->sess.cookies);
    sw_find_testdata(exe_dir, app->testdata_dir, sizeof(app->testdata_dir));

    // 데모 모드는 HTTP 없이도 동작한다
    if (sw_http_init(&app->http, app->cfg.base_url) != SW_OK) {
    }
    return SW_OK;
}

// 프로그램 상태 해제
void sw_app_free(SwApp *app)
{
    sw_free_courses(app->courses, app->n_courses);
    app->courses = NULL;
    app->n_courses = 0;
    sw_cookie_jar_free(&app->sess.cookies);
    sw_http_free(&app->http);
}

// 설정·세션 불러오기 (RETURN: SW_OK)
int sw_app_boot(SwApp *app)
{
    char spath[SW_STR_PATH];        // session.json 경로
    char rpath[SW_STR_PATH];        // result.json 경로

    // config.json 이 없으면 기본값으로 만든다
    if (sw_config_load("config.json", &app->cfg) != SW_OK) {
        sw_config_default(&app->cfg);
        sw_config_save(&app->cfg);
        say_info(app, "config.json 이 없어 기본값으로 만들었습니다.");
    }
    sw_mkdir_p(app->cfg.data_dir);

    // login.json 이 없으면 빈 학번·비밀번호로 만든다
    if (sw_login_file_ensure(SW_LOGIN_FILE) != SW_OK) {
        say_warn(app, "login.json 을 만들지 못했습니다.");
    }

    // 설정에서 주소가 바뀌었을 수 있으니 HTTP 세션을 다시 연다
    if (app->http.session == NULL && !app->demo) {
        sw_http_free(&app->http);
        sw_http_init(&app->http, app->cfg.base_url);
    }
    if (app->demo) return SW_OK;

    // 저장된 쿠키로 재접속을 시도한다
    sw_config_paths(&app->cfg, spath, sizeof(spath), rpath, sizeof(rpath));
    if (app->cfg.save_session && sw_session_load(spath, &app->sess) == SW_OK &&
        sw_cookie_jar_usable(&app->sess.cookies)) {
        apply_session_cookies(app);
        say_info(app, "저장된 세션으로 접속을 시도합니다.");
        if (sw_app_try_session(app) == SW_OK) {
            say_ok(app, "세션을 재사용했습니다. 비밀번호 없이 이어서 조회합니다.");
            return SW_OK;
        }
        say_warn(app, "세션이 만료되었습니다. 다시 로그인하세요.");
    }
    return SW_OK;
}

// 저장된 쿠키로 재접속 (RETURN: SW_OK)
int sw_app_try_session(SwApp *app)
{
    if (app->demo) {
        app->logged_in = 1;
        return SW_OK;
    }

    // 과목 목록이 오면 쿠키가 아직 살아 있는 것이다
    if (sw_app_fetch_courses(app) == SW_OK && app->n_courses > 0) {
        app->logged_in = 1;
        return SW_OK;
    }
    app->logged_in = 0;
    return SW_ERR_SESSION;
}

// 로그인 되어 있는지 확인 (RETURN: SW_OK)
int sw_app_ensure_auth(SwApp *app)
{
    if (app->logged_in) return SW_OK;
    if (app->demo) {
        app->logged_in = 1;
        return SW_OK;
    }
    if (sw_cookie_jar_usable(&app->http.jar) && sw_app_try_session(app) == SW_OK) return SW_OK;
    return sw_app_login_interactive(app);
}

// 학번·비밀번호 로그인 (RETURN: SW_OK)
int sw_app_login_interactive(SwApp *app)
{
    SwLoginFile lf;                 // login.json
    char sid[SW_STR_ID];            // 학번
    char pw[SW_STR_PW];             // 비밀번호
    char prompt[128];               // 학번 입력 안내
    int rc;                         // 로그인 결과

    if (app->demo) return sw_app_login_with(app, "", "");

    // 학번·비밀번호가 둘 다 있으면 파일 값으로 바로 로그인한다
    sw_login_file_load(SW_LOGIN_FILE, &lf);
    if (sw_login_file_complete(&lf)) {
        say_info(app, "login.json 의 학번·비밀번호로 로그인합니다.");
        rc = sw_app_login_with(app, lf.student_id, lf.password);
        sw_login_file_wipe(&lf);
        return rc;
    }
    sw_login_file_wipe(&lf);
    say_info(app, "login.json 에 학번 또는 비밀번호가 없어 직접 입력합니다.");

    snprintf(prompt, sizeof(prompt), "학번%s%s%s: ", app->cfg.last_student_id[0] ? " [" : "",
             app->cfg.last_student_id, app->cfg.last_student_id[0] ? "]" : "");
    sw_read_line(prompt, sid, sizeof(sid));
    if (!sid[0]) sw_str_copy(sid, sizeof(sid), app->cfg.last_student_id);
    sw_read_password("비밀번호: ", pw, sizeof(pw));
    rc = sw_app_login_with(app, sid, pw);
#ifdef _WIN32
    SecureZeroMemory(pw, sizeof(pw));
#else
    memset(pw, 0, sizeof(pw));
#endif
    return rc;
}

// 학번·비밀번호로 바로 로그인 (GUI / RPC)
int sw_app_login_with(SwApp *app, const char *sid, const char *pw)
{
    char enc[1024];                 // NICE encryptData
    SwBuf page;                     // 로그인 페이지 HTML
    SwBuf resp;                     // 로그인 API 응답
    SwLoginResult lr;               // 파싱한 로그인 결과
    int status = 0;                 // HTTP 상태 코드
    SwBuf form;                     // POST 본문
    char referer[256];              // Referer 헤더
    char idbuf[SW_STR_ID];          // 학번 복사

    if (app->demo) {
        sw_str_copy(app->sess.student_id, sizeof(app->sess.student_id),
                    (sid && sid[0]) ? sid : (app->cfg.last_student_id[0] ? app->cfg.last_student_id : "20241234"));
        sw_str_copy(app->sess.user_no, sizeof(app->sess.user_no), app->sess.student_id);
        sw_sugang_load_demo_profile(app->testdata_dir, &app->sess);
        app->logged_in = 1;
        say_ok(app, "데모 모드: 실제 로그인 없이 샘플 데이터로 진행합니다.");
        return SW_OK;
    }

    sw_str_copy(idbuf, sizeof(idbuf), sid ? sid : "");
    if (!idbuf[0]) sw_str_copy(idbuf, sizeof(idbuf), app->cfg.last_student_id);
    if (!idbuf[0]) {
        say_err(app, "학번이 비어 있습니다.");
        return SW_ERR;
    }
    if (!pw || !pw[0]) {
        say_err(app, "비밀번호가 비어 있습니다.");
        return SW_ERR;
    }

    // 1) 로그인 페이지를 열어 세션 쿠키를 받는다
    spin(app, 50, "로그인 페이지 ");
    snprintf(referer, sizeof(referer), "%s%s", SW_BASE_URL, SW_LOGIN_PAGE);
    if (sw_http_get(&app->http, SW_LOGIN_PAGE, NULL, 0, &page, &status) != SW_OK) {
        say_err(app, app->http.last_error);
        sw_buf_free(&page);
        return SW_ERR_NET;
    }
    sw_buf_free(&page);

    // 2) 비밀번호로 encryptData 를 만든다
    if (sw_make_encrypt_data(idbuf, pw, enc, sizeof(enc)) != SW_OK) {
        say_err(app, "로그인 암호문을 만들지 못했습니다.");
        return SW_ERR;
    }

    // 3) 로그인 API 로 암호문을 보낸다
    sw_buf_init(&form);
    sw_form_add(&form, "encryptData", enc);
    spin(app, 50, "인증 요청 ");
    if (sw_http_post(&app->http, SW_LOGIN_API, referer,
                     "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &resp,
                     &status) != SW_OK) {
        say_err(app, app->http.last_error);
        sw_buf_free(&form);
        sw_buf_free(&resp);
        return SW_ERR_NET;
    }
    sw_buf_free(&form);

    // 4) JSON 을 해석해 성공·실패·OTP 를 가른다
    if (sw_parse_login_json(resp.p ? resp.p : "", &lr) != SW_OK) {
        say_err(app, "로그인 응답을 해석하지 못했습니다.");
        sw_buf_free(&resp);
        return SW_ERR_PARSE;
    }
    sw_buf_free(&resp);
    if (lr.type == 0) {
        say_err(app, lr.message);
        return SW_ERR_AUTH;
    }
    if (lr.type == 2) {
        say_err(app, lr.message);
        return SW_ERR_OTP;
    }

    // 5) 세션에 학번·쿠키를 남기고, 설정이 켜져 있으면 파일에도 저장한다
    sw_str_copy(app->sess.student_id, sizeof(app->sess.student_id), idbuf);
    sw_str_copy(app->sess.user_no, sizeof(app->sess.user_no), lr.user_no[0] ? lr.user_no : idbuf);
    sw_now_iso(app->sess.saved_at, sizeof(app->sess.saved_at));
    snapshot_cookies(app);

    // 6) 수강신청 SSO 에서 이름·학과를 가져온다 (실패해도 로그인은 유지)
    spin(app, 50, "학생 정보 ");
    sw_sugang_fetch_profile(idbuf, pw, &app->sess);

    sw_str_copy(app->cfg.last_student_id, sizeof(app->cfg.last_student_id), idbuf);
    sw_config_save(&app->cfg);
    if (app->cfg.save_session) {
        char spath[SW_STR_PATH], rpath[SW_STR_PATH];
        sw_config_paths(&app->cfg, spath, sizeof(spath), rpath, sizeof(rpath));
        sw_session_save(spath, &app->sess);
    }
    app->logged_in = 1;
    {
        char who[SW_STR_TITLE + SW_STR_ID + 32];
        sw_session_label(&app->sess, who, sizeof(who));
        if (app->sess.student_name[0] || app->sess.dept_name[0]) {
            char line[SW_STR_TITLE + 64];
            snprintf(line, sizeof(line), "로그인에 성공했습니다.  %s", who);
            say_ok(app, line);
        } else {
            say_ok(app, "로그인에 성공했습니다.");
        }
    }
    return SW_OK;
}

// 수강 과목 조회 (RETURN: SW_OK)
int sw_app_fetch_courses(SwApp *app)
{
    SwBuf body;                     // 응답 HTML
    SwBuf form;                     // POST 본문
    int status = 0;                 // HTTP 상태 코드
    SwCourseData *list = NULL;      // 파싱한 과목 목록
    size_t n = 0;                   // 과목 개수

    if (app->demo) {
        if (demo_read(app, "courses.html", &body) != SW_OK) {
            say_err(app, "testdata/courses.html 을 읽지 못했습니다.");
            return SW_ERR_IO;
        }
    } else {
        sw_buf_init(&form);
        sw_form_add(&form, "crsCreCd", "");
        if (sw_http_post(&app->http, SW_COURSE_LIST, SW_BASE_URL,
                         "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                         &status) != SW_OK) {
            sw_buf_free(&form);
            say_err(app, app->http.last_error);
            return SW_ERR_NET;
        }
        sw_buf_free(&form);
    }

    if (sw_parse_courses_html(body.p ? body.p : "", &list, &n) != SW_OK) {
        sw_buf_free(&body);
        sw_str_copy(app->last_error, sizeof(app->last_error), "과목 목록을 해석하지 못했습니다. 세션을 확인하세요.");
        return SW_ERR_SESSION;
    }
    sw_buf_free(&body);

    // 이전 목록을 지우고 새 목록으로 갈아 끼운다
    sw_free_courses(app->courses, app->n_courses);
    app->courses = list;
    app->n_courses = n;
    snapshot_cookies(app);
    return SW_OK;
}

// 한 과목 과제 조회 (RETURN: SW_OK)
static int fetch_one_assignments(SwApp *app, SwCourseData *c)
{
    SwBuf body;                     // 응답 HTML
    SwBuf form;                     // POST 본문
    int status = 0;                 // HTTP 상태 코드
    SwAssignment *list = NULL;      // 파싱한 과제 목록
    size_t n = 0;                   // 과제 개수
    size_t i;                       // 과제 인덱스

    if (c->fetched_asg) return SW_OK; // 이미 받은 과목은 다시 치지 않는다

    if (app->demo) {
        // 데모 testdata 는 논리회로 한 과목만 있다
        if (strcmp(c->course.title, "논리회로") != 0) {
            c->fetched_asg = 1;
            return SW_OK;
        }
        if (demo_read(app, "assignments.html", &body) != SW_OK) return SW_ERR_IO;
    } else {
        sw_buf_init(&form);
        sw_form_add(&form, "pageIndex", "1");
        sw_form_add(&form, "listScale", SW_LIST_SCALE);
        sw_form_add(&form, "searchValue", "");
        sw_form_add(&form, "crsCreCd", c->course.crs_cre_cd);
        sw_form_add(&form, "userNo", app->sess.user_no[0] ? app->sess.user_no : app->sess.student_id);
        sw_form_add(&form, "userName", "");
        if (sw_http_post(&app->http, SW_ASSIGN_LIST, SW_BASE_URL,
                         "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                         &status) != SW_OK) {
            sw_buf_free(&form);
            return SW_ERR_NET;
        }
        sw_buf_free(&form);
    }

    if (sw_parse_assignments_html(body.p ? body.p : "", c->course.crs_cre_cd, &list, &n) != SW_OK) {
        sw_buf_free(&body);
        return SW_ERR_PARSE;
    }
    sw_buf_free(&body);
    free(c->assignments);
    c->assignments = list;
    c->n_asg = n;
    c->cap_asg = n;
    c->fetched_asg = 1;
    for (i = 0; i < n; i++) sw_str_copy(c->assignments[i].crs_cre_cd, sizeof(c->assignments[i].crs_cre_cd),
                                        c->course.crs_cre_cd);
    return SW_OK;
}

// 한 과목 이러닝 조회 (RETURN: SW_OK)
static int fetch_one_lessons(SwApp *app, SwCourseData *c)
{
    SwBuf body;                     // 응답 HTML
    SwBuf form;                     // POST 본문
    int status = 0;                 // HTTP 상태 코드
    SwLesson *list = NULL;          // 파싱한 차시 목록
    size_t n = 0;                   // 차시 개수
    char path[512];                 // 이러닝 폼 GET 경로

    if (c->fetched_les) return SW_OK;

    if (app->demo) {
        if (strcmp(c->course.title, "논리회로") != 0) {
            c->fetched_les = 1;
            return SW_OK;
        }
        if (demo_read(app, "lessons.html", &body) != SW_OK) return SW_ERR_IO;
    } else {
        // 1) 강의실 폼을 열어 세션을 맞춘다
        snprintf(path, sizeof(path), "%s?mcd=%s&crsCreCd=%s", SW_LESSON_FORM, SW_LESSON_MCD,
                 c->course.crs_cre_cd);
        if (sw_http_get(&app->http, path, SW_BASE_URL, 0, &body, &status) != SW_OK) {
            sw_buf_free(&body);
            return SW_ERR_NET;
        }
        sw_buf_free(&body);

        // 2) 과목 정보를 한 번 더 요청한다 (브라우저와 같은 순서)
        sw_buf_init(&form);
        sw_form_add(&form, "crsCreCd", c->course.crs_cre_cd);
        sw_http_post(&app->http, SW_LESSON_INFO, SW_BASE_URL,
                     "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                     &status);
        sw_buf_free(&form);
        sw_buf_free(&body);

        // 3) 차시 그리드를 받는다
        sw_buf_init(&form);
        sw_form_add(&form, "pageIndex", "1");
        sw_form_add(&form, "listScale", SW_LIST_SCALE);
        sw_form_add(&form, "searchValue", "");
        sw_form_add(&form, "crsCreCd", c->course.crs_cre_cd);
        sw_form_add(&form, "lessonScheduleId", "");
        sw_form_add(&form, "subParam", "GRID");
        sw_form_add(&form, "progressTypeCd", SW_PROGRESS_TYPE);
        if (sw_http_post(&app->http, SW_LESSON_LIST, SW_BASE_URL,
                         "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                         &status) != SW_OK) {
            sw_buf_free(&form);
            return SW_ERR_NET;
        }
        sw_buf_free(&form);
    }

    if (sw_parse_lessons_html(body.p ? body.p : "", c->course.crs_cre_cd, &list, &n) != SW_OK) {
        sw_buf_free(&body);
        return SW_ERR_PARSE;
    }
    sw_buf_free(&body);
    free(c->lessons);
    c->lessons = list;
    c->n_les = n;
    c->cap_les = n;
    c->fetched_les = 1;
    return SW_OK;
}

// 과제 조회 (all=1 이면 전 과목)
int sw_app_fetch_assignments(SwApp *app, int all)
{
    size_t i;                       // 과목 인덱스
    int ok = 0;                     // 성공한 과목 수

    if (app->n_courses == 0 && sw_app_fetch_courses(app) != SW_OK) return SW_ERR;
    for (i = 0; i < app->n_courses; i++) {
        if (!app->quiet) sw_load_spin_step((int)i, (int)app->n_courses, "과제 조회 ");
        if (fetch_one_assignments(app, &app->courses[i]) == SW_OK) ok++;
        if (!all) break;
    }
    if (!app->quiet) {
        sw_load_spin_step((int)app->n_courses, (int)app->n_courses, "과제 조회 ");
        sw_load_spin_done();
    }
    return ok ? SW_OK : SW_ERR;
}

// 이러닝 조회 (all=1 이면 전 과목)
int sw_app_fetch_lessons(SwApp *app, int all)
{
    size_t i;                       // 과목 인덱스
    int ok = 0;                     // 성공한 과목 수

    if (app->n_courses == 0 && sw_app_fetch_courses(app) != SW_OK) return SW_ERR;
    for (i = 0; i < app->n_courses; i++) {
        if (!app->quiet) sw_load_spin_step((int)i, (int)app->n_courses, "이러닝 조회 ");
        if (fetch_one_lessons(app, &app->courses[i]) == SW_OK) ok++;
        if (!all) break;
    }
    if (!app->quiet) {
        sw_load_spin_step((int)app->n_courses, (int)app->n_courses, "이러닝 조회 ");
        sw_load_spin_done();
    }
    return ok ? SW_OK : SW_ERR;
}

// 과제 상세 조회 (RETURN: SW_OK)
int sw_app_fetch_assignment_detail(SwApp *app, size_t ci, size_t ai, char *out, size_t outsz)
{
    SwBuf body;                     // 응답 HTML
    SwBuf form;                     // POST 본문
    int status = 0;                 // HTTP 상태 코드
    SwAssignment *a;                // 고른 과제

    if (ci >= app->n_courses || ai >= app->courses[ci].n_asg) return SW_ERR;
    a = &app->courses[ci].assignments[ai];

    if (app->demo) {
        if (demo_read(app, "assignment_detail.html", &body) != SW_OK) return SW_ERR_IO;
    } else {
        sw_buf_init(&form);
        sw_form_add(&form, "asmntCd", a->id);
        sw_form_add(&form, "crsCreCd", a->crs_cre_cd[0] ? a->crs_cre_cd : app->courses[ci].course.crs_cre_cd);
        if (sw_http_post(&app->http, SW_ASSIGN_VIEW, SW_BASE_URL,
                         "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                         &status) != SW_OK) {
            sw_buf_free(&form);
            return SW_ERR_NET;
        }
        sw_buf_free(&form);
    }
    sw_parse_assignment_detail(body.p ? body.p : "", out, outsz);
    sw_buf_free(&body);
    return out[0] ? SW_OK : SW_ERR_PARSE;
}

// 학습률 조회 (RETURN: SW_OK)
int sw_app_fetch_progress(SwApp *app, size_t ci, size_t li)
{
    SwBuf body;                     // 응답 JSON
    SwBuf form;                     // POST 본문
    int status = 0;                 // HTTP 상태 코드
    int pct = -1;                   // 학습률 (%)
    SwLesson *l;                    // 고른 차시
    char stdno[SW_STR_ID];          // 서버가 쓰는 학습자 키

    if (ci >= app->n_courses || li >= app->courses[ci].n_les) return SW_ERR;
    l = &app->courses[ci].lessons[li];

    if (app->demo) {
        if (demo_read(app, "progress.json", &body) != SW_OK) return SW_ERR_IO;
    } else {
        snprintf(stdno, sizeof(stdno), "%s_%s", l->crs_cre_cd[0] ? l->crs_cre_cd : app->courses[ci].course.crs_cre_cd,
                 app->sess.student_id);
        sw_buf_init(&form);
        sw_form_add(&form, "lessonCntsId", l->lesson_cnts_id);
        sw_form_add(&form, "prgrRatioTypeCd", "STUDY_TOTAL_TM");
        sw_form_add(&form, "stdNo", stdno);
        sw_form_add(&form, "crsCreCd", l->crs_cre_cd[0] ? l->crs_cre_cd : app->courses[ci].course.crs_cre_cd);
        sw_form_add(&form, "pageIndex", "1");
        sw_form_add(&form, "listScale", "10");
        if (sw_http_post(&app->http, SW_STUDY_DETAIL, SW_BASE_URL,
                         "application/x-www-form-urlencoded; charset=UTF-8", form.p, form.n, 1, &body,
                         &status) != SW_OK) {
            sw_buf_free(&form);
            return SW_ERR_NET;
        }
        sw_buf_free(&form);
    }

    if (sw_parse_progress_json(body.p ? body.p : "", &pct) != SW_OK) {
        sw_buf_free(&body);
        return SW_ERR_PARSE;
    }
    sw_buf_free(&body);
    l->progress_percent = pct;      // 목록에 없는 % 만 채워 넣는다
    return SW_OK;
}

// result.json 저장 (RETURN: SW_OK)
int sw_app_save_result(SwApp *app)
{
    char spath[SW_STR_PATH];        // session.json 경로 (여기선 쓰지 않음)
    char rpath[SW_STR_PATH];        // result.json 경로

    sw_config_paths(&app->cfg, spath, sizeof(spath), rpath, sizeof(rpath));
    sw_mkdir_p(app->cfg.data_dir);
    return sw_result_save(rpath, app->courses, app->n_courses, sw_course_semester(app->courses, app->n_courses));
}

// result.json 불러오기 (RETURN: SW_OK)
int sw_app_load_result(SwApp *app)
{
    char spath[SW_STR_PATH];        // session.json 경로
    char rpath[SW_STR_PATH];        // result.json 경로
    char sem[16];                   // 학기 문자열
    SwCourseData *list = NULL;      // 파일에서 읽은 과목
    size_t n = 0;                   // 과목 개수

    sw_config_paths(&app->cfg, spath, sizeof(spath), rpath, sizeof(rpath));
    if (sw_result_load(rpath, &list, &n, sem, sizeof(sem)) != SW_OK) return SW_ERR_IO;
    sw_free_courses(app->courses, app->n_courses);
    app->courses = list;
    app->n_courses = n;
    return SW_OK;
}
