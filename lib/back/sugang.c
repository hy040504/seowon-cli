// 수강신청 SSO 학생정보 — seowon-client-api findAppcsLogin / findStunoInfo
#include "sugang.h"
#include "ssv.h"
#include "http.h"
#include "../util.h"

#ifndef CJSON_HIDE_SYMBOLS
#define CJSON_HIDE_SYMBOLS
#endif
#include "cJSON.h"

static const char *LOGIN_COLS[] = {"syy",    "smtCd",  "unvfrStdrDeptCd", "stuno",     "password",
                                   "hy",     "deptCd", "notcClCd",        "appcsKindCd"};

static void now_ms(char *out, size_t outsz)
{
    snprintf(out, outsz, "%llu", (unsigned long long)time(NULL) * 1000ULL);
}

static void fill_from_ssv(const char *body, SwSession *sess)
{
    char name[SW_STR_TITLE], stuno[SW_STR_ID], dept[SW_STR_TITLE], dcd[SW_STR_TINY];

    name[0] = stuno[0] = dept[0] = dcd[0] = 0;
    sw_ssv_field(body, "dsStunoInfo", "stdntNm", name, sizeof(name));
    if (!name[0]) sw_ssv_field(body, "dsSession", "userNm", name, sizeof(name));
    sw_ssv_field(body, "dsStunoInfo", "stuno", stuno, sizeof(stuno));
    if (!stuno[0]) sw_ssv_field(body, "dsSession", "persNo", stuno, sizeof(stuno));
    sw_ssv_field(body, "dsStunoInfo", "deprtNm", dept, sizeof(dept));
    if (!dept[0]) sw_ssv_field(body, "dsSession", "deptNm", dept, sizeof(dept));
    sw_ssv_field(body, "dsStunoInfo", "deptCd", dcd, sizeof(dcd));
    if (!dcd[0]) sw_ssv_field(body, "dsStunoInfo", "deprtCd", dcd, sizeof(dcd));

    if (name[0]) sw_str_copy(sess->student_name, sizeof(sess->student_name), name);
    if (stuno[0]) {
        sw_str_copy(sess->student_id, sizeof(sess->student_id), stuno);
        if (!sess->user_no[0]) sw_str_copy(sess->user_no, sizeof(sess->user_no), stuno);
    }
    if (dept[0]) sw_str_copy(sess->dept_name, sizeof(sess->dept_name), dept);
    if (dcd[0]) sw_str_copy(sess->dept_cd, sizeof(sess->dept_cd), dcd);
}

static void build_login_body(SwBuf *out, const char *syy, const char *smt, const char *stuno,
                             const char *pw, const char *row_type)
{
    const char *cells[9];
    cells[0] = syy;
    cells[1] = smt;
    cells[2] = "20000";
    cells[3] = stuno;
    cells[4] = pw;
    cells[5] = "";
    cells[6] = "";
    cells[7] = "L";
    cells[8] = "100";
    sw_ssv_row(out, row_type, cells, 9);
}

int sw_sugang_fetch_profile(const char *stuno, const char *password, SwSession *sess)
{
    SwHttp http;
    SwBuf body, form;
    int status = 0;
    char ts[32], syy[8], smt[8], term[16];

    if (!stuno || !stuno[0] || !password || !password[0] || !sess) return SW_ERR;

    if (sw_http_init(&http, SW_SUGANG_URL) != SW_OK) return SW_ERR_NET;

    // 1) SESSIONID
    if (sw_http_get(&http, SW_SUGANG_HOME, SW_SUGANG_URL, 0, &body, &status) != SW_OK) {
        sw_http_free(&http);
        sw_buf_free(&body);
        return SW_ERR_NET;
    }
    sw_buf_free(&body);

    // 2) 학년도/학기
    now_ms(ts, sizeof(ts));
    sw_ssv_begin(&form);
    sw_ssv_add_param(&form, "flag", "1");
    sw_ssv_add_param(&form, "univunvfrSchdlCd", "SAPL00010001");
    sw_ssv_add_param(&form, "regDeptCd", "20000");
    sw_ssv_add_param(&form, "applcDeptCd", "");
    sw_ssv_add_param(&form, "applyCrseCd", "");
    sw_ssv_add_param(&form, "dgriCrseCd", "");
    sw_ssv_add_param(&form, "hy", "");
    sw_ssv_add_param(&form, "syy", "");
    sw_ssv_add_param(&form, "smtCd", "");
    sw_ssv_add_param(&form, "requestTimeStr", ts);
    if (sw_http_post(&http, SW_SUGANG_TERM, SW_SUGANG_URL, "text/xml", form.p, form.n, 1, &body,
                     &status) != SW_OK) {
        sw_buf_free(&form);
        sw_buf_free(&body);
        sw_http_free(&http);
        return SW_ERR_NET;
    }
    sw_buf_free(&form);
    term[0] = syy[0] = smt[0] = 0;
    sw_ssv_field(body.p ? body.p : "", "dsUnvfc", "reslt", term, sizeof(term));
    sw_buf_free(&body);
    if (strlen(term) >= 5) {
        memcpy(syy, term, 4);
        syy[4] = 0;
        sw_str_copy(smt, sizeof(smt), term + 4);
    } else {
        time_t t = time(NULL);
        struct tm tmv;
#ifdef _WIN32
        localtime_s(&tmv, &t);
#else
        localtime_r(&t, &tmv);
#endif
        snprintf(syy, sizeof(syy), "%d", tmv.tm_year + 1900);
        sw_str_copy(smt, sizeof(smt), tmv.tm_mon + 1 >= 8 ? "20" : "10");
    }

    // 3) findAppcsLogin — dsSession 에 userNm / persNo / deptNm
    now_ms(ts, sizeof(ts));
    sw_ssv_begin(&form);
    sw_ssv_add_param(&form, "requestTimeStr", ts);
    sw_ssv_dataset_begin(&form, "dsParam", LOGIN_COLS, 9);
    build_login_body(&form, syy, smt, stuno, password, "U");
    {
        const char *empty[9] = {syy, smt, "20000", "", "", "", "", "L", ""};
        sw_ssv_row(&form, "O", empty, 9);
    }
    sw_ssv_dataset_end(&form);
    if (sw_http_post(&http, SW_SUGANG_LOGIN, SW_SUGANG_URL, "text/xml", form.p, form.n, 1, &body,
                     &status) != SW_OK) {
        sw_buf_free(&form);
        sw_buf_free(&body);
        sw_http_free(&http);
        return SW_ERR_NET;
    }
    sw_buf_free(&form);
    fill_from_ssv(body.p ? body.p : "", sess);
    sw_buf_free(&body);

    // 4) findStunoInfo — stdntNm / stuno / deprtNm
    now_ms(ts, sizeof(ts));
    sw_ssv_begin(&form);
    sw_ssv_add_param(&form, "requestTimeStr", ts);
    sw_ssv_dataset_begin(&form, "dsParam", LOGIN_COLS, 9);
    build_login_body(&form, syy, smt, stuno, password, "N");
    sw_ssv_dataset_end(&form);
    if (sw_http_post(&http, SW_SUGANG_STUNO, SW_SUGANG_URL, "text/xml", form.p, form.n, 1, &body,
                     &status) == SW_OK) {
        fill_from_ssv(body.p ? body.p : "", sess);
    }
    sw_buf_free(&form);
    sw_buf_free(&body);
    sw_http_free(&http);

    return (sess->student_name[0] || sess->dept_name[0]) ? SW_OK : SW_ERR;
}

int sw_sugang_load_demo_profile(const char *testdata_dir, SwSession *sess)
{
    char path[SW_STR_PATH];
    SwBuf raw;
    cJSON *root, *it;

    if (!sess) return SW_ERR;
    sw_path_join(path, sizeof(path), testdata_dir ? testdata_dir : "db/testdata", "student.json");
    if (sw_read_file(path, &raw) != SW_OK) {
        sw_buf_free(&raw);
        if (!sess->student_id[0]) sw_str_copy(sess->student_id, sizeof(sess->student_id), "20241234");
        sw_str_copy(sess->student_name, sizeof(sess->student_name), "홍길동");
        sw_str_copy(sess->dept_name, sizeof(sess->dept_name), "컴퓨터공학과");
        return SW_OK;
    }
    root = cJSON_Parse(raw.p ? raw.p : "");
    sw_buf_free(&raw);
    if (!root) return SW_ERR_PARSE;
    it = cJSON_GetObjectItemCaseSensitive(root, "stuno");
    if (cJSON_IsString(it) && it->valuestring)
        sw_str_copy(sess->student_id, sizeof(sess->student_id), it->valuestring);
    it = cJSON_GetObjectItemCaseSensitive(root, "stdntNm");
    if (cJSON_IsString(it) && it->valuestring)
        sw_str_copy(sess->student_name, sizeof(sess->student_name), it->valuestring);
    it = cJSON_GetObjectItemCaseSensitive(root, "deprtNm");
    if (cJSON_IsString(it) && it->valuestring)
        sw_str_copy(sess->dept_name, sizeof(sess->dept_name), it->valuestring);
    it = cJSON_GetObjectItemCaseSensitive(root, "deptCd");
    if (cJSON_IsString(it) && it->valuestring)
        sw_str_copy(sess->dept_cd, sizeof(sess->dept_cd), it->valuestring);
    cJSON_Delete(root);
    return SW_OK;
}

void sw_session_label(const SwSession *sess, char *out, size_t outsz)
{
    const char *id, *nm, *dept;
    if (!out || outsz == 0) return;
    out[0] = 0;
    if (!sess) return;
    id = sess->student_id[0] ? sess->student_id : "-";
    nm = sess->student_name[0] ? sess->student_name : "";
    dept = sess->dept_name[0] ? sess->dept_name : "";
    if (nm[0] && dept[0])
        snprintf(out, outsz, "%s (%s) · %s", nm, id, dept);
    else if (nm[0])
        snprintf(out, outsz, "%s (%s)", nm, id);
    else if (dept[0])
        snprintf(out, outsz, "%s · %s", id, dept);
    else
        snprintf(out, outsz, "%s", id);
}
