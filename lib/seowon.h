#ifndef SEOWON_H
#define SEOWON_H

#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

// 기본 라이브러리
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
#endif

// 매크로 변수 (서버)
#define SW_VERSION "1.0.0"
#define SW_BASE_URL "https://ecampus.seowon.ac.kr"       // e-campus 주소
#define SW_HOST "ecampus.seowon.ac.kr"                   // 호스트
#define SW_USER_AGENT \
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

#define SW_LOGIN_PAGE "/home/mainPop/popup/login"        // 로그인 페이지
#define SW_LOGIN_API "/user/userHome/login"              // 로그인 API
#define SW_COURSE_LIST "/crs/creCrsHome/classRoomCrsCreList" // 과목 목록
#define SW_ASSIGN_LIST "/asmnt/asmntHome/stuAsmntGridList"   // 과제 목록
#define SW_ASSIGN_VIEW "/asmnt/asmntLect/Form/asmntStuMain"  // 과제 상세
#define SW_LESSON_FORM "/lesson/lessonLect/Form/lessonListForm"
#define SW_LESSON_INFO "/crs/creCrsLect/creInfo"
#define SW_LESSON_LIST "/lesson/lessonLect/lessonList"    // 이러닝 차시 목록
#define SW_LESSON_WINDOW "/lesson/lessonOpen/lessonNewWindow"
#define SW_STUDY_DETAIL "/lesson/lessonLect/viewLessonStudyDetail" // 학습률 조회
#define SW_LESSON_MCD "MH_210504T143020d03000a"
#define SW_PROGRESS_TYPE "WEEK"
#define SW_LIST_SCALE "100"                              // 목록 조회 개수

// 매크로 변수 (버퍼 크기)
#define SW_STR_TINY 32
#define SW_STR_ID 96
#define SW_STR_TITLE 256
#define SW_STR_PERIOD 128
#define SW_STR_STATUS 80
#define SW_STR_PATH 320
#define SW_STR_HOST 128
#define SW_STR_COOKIE 2048
#define SW_STR_MSG 512
#define SW_STR_LONG 4096

// 반환 코드
#define SW_OK 0
#define SW_ERR -1
#define SW_ERR_AUTH -2
#define SW_ERR_NET -3
#define SW_ERR_PARSE -4
#define SW_ERR_IO -5
#define SW_ERR_OTP -6
#define SW_ERR_SESSION -7

// 문자열 버퍼
typedef struct {
    char *p;        // 데이터
    size_t n;       // 길이
    size_t cap;     // 용량
} SwBuf;

// 쿠키 한 개
typedef struct {
    char name[SW_STR_ID];           // 이름
    char value[SW_STR_COOKIE];      // 값
    char domain[SW_STR_HOST];       // 도메인
    char path[SW_STR_PATH];         // 경로
} SwCookie;

// 쿠키 목록
typedef struct {
    SwCookie *items;    // 쿠키 배열
    size_t count;       // 개수
    size_t cap;         // 용량
} SwCookieJar;

// 프로그램 구성 (config.json)
typedef struct {
    char last_student_id[SW_STR_ID];    // 마지막 학번
    int save_session;                   // 세션 저장 여부
    int save_result;                    // 결과 저장 여부
    char data_dir[SW_STR_PATH];         // 세션·결과 폴더
    char base_url[SW_STR_PATH];         // 서버 주소
    char config_path[SW_STR_PATH];      // 설정 파일 경로
} SwConfig;

// 로그인 세션 (session.json)
typedef struct {
    char student_id[SW_STR_ID];     // 학번
    char user_no[SW_STR_ID];        // 사용자 번호
    char saved_at[SW_STR_TINY];     // 저장 시각
    SwCookieJar cookies;            // 재접속용 쿠키
} SwSession;

// 수강 과목
typedef struct {
    char title[SW_STR_TITLE];           // 과목명
    char crs_cre_cd[SW_STR_ID];         // 강의실 코드
    char crs_type_cd[SW_STR_TINY];      // 과목 유형 코드
    char category[SW_STR_TINY];         // curricular | extracurricular
    char label[SW_STR_TINY];            // 화면 라벨
} SwCourse;

// 과제 한 건
typedef struct {
    char id[SW_STR_ID];                 // 과제 코드
    char title[SW_STR_TITLE];           // 과제명
    char period[SW_STR_PERIOD];         // 제출 기간
    char status[SW_STR_STATUS];         // 제출 상태
    char crs_cre_cd[SW_STR_ID];         // 강의실 코드
    int due_now;                        // 기간 안 미제출 여부
} SwAssignment;

// 이러닝 차시 한 건
typedef struct {
    char week[SW_STR_TITLE];            // 주차
    char title[SW_STR_TITLE];           // 차시명
    char period[SW_STR_PERIOD];         // 학습 기간
    char attendance[SW_STR_STATUS];     // 출결 상태
    char lesson_cnts_id[SW_STR_ID];     // 콘텐츠 ID
    char lesson_schedule_id[SW_STR_ID]; // 주차 ID
    char crs_cre_cd[SW_STR_ID];         // 강의실 코드
    int needs_watch;                    // 들을 차시 여부
    int progress_percent;               // 학습률 (-1 = 미조회)
} SwLesson;

// 과목 + 과제 + 이러닝
typedef struct {
    SwCourse course;                    // 과목 정보
    SwAssignment *assignments;          // 과제 목록
    size_t n_asg;                       // 과제 개수
    size_t cap_asg;                     // 과제 용량
    SwLesson *lessons;                  // 차시 목록
    size_t n_les;                       // 차시 개수
    size_t cap_les;                     // 차시 용량
    int fetched_asg;                    // 과제 조회 완료
    int fetched_les;                    // 차시 조회 완료
} SwCourseData;

// 로그인 결과
typedef struct {
    int type;                           // 0=실패, 1=성공, 2=OTP
    char message[SW_STR_MSG];           // 메시지
    char user_id[SW_STR_ID];            // 사용자 ID
    char user_no[SW_STR_ID];            // 사용자 번호
    char redirect[SW_STR_PATH];         // 이동 경로
} SwLoginResult;

// HTTP 클라이언트
typedef struct {
    char host[SW_STR_HOST];             // 호스트
    int port;                           // 포트
    int https;                          // HTTPS 여부
    SwCookieJar jar;                    // 쿠키 저장소
    char last_error[SW_STR_MSG];        // 마지막 오류
#ifdef _WIN32
    void *session;                      // WinHTTP 세션 핸들
#endif
} SwHttp;

// 프로그램 상태
typedef struct {
    SwConfig cfg;                       // 설정
    SwSession sess;                     // 세션
    SwHttp http;                        // HTTP
    SwCourseData *courses;              // 과목 목록
    size_t n_courses;                   // 과목 개수
    int logged_in;                      // 로그인 여부
    int demo;                           // 데모 모드
    int quiet;                          // 1 이면 TUI 문구·스피너 없음 (GUI RPC)
    char testdata_dir[SW_STR_PATH];     // testdata 폴더
    char last_error[SW_STR_MSG];        // 마지막 오류
} SwApp;

#endif
