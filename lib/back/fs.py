"""config.json · login.json · session.json · result.json.

로컬 JSON 만 다룬다. 비밀번호는 ``login.json`` 에만 두고 ``session.json`` 에는 넣지 않는다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lib.seowon import (
    BASE_URL,
    HOST,
    LOGIN_FILE,
    Assignment,
    Attachment,
    BoardPost,
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
    """실행 폴더의 기본 ``config.json`` 값.

    Returns:
        비어 있는 ``Config``.
    """
    return Config()


def config_load(path: str | Path = "config.json") -> Config:
    """``config.json`` 을 읽는다. 없으면 호출 쪽에서 기본값을 만든다.

    Args:
        path: 설정 파일 경로.

    Returns:
        채운 ``Config``.

    Raises:
        ValueError: 최상위가 객체가 아닐 때.
        OSError: 파일이 없을 때.
    """
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
    """``config.json`` 에 학번·저장 옵션·폴더를 쓴다.

    Args:
        cfg: 저장할 설정. ``config_path`` 가 비면 ``config.json``.
    """
    data = {
        "lastStudentId": cfg.last_student_id,
        "saveSession": cfg.save_session,
        "saveResult": cfg.save_result,
        "dataDir": cfg.data_dir,
    }
    write_file(cfg.config_path or "config.json", json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def config_paths(cfg: Config) -> tuple[Path, Path]:
    """세션·결과 JSON 경로.

    Args:
        cfg: dataDir 이 들어 있는 설정.

    Returns:
        ``(session.json, result.json)``.
    """
    base = Path(cfg.data_dir)
    return base / "session.json", base / "result.json"


def login_file_complete(lf: LoginFile) -> bool:
    """학번·비밀번호가 둘 다 있으면 True.

    Args:
        lf: login.json 내용.

    Returns:
        둘 다 비어 있지 않으면 True.
    """
    return bool(lf.student_id.strip() and lf.password.strip())


def login_file_wipe(lf: LoginFile) -> None:
    """메모리의 학번·비밀번호만 지운다. 파일은 그대로 둔다.

    Args:
        lf: 지울 객체.
    """
    lf.student_id = ""
    lf.password = ""


def login_file_load(path: str | Path = LOGIN_FILE) -> LoginFile:
    """``login.json`` 을 읽는다.

    Args:
        path: 파일 경로.

    Returns:
        학번·비밀번호.

    Raises:
        ValueError: 최상위가 객체가 아닐 때.
    """
    lf = LoginFile(path=str(path))
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("login.json")
    lf.student_id = str(root.get("studentId") or "").strip()
    lf.password = str(root.get("password") or "")
    return lf


def login_file_save(lf: LoginFile) -> None:
    """``login.json`` 쓰기. 로컬 전용.

    Args:
        lf: 저장할 학번·비밀번호.
    """
    data = {"studentId": lf.student_id, "password": lf.password}
    write_file(lf.path or LOGIN_FILE, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def login_file_ensure(path: str | Path = LOGIN_FILE) -> None:
    """없으면 빈 ``login.json`` 을 만든다.

    Args:
        path: 만들 경로.
    """
    p = Path(path)
    if p.is_file():
        return
    login_file_save(LoginFile(path=str(p)))


def session_load(path: str | Path) -> Session:
    """``session.json`` 을 읽는다. 비밀번호는 없다.

    Args:
        path: 파일 경로.

    Returns:
        학번·이름·학과·쿠키.

    Raises:
        ValueError: 최상위가 객체가 아닐 때.
    """
    raw = Path(path).read_text(encoding="utf-8")
    root = json.loads(raw)
    if not isinstance(root, dict):
        raise ValueError("session.json")
    sess = Session(
        student_id=str(root.get("studentId") or ""),
        user_no=str(root.get("userNo") or root.get("studentId") or ""),
        student_name=str(root.get("studentName") or ""),
        college_name=str(root.get("collegeName") or ""),
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
    """쿠키와 이름·학과를 쓴다. 비밀번호는 넣지 않는다.

    Args:
        path: 저장 경로.
        sess: 세션.
    """
    data = {
        "studentId": sess.student_id,
        "userNo": sess.user_no,
        "studentName": sess.student_name,
        "collegeName": sess.college_name,
        "deptName": sess.dept_name,
        "deptCd": sess.dept_cd,
        "savedAt": sess.saved_at,
        "cookies": [{"name": c.name, "value": c.value, "domain": c.domain} for c in sess.cookies],
    }
    write_file(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def result_save(
    path: str | Path,
    courses: list[CourseData],
    semester: str | None = None,
    timetable: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """최근 조회 결과를 ``result.json`` 에 쓴다.

    Parameters
    ----------
    path : str or Path
        저장 경로.
    courses : list of CourseData
        과목별 과제·이러닝·공지·자료.
    semester : str or None
        학기 표시. None 이면 과목 코드에서 추정.
    timetable : dict or None
        시간표 JSON. ``svg`` 필드는 파일에 넣지 않는다.

    Returns
    -------
    dict
        파일에 쓴 것과 같은 객체.
    """
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
                    "id": a.id,
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

        def board_dump(posts: list[BoardPost]) -> list[dict[str, Any]]:
            """공지·자료 JSON.

            Args:
                posts: 글 목록.

            Returns:
                GUI/result.json 용 dict 목록.
            """
            rows = []
            for p in posts:
                rows.append(
                    {
                        "id": p.id,
                        "title": p.title,
                        "date": p.date,
                        "hasAttachment": bool(p.has_attachment),
                        "crsCreCd": p.crs_cre_cd,
                        "bbsId": p.bbs_id,
                        "bbsCd": p.bbs_cd,
                        "text": p.text,
                        "attachments": [{"title": a.title, "url": a.url, "token": a.token} for a in p.attachments],
                    }
                )
            return rows

        out_courses.append(
            {
                "courseTitle": item.course.title,
                "crsCreCd": item.course.crs_cre_cd,
                "category": item.course.category,
                "label": item.course.label,
                "assignments": asg,
                "elearning": el,
                "notices": board_dump(item.notices),
                "materials": board_dump(item.materials),
            }
        )
        summary.append(
            {
                "courseTitle": item.course.title,
                "dueAssignments": due,
                "pendingLessons": pend,
            }
        )
    tt = dict(timetable or {})
    tt.pop("svg", None)
    data = {
        "savedAt": now_iso(),
        "semester": semester or "",
        "courses": out_courses,
        "summary": summary,
        "timetable": tt,
    }
    write_file(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return data


def result_load(path: str | Path) -> tuple[list[CourseData], str]:
    """``result.json`` 을 과목 목록으로 되돌린다.

    Parameters
    ----------
    path : str or Path
        파일 경로.

    Returns
    -------
    list of CourseData
        과제·이러닝·공지·자료가 채워진 과목.
    str
        학기 문자열.

    Raises
    ------
    ValueError
        최상위가 객체가 아닐 때.
    """
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
                category=str(co.get("category") or ""),
                label=str(co.get("label") or ""),
            ),
            fetched_asg=True,
            fetched_les=True,
        )
        for it in co.get("assignments") or []:
            if not isinstance(it, dict):
                continue
            a = Assignment(
                id=str(it.get("id") or ""),
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

        def board_load(raw_posts: object, bbs_cd: str) -> list[BoardPost]:
            """공지·자료 JSON 배열을 ``BoardPost`` 로 바꾼다.

            Args:
                raw_posts: JSON 값.
                bbs_cd: 기본 게시판 코드.

            Returns:
                글 목록. 배열이 아니면 빈 목록.
            """
            posts: list[BoardPost] = []
            if not isinstance(raw_posts, list):
                return posts
            for it in raw_posts:
                if not isinstance(it, dict):
                    continue
                post = BoardPost(
                    id=str(it.get("id") or ""),
                    title=str(it.get("title") or ""),
                    date=str(it.get("date") or ""),
                    has_attachment=bool(it.get("hasAttachment")),
                    crs_cre_cd=str(it.get("crsCreCd") or item.course.crs_cre_cd),
                    bbs_id=str(it.get("bbsId") or ""),
                    bbs_cd=str(it.get("bbsCd") or bbs_cd),
                    text=str(it.get("text") or ""),
                )
                for att in it.get("attachments") or []:
                    if isinstance(att, dict):
                        post.attachments.append(
                            Attachment(
                                title=str(att.get("title") or "첨부파일"),
                                url=str(att.get("url") or ""),
                                token=str(att.get("token") or ""),
                            )
                        )
                posts.append(post)
            return posts

        item.notices = board_load(co.get("notices"), "NOTICE")
        item.materials = board_load(co.get("materials"), "PDS")
        item.fetched_notice = True
        item.fetched_mat = True
        list_.append(item)
    return list_, semester
