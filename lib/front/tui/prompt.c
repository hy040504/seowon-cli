// 커스텀 라이브러리
#include "prompt.h"
#include "ui.h"
#include "../../back/data_manager.h"
#include "../../back/fs.h"
#include "../../util.h"

// 이 파일 안에서만 쓰는 메뉴·작업 함수
static void Main(SwApp *app);                   // 메인 메뉴
static int Login(SwApp *app);                   // 로그인 메뉴
static int Assign(SwApp *app);                  // 과제 메뉴
static int Elearn(SwApp *app);                  // 이러닝 메뉴
static int Summary(SwApp *app);                 // 현황 요약
static int FileMenu(SwApp *app);                // 파일 메뉴
static char selectMainMenu(SwApp *app);         // 메인 선택창
static char selectAssignMenu(void);             // 과제 선택창
static char selectElearnMenu(void);             // 이러닝 선택창
static char selectFileMenu(void);               // 파일 선택창
static char readMenuKey(void);                  // 한 글자 메뉴 입력
static void doAllAssignments(SwApp *app);       // 전체 과제 조회
static void doDueAssignments(SwApp *app);       // 현재 수행 가능 과제
static void doMissingAssignments(SwApp *app);   // 미제출 전수 조사
static void doAssignDetail(SwApp *app);         // 과제 상세
static void doLessonList(SwApp *app);           // 차시 목록
static void doWatchList(SwApp *app);            // 들을 차시
static void doProgress(SwApp *app);             // 학습률
static void doConfig(SwApp *app);               // 설정
static void doSaveResult(SwApp *app);           // 결과 저장
static void doLoadResult(SwApp *app);           // 결과 불러오기
static void loadScene(const char *allowed);     // 선택 후 로딩 효과
static void drawMenuHead(SwApp *app, const char *title); // 화면 지우고 배너

// 화면을 지운 뒤 배너·제목을 그린다
static void drawMenuHead(SwApp *app, const char *title)
{
    sw_term_clear();
    sw_ui_banner();
    if (title && title[0]) printf("\n  %s\n", title);
    if (app) {
        if (app->demo) printf("  \x1b[2m[데모 모드 — testdata JSON/HTML]\x1b[0m\n");
        else if (app->logged_in) printf("  \x1b[2m[로그인됨: %s]\x1b[0m\n", app->sess.student_id);
    }
}

// 고른 키가 맞으면 LoadSpin 으로 화면을 넘긴다
static void loadScene(const char *allowed)
{
    (void)allowed;
    sw_load_spin(50, "");
}

// 한 글자 메뉴 입력 (q = 종료, z = 뒤로)
static char readMenuKey(void)
{
    char line[32];                  // 입력 줄

    sw_read_line("\n메뉴 번호: ", line, sizeof(line));
    if (sw_str_ieq(line, "quit") || sw_str_ieq(line, "q")) return 'q';
    if (sw_str_ieq(line, "z") || sw_str_ieq(line, "0")) return line[0] == '0' ? '0' : 'z';
    if (line[0] >= '1' && line[0] <= '9' && line[1] == 0) return line[0];
    if (strcmp(line, "0") == 0) return '0';
    return 0;                       // 잘못된 입력
}

// 0. 메인메뉴 선택창
static char selectMainMenu(SwApp *app)
{
    char key;                       // 고른 메뉴

    drawMenuHead(app, "메인 메뉴");
    printf("  1. 로그인 / 세션\n");
    printf("  2. 과제 확인\n");
    printf("  3. 이러닝 확인\n");
    printf("  4. 현황 한 표 요약\n");
    printf("  5. 파일 / 설정\n");
    printf("  0. 종료\n");
    key = readMenuKey();
    if (sw_char_in(key, "123450q")) loadScene("123450q");
    return key;
}

// 2. 과제메뉴 선택창
static char selectAssignMenu(void)
{
    char key;                       // 고른 메뉴

    drawMenuHead(NULL, "과제 확인");
    printf("  1. 전체 과제 조회\n");
    printf("  2. 현재 수행 가능 과제\n");
    printf("  3. 미제출 과제 전수 조사\n");
    printf("  4. 과제 상세 보기\n");
    printf("  z. 뒤로가기\n");
    printf("  q. 종료\n");
    key = readMenuKey();
    if (sw_char_in(key, "1234z0q")) loadScene("1234z0q");
    return key;
}

// 3. 이러닝메뉴 선택창
static char selectElearnMenu(void)
{
    char key;                       // 고른 메뉴

    drawMenuHead(NULL, "이러닝 확인");
    printf("  1. 차시 목록 조회\n");
    printf("  2. 들을 차시 조회\n");
    printf("  3. 학습률(%%) 조회\n");
    printf("  z. 뒤로가기\n");
    printf("  q. 종료\n");
    key = readMenuKey();
    if (sw_char_in(key, "123z0q")) loadScene("123z0q");
    return key;
}

// 5. 파일메뉴 선택창
static char selectFileMenu(void)
{
    char key;                       // 고른 메뉴

    drawMenuHead(NULL, "파일 / 설정");
    printf("  1. 설정 저장 / 불러오기\n");
    printf("  2. 조회 결과 저장\n");
    printf("  3. 조회 결과 불러오기\n");
    printf("  z. 뒤로가기\n");
    printf("  q. 종료\n");
    key = readMenuKey();
    if (sw_char_in(key, "123z0q")) loadScene("123z0q");
    return key;
}

// 전체 과제 조회
static void doAllAssignments(SwApp *app)
{
    // 로그인 확인 후 전 과목 과제를 받아 표로 출력
    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_assignments(app, 1) != SW_OK) {
        sw_ui_err("과제를 가져오지 못했습니다.");
        return;
    }
    sw_ui_print_assignments(app->courses, app->n_courses, 0, 0);
}

// 현재 수행 가능 과제
static void doDueAssignments(SwApp *app)
{
    // dueNow = 기간 안 + 미제출
    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_assignments(app, 1) != SW_OK) {
        sw_ui_err("과제를 가져오지 못했습니다.");
        return;
    }
    sw_ui_print_assignments(app->courses, app->n_courses, 1, 0);
}

// 미제출 과제 전수 조사
static void doMissingAssignments(SwApp *app)
{
    // 기간과 관계없이 미제출·진행중만
    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_assignments(app, 1) != SW_OK) {
        sw_ui_err("과제를 가져오지 못했습니다.");
        return;
    }
    sw_ui_print_assignments(app->courses, app->n_courses, 0, 1);
}

// 과제 상세 보기
static void doAssignDetail(SwApp *app)
{
    size_t ci, ai;                  // 고른 과목·과제 번호
    char detail[SW_STR_LONG];       // 상세 본문

    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_assignments(app, 1) != SW_OK) return;

    // 목록에서 하나 고른 뒤 상세 API 호출
    if (sw_ui_pick_assignment(app->courses, app->n_courses, 0, &ci, &ai) != SW_OK) return;
    sw_load_spin(50, "과제 상세 ");
    if (sw_app_fetch_assignment_detail(app, ci, ai, detail, sizeof(detail)) != SW_OK) {
        sw_ui_err("상세 내용을 찾지 못했습니다.");
        return;
    }
    printf("\n\x1b[1m[과제내용]\x1b[0m\n%s\n", detail);
}

// 차시 목록 조회
static void doLessonList(SwApp *app)
{
    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_lessons(app, 1) != SW_OK) {
        sw_ui_err("이러닝을 가져오지 못했습니다.");
        return;
    }
    sw_ui_print_lessons(app->courses, app->n_courses, 0);
}

// 들을 차시 조회
static void doWatchList(SwApp *app)
{
    // needsWatch = 기간 안 + 미학습/학습중
    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_lessons(app, 1) != SW_OK) {
        sw_ui_err("이러닝을 가져오지 못했습니다.");
        return;
    }
    sw_ui_print_lessons(app->courses, app->n_courses, 1);
}

// 학습률(%) 조회
static void doProgress(SwApp *app)
{
    size_t ci, li;                  // 고른 과목·차시 번호

    if (sw_app_ensure_auth(app) != SW_OK) return;
    if (sw_app_fetch_lessons(app, 1) != SW_OK) return;
    if (sw_ui_pick_lesson(app->courses, app->n_courses, 0, &ci, &li) != SW_OK) return;

    // 목록에 없는 % 만 한 번 더 조회 (시청 기록은 보내지 않음)
    sw_ui_info("선택한 차시의 학습률만 추가로 조회합니다. (자동 시청 없음)");
    sw_load_spin(50, "학습률 ");
    if (sw_app_fetch_progress(app, ci, li) != SW_OK) {
        sw_ui_err("학습률을 조회하지 못했습니다.");
        return;
    }
    printf("  [%s] %s → %s%d%%%s\n", app->courses[ci].course.title, app->courses[ci].lessons[li].title,
           "\x1b[32m", app->courses[ci].lessons[li].progress_percent, "\x1b[0m");
}

// 설정 저장 / 불러오기
static void doConfig(SwApp *app)
{
    char line[128];                 // 메뉴 입력
    char key;                       // 설정 번호

    // 현재 값 보여 주기
    printf("\n현재 설정\n");
    printf("  lastStudentId : %s\n", app->cfg.last_student_id[0] ? app->cfg.last_student_id : "(없음)");
    printf("  saveSession   : %s\n", app->cfg.save_session ? "true" : "false");
    printf("  saveResult    : %s\n", app->cfg.save_result ? "true" : "false");
    printf("  dataDir       : %s\n", app->cfg.data_dir);
    printf("  1) 세션 저장 켜기/끄기\n");
    printf("  2) 결과 저장 켜기/끄기\n");
    printf("  3) 저장 폴더 바꾸기\n");
    printf("  4) config.json 에 저장\n");
    printf("  0) 뒤로\n");
    sw_read_line("선택: ", line, sizeof(line));
    key = line[0];

    switch (key) {
        case '1':
            app->cfg.save_session = !app->cfg.save_session;
            break;
        case '2':
            app->cfg.save_result = !app->cfg.save_result;
            break;
        case '3':
            sw_read_line("폴더 경로: ", line, sizeof(line));
            if (line[0]) sw_str_copy(app->cfg.data_dir, sizeof(app->cfg.data_dir), line);
            break;
        case '4':
            if (sw_config_save(&app->cfg) == SW_OK) sw_ui_ok("config.json 을 저장했습니다.");
            else sw_ui_err("설정 저장에 실패했습니다.");
            return;
        default:
            return;
    }
    sw_config_save(&app->cfg);      // 바꾼 값을 바로 파일에 반영
    sw_ui_ok("설정을 반영했습니다.");
}

// 조회 결과 저장
static void doSaveResult(SwApp *app)
{
    if (app->n_courses == 0) {
        sw_ui_warn("먼저 조회하세요. (4번 요약이 가장 편합니다)");
        return;
    }
    if (sw_app_save_result(app) == SW_OK) sw_ui_ok("result.json 을 저장했습니다.");
    else sw_ui_err("저장에 실패했습니다.");
}

// 조회 결과 불러오기
static void doLoadResult(SwApp *app)
{
    if (sw_app_load_result(app) == SW_OK) {
        sw_ui_ok("저장된 조회 결과를 다시 그립니다.");
        sw_ui_print_summary(app->courses, app->n_courses);
        sw_ui_print_assignments(app->courses, app->n_courses, 0, 0);
        sw_ui_print_lessons(app->courses, app->n_courses, 0);
    } else
        sw_ui_err("result.json 을 읽지 못했습니다.");
}

// 1. 로그인 메뉴
static int Login(SwApp *app)
{
    // 로그인 성공 직후 과목 목록을 한 번 받아 둔다
    if (sw_app_login_interactive(app) == SW_OK && app->n_courses == 0) {
        sw_app_fetch_courses(app);
    }
    sw_pause();
    return SW_MENU_OK;
}

// 2. 과제 메뉴
static int Assign(SwApp *app)
{
    char getScene;                  // 선택한 작업

    while (1) {
        getScene = selectAssignMenu();
        switch (getScene) {
            case '1':               // 전체 과제 조회
                doAllAssignments(app);
                sw_pause();
                break;
            case '2':               // 현재 수행 가능 과제
                doDueAssignments(app);
                sw_pause();
                break;
            case '3':               // 미제출 전수 조사
                doMissingAssignments(app);
                sw_pause();
                break;
            case '4':               // 과제 상세
                doAssignDetail(app);
                sw_pause();
                break;
            case 'z':               // 뒤로가기 (메인 메뉴)
            case '0':
                return SW_MENU_BACK;
            case 'q':               // 종료
                return SW_MENU_QUIT;
            default:
                sw_ui_warn("없는 메뉴입니다.");
                break;
        }
    }
}

// 3. 이러닝 메뉴
static int Elearn(SwApp *app)
{
    char getScene;                  // 선택한 작업

    while (1) {
        getScene = selectElearnMenu();
        switch (getScene) {
            case '1':               // 차시 목록
                doLessonList(app);
                sw_pause();
                break;
            case '2':               // 들을 차시
                doWatchList(app);
                sw_pause();
                break;
            case '3':               // 학습률
                doProgress(app);
                sw_pause();
                break;
            case 'z':               // 뒤로가기 (메인 메뉴)
            case '0':
                return SW_MENU_BACK;
            case 'q':               // 종료
                return SW_MENU_QUIT;
            default:
                sw_ui_warn("없는 메뉴입니다.");
                break;
        }
    }
}

// 4. 현황 한 표 요약
static int Summary(SwApp *app)
{
    if (sw_app_ensure_auth(app) != SW_OK) return SW_MENU_OK;

    // 과제·이러닝을 모아 한 표로 그리고, 설정이 켜져 있으면 파일에도 남긴다
    sw_load_spin(50, "현황 모으는 중 ");
    sw_app_fetch_assignments(app, 1);
    sw_app_fetch_lessons(app, 1);
    sw_ui_print_summary(app->courses, app->n_courses);
    if (app->cfg.save_result) {
        if (sw_app_save_result(app) == SW_OK) sw_ui_ok("같은 내용을 result.json 에도 저장했습니다.");
    }
    sw_pause();
    return SW_MENU_OK;
}

// 5. 파일 메뉴
static int FileMenu(SwApp *app)
{
    char getScene;                  // 선택한 작업

    while (1) {
        getScene = selectFileMenu();
        switch (getScene) {
            case '1':               // 설정
                doConfig(app);
                sw_pause();
                break;
            case '2':               // 결과 저장
                doSaveResult(app);
                sw_pause();
                break;
            case '3':               // 결과 불러오기
                doLoadResult(app);
                sw_pause();
                break;
            case 'z':               // 뒤로가기 (메인 메뉴)
            case '0':
                return SW_MENU_BACK;
            case 'q':               // 종료
                return SW_MENU_QUIT;
            default:
                sw_ui_warn("없는 메뉴입니다.");
                break;
        }
    }
}

// 0. 메인 메뉴
static void Main(SwApp *app)
{
    char getScene;                  // 선택한 메뉴
    int moveNum;                    // 하위 메뉴 이동 값

    while (1) {
        getScene = selectMainMenu(app);
        switch (getScene) {
            case '1':               // 로그인 / 세션
                Login(app);
                break;
            case '2':               // 과제 확인
                moveNum = Assign(app);
                if (moveNum == SW_MENU_QUIT) return;
                break;
            case '3':               // 이러닝 확인
                moveNum = Elearn(app);
                if (moveNum == SW_MENU_QUIT) return;
                break;
            case '4':               // 현황 한 표
                Summary(app);
                break;
            case '5':               // 파일 / 설정
                moveNum = FileMenu(app);
                if (moveNum == SW_MENU_QUIT) return;
                break;
            case '0':               // 종료
            case 'q':
                return;
            default:
                sw_ui_warn("없는 메뉴입니다.");
                break;
        }
    }
}

// 메인 메뉴 시작 (RETURN: SW_OK)
int sw_app_run_menu(SwApp *app)
{
    Main(app);

    // 종료 화면: 텍스트가 한 글자씩 나왔다가 깜빡이며 사라진다
    sw_term_clear();
    sw_ui_banner();
    printf("\n");
    sw_disappear_text("이용해 주셔서 감사합니다.");
    return SW_OK;
}
