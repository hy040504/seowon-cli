#ifndef SW_BACK_FS_H
#define SW_BACK_FS_H

// 커스텀 라이브러리
#include "../seowon.h"

// 설정 파일 함수
void sw_config_default(SwConfig *cfg);                              // 기본 설정 채우기
int sw_config_load(const char *path, SwConfig *cfg);                // config.json 불러오기
int sw_config_save(const SwConfig *cfg);                            // config.json 저장
void sw_config_paths(const SwConfig *cfg, char *session_path, size_t ssz, char *result_path,
                     size_t rsz);                                   // 세션·결과 경로 만들기

// 세션·결과 파일 함수
int sw_session_load(const char *path, SwSession *sess);             // session.json 불러오기
int sw_session_save(const char *path, const SwSession *sess);       // session.json 저장
int sw_result_save(const char *path, const SwCourseData *list, size_t n, const char *semester); // result.json 저장
int sw_result_load(const char *path, SwCourseData **out_list, size_t *out_n, char *semester,
                   size_t semsz);                                   // result.json 불러오기

#endif
