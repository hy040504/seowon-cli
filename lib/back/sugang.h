#ifndef SW_BACK_SUGANG_H
#define SW_BACK_SUGANG_H

#include "../seowon.h"

// 수강신청 SSO 에서 이름·학번·학과를 가져온다 (seowon-client-api findStunoInfo)
int sw_sugang_fetch_profile(const char *stuno, const char *password, SwSession *sess);

// testdata/student.json 읽기 (데모)
int sw_sugang_load_demo_profile(const char *testdata_dir, SwSession *sess);

// "이름 (학번) · 학과" 한 줄
void sw_session_label(const SwSession *sess, char *out, size_t outsz);

#endif
