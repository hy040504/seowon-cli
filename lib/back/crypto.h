#ifndef SW_BACK_CRYPTO_H
#define SW_BACK_CRYPTO_H

// 커스텀 라이브러리
#include "../seowon.h"

// 로그인 암호 함수
int sw_make_encrypt_data(const char *user_id, const char *password, char *out, size_t outsz); // encryptData 만들기
int sw_make_encrypt_data_with_key(const char *user_id, const char *password, const char *key24,
                                  char *out, size_t outsz);         // 고정 키로 encryptData 만들기

#endif
