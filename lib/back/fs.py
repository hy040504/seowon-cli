"""config.json · login.json · session.json · result.json."""

from __future__ import annotations

import json
from pathlib import Path

from lib.seowon import (
    BASE_URL,
    HOST,
    LOGIN_FILE,
    Assignment,
    Config,
    Cookie,
    Course,
    CourseData,
    Lesson,
    LoginFile,
    Session,
)
from lib.back.parse import course_semester
from lib.util import now_iso, write_file


def config_default() -> Config:
    """실행 폴더의 기본 config.json 값."""
    return Config()


def config_load(path: str | Path = "config.json") -> Config:
    """config.json. 없으면 호출 쪽에서 기본값을 만든다."""
    cfg = config_default()
    cfg.config_path = str(path)
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("config.json")
    cfg.last_student_id = str(root.get("lastStudentId") or "")
    cfg.save_session = bool(root.get("saveSession", True))
    cfg.save_result = bool(root.get("saveResult", True))
    cfg.data_dir = str(root.get("dataDir") or "./db")
    cfg.base_url = str(root.get("baseUrl") or BASE_URL)
    return cfg


def config_save(cfg: Config) -> None:
    """config.json 에 학번·저장 옵션·폴더를 쓴다."""
    data = {
        "lastStudentId": cfg.last_student_id,
        "saveSession": cfg.save_session,
        "saveResult": cfg.save_result,
        "dataDir": cfg.data_dir,
    }
    write_file(cfg.config_path or "config.json", json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def config_paths(cfg: Config) -> tuple[Path, Path]:
    """(session.json, result.json) 경로."""
    base = Path(cfg.data_dir)
    return base / "session.json", base / "result.json"


def login_file_complete(lf: LoginFile) -> bool:
    """학번·비밀번호가 둘 다 있으면 True."""
    return bool(lf.student_id.strip() and lf.password.strip())


def login_file_wipe(lf: LoginFile) -> None:
    """메모리의 학번·비밀번호만 지운다. 파일은 그대로 둔다."""
    lf.student_id = ""
    lf.password = ""


def login_file_load(path: str | Path = LOGIN_FILE) -> LoginFile:
    """login.json 읽기."""
    lf = LoginFile(path=str(path))
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("login.json")
    lf.student_id = str(root.get("studentId") or "").strip()
    lf.password = str(root.get("password") or "")
    return lf


def login_file_save(lf: LoginFile) -> None:
    """login.json 쓰기. 로컬 전용."""
    data = {"studentId": lf.student_id, "password": lf.password}
    write_file(lf.path or LOGIN_FILE, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def login_file_ensure(path: str | Path = LOGIN_FILE) -> None:
    """없으면 빈 login.json 을 만든다."""
    p = Path(path)
    if p.is_file():
        return
    login_file_save(LoginFile(path=str(p)))


def session_load(path: str | Path) -> Session:
    """session.json. 비밀번호는 없다."""
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("session.json")
    sess = Session(
        student_id=str(root.get("studentId") or ""),
        user_no=str(root.get("userNo") or root.get("studentId") or ""),
        student_name=str(root.get("studentName") or ""),
        dept_name=str(root.get("deptName") or ""),
        dept_cd=str(root.get("deptCd") or ""),
        saved_at=str(root.get("savedAt") or ""),
    )
    cookies = root.get("cookies") or []
    if isinstance(cookies, list):
        for it in cookies:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "")
            if not name:
                continue
            sess.cookies.append(
                Cookie(
                    name=name,
                    value=str(it.get("value") or ""),
                    domain=str(it.get("domain") or HOST),
                )
            )
    return sess


def session_save(path: str | Path, sess: Session) -> None:
    """쿠키와 이름·학과. 비밀번호는 넣지 않는다."""
    data = {
        "studentId": sess.student_id,
        "userNo": sess.user_no,
        "studentName": sess.student_name,
        "deptName": sess.dept_name,
        "deptCd": sess.dept_cd,
        "savedAt": sess.saved_at,
        "cookies": [{"name": c.name, "value": c.value, "domain": c.domain} for c in sess.cookies],
    }
    write_file(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def result_save(path: str | Path, courses: list[CourseData], semester: str | None = None) -> dict:
    """최근 조회 결과를 result.json 에 쓴다."""
    if semester is None:
        semester = course_semester(courses)
    out_courses = []
    summary = []
    for item in courses:
        asg = []
        el = []
        due = 0
        pend = 0
        for a in item.assignments:
            asg.append(
                {
                    "title": a.title,
                    "period": a.period,
                    "status": a.status,
                    "dueNow": bool(a.due_now),
                }
            )
            if a.due_now:
                due += 1
        for l in item.lessons:
            rec = {
                "week": l.week,
                "title": l.title,
                "period": l.period,
                "attendanceStatus": l.attendance,
                "needsWatch": bool(l.needs_watch),
                "progressPercent": l.progress_percent if l.progress_percent >= 0 else None,
            }
            el.append(rec)
            if l.needs_watch:
                pend += 1
        out_courses.append(
            {
                "courseTitle": item.course.title,
                "crsCreCd": item.course.crs_cre_cd,
                "assignments": asg,
                "elearning": el,
            }
        )
        summary.append(
            {
                "courseTitle": item.course.title,
                "dueAssignments": due,
                "pendingLessons": pend,
            }
        )
    data = {
        "savedAt": now_iso(),
        "semester": semester or "",
        "courses": out_courses,
        "summary": summary,
    }
    write_file(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return data


def result_load(path: str | Path) -> tuple[list[CourseData], str]:
    """result.json → (과목 목록, 학기)."""
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("result.json")
    semester = str(root.get("semester") or "")
    list_: list[CourseData] = []
    for co in root.get("courses") or []:
        if not isinstance(co, dict):
            continue
        item = CourseData(
            course=Course(
                title=str(co.get("courseTitle") or ""),
                crs_cre_cd=str(co.get("crsCreCd") or ""),
            ),
            fetched_asg=True,
            fetched_les=True,
        )
        for it in co.get("assignments") or []:
            if not isinstance(it, dict):
                continue
            a = Assignment(
                title=str(it.get("title") or ""),
                period=str(it.get("period") or ""),
                status=str(it.get("status") or ""),
                crs_cre_cd=item.course.crs_cre_cd,
                due_now=bool(it.get("dueNow")),
            )
            item.assignments.append(a)
        for it in co.get("elearning") or []:
            if not isinstance(it, dict):
                continue
            pr = it.get("progressPercent")
            try:
                pct = int(pr) if pr is not None else -1
            except (TypeError, ValueError):
                pct = -1
            l = Lesson(
                week=str(it.get("week") or ""),
                title=str(it.get("title") or ""),
                period=str(it.get("period") or ""),
                attendance=str(it.get("attendanceStatus") or ""),
                crs_cre_cd=item.course.crs_cre_cd,
                needs_watch=bool(it.get("needsWatch")),
                progress_percent=pct,
            )
            item.lessons.append(l)
        list_.append(item)
    return list_, semester
