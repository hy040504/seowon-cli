#ifndef SW_BACK_SSV_H
#define SW_BACK_SSV_H

#include "../seowon.h"

// Nexacro SSV (수강신청 findStunoInfo 등)
#define SSV_RS '\x1e'
#define SSV_US '\x1f'
#define SSV_EMPTY '\x03'

int sw_ssv_add_param(SwBuf *out, const char *key, const char *value); // 파라미터 한 줄
int sw_ssv_begin(SwBuf *out);                                       // SSV:utf-8
int sw_ssv_dataset_begin(SwBuf *out, const char *id, const char **cols, int ncol); // Dataset 헤더
int sw_ssv_row(SwBuf *out, const char *row_type, const char **cells, int n); // 데이터 행
int sw_ssv_dataset_end(SwBuf *out);                                 // 데이터셋 끝
int sw_ssv_field(const char *body, const char *dataset, const char *col, char *out,
                 size_t outsz);                                     // 첫 행 컬럼 값

#endif
