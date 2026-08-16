// 기본 라이브러리
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// 커스텀 라이브러리
#include "./lib/front/ui.h"
#include "./lib/front/prompt.h"
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
    printf("  seowon-cli            대화형 메뉴\n");
    printf("  seowon-cli --demo     testdata 로 오프라인 시연\n");
    printf("  seowon-cli --test     파서·필터·암호 단위 테스트\n");
    printf("  seowon-cli --help     이 도움말\n\n");
    printf("저장 파일 (JSON만):\n");
    printf("  config.json           마지막 학번, 저장 옵션, dataDir\n");
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

// 시작점 함수
int main(int argc, char **argv)
{
    SwApp app;                      // 프로그램 상태
    char dir[SW_STR_PATH];          // 실행 폴더
    int demo = 0;                   // --demo 이면 1
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
        if (strcmp(argv[i], "--test") == 0) {
            char td[SW_STR_PATH];   // testdata 폴더
            sw_find_testdata(dir, td, sizeof(td));
            return sw_run_tests(td);
        }
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
