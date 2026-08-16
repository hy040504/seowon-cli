// 커스텀 라이브러리
#include "./lib/seowon.h"
#include "./lib/util.h"
#include "./lib/back/parse.h"
#include "./lib/back/crypto.h"
#include "./lib/back/fs.h"
#include "./lib/back/ssv.h"
#include "./lib/back/sugang.h"

#ifndef CJSON_HIDE_SYMBOLS
#define CJSON_HIDE_SYMBOLS
#endif
#include "cJSON.h"

static int g_fail;      // 실패 개수
static int g_pass;      // 통과 개수

// 참이면 PASS
static void expect_true(int cond, const char *name)
{
    if (cond) {
        printf("  PASS  %s\n", name);
        g_pass++;
    } else {
        printf("  FAIL  %s\n", name);
        g_fail++;
    }
}

// 문자열 같으면 PASS
static void expect_streq(const char *a, const char *b, const char *name)
{
    int ok = a && b && strcmp(a, b) == 0;
    if (!ok) printf("         got=\"%s\" expected=\"%s\"\n", a ? a : "(null)", b ? b : "(null)");
    expect_true(ok, name);
}

// testdata 파일 읽기
static char *read_td(const char *dir, const char *name)
{
    char path[SW_STR_PATH];         // testdata 안 파일 경로
    SwBuf b;                        // 파일 내용
    sw_path_join(path, sizeof(path), dir, name);
    if (sw_read_file(path, &b) != SW_OK) return NULL;
    return b.p;
}

// 단위 테스트 (RETURN: 실패 개수)
int sw_run_tests(const char *testdata_dir)
{
    char *html;                     // testdata 원문
    time_t mid = sw_local_ymdhms(2026, 8, 16, 12, 0, 0); // 8월 기준일
    time_t may = sw_local_ymdhms(2026, 5, 16, 12, 0, 0); // 5월 기준일

    printf("seowon-cli 단위 테스트  testdata=%s\n\n", testdata_dir);

    // 기간 필터
    expect_true(sw_period_active("2026.08.10 ~ 2026.08.20", mid), "period current in range");
    expect_true(!sw_period_active("2026.05.14 ~ 2026.05.21", mid), "period may not current in august");
    expect_true(sw_period_active("2026.05.14 ~ 2026.05.21", may), "period may in may");
    expect_true(!sw_period_active("", mid), "empty period inactive");

    {
        SwAssignment a;             // 과제 플래그 샘플
        memset(&a, 0, sizeof(a));
        sw_str_copy(a.status, sizeof(a.status), "미제출");
        sw_str_copy(a.period, sizeof(a.period), "2026.08.10 ~ 2026.08.20");
        sw_mark_assignment_flags(&a, mid);
        expect_true(sw_assignment_unsubmitted(&a), "unsubmitted");
        expect_true(a.due_now, "dueNow in period");
        sw_str_copy(a.status, sizeof(a.status), "과제를 제출하였습니다");
        sw_mark_assignment_flags(&a, mid);
        expect_true(!a.due_now, "submitted not dueNow");
    }
    {
        SwLesson l;                 // 차시 플래그 샘플
        memset(&l, 0, sizeof(l));
        sw_str_copy(l.attendance, sizeof(l.attendance), "미학습(결석)");
        sw_str_copy(l.period, sizeof(l.period), "2026.08.11 ~ 2026.08.22");
        sw_mark_lesson_flags(&l, mid);
        expect_true(l.needs_watch, "needsWatch unwatched in period");
        sw_str_copy(l.attendance, sizeof(l.attendance), "출석");
        sw_mark_lesson_flags(&l, mid);
        expect_true(!l.needs_watch, "attended not needsWatch");
    }

    // 학생정보 SSV (findStunoInfo / dsSession)
    {
        char body[256];
        char name[64], id[32], dept[64];
        snprintf(body, sizeof(body),
                 "SSV:utf-8%cDataset:dsStunoInfo%c_RowType_%cstdntNm:STRING(256)%cstuno:STRING(256)%cdeprtNm:STRING(256)"
                 "%cN%c홍길동%c20241234%c컴퓨터공학과",
                 0x1e, 0x1e, 0x1f, 0x1f, 0x1f, 0x1e, 0x1f, 0x1f, 0x1f);
        expect_true(sw_ssv_field(body, "dsStunoInfo", "stdntNm", name, sizeof(name)) == SW_OK, "ssv name");
        expect_streq(name, "홍길동", "ssv name value");
        expect_true(sw_ssv_field(body, "dsStunoInfo", "stuno", id, sizeof(id)) == SW_OK, "ssv stuno");
        expect_streq(id, "20241234", "ssv stuno value");
        expect_true(sw_ssv_field(body, "dsStunoInfo", "deprtNm", dept, sizeof(dept)) == SW_OK, "ssv dept");
        expect_streq(dept, "컴퓨터공학과", "ssv dept value");
    }
    {
        SwSession s;
        char who[128];
        memset(&s, 0, sizeof(s));
        expect_true(sw_sugang_load_demo_profile(testdata_dir, &s) == SW_OK, "demo profile load");
        expect_streq(s.student_name, "홍길동", "demo profile name");
        expect_streq(s.student_id, "20241234", "demo profile id");
        expect_streq(s.dept_name, "컴퓨터공학과", "demo profile dept");
        sw_session_label(&s, who, sizeof(who));
        expect_true(sw_str_contains(who, "홍길동") && sw_str_contains(who, "20241234"), "session label");
    }

    // 로그인 JSON
    {
        SwLoginResult lr;           // 파싱 결과
        html = read_td(testdata_dir, "login_ok.json");
        expect_true(html && sw_parse_login_json(html, &lr) == SW_OK && lr.type == 1, "login ok");
        expect_streq(lr.user_no, "20241234", "login userNo");
        free(html);
        html = read_td(testdata_dir, "login_fail.json");
        expect_true(html && sw_parse_login_json(html, &lr) == SW_OK && lr.type == 0, "login fail");
        free(html);
    }

    // 과목 HTML
    html = read_td(testdata_dir, "courses.html");
    if (html) {
        SwCourseData *list = NULL;  // 파싱한 과목
        size_t n = 0;               // 과목 개수
        expect_true(sw_parse_courses_html(html, &list, &n) == SW_OK && n >= 2, "parse courses count");
        if (n >= 1) expect_streq(list[0].course.title, "논리회로", "course 0 title");
        if (n >= 1) expect_streq(list[0].course.crs_cre_cd, "2026_1_736078_01", "course 0 code");
        sw_free_courses(list, n);
        free(html);
    } else {
        expect_true(0, "read courses.html");
    }

    // 과제 HTML
    html = read_td(testdata_dir, "assignments.html");
    if (html) {
        SwAssignment *list = NULL;  // 파싱한 과제
        size_t n = 0;               // 과제 개수
        size_t i;                   // 인덱스
        size_t due = 0;             // dueNow 건수
        expect_true(sw_parse_assignments_html(html, "2026_1_736078_01", &list, &n) == SW_OK && n >= 2,
                    "parse assignments count");
        for (i = 0; i < n; i++) {
            sw_mark_assignment_flags(&list[i], mid);
            if (list[i].due_now) due++;
        }
        expect_true(due >= 1, "at least one dueNow assignment on 2026-08-16");
        free(list);
        free(html);
    } else {
        expect_true(0, "read assignments.html");
    }

    // 이러닝 HTML
    html = read_td(testdata_dir, "lessons.html");
    if (html) {
        SwLesson *list = NULL;      // 파싱한 차시
        size_t n = 0;               // 차시 개수
        size_t i;                   // 인덱스
        size_t w = 0;               // needsWatch 건수
        expect_true(sw_parse_lessons_html(html, "2026_1_736078_01", &list, &n) == SW_OK && n >= 2,
                    "parse lessons count");
        for (i = 0; i < n; i++) {
            sw_mark_lesson_flags(&list[i], mid);
            if (list[i].needs_watch) w++;
        }
        expect_true(w >= 1, "at least one needsWatch lesson on 2026-08-16");
        free(list);
        free(html);
    } else {
        expect_true(0, "read lessons.html");
    }

    // 학습률
    html = read_td(testdata_dir, "progress.json");
    if (html) {
        int pct = -1;               // 퍼센트
        expect_true(sw_parse_progress_json(html, &pct) == SW_OK && pct == 72, "progress 72");
        free(html);
    } else {
        expect_true(0, "read progress.json");
    }

    // 과제 상세
    html = read_td(testdata_dir, "assignment_detail.html");
    if (html) {
        char detail[1024];          // 본문
        expect_true(sw_parse_assignment_detail(html, detail, sizeof(detail)) == SW_OK &&
                        sw_str_contains(detail, "강의노트"),
                    "assignment detail text");
        free(html);
    } else {
        expect_true(0, "read assignment_detail.html");
    }

    // 로그인 암호 고정 키 벡터 (원본 login-crypto.cjs 와 동일)
    {
        char out[256];              // encryptData
        const char *v2 =
            "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYISMhPJmt0BAk4tddyxhw4BmU5EnP9pmDeKYBsct6ls/QXGT+kQWkvxD4VFfdUnTvnCXS";
        const char *v1 =
            "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYISMhxjkxxg0Kp3VSvfCR6GJYbn5XxOWXg4As1+42Bq1pmOHjv2SS4Gf1Q2NWyjO91G2d";
        expect_true(sw_make_encrypt_data_with_key("student", "password", "ABCDEFGHIJKLMNOPQRSTUVWX", out,
                                                 sizeof(out)) == SW_OK,
                    "encrypt student generate");
        expect_streq(out, v2, "encrypt student/password fixed key");
        expect_true(sw_make_encrypt_data_with_key("20241234", "pass!@#", "ABCDEFGHIJKLMNOPQRSTUVWX", out,
                                                 sizeof(out)) == SW_OK,
                    "encrypt special generate");
        expect_streq(out, v1, "encrypt 20241234/pass!@# fixed key");
    }

    // result.json 왕복
    {
        SwCourseData one;           // 저장할 샘플 과목
        SwAssignment a;             // 샘플 과제
        SwLesson l;                 // 샘플 차시
        SwCourseData *back = NULL;  // 다시 읽은 목록
        size_t bn = 0;              // 읽은 과목 수
        char sem[16];               // 학기
        char tmp[SW_STR_PATH];      // 임시 파일 경로
        memset(&one, 0, sizeof(one));
        memset(&a, 0, sizeof(a));
        memset(&l, 0, sizeof(l));
        sw_str_copy(one.course.title, sizeof(one.course.title), "논리회로");
        sw_str_copy(a.title, sizeof(a.title), "강의노트 2");
        sw_str_copy(a.period, sizeof(a.period), "2026.05.14 ~ 2026.05.21");
        sw_str_copy(a.status, sizeof(a.status), "미제출");
        a.due_now = 1;
        sw_course_add_assignment(&one, &a);
        sw_str_copy(l.week, sizeof(l.week), "5주차");
        sw_str_copy(l.title, sizeof(l.title), "5-1. 조합논리");
        sw_str_copy(l.attendance, sizeof(l.attendance), "미학습(결석)");
        l.needs_watch = 1;
        l.progress_percent = -1;
        sw_course_add_lesson(&one, &l);
        sw_str_copy(tmp, sizeof(tmp), "db/_test_result.json");
        sw_mkdir_p("db");
        expect_true(sw_result_save(tmp, &one, 1, "2026-2") == SW_OK, "result save");
        expect_true(sw_result_load(tmp, &back, &bn, sem, sizeof(sem)) == SW_OK && bn == 1, "result load");
        if (bn == 1) {
            expect_streq(back[0].course.title, "논리회로", "result course title");
            expect_true(back[0].n_asg == 1 && back[0].assignments[0].due_now, "result dueNow");
            expect_true(back[0].n_les == 1 && back[0].lessons[0].needs_watch, "result needsWatch");
        }
        sw_free_courses(back, bn);
        free(one.assignments);
        free(one.lessons);
    }

    printf("\n결과: %d 통과, %d 실패\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
