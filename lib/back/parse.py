"""e-campus HTML/JSON 파서.

목록·상세 HTML 과 로그인/학습률 JSON 을 dataclass 로 바꾼다.
공지 제목은 번호 span 이 아니라 ``viewAtcl`` 링크 텍스트를 우선한다.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime

from lib.seowon import BASE_URL, Assignment, Attachment, BoardPost, Course, CourseData, Lesson, LoginResult
from lib.util import (
    decode_entities,
    html_to_text,
    looks_like_login_html,
    normalize_space,
    period_active,
)


def parse_login_json(raw: str) -> LoginResult:
    """로그인 API JSON 을 ``LoginResult`` 로 바꾼다.

    Parameters
    ----------
    raw : str
        ``/user/userHome/login`` 응답 본문.

    Returns
    -------
    LoginResult
        ``type`` 0=실패, 1=성공, 2=OTP.

    Raises
    ------
    ValueError
        빈 본문, JSON 아님, 객체가 아님.
    """
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
    """첫 따옴표 문자열과 나머지를 나눈다.

    Args:
        s: ``'a'`` 또는 ``"a"`` 가 들어 있는 구간.

    Returns:
        ``(값, 나머지)``. 없으면 None.
    """
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
    """첫 태그 안 텍스트.

    Args:
        html: HTML 조각.
        tag: 태그 이름. ``span``, ``a`` 등.

    Returns:
        안쪽 평문. 없으면 빈 문자열.
    """
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
    """강의실 목록 HTML 에서 과목 코드·제목을 뽑는다.

    Parameters
    ----------
    html : str
        ``classRoomCrsCreList`` 응답.

    Returns
    -------
    list of CourseData
        과목만 채운 목록.

    Raises
    ------
    ValueError
        html 이 None.
    SessionExpired
        목록이 비고 로그인 화면처럼 보일 때.
    """
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
    """로그인 HTML 이 돌아온 경우.

    쿠키가 만료되어 강의실 대신 로그인 페이지가 올 때 쓴다.
    """


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
    """``제목 : 값`` 형태에서 값을 읽는다.

    Args:
        text: 평문.
        label: ``제출기간`` 같은 표지.

    Returns:
        다음 표지 앞까지의 값.
    """
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
    """과제 창 텍스트에서 제출 상태를 고른다.

    Args:
        text: 과제 행 평문.

    Returns:
        제출 완료·미제출·진행중·종료 또는 빈 문자열.
    """
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
    """제출 완료가 아니면 미제출로 본다.

    Args:
        a: 과제.

    Returns:
        제출 완료 문구가 없으면 True.
    """
    if not a.status:
        return True
    if "과제를 제출" in a.status or "제출하" in a.status:
        return False
    return True


def assignment_missing_or_progress(a: Assignment) -> bool:
    """미제출이거나 진행중인 과제인지.

    Args:
        a: 과제.

    Returns:
        상태 필터에 넣을지.
    """
    return a.status == "미제출" or "진행중" in a.status


def lesson_unwatched(l: Lesson) -> bool:
    """출결이 미학습·지각이면 들어야 할 차시인지.

    Args:
        l: 차시.

    Returns:
        미학습(결석) 또는 학습중(지각)이면 True.
    """
    if not l.attendance:
        return False
    return "학습중(지각)" in l.attendance or "미학습(결석)" in l.attendance


def mark_assignment_flags(a: Assignment, now: float | None = None) -> None:
    """기간 안 + 미제출이면 ``due_now`` 를 켠다.

    Args:
        a: 과제. 제자리에서 수정.
        now: unix time. None 이면 현재.
    """
    if now is None:
        now = time.time()
    a.due_now = period_active(a.period, now) and assignment_unsubmitted(a)


def mark_lesson_flags(l: Lesson, now: float | None = None) -> None:
    """기간 안 + 미학습이면 ``needs_watch`` 를 켠다.

    Args:
        l: 차시. 제자리에서 수정.
        now: unix time. None 이면 현재.
    """
    if now is None:
        now = time.time()
    l.needs_watch = period_active(l.period, now) and lesson_unwatched(l)


def parse_assignments_html(html: str, crs_cre_cd: str, now: float | None = None) -> list[Assignment]:
    """과제 목록 HTML 을 ``Assignment`` 목록으로 바꾼다.

    창은 앞쪽 ``<a>`` 부터 다음 ``asmntView`` 까지다.

    Parameters
    ----------
    html : str
        ``stuAsmntGridList`` 응답.
    crs_cre_cd : str
        소속 과목 코드.
    now : float or None
        ``due_now`` 계산 시각.

    Returns
    -------
    list of Assignment
        과제 목록.

    Raises
    ------
    ValueError
        html 이 None.
    """
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
    """앞에서부터 영숫자·밑줄만 남긴 ID.

    Args:
        s: ``CNTS_...`` 로 시작하는 구간.

    Returns:
        ID 토큰.
    """
    i = 0
    while i < len(s) and (s[i].isalnum() or s[i] == "_"):
        i += 1
    return s[:i]


def _find_week_for(html: str, schedule_id: str) -> str:
    """일정 ID 앞쪽에서 주차 글자를 찾는다.

    Args:
        html: 차시 목록 HTML.
        schedule_id: ``LESN_`` ID.

    Returns:
        ``n주차`` 또는 빈 문자열.
    """
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
    """이러닝 차시 HTML 을 ``Lesson`` 목록으로 바꾼다.

    ``CNTS_`` 가 콘텐츠, ``LESN_`` 이 일정이다.

    Parameters
    ----------
    html : str
        ``lessonList`` 응답.
    crs_cre_cd : str
        소속 과목 코드.
    now : float or None
        ``needs_watch`` 계산 시각.

    Returns
    -------
    list of Lesson
        차시 목록.

    Raises
    ------
    ValueError
        html 이 None.
    """
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


def parse_assignment_send_type(html: str) -> str:
    """과제 화면의 제출 형식.

    Args:
        html: 과제 상세 HTML.

    Returns:
        ``F`` 파일, ``T`` 텍스트, 모르면 빈 문자열.
    """
    if not html:
        return ""
    patterns = (
        r'''["']sendType["']\s*[:=]\s*["']([FT])["']''',
        r'''name\s*=\s*["']sendType["'][^>]*value\s*=\s*["']([FT])["']''',
        r'''value\s*=\s*["']([FT])["'][^>]*name\s*=\s*["']sendType["']''',
    )
    for pat in patterns:
        m = re.search(pat, html, re.I)
        if m and m.group(1) in ("F", "T"):
            return m.group(1)
    if re.search(r'input[^>]*type=["\']file["\']', html, re.I):
        return "F"
    if "<textarea" in html.lower():
        return "T"
    return ""


def parse_assignment_title(html: str) -> str:
    """과제 상세의 과제명.

    Args:
        html: 과제 상세 HTML.

    Returns:
        과제명. 없으면 빈 문자열.
    """
    if not html:
        return ""
    p = html.find("과제명")
    if p < 0:
        return ""
    end = html.find("label-title", p + 6)
    if end < 0:
        end = min(len(html), p + 400)
    return html_to_text(html[p:end]).replace("과제명", "", 1).strip()


def extract_upload_file_sn(raw: str) -> str:
    """업로드 JSON 에서 ``fileSn`` / ``attachFileSns``.

    Args:
        raw: ajaxupload 응답.

    Returns:
        파일 번호. 없으면 빈 문자열.
    """
    if not raw:
        return ""
    text = raw.strip()
    try:
        root: object = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r'fileSn["\']?\s*[:=]\s*["\']?([A-Za-z0-9_=-]+)', text)
        return m.group(1) if m else ""

    def walk(node: object) -> str:
        """중첩 dict/list 에서 파일 번호를 찾는다.

        Args:
            node: JSON 값.

        Returns:
            첫 파일 번호 또는 빈 문자열.
        """
        if isinstance(node, dict):
            for key in ("fileSn", "attachFileSn", "attachFileSns", "fileId"):
                val = node.get(key)
                if val is not None and str(val).strip():
                    return str(val).strip()
            for val in node.values():
                found = walk(val)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        return ""

    return walk(root)


def parse_submit_ok(raw: str) -> bool:
    """``sendAsmnt`` 응답이 성공인지.

    Args:
        raw: JSON 또는 텍스트 응답.

    Returns:
        ``result > 0`` 이거나 success 문구가 있으면 True.
    """
    if not raw:
        return False
    try:
        root = json.loads(raw)
    except json.JSONDecodeError:
        low = raw.lower()
        return "success" in low or '"result":1' in raw.replace(" ", "")
    if isinstance(root, dict):
        try:
            return int(root.get("result") or 0) > 0
        except (TypeError, ValueError):
            return False
    return False


def parse_assignment_detail(html: str) -> str:
    """과제 본문을 평문으로 뽑는다.

    Args:
        html: 과제 상세 HTML.

    Returns:
        ``과제내용`` 구간 또는 전체 평문.

    Raises:
        ValueError: 본문이 비었을 때.
    """
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
    """학습률 JSON 의 ``prgrRatio``.

    Args:
        raw: ``viewLessonStudyDetail`` 응답.

    Returns:
        퍼센트 정수.

    Raises:
        ValueError: 값을 못 읽을 때.
    """
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
    """JSON 트리에서 ``prgrRatio`` 를 찾는다.

    Args:
        n: JSON 값.

    Returns:
        정수 학습률. 없으면 None.
    """
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


def parse_js_args(s: str) -> list[str]:
    """``javascript:fn('a','b')`` 따옴표 인자를 순서대로 읽는다.

    Args:
        s: 함수 호출이 들어 있는 구간.

    Returns:
        인자 문자열 목록.
    """
    out: list[str] = []
    rest = s
    while True:
        got = _extract_quoted(rest)
        if not got:
            break
        val, rest = got
        out.append(val)
    return out


def _rfind_open_tag(html: str, tag: str, idx: int) -> int:
    """``idx`` 앞에서 ``<tag ...>`` 시작 위치.

    Args:
        html: 전체 HTML.
        tag: 태그 이름.
        idx: 찾을 끝 위치.

    Returns:
        시작 인덱스. 없으면 -1.
    """
    needle = "<" + tag
    pos = html.lower().rfind(needle, 0, idx)
    if pos < 0:
        return -1
    nxt = pos + len(needle)
    if nxt < len(html) and html[nxt] not in " \t\r\n/>":
        return -1
    return pos


def _bbs_block(html: str, idx: int) -> str:
    """``viewAtcl`` 한 건이 들어 있는 ``li`` / ``tr`` / ``a``.

    같은 줄에 ``viewAtcl`` 이 두 번 있어도 행 전체를 잡아 제목을 자르지 않는다.

    Args:
        html: 목록 HTML.
        idx: ``viewAtcl`` 위치.

    Returns:
        그 행 HTML.
    """
    start = _rfind_open_tag(html, "li", idx)
    end_tag = "</li>"
    if start < 0:
        start = _rfind_open_tag(html, "tr", idx)
        end_tag = "</tr>"
    if start < 0:
        start = _rfind_open_tag(html, "a", idx)
        end_tag = "</a>"
    if start < 0:
        start = max(0, idx - 80)
        return html[start : min(len(html), idx + 700)]
    end = html.lower().find(end_tag, idx)
    if end < 0:
        end = min(len(html), start + 1200)
    else:
        end += len(end_tag)
    return html[start:end]


def _ok_bbs_title(s: str) -> bool:
    """목록 번호·날짜가 아닌 제목인지.

    Args:
        s: 후보 문자열.

    Returns:
        1~4자리 숫자, 날짜, 첨부/new 가 아니면 True.
    """
    t = normalize_space(s)
    if not t:
        return False
    if re.fullmatch(r"\d{1,4}", t):
        return False
    if re.fullmatch(r"20\d{2}\.\d{2}\.\d{2}", t):
        return False
    if t.lower() in ("첨부", "file", "new", "n", "p"):
        return False
    return True


def _viewatcl_link_title(window: str) -> str:
    """``javascript:viewAtcl`` 링크 안의 텍스트.

    Args:
        window: 행 HTML.

    Returns:
        링크 평문. 없으면 빈 문자열.
    """
    low = window.lower()
    p = 0
    while True:
        a = low.find("<a", p)
        if a < 0:
            return ""
        gt = window.find(">", a)
        if gt < 0:
            return ""
        if "viewatcl" in low[a:gt]:
            close = low.find("</a>", gt)
            inner = window[gt + 1 : close if close >= 0 else len(window)]
            return normalize_space(html_to_text(inner))
        p = a + 2


def _span_texts(window: str) -> list[str]:
    """span 안 텍스트. 중첩이면 안쪽부터 나온다.

    Args:
        window: 행 HTML.

    Returns:
        비어 있지 않은 span 평문.
    """
    out: list[str] = []
    low = window.lower()
    p = 0
    while True:
        a = low.find("<span", p)
        if a < 0:
            break
        gt = window.find(">", a)
        if gt < 0:
            break
        close = low.find("</span>", gt)
        if close < 0:
            break
        inner = normalize_space(html_to_text(window[gt + 1 : close]))
        if inner:
            out.append(inner)
        p = gt + 1
    return out


def _bbs_title(window: str) -> str:
    """게시판 행 제목. 번호 span 보다 링크 텍스트를 우선한다.

    Args:
        window: 행 HTML.

    Returns:
        제목. 못 읽으면 빈 문자열.
    """
    t = _viewatcl_link_title(window)
    if _ok_bbs_title(t):
        return t
    for s in reversed(_span_texts(window)):
        if _ok_bbs_title(s):
            return s
    a = _copy_inner_tag(window, "a")
    if _ok_bbs_title(a):
        return a
    text = html_to_text(window)
    text = re.sub(r"\b20\d{2}\.\d{2}\.\d{2}\b", " ", text)
    text = re.sub(r"viewAtcl", " ", text, flags=re.I)
    cleaned = normalize_space(text)
    cleaned = re.sub(r"\b(BBS|ATCL)_[A-Za-z0-9_]+", " ", cleaned)
    cleaned = normalize_space(re.sub(r"^\d{1,4}\s+", "", cleaned))
    return cleaned if _ok_bbs_title(cleaned) else ""


def parse_bbs_list_html(html: str, crs_cre_cd: str, section: str) -> list[BoardPost]:
    """공지(NOTICE) / 강의자료실(PDS) 목록을 읽는다.

    ``viewAtcl`` 호출과 행 전체에서 제목·날짜·첨부를 고른다.
    같은 행의 번호 span(``1``, ``3``) 은 제목으로 쓰지 않는다.

    Parameters
    ----------
    html : str
        ``atclList`` 응답.
    crs_cre_cd : str
        소속 과목 코드.
    section : str
        ``notices`` 또는 ``materials``.

    Returns
    -------
    list of BoardPost
        글 목록.

    Raises
    ------
    ValueError
        html 이 None.
    """
    if html is None:
        raise ValueError("bbs html")
    materials = section == "materials"
    suffix = "P" if materials else "N"
    bbs_cd = "PDS" if materials else "NOTICE"
    default_bbs = f"BBS_{crs_cre_cd}_{suffix}" if crs_cre_cd else ""
    out: list[BoardPost] = []
    seen: set[str] = set()
    p = 0
    while True:
        idx = html.find("viewAtcl", p)
        if idx < 0:
            break
        args = parse_js_args(html[idx : idx + 280])
        bbs_id = ""
        atcl_id = ""
        for a in args:
            if a.startswith("ATCL_") and not atcl_id:
                atcl_id = a
            elif a.startswith("BBS_") and not bbs_id:
                bbs_id = a
        if not atcl_id:
            p = idx + 8
            continue
        bbs_id = bbs_id or default_bbs
        window = _bbs_block(html, idx)
        title = _bbs_title(window)
        text = html_to_text(window)
        date_m = re.search(r"\b20\d{2}\.\d{2}\.\d{2}\b", text)
        date = date_m.group(0) if date_m else ""
        low = window.lower()
        has_att = (
            "paperclip" in low
            or "filedown" in low
            or "ico-paperclip" in low
            or 'alt="첨부' in window
            or "alt='첨부" in window
        )
        if title and atcl_id not in seen:
            seen.add(atcl_id)
            out.append(
                BoardPost(
                    id=atcl_id,
                    title=title,
                    date=date,
                    has_attachment=has_att,
                    crs_cre_cd=crs_cre_cd or "",
                    bbs_id=bbs_id,
                    bbs_cd=bbs_cd if bbs_id.endswith(f"_{suffix}") else bbs_cd,
                )
            )
        p = idx + 8
    return out


_FILE_NAME_RE = re.compile(
    r"([\w가-힣()[\]{}.+\- ]+\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?|zip|rar|7z|txt|jpg|jpeg|png|gif|mp4))",
    re.I,
)
FILE_DOWNLOAD_PATH = "/file/download/"


def parse_file_down_links(html: str, base_url: str = BASE_URL) -> list[Attachment]:
    """``fileDown('TOKEN')`` 과 ``/file/download/`` 첨부 링크.

    Args:
        html: 상세 HTML.
        base_url: 절대 URL 을 만들 origin.

    Returns:
        중복 없는 첨부 목록.
    """
    if not html:
        return []
    out: list[Attachment] = []
    seen: set[str] = set()
    p = 0
    while True:
        idx = html.find("fileDown", p)
        if idx < 0:
            break
        args = parse_js_args(html[idx : idx + 500])
        token = args[0] if args else ""
        if token and token not in seen:
            seen.add(token)
            title = "첨부파일"
            for a in args[1:]:
                if _FILE_NAME_RE.search(a):
                    title = a.strip()
                    break
            if title == "첨부파일":
                win = html[max(0, idx - 80) : idx + 220]
                named = _FILE_NAME_RE.search(html_to_text(win))
                if named:
                    title = named.group(1).strip()
            url = f"{base_url.rstrip('/')}{FILE_DOWNLOAD_PATH}{token}"
            out.append(Attachment(title=title, url=url, token=token))
        p = idx + 8
    p = 0
    marker = FILE_DOWNLOAD_PATH
    while True:
        idx = html.find(marker, p)
        if idx < 0:
            break
        start = idx + len(marker)
        end = start
        while end < len(html) and (html[end].isalnum() or html[end] in "_-="):
            end += 1
        token = html[start:end]
        if token and token not in seen:
            seen.add(token)
            url = f"{base_url.rstrip('/')}{marker}{token}"
            win = html[max(0, idx - 120) : idx + 80]
            named = _FILE_NAME_RE.search(html_to_text(win))
            title = named.group(1).strip() if named else "첨부파일"
            out.append(Attachment(title=title, url=url, token=token))
        p = idx + len(marker)
    return out


def parse_notice_detail(html: str) -> str:
    """공지·자료 본문. ``atclCn`` · view-cont · ``게시글내용`` 순.

    Args:
        html: 상세 HTML.

    Returns:
        평문 본문.

    Raises:
        ValueError: 본문이 비었을 때.
    """
    if not html:
        raise ValueError("notice html")
    for pat in (
        r'''id=["']atclCn["'][^>]*>([\s\S]*?)</div>''',
        r'''class=["'][^"']*view[-_]?cont[^"']*["'][^>]*>([\s\S]*?)</div>''',
        r'''class=["'][^"']*bbs[-_]?view[^"']*["'][^>]*>([\s\S]*?)</div>''',
        r'''class=["']note-editable["'][^>]*>([\s\S]*?)</div>''',
    ):
        m = re.search(pat, html, re.I)
        if m:
            text = html_to_text(m.group(1))
            if len(text) >= 8:
                return text
    for mark in ("게시글내용", "공지내용", "글내용"):
        start = html.find(mark)
        if start < 0:
            continue
        rest = html[start:]
        end_m = re.search(r"label-title|첨부파일|file-list", rest, re.I)
        chunk = rest[: end_m.start()] if end_m else rest[:6000]
        text = html_to_text(chunk)
        if text:
            return text
    text = html_to_text(html)
    if not text:
        raise ValueError("notice html")
    return text


def looks_like_campus_file_url(url: str) -> bool:
    """e-campus 첨부 호스트만 허용한다.

    Args:
        url: 받을 주소.

    Returns:
        ``seowon.ac.kr`` 이고 경로에 ``/file/`` 이 있으면 True.
    """
    low = (url or "").lower()
    return "seowon.ac.kr" in low and "/file/" in low


def course_semester(list_: list[CourseData]) -> str:
    """과목 코드 ``YYYY_학기_...`` 에서 학기를 읽는다.

    Args:
        list_: 과목 목록.

    Returns:
        ``YYYY-학기``. 코드를 못 읽으면 현재 연·학기.
    """
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
