#ifndef SW_UTIL_H
#define SW_UTIL_H

// 커스텀 라이브러리
#include "seowon.h"

// 버퍼 함수
void sw_buf_init(SwBuf *b);                                         // 버퍼 초기화
void sw_buf_free(SwBuf *b);                                         // 버퍼 해제
int sw_buf_reserve(SwBuf *b, size_t need);                          // 버퍼 용량 확보
int sw_buf_append(SwBuf *b, const char *s, size_t n);               // 버퍼에 문자열 추가
int sw_buf_printf(SwBuf *b, const char *fmt, ...);                  // 버퍼에 서식 출력
void sw_buf_clear(SwBuf *b);                                        // 버퍼 비우기

// 문자열 함수
void *sw_xmalloc(size_t n);                                         // 메모리 할당
void *sw_xrealloc(void *p, size_t n);                               // 메모리 재할당
char *sw_strdup(const char *s);                                     // 문자열 복사본
void sw_str_copy(char *dst, size_t dstsz, const char *src);         // 안전 문자열 복사
void sw_str_trim(char *s);                                          // 앞뒤 공백 제거
void sw_normalize_space(char *s);                                   // 연속 공백을 하나로
int sw_str_ieq(const char *a, const char *b);                       // 대소문자 무시 비교
int sw_str_contains(const char *hay, const char *needle);           // 부분 문자열 포함 여부
char *sw_html_to_text(const char *html);                            // HTML을 일반 텍스트로
void sw_decode_entities(char *s);                                   // HTML 엔티티 복원
int sw_url_encode(const char *in, char *out, size_t outsz);         // URL 인코딩
int sw_form_add(SwBuf *body, const char *key, const char *value);   // form 필드 추가

// 파일·경로 함수
int sw_read_file(const char *path, SwBuf *out);                     // 파일 읽기
int sw_write_file(const char *path, const char *data, size_t n);    // 파일 쓰기
int sw_mkdir_p(const char *path);                                   // 폴더 만들기
int sw_path_join(char *out, size_t outsz, const char *a, const char *b); // 경로 합치기

// 날짜·입력 함수
void sw_now_iso(char *out, size_t outsz);                           // 현재 시각 ISO 문자열
time_t sw_local_ymdhms(int y, int mo, int d, int h, int mi, int s); // 로컬 시각 만들기
int sw_period_range(const char *period, time_t *start, time_t *end); // 기간 문자열 파싱
int sw_period_active(const char *period, time_t now);               // 기간 안인지 확인
void sw_enable_console(void);                                       // UTF-8 콘솔 설정
int sw_read_line(const char *prompt, char *out, size_t outsz);      // 한 줄 입력
int sw_read_password(const char *prompt, char *out, size_t outsz);  // 비밀번호 입력
void sw_pause(void);                                                // Enter 대기
int sw_looks_like_login_html(const char *html);                     // 로그인 화면인지 확인
void sw_find_testdata(const char *exe_dir, char *out, size_t outsz); // testdata 폴더 찾기

// 터미널 효과 (SeowonProject util.h LoadSpin / Clear / disappearText 응용)
void sw_sleep_ms(int ms);                                           // 밀리초 대기
void sw_term_clear(void);                                           // 화면 지우기
void sw_gotoxy(int x, int y);                                       // 커서 이동
void sw_load_spin(int total_speed, const char *plus_text);          // 로딩 스피너
void sw_load_spin_step(int current, int total, const char *plus_text); // 실제 진행률 스피너
void sw_load_spin_done(void);                                       // 스피너 줄 지우기
void sw_disappear_text(const char *text);                           // 종료 텍스트 깜빡임
int sw_char_in(char value, const char *set);                        // 글자가 집합에 있는지

#endif
