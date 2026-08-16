#ifndef SW_BACK_HTTP_H
#define SW_BACK_HTTP_H

// 커스텀 라이브러리
#include "../seowon.h"

// HTTP 함수
int sw_http_init(SwHttp *http, const char *base_url);               // HTTP 세션 열기
void sw_http_free(SwHttp *http);                                    // HTTP 세션 닫기
int sw_http_get(SwHttp *http, const char *path, const char *referer, int ajax, SwBuf *body,
                int *status);                                       // GET 요청
int sw_http_post(SwHttp *http, const char *path, const char *referer, const char *content_type,
                 const char *payload, size_t payload_n, int ajax, SwBuf *body, int *status); // POST 요청

// 쿠키 함수
void sw_cookie_jar_init(SwCookieJar *jar);                          // 쿠키 저장소 초기화
void sw_cookie_jar_free(SwCookieJar *jar);                          // 쿠키 저장소 해제
int sw_cookie_jar_set(SwCookieJar *jar, const char *name, const char *value, const char *domain); // 쿠키 넣기
int sw_cookie_jar_usable(const SwCookieJar *jar);                   // 쓸 수 있는 쿠키 있는지
void sw_cookie_header(const SwCookieJar *jar, char *out, size_t outsz); // Cookie 헤더 만들기

#endif
