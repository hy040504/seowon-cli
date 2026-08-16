#ifndef SW_FRONT_UI_H
#define SW_FRONT_UI_H

// 커스텀 라이브러리
#include "../seowon.h"

// UI 장면 함수들
void sw_ui_banner(void);                                            // 시작 배너
void sw_ui_info(const char *msg);                                   // 안내 메시지
void sw_ui_ok(const char *msg);                                     // 성공 메시지
void sw_ui_warn(const char *msg);                                   // 경고 메시지
void sw_ui_err(const char *msg);                                    // 오류 메시지

// 목록 출력 함수들
void sw_ui_print_courses(const SwCourseData *list, size_t n);       // 수강 과목 표
void sw_ui_print_assignments(const SwCourseData *list, size_t n, int only_due, int only_missing); // 과제 목록
void sw_ui_print_lessons(const SwCourseData *list, size_t n, int only_watch); // 이러닝 목록
void sw_ui_print_summary(const SwCourseData *list, size_t n);       // 현황 한 표

// 선택 함수들
int sw_ui_pick_assignment(const SwCourseData *list, size_t n, int only_due, size_t *ci, size_t *ai); // 과제 고르기
int sw_ui_pick_lesson(const SwCourseData *list, size_t n, int only_watch, size_t *ci, size_t *li);   // 차시 고르기

#endif
