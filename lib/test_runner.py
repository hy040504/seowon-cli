"""파서 · 필터 · 암호 단위 테스트."""

from __future__ import annotations

from pathlib import Path

from lib.back.crypto import make_encrypt_data_with_key
from lib.back.fs import login_file_complete, login_file_load, login_file_save, login_file_wipe, result_load, result_save
from lib.back.parse import (
    assignment_unsubmitted,
    mark_assignment_flags,
    mark_lesson_flags,
    parse_assignment_detail,
    parse_assignments_html,
    parse_courses_html,
    parse_lessons_html,
    parse_login_json,
    parse_progress_json,
)
from lib.back.ssv import RS, US, ssv_field
from lib.back.sugang import load_demo_profile, session_label
from lib.seowon import Assignment, Course, CourseData, Lesson, LoginFile, Session
from lib.util import local_ymdhms, period_active, read_file

g_pass = 0
g_fail = 0


def expect_true(cond: bool, name: str) -> None:
    """조건이 참이면 PASS."""
    global g_pass, g_fail
    if cond:
        print(f"  PASS  {name}")
        g_pass += 1
    else:
        print(f"  FAIL  {name}")
        g_fail += 1


def expect_streq(a: str | None, b: str | None, name: str) -> None:
    """문자열 같음."""
    ok = a is not None and b is not None and a == b
    if not ok:
        print(f'         got="{a}" expected="{b}"')
    expect_true(ok, name)


def run_tests(testdata_dir: str | Path) -> int:
    """파서·필터·암호 단위 테스트."""
    global g_pass, g_fail
    g_pass = g_fail = 0
    td = Path(testdata_dir)
    mid = local_ymdhms(2026, 8, 16, 12, 0, 0)
    may = local_ymdhms(2026, 5, 16, 12, 0, 0)

    print(f"seowon-cli 단위 테스트  testdata={td}\n")

    expect_true(period_active("2026.08.10 ~ 2026.08.20", mid), "period current in range")
    expect_true(not period_active("2026.05.14 ~ 2026.05.21", mid), "period may not current in august")
    expect_true(period_active("2026.05.14 ~ 2026.05.21", may), "period may in may")
    expect_true(not period_active("", mid), "empty period inactive")

    a = Assignment(status="미제출", period="2026.08.10 ~ 2026.08.20")
    mark_assignment_flags(a, mid)
    expect_true(assignment_unsubmitted(a), "unsubmitted")
    expect_true(a.due_now, "dueNow in period")
    a.status = "과제를 제출하였습니다"
    mark_assignment_flags(a, mid)
    expect_true(not a.due_now, "submitted not dueNow")

    l = Lesson(attendance="미학습(결석)", period="2026.08.11 ~ 2026.08.22")
    mark_lesson_flags(l, mid)
    expect_true(l.needs_watch, "needsWatch unwatched in period")
    l.attendance = "출석"
    mark_lesson_flags(l, mid)
    expect_true(not l.needs_watch, "attended not needsWatch")

    body = (
        f"SSV:utf-8{RS}Dataset:dsStunoInfo{RS}_RowType_{US}stdntNm:STRING(256)"
        f"{US}stuno:STRING(256){US}deprtNm:STRING(256){RS}N{US}홍길동{US}20241234{US}컴퓨터공학과"
    )
    expect_true(ssv_field(body, "dsStunoInfo", "stdntNm") == "홍길동", "ssv name")
    expect_streq(ssv_field(body, "dsStunoInfo", "stdntNm"), "홍길동", "ssv name value")
    expect_true(ssv_field(body, "dsStunoInfo", "stuno") == "20241234", "ssv stuno")
    expect_streq(ssv_field(body, "dsStunoInfo", "stuno"), "20241234", "ssv stuno value")
    expect_true(ssv_field(body, "dsStunoInfo", "deprtNm") == "컴퓨터공학과", "ssv dept")
    expect_streq(ssv_field(body, "dsStunoInfo", "deprtNm"), "컴퓨터공학과", "ssv dept value")

    s = Session()
    load_demo_profile(td, s)
    expect_streq(s.student_name, "홍길동", "demo profile name")
    expect_streq(s.student_id, "20241234", "demo profile id")
    expect_streq(s.dept_name, "컴퓨터공학과", "demo profile dept")
    who = session_label(s)
    expect_true("홍길동" in who and "20241234" in who, "session label")

    html = read_file(td / "login_ok.json")
    lr = parse_login_json(html)
    expect_true(lr.type == 1, "login ok")
    expect_streq(lr.user_no, "20241234", "login userNo")
    html = read_file(td / "login_fail.json")
    lr = parse_login_json(html)
    expect_true(lr.type == 0, "login fail")

    try:
        html = read_file(td / "courses.html")
        courses = parse_courses_html(html)
        expect_true(len(courses) >= 2, "parse courses count")
        if courses:
            expect_streq(courses[0].course.title, "논리회로", "course 0 title")
            expect_streq(courses[0].course.crs_cre_cd, "2026_1_736078_01", "course 0 code")
    except Exception:
        expect_true(False, "read courses.html")

    try:
        html = read_file(td / "assignments.html")
        alist = parse_assignments_html(html, "2026_1_736078_01", now=mid)
        expect_true(len(alist) >= 2, "parse assignments count")
        due = 0
        for item in alist:
            mark_assignment_flags(item, mid)
            if item.due_now:
                due += 1
        expect_true(due >= 1, "at least one dueNow assignment on 2026-08-16")
    except Exception:
        expect_true(False, "read assignments.html")

    try:
        html = read_file(td / "lessons.html")
        llist = parse_lessons_html(html, "2026_1_736078_01", now=mid)
        expect_true(len(llist) >= 2, "parse lessons count")
        w = 0
        for item in llist:
            mark_lesson_flags(item, mid)
            if item.needs_watch:
                w += 1
        expect_true(w >= 1, "at least one needsWatch lesson on 2026-08-16")
    except Exception:
        expect_true(False, "read lessons.html")

    try:
        html = read_file(td / "progress.json")
        pct = parse_progress_json(html)
        expect_true(pct == 72, "progress 72")
    except Exception:
        expect_true(False, "read progress.json")

    try:
        html = read_file(td / "assignment_detail.html")
        detail = parse_assignment_detail(html)
        expect_true("강의노트" in detail, "assignment detail text")
    except Exception:
        expect_true(False, "read assignment_detail.html")

    v2 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYISMhPJmt0BAk4tddyxhw4BmU5EnP9pmDeKYBsct6ls/QXGT+kQWkvxD4VFfdUnTvnCXS"
    v1 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYISMhxjkxxg0Kp3VSvfCR6GJYbn5XxOWXg4As1+42Bq1pmOHjv2SS4Gf1Q2NWyjO91G2d"
    out = make_encrypt_data_with_key("student", "password", "ABCDEFGHIJKLMNOPQRSTUVWX")
    expect_true(bool(out), "encrypt student generate")
    expect_streq(out, v2, "encrypt student/password fixed key")
    out = make_encrypt_data_with_key("20241234", "pass!@#", "ABCDEFGHIJKLMNOPQRSTUVWX")
    expect_true(bool(out), "encrypt special generate")
    expect_streq(out, v1, "encrypt 20241234/pass!@# fixed key")

    one = CourseData(course=Course(title="논리회로"))
    aa = Assignment(title="강의노트 2", period="2026.05.14 ~ 2026.05.21", status="미제출", due_now=True)
    one.assignments.append(aa)
    ll = Lesson(
        week="5주차",
        title="5-1. 조합논리",
        attendance="미학습(결석)",
        needs_watch=True,
        progress_percent=-1,
    )
    one.lessons.append(ll)
    Path("db").mkdir(parents=True, exist_ok=True)
    tmp = Path("db/_test_result.json")
    try:
        result_save(tmp, [one], "2026-2")
        expect_true(True, "result save")
        back, _sem = result_load(tmp)
        expect_true(len(back) == 1, "result load")
        if back:
            expect_streq(back[0].course.title, "논리회로", "result course title")
            expect_true(len(back[0].assignments) == 1 and back[0].assignments[0].due_now, "result dueNow")
            expect_true(len(back[0].lessons) == 1 and back[0].lessons[0].needs_watch, "result needsWatch")
    except Exception as e:
        expect_true(False, f"result roundtrip ({e})")

    lf = LoginFile(path="db/_test_login.json", student_id="20241234", password="secret")
    Path("db").mkdir(parents=True, exist_ok=True)
    try:
        login_file_save(lf)
        expect_true(True, "login save")
        back_lf = login_file_load(lf.path)
        expect_true(True, "login load")
        expect_streq(back_lf.student_id, "20241234", "login studentId")
        expect_streq(back_lf.password, "secret", "login password")
        expect_true(login_file_complete(back_lf), "login complete")
        login_file_wipe(back_lf)
        expect_true(not login_file_complete(back_lf), "login wipe")
        login_file_wipe(lf)
    except Exception as e:
        expect_true(False, f"login roundtrip ({e})")

    print(f"\n결과: {g_pass} 통과, {g_fail} 실패")
    return 1 if g_fail else 0
