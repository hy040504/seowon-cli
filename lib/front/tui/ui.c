// 커스텀 라이브러리
#include "ui.h"
#include "../../util.h"
#include "../../back/parse.h"

// 색상 코드
#define R "\x1b[0m"
#define B "\x1b[1m"
#define C "\x1b[36m"
#define Y "\x1b[33m"
#define G "\x1b[32m"
#define RED "\x1b[31m"
#define DIM "\x1b[2m"

// 이 파일 안에서만 쓰는 출력 함수
static void print_asg_row(const char *course, const SwAssignment *a); // 과제 한 줄

// 시작 배너
void sw_ui_banner(void)
{
    printf("\n%s%s============================================%s\n", B, C, R);
    printf("%s%s  서원대 e-campus 과제·이러닝 현황  %s v%s\n", B, C, R, SW_VERSION);
    printf("%s%s  조회 전용 · C언어 · JSON 저장            %s\n", B, C, R);
    printf("%s%s============================================%s\n", B, C, R);
}

// 안내 메시지
void sw_ui_info(const char *msg) { printf("%s%s%s\n", DIM, msg, R); }
// 성공 메시지
void sw_ui_ok(const char *msg) { printf("%s%s%s\n", G, msg, R); }
// 경고 메시지
void sw_ui_warn(const char *msg) { printf("%s%s%s\n", Y, msg, R); }
// 오류 메시지
void sw_ui_err(const char *msg) { printf("%s%s%s\n", RED, msg, R); }

// 수강 과목 표
void sw_ui_print_courses(const SwCourseData *list, size_t n)
{
    size_t i;                       // 과목 인덱스
    size_t cur = 0;                 // 교과 개수
    size_t ext = 0;                 // 비교과 개수
    const char *cat;                // 구분 글자

    printf("\n%s[수강 과목]%s\n", B, R);
    printf("  %-4s %-36s %-22s %s\n", "번호", "과목명", "강의실 코드", "구분");
    printf("  %s\n", "----------------------------------------------------------------");
    for (i = 0; i < n; i++) {
        cat = strcmp(list[i].course.category, "extracurricular") == 0 ? "비교과" : "교과";
        printf("  %-4zu %-36s %-22s %s\n", i + 1, list[i].course.title, list[i].course.crs_cre_cd, cat);
        if (strcmp(list[i].course.category, "extracurricular") == 0) ext++;
        else cur++;
    }
    printf("  %s교과 %zu · 비교과 %zu · 합 %zu%s\n", DIM, cur, ext, n, R);
}

// 과제 한 줄 출력
static void print_asg_row(const char *course, const SwAssignment *a)
{
    const char *mark = a->due_now ? "지금" : "    "; // 지금 해야 하면 표시

    printf("  [%s] %s | %s | %s%s%s %s\n", course, a->title, a->period[0] ? a->period : "-",
           a->due_now ? Y : "", a->status[0] ? a->status : "-", R, mark);
}

// 과제 목록 출력
void sw_ui_print_assignments(const SwCourseData *list, size_t n, int only_due, int only_missing)
{
    size_t i, j;                    // 과목·과제 인덱스
    size_t shown = 0;               // 화면에 그린 건수
    int header;                     // 과목 제목을 이미 찍었는지
    const SwAssignment *a;          // 현재 과제

    printf("\n%s[과제]%s%s\n", B, only_due ? " 기간 안 미제출" : only_missing ? " 미제출·진행중" : " 전체", R);
    for (i = 0; i < n; i++) {
        header = 0;
        for (j = 0; j < list[i].n_asg; j++) {
            a = &list[i].assignments[j];
            if (only_due && !a->due_now) continue;
            if (only_missing && !sw_assignment_missing_or_progress(a)) continue;
            if (!header) {
                printf("\n  %s%s%s\n", Y, list[i].course.title, R);
                header = 1;
            }
            print_asg_row(list[i].course.title, a);
            shown++;
        }
    }
    if (shown == 0) sw_ui_ok("  해당하는 과제가 없습니다.");
    else printf("\n  %s총 %zu건%s\n", DIM, shown, R);
}

// 이러닝 차시 목록 출력
void sw_ui_print_lessons(const SwCourseData *list, size_t n, int only_watch)
{
    size_t i, j;                    // 과목·차시 인덱스
    size_t shown = 0;               // 화면에 그린 건수
    int header;                     // 과목 제목을 이미 찍었는지
    const SwLesson *l;              // 현재 차시
    char prog[24];                  // 학습률 글자

    printf("\n%s[이러닝]%s%s\n", B, only_watch ? " 들을 차시" : " 차시 목록", R);
    for (i = 0; i < n; i++) {
        header = 0;
        for (j = 0; j < list[i].n_les; j++) {
            l = &list[i].lessons[j];
            if (only_watch && !l->needs_watch) continue;
            if (!header) {
                printf("\n  %s%s%s\n", Y, list[i].course.title, R);
                header = 1;
            }
            if (l->progress_percent >= 0) snprintf(prog, sizeof(prog), "%d%%", l->progress_percent);
            else sw_str_copy(prog, sizeof(prog), "-");
            printf("  [%s] %s %s | %s | %s | 진행 %s%s%s\n", list[i].course.title,
                   l->week[0] ? l->week : "", l->title, l->period[0] ? l->period : "-",
                   l->attendance[0] ? l->attendance : "-", l->needs_watch ? Y : "", prog, R);
            shown++;
        }
    }
    if (shown == 0) sw_ui_ok("  해당하는 차시가 없습니다.");
    else printf("\n  %s총 %zu건%s\n", DIM, shown, R);
}

// 현황 한 표 출력
void sw_ui_print_summary(const SwCourseData *list, size_t n)
{
    size_t i, j;                    // 과목·항목 인덱스
    size_t td = 0;                  // 전체 미제출 과제
    size_t tp = 0;                  // 전체 미완료 이러닝
    int due;                        // 과목별 미제출
    int pend;                       // 과목별 미완료

    printf("\n%s[현황 한 표]%s\n", B, R);
    printf("  %-28s %8s %8s\n", "과목", "미제출", "미완료");
    printf("  %s\n", "----------------------------------------------");
    for (i = 0; i < n; i++) {
        due = 0;
        pend = 0;
        for (j = 0; j < list[i].n_asg; j++)
            if (list[i].assignments[j].due_now) due++;
        for (j = 0; j < list[i].n_les; j++)
            if (list[i].lessons[j].needs_watch) pend++;
        printf("  %-28s %8d %8d\n", list[i].course.title, due, pend);
        td += (size_t)due;
        tp += (size_t)pend;
    }
    printf("  %s\n", "----------------------------------------------");
    printf("  %-28s %8zu %8zu\n", "합계", td, tp);
}

// 과제 고르기 (RETURN: SW_OK)
int sw_ui_pick_assignment(const SwCourseData *list, size_t n, int only_due, size_t *ci, size_t *ai)
{
    size_t i, j;                    // 과목·과제 인덱스
    size_t k = 0;                   // 화면에 붙인 번호 (1부터)
    struct {
        size_t c, a;
    } map[256];                     // 화면 번호 → 실제 과목/과제
    char line[32];                  // 번호 입력
    int sel;                        // 고른 번호

    printf("\n%s과제를 고르세요%s\n", B, R);
    for (i = 0; i < n && k < 256; i++) {
        for (j = 0; j < list[i].n_asg && k < 256; j++) {
            if (only_due && !list[i].assignments[j].due_now) continue;
            printf("  %s%zu.%s [%s] %s (%s)\n", Y, k + 1, R, list[i].course.title,
                   list[i].assignments[j].title,
                   list[i].assignments[j].status[0] ? list[i].assignments[j].status : "-");
            map[k].c = i;
            map[k].a = j;
            k++;
        }
    }
    if (k == 0) {
        sw_ui_warn("선택할 과제가 없습니다.");
        return SW_ERR;
    }

    // 빈 칸이면 취소, 그 외는 번호로 고른다
    sw_read_line("번호 (취소는 빈 칸): ", line, sizeof(line));
    if (!line[0]) return SW_ERR;
    sel = atoi(line);
    if (sel < 1 || (size_t)sel > k) {
        sw_ui_err("잘못된 번호입니다.");
        return SW_ERR;
    }
    *ci = map[sel - 1].c;
    *ai = map[sel - 1].a;
    return SW_OK;
}

// 차시 고르기 (RETURN: SW_OK)
int sw_ui_pick_lesson(const SwCourseData *list, size_t n, int only_watch, size_t *ci, size_t *li)
{
    size_t i, j;                    // 과목·차시 인덱스
    size_t k = 0;                   // 화면에 붙인 번호
    struct {
        size_t c, a;
    } map[256];                     // 화면 번호 → 실제 과목/차시
    char line[32];                  // 번호 입력
    int sel;                        // 고른 번호

    printf("\n%s차시를 고르세요%s\n", B, R);
    for (i = 0; i < n && k < 256; i++) {
        for (j = 0; j < list[i].n_les && k < 256; j++) {
            if (only_watch && !list[i].lessons[j].needs_watch) continue;
            printf("  %s%zu.%s [%s] %s %s (%s)\n", Y, k + 1, R, list[i].course.title,
                   list[i].lessons[j].week, list[i].lessons[j].title,
                   list[i].lessons[j].attendance[0] ? list[i].lessons[j].attendance : "-");
            map[k].c = i;
            map[k].a = j;
            k++;
        }
    }
    if (k == 0) {
        sw_ui_warn("선택할 차시가 없습니다.");
        return SW_ERR;
    }
    sw_read_line("번호 (취소는 빈 칸): ", line, sizeof(line));
    if (!line[0]) return SW_ERR;
    sel = atoi(line);
    if (sel < 1 || (size_t)sel > k) {
        sw_ui_err("잘못된 번호입니다.");
        return SW_ERR;
    }
    *ci = map[sel - 1].c;
    *li = map[sel - 1].a;
    return SW_OK;
}
