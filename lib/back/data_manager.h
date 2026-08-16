#ifndef SW_BACK_DATA_MANAGER_H
#define SW_BACK_DATA_MANAGER_H

// 커스텀 라이브러리
#include "../seowon.h"

// 초기화 함수
int sw_app_init(SwApp *app, const char *exe_dir);                   // 프로그램 상태 만들기
void sw_app_free(SwApp *app);                                       // 프로그램 상태 해제
int sw_app_boot(SwApp *app);                                        // 설정·세션 불러오기

// 로그인 함수
int sw_app_login_interactive(SwApp *app);                           // 학번·비밀번호 로그인
int sw_app_login_with(SwApp *app, const char *sid, const char *pw); // 학번·비밀번호로 바로 로그인 (GUI)
int sw_app_try_session(SwApp *app);                                 // 저장된 쿠키로 재접속
int sw_app_ensure_auth(SwApp *app);                                 // 로그인 되어 있는지 확인

// 조회 함수 (prompt.h)
int sw_app_fetch_courses(SwApp *app);                               // 수강 과목 조회
int sw_app_fetch_assignments(SwApp *app, int all);                  // 과제 조회
int sw_app_fetch_lessons(SwApp *app, int all);                      // 이러닝 조회
int sw_app_fetch_assignment_detail(SwApp *app, size_t ci, size_t ai, char *out, size_t outsz); // 과제 상세 조회
int sw_app_fetch_progress(SwApp *app, size_t ci, size_t li);        // 학습률 조회

// 결과 파일 함수
int sw_app_save_result(SwApp *app);                                 // result.json 저장
int sw_app_load_result(SwApp *app);                                 // result.json 불러오기

#endif
