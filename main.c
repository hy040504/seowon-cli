// 기본 라이브러리
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// 커스텀 라이브러리
#include "./lib/front/tui/ui.h"
#include "./lib/front/tui/prompt.h"
#include "./lib/util.h"
#include "./lib/back/fs.h"
#include "./lib/back/data_manager.h"

// 기본 메뉴 함수
static void usage(void);                    // 사용법 출력
static void exe_dir(char *out, size_t outsz); // 실행 파일 폴더
int sw_run_tests(const char *testdata_dir); // 단위 테스트

// 사용법 출력
static void usage(void)
{
    printf("seowon-cli %s — 서원대 e-campus 과제·이러닝 현황 (C CLI)\n\n", SW_VERSION);
    printf("사용법:\n");
    printf("  seowon-tui            대화형 TUI 메뉴\n");
    printf("  seowon-tui --demo     testdata 로 오프라인 시연\n");
    printf("  seowon-tui --test     파서·필터·암호 단위 테스트\n");
    printf("  seowon-tui --rpc ...  GUI 가 부르는 JSON 명령\n");
    printf("  seowon-gui            PyQt GUI (별도 실행 파일)\n");
    printf("  seowon-tui --help     이 도움말\n\n");
    printf("저장 파일 (JSON만):\n");
    printf("  config.json           마지막 학번, 저장 옵션, dataDir\n");
    printf("  login.json            학번·비밀번호 (둘 다 있으면 입력 생략)\n");
    printf("  db/session.json       쿠키 (비밀번호 없음)\n");
    printf("  db/result.json        최근 조회 결과\n");
}

#ifdef _WIN32
// 실행 파일 폴더 경로
static void exe_dir(char *out, size_t outsz)
{
    char path[MAX_PATH];            // 실행 파일 전체 경로
    char *slash;                    // 마지막 '\'
    DWORD n = GetModuleFileNameA(NULL, path, MAX_PATH); // 경로 길이
    if (n == 0) {
        sw_str_copy(out, outsz, ".");
        return;
    }
    slash = strrchr(path, '\\');
    if (slash) *slash = 0;
    sw_str_copy(out, outsz, path);
}
#else
static void exe_dir(char *out, size_t outsz) { sw_str_copy(out, outsz, "."); }
#endif

static void json_escape(const char *in, char *out, size_t outsz)
{
    size_t o = 0;
    if (!in) in = "";
    while (*in && o + 2 < outsz) {
        unsigned char c = (unsigned char)*in++;
        if (c == '"' || c == '\\') {
            if (o + 3 >= outsz) break;
            out[o++] = '\\';
            out[o++] = (char)c;
        } else if (c == '\n') {
            if (o + 3 >= outsz) break;
            out[o++] = '\\';
            out[o++] = 'n';
        } else if (c == '\r') {
            continue;
        } else {
            out[o++] = (char)c;
        }
    }
    out[o] = 0;
}

static int rpc_print_file(const char *path)
{
    SwBuf raw;
    if (sw_read_file(path, &raw) != SW_OK || !raw.p) {
        printf("{\"ok\":false,\"error\":\"result.json 을 읽지 못했습니다.\"}\n");
        sw_buf_free(&raw);
        return 1;
    }
    fputs(raw.p, stdout);
    if (raw.n == 0 || raw.p[raw.n - 1] != '\n') fputc('\n', stdout);
    sw_buf_free(&raw);
    return 0;
}

static int run_rpc(SwApp *app, int argc, char **argv)
{
    const char *cmd;                // login / fetch / load / detail / progress
    char spath[SW_STR_PATH], rpath[SW_STR_PATH];
    int i;

    cmd = NULL;
    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--rpc") == 0 && i + 1 < argc) {
            cmd = argv[i + 1];
            break;
        }
    }
    if (!cmd) {
        printf("{\"ok\":false,\"error\":\"--rpc 명령이 없습니다.\"}\n");
        return 1;
    }

    app->quiet = 1;
    sw_app_boot(app);
    sw_config_paths(&app->cfg, spath, sizeof(spath), rpath, sizeof(rpath));

    if (strcmp(cmd, "login") == 0) {
        const char *id = getenv("SEOWON_ID");
        const char *pw = getenv("SEOWON_PW");
        char idbuf[SW_STR_ID];
        char pwbuf[SW_STR_PW];
        SwLoginFile lf;
        int rc;

        idbuf[0] = 0;
        pwbuf[0] = 0;
        if (argc > i + 2 && argv[i + 2][0]) id = argv[i + 2];
        if (argc > i + 3 && argv[i + 3][0]) pw = argv[i + 3];
        if (id && id[0]) sw_str_copy(idbuf, sizeof(idbuf), id);
        if (pw && pw[0]) sw_str_copy(pwbuf, sizeof(pwbuf), pw);

        // 환경변수·인자에 빈 칸이 있으면 login.json 으로 채운다
        if (!idbuf[0] || !pwbuf[0]) {
            if (sw_login_file_load(SW_LOGIN_FILE, &lf) == SW_OK) {
                if (!idbuf[0]) sw_str_copy(idbuf, sizeof(idbuf), lf.student_id);
                if (!pwbuf[0]) sw_str_copy(pwbuf, sizeof(pwbuf), lf.password);
            }
            sw_login_file_wipe(&lf);
        }

        rc = sw_app_login_with(app, idbuf, pwbuf);
#ifdef _WIN32
        SecureZeroMemory(pwbuf, sizeof(pwbuf));
#else
        memset(pwbuf, 0, sizeof(pwbuf));
#endif
        printf("{\"ok\":%s,\"studentId\":\"%s\",\"studentName\":\"%s\",\"deptName\":\"%s\",\"deptCd\":\"%s\",\"error\":\"%s\"}\n",
               rc == SW_OK ? "true" : "false", app->sess.student_id, app->sess.student_name,
               app->sess.dept_name, app->sess.dept_cd, app->last_error);
        return rc == SW_OK ? 0 : 1;
    }

    if (strcmp(cmd, "session") == 0) {
        int rc = sw_app_try_session(app);
        printf("{\"ok\":%s,\"studentId\":\"%s\",\"studentName\":\"%s\",\"deptName\":\"%s\",\"deptCd\":\"%s\",\"error\":\"%s\"}\n",
               rc == SW_OK ? "true" : "false", app->sess.student_id, app->sess.student_name,
               app->sess.dept_name, app->sess.dept_cd,
               rc == SW_OK ? "" : "세션이 없거나 만료되었습니다.");
        return rc == SW_OK ? 0 : 1;
    }

    if (strcmp(cmd, "fetch") == 0) {
        if (!app->demo && !app->logged_in) {
            if (sw_app_try_session(app) != SW_OK) {
                printf("{\"ok\":false,\"error\":\"먼저 로그인하세요.\"}\n");
                return 1;
            }
        }
        if (app->demo) sw_app_login_with(app, "", "");
        if (sw_app_fetch_assignments(app, 1) != SW_OK || sw_app_fetch_lessons(app, 1) != SW_OK) {
            printf("{\"ok\":false,\"error\":\"%s\"}\n",
                   app->last_error[0] ? app->last_error : "조회에 실패했습니다.");
            return 1;
        }
        if (sw_app_save_result(app) != SW_OK) {
            printf("{\"ok\":false,\"error\":\"result.json 저장 실패\"}\n");
            return 1;
        }
        return rpc_print_file(rpath);
    }

    if (strcmp(cmd, "load") == 0) {
        if (sw_app_load_result(app) != SW_OK) {
            printf("{\"ok\":false,\"error\":\"result.json 을 읽지 못했습니다.\"}\n");
            return 1;
        }
        return rpc_print_file(rpath);
    }

    if (strcmp(cmd, "detail") == 0) {
        size_t ci, ai;
        char detail[SW_STR_LONG];
        char esc[SW_STR_LONG * 2];
        if (argc <= i + 3) {
            printf("{\"ok\":false,\"error\":\"detail 과목번호 과제번호\"}\n");
            return 1;
        }
        if (!app->demo && !app->logged_in) sw_app_try_session(app);
        if (app->demo) sw_app_login_with(app, "", "");
        if (app->n_courses == 0) sw_app_fetch_assignments(app, 1);
        ci = (size_t)atoi(argv[i + 2]);
        ai = (size_t)atoi(argv[i + 3]);
        if (sw_app_fetch_assignment_detail(app, ci, ai, detail, sizeof(detail)) != SW_OK) {
            printf("{\"ok\":false,\"error\":\"상세를 찾지 못했습니다.\"}\n");
            return 1;
        }
        json_escape(detail, esc, sizeof(esc));
        printf("{\"ok\":true,\"detail\":\"%s\"}\n", esc);
        return 0;
    }

    if (strcmp(cmd, "progress") == 0) {
        size_t ci, li;
        if (argc <= i + 3) {
            printf("{\"ok\":false,\"error\":\"progress 과목번호 차시번호\"}\n");
            return 1;
        }
        if (!app->demo && !app->logged_in) sw_app_try_session(app);
        if (app->demo) sw_app_login_with(app, "", "");
        if (app->n_courses == 0) sw_app_fetch_lessons(app, 1);
        ci = (size_t)atoi(argv[i + 2]);
        li = (size_t)atoi(argv[i + 3]);
        if (sw_app_fetch_progress(app, ci, li) != SW_OK) {
            printf("{\"ok\":false,\"error\":\"학습률을 조회하지 못했습니다.\"}\n");
            return 1;
        }
        printf("{\"ok\":true,\"percent\":%d}\n", app->courses[ci].lessons[li].progress_percent);
        return 0;
    }

    printf("{\"ok\":false,\"error\":\"알 수 없는 rpc 명령\"}\n");
    return 1;
}

// 시작점 함수
int main(int argc, char **argv)
{
    SwApp app;                      // 프로그램 상태
    char dir[SW_STR_PATH];          // 실행 폴더
    int demo = 0;                   // --demo 이면 1
    int rpc = 0;                    // --rpc 이면 1
    int i;                          // 인자 인덱스

    // 콘솔을 UTF-8 로 맞춘 뒤 실행 폴더를 찾는다
    sw_enable_console();
    exe_dir(dir, sizeof(dir));

    // 명령줄 인자
    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            usage();
            return 0;
        }
        if (strcmp(argv[i], "--version") == 0) {
            printf("%s\n", SW_VERSION);
            return 0;
        }
        if (strcmp(argv[i], "--demo") == 0) demo = 1;
        if (strcmp(argv[i], "--rpc") == 0) rpc = 1;
        if (strcmp(argv[i], "--test") == 0) {
            char td[SW_STR_PATH];   // testdata 폴더
            sw_find_testdata(dir, td, sizeof(td));
            return sw_run_tests(td);
        }
    }

    if (rpc) {
        int rc;
        sw_app_init(&app, dir);
        app.demo = demo;
        rc = run_rpc(&app, argc, argv);
        sw_app_free(&app);
        return rc;
    }

    // 스플래시 → 설정·세션 → 메뉴
    sw_app_init(&app, dir);
    app.demo = demo;
    sw_term_clear();
    sw_ui_banner();
    sw_load_spin(150, "");
    if (demo) sw_ui_warn("데모 모드입니다. e-campus 에 접속하지 않고 testdata 를 씁니다.");
    sw_app_boot(&app);
    sw_app_run_menu(&app);
    sw_app_free(&app);
    return 0;
}
