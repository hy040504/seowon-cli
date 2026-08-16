#ifndef SW_BACK_PARSE_H
#define SW_BACK_PARSE_H

// 커스텀 라이브러리
#include "../seowon.h"

// 응답 파싱 함수
int sw_parse_login_json(const char *json, SwLoginResult *out);      // 로그인 JSON 파싱
int sw_parse_courses_html(const char *html, SwCourseData **out_list, size_t *out_n); // 과목 HTML 파싱
int sw_parse_assignments_html(const char *html, const char *crs_cre_cd, SwAssignment **out,
                              size_t *out_n);                       // 과제 HTML 파싱
int sw_parse_lessons_html(const char *html, const char *crs_cre_cd, SwLesson **out, size_t *out_n); // 차시 HTML 파싱
int sw_parse_assignment_detail(const char *html, char *out, size_t outsz); // 과제 상세 파싱
int sw_parse_progress_json(const char *json, int *percent);         // 학습률 JSON 파싱

// 상태·기간 판별 함수
void sw_mark_assignment_flags(SwAssignment *a, time_t now);         // 과제 dueNow 표시
void sw_mark_lesson_flags(SwLesson *l, time_t now);                 // 차시 needsWatch 표시
int sw_assignment_unsubmitted(const SwAssignment *a);               // 미제출인지
int sw_assignment_missing_or_progress(const SwAssignment *a);       // 미제출·진행중인지
int sw_lesson_unwatched(const SwLesson *l);                         // 미학습·학습중인지
const char *sw_course_semester(const SwCourseData *list, size_t n); // 학기 문자열

// 목록 관리 함수
void sw_free_courses(SwCourseData *list, size_t n);                 // 과목 목록 해제
void sw_course_add_assignment(SwCourseData *c, const SwAssignment *a); // 과제 추가
void sw_course_add_lesson(SwCourseData *c, const SwLesson *l);      // 차시 추가

#endif
