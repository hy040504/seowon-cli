"""e-campus HTML/JSON 파서."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime

from lib.seowon import Assignment, Course, CourseData, Lesson, LoginResult
from lib.util import (
    decode_entities,
    html_to_text,
    looks_like_login_html,
    normalize_space,
    period_active,
)


def parse_login_json(raw: str) -> LoginResult:
    """로그인 API JSON. type: 0 실패, 1 성공, 2 OTP."""
    out = LoginResult(type=0, message="아이디 또는 비밀번호가 맞지 않습니다.")
    if not raw:
        raise ValueError("empty login json")
    try:
        root = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError("login json") from e
    if not isinstance(root, dict):
        raise ValueError("login json")
    uid = root.get("userId")
    uno = root.get("userNo")
    msg = root.get("message")
    redir = root.get("redirectUrl")
    if isinstance(uid, str):
        out.user_id = uid
    if isinstance(uno, str):
        out.user_no = uno
    if isinstance(msg, str) and msg:
        out.message = msg
    if not redir:
        out.type = 0
        return out
    out.redirect = str(redir)
    otp = root.get("otpLogin")
    otp_user = root.get("otpUserYn")
    otp_type = root.get("otpUserType")
    if (
        isinstance(otp, str)
        and isinstance(otp_user, str)
        and otp.startswith("Y")
        and otp_user.startswith("Y")
        and isinstance(otp_type, str)
        and "LEARNER" in otp_type
        and out.user_id
        and out.user_no
    ):
        out.type = 2
        out.message = "OTP 로그인이 필요합니다. 이 프로그램은 OTP를 지원하지 않습니다."
        return out
    out.type = 1
    out.message = "로그인 성공"
    return out


def _extract_quoted(s: str) -> tuple[str, str] | None:
    """첫 따옴표 문자열과 나머지."""
    i = 0
    n = len(s)
    while i < n and s[i] not in "'\"":
        i += 1
    if i >= n:
        return None
    q = s[i]
    i += 1
    start = i
    while i < n and s[i] != q:
        i += 1
    val = s[start:i]
    if i < n and s[i] == q:
        i += 1
    if not val:
        return None
    return val, s[i:]


def _copy_inner_tag(html: str, tag: str) -> str:
    """첫 태그 안 텍스트."""
    open_t = f"<{tag}"
    a = html.find(open_t)
    if a < 0:
        return ""
    a = html.find(">", a)
    if a < 0:
        return ""
    a += 1
    b = html.find("</", a)
    if b < 0:
        b = len(html)
    return normalize_space(decode_entities(html[a:b]))


def parse_courses_html(html: str) -> list[CourseData]:
    """강의실 목록 HTML 에서 과목 코드·제목을 뽑는다."""
    if html is None:
        raise ValueError("courses html")
    list_: list[CourseData] = []
    p = 0
    while True:
        idx = html.find("classRoomMain", p)
        if idx < 0:
            break
        q = html[idx + 13 :]
        first = _extract_quoted(q)
        if not first:
            p = idx + 13
            continue
        cd, rest = first
        second = _extract_quoted(rest)
        if not second:
            p = idx + 13
            continue
        ty, rest2 = second
        win_end = min(len(html), idx + 13 + 800)
        window = html[idx:win_end]
        title = _copy_inner_tag(window, "span")
        label = _copy_inner_tag(window, "label")
        if not title or not cd:
            p = idx + 13
            continue
        category = "extracurricular" if ty == "CO" or "비교과" in label else "curricular"
        list_.append(
            CourseData(
                course=Course(
                    title=title,
                    crs_cre_cd=cd,
                    crs_type_cd=ty,
                    label=label,
                    category=category,
                )
            )
        )
        p = idx + 13 + (len(q) - len(rest2))
    if not list_ and looks_like_login_html(html):
        raise SessionExpired("과목 목록을 해석하지 못했습니다. 세션을 확인하세요.")
    return list_


class SessionExpired(RuntimeError):
    """로그인 HTML 이 돌아온 경우."""


_STOPS = [
    "제출기간",
    "기간 외 학습기간",
    "기간",
    "출결상태",
    "강의시간",
    "수업내용",
    "과제를 제출",
    "미제출",
    "종료",
    "진행중",
]


def _extract_labeled(text: str, label: str) -> str:
    """`제목 : 값` 형태에서 값을 읽는다."""
    p = text.find(label)
    if p < 0:
        return ""
    p += len(label)
    while p < len(text) and text[p] in " \t:\n":
        p += 1
    end = len(text)
    for stop in _STOPS:
        if stop == label:
            continue
        s = text.find(stop, p)
        if s >= 0 and s < end:
            end = s
    return normalize_space(text[p:end].rstrip(" \t"))


def _extract_status(text: str) -> str:
    """과제 창 텍스트에서 제출 상태를 고른다."""
    if "과제를 제출하였습니다" in text:
        return "과제를 제출하였습니다"
    if "미제출" in text:
        return "미제출"
    if "진행중" in text:
        return "진행중"
    if "종료" in text:
        return "종료"
    return ""


def assignment_unsubmitted(a: Assignment) -> bool:
    """제출 완료가 아니면 미제출로 본다."""
    if not a.status:
        return True
    if "과제를 제출" in a.status or "제출하" in a.status:
        return False
    return True


def assignment_missing_or_progress(a: Assignment) -> bool:
    """미제출이거나 진행중인 과제."""
    return a.status == "미제출" or "진행중" in a.status


def lesson_unwatched(l: Lesson) -> bool:
    """출결이 미학습·지각이면 들어야 할 차시."""
    if not l.attendance:
        return False
    return "학습중(지각)" in l.attendance or "미학습(결석)" in l.attendance


def mark_assignment_flags(a: Assignment, now: float | None = None) -> None:
    """기간 안 + 미제출이면 due_now."""
    if now is None:
        now = time.time()
    a.due_now = period_active(a.period, now) and assignment_unsubmitted(a)


def mark_lesson_flags(l: Lesson, now: float | None = None) -> None:
    """기간 안 + 미학습이면 needs_watch."""
    if now is None:
        now = time.time()
    l.needs_watch = period_active(l.period, now) and lesson_unwatched(l)


def parse_assignments_html(html: str, crs_cre_cd: str, now: float | None = None) -> list[Assignment]:
    """과제 목록 HTML. 창은 앞쪽 <a> 부터 다음 asmntView 까지."""
    if html is None:
        raise ValueError("assignments html")
    if now is None:
        now = time.time()
    out: list[Assignment] = []
    p = 0
    while True:
        idx = html.find("asmntView", p)
        if idx < 0:
            break
        q = html[idx + 9 :]
        got = _extract_quoted(q)
        if not got:
            p = idx + 9
            continue
        aid, rest = got
        a_pos = html.rfind("<a", 0, idx)
        start = a_pos if a_pos >= 0 else idx
        nxt = html.find("asmntView", idx + 9)
        end = nxt if nxt >= 0 else min(len(html), idx + 800)
        window = html[start:end]
        title = _copy_inner_tag(window, "a")
        text = html_to_text(window)
        period = _extract_labeled(text, "제출기간")
        status = _extract_status(text)
        if not aid or not title:
            p = idx + 9 + (len(q) - len(rest))
            continue
        a = Assignment(id=aid, title=title, period=period, status=status, crs_cre_cd=crs_cre_cd or "")
        mark_assignment_flags(a, now)
        out.append(a)
        p = idx + 9 + (len(q) - len(rest))
    return out


def _id_token(s: str) -> str:
    """숫자·밑줄만 남긴 ID."""
    i = 0
    while i < len(s) and (s[i].isalnum() or s[i] == "_"):
        i += 1
    return s[:i]


def _find_week_for(html: str, schedule_id: str) -> str:
    """일정 ID 앞쪽에서 주차 글자를 찾는다."""
    if not schedule_id:
        return ""
    key = f"dropdown_{schedule_id}"
    p = html.find(key)
    if p < 0:
        key = f'id="{schedule_id}"'
        p = html.find(key)
    if p < 0:
        return ""
    window = html[p : p + 800]
    week = _copy_inner_tag(window, "section")
    if week:
        return week
    t = html_to_text(window)
    w = t.find("주차")
    if w >= 0:
        s = w
        while s > 0 and (t[s - 1].isdigit() or t[s - 1] == " "):
            s -= 1
        return normalize_space(t[s:w] + "주차")
    return ""


def parse_lessons_html(html: str, crs_cre_cd: str, now: float | None = None) -> list[Lesson]:
    """이러닝 차시 HTML. CNTS_ 가 콘텐츠, LESN_ 이 일정."""
    if html is None:
        raise ValueError("lessons html")
    if now is None:
        now = time.time()
    out: list[Lesson] = []
    seen: set[str] = set()
    p = 0
    while True:
        idx = html.find("CNTS_", p)
        if idx < 0:
            break
        cnts = _id_token(html[idx:])
        a_pos = html.rfind("<a", 0, idx)
        start = a_pos if a_pos >= 0 else max(0, idx - 80)
        lesn = ""
        found = -1
        search = max(0, start - 200)
        while True:
            ls = html.find("LESN_", search)
            if ls < 0 or ls >= idx:
                break
            found = ls
            search = ls + 5
        if found >= 0:
            lesn = _id_token(html[found:])
        nxt = html.find("CNTS_", idx + 5)
        end = nxt if nxt >= 0 else min(len(html), idx + 500)
        window = html[start:end]
        title = _copy_inner_tag(window, "a")
        text = html_to_text(window)
        period = _extract_labeled(text, "기간 외 학습기간")
        if not period:
            period = _extract_labeled(text, "기간")
        att = _extract_labeled(text, "출결상태")
        week = _find_week_for(html, lesn)
        if not title or not cnts:
            p = idx + 5
            continue
        if cnts in seen:
            p = idx + 5
            continue
        seen.add(cnts)
        les = Lesson(
            lesson_cnts_id=cnts,
            lesson_schedule_id=lesn,
            title=title,
            period=period,
            attendance=att,
            week=week,
            crs_cre_cd=crs_cre_cd or "",
            progress_percent=-1,
        )
        mark_lesson_flags(les, now)
        out.append(les)
        p = idx + 5
    return out


def parse_assignment_detail(html: str) -> str:
    """과제 본문. 제출은 하지 않고 글만 읽는다."""
    if not html:
        raise ValueError("detail html")
    p = html.find("과제내용")
    if p < 0:
        text = html_to_text(html)
        if not text:
            raise ValueError("detail html")
        return text
    end = html.find("label-title", p + 8)
    if end < 0:
        end = min(len(html), p + 4000)
    chunk = html[p:end]
    return html_to_text(chunk)


def parse_progress_json(raw: str) -> int:
    """학습률 JSON 의 prgrRatio. 시청 기록은 보내지 않는다."""
    if raw is None:
        raise ValueError("progress json")
    try:
        root = json.loads(raw)
    except json.JSONDecodeError:
        root = None
    if root is not None:
        found = _walk_prgr(root)
        if found is not None:
            return found
    p = raw.find("prgrRatio")
    if p >= 0:
        colon = raw.find(":", p)
        if colon >= 0:
            rest = raw[colon + 1 :].lstrip(' :"')
            try:
                return int(re.match(r"-?\d+", rest).group(0))  # type: ignore[union-attr]
            except Exception:
                pass
    raise ValueError("progress json")


def _walk_prgr(n: object) -> int | None:
    """JSON 트리에서 prgrRatio 를 찾는다."""
    if isinstance(n, dict):
        for k, v in n.items():
            if k in ("prgrRatio", "progressPercent") and v is not None:
                try:
                    return int(v)
                except (TypeError, ValueError):
                    pass
            found = _walk_prgr(v)
            if found is not None:
                return found
    elif isinstance(n, list):
        for v in n:
            found = _walk_prgr(v)
            if found is not None:
                return found
    return None


def course_semester(list_: list[CourseData]) -> str:
    """과목 코드 `YYYY_학기_...` 에서 학기를 읽는다."""
    now = datetime.now()
    sem = f"{now.year}-{2 if now.month >= 8 else 1}"
    for item in list_:
        m = re.match(r"(\d+)_(\d+)", item.course.crs_cre_cd)
        if m:
            y = int(m.group(1))
            term = int(m.group(2))
            if y >= 2000:
                sem = f"{y}-{term}"
                if item.course.category == "curricular":
                    break
    return sem
