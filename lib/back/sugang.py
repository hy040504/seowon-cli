"""수강신청 SSO 에서 이름·학번·학과·확정 수강 목록을 가져온다.

신청·취소 패킷은 보내지 않는다.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from lib.seowon import (
    SUGANG_HOME,
    SUGANG_LOGIN,
    SUGANG_MY_LIST,
    SUGANG_STUNO,
    SUGANG_TERM,
    SUGANG_URL,
    Session,
    TimetableSubject,
)
from lib.back.http import HttpClient
from lib.back.ssv import SsvBuf, ssv_field, ssv_rows
from lib.back.timetable import course_kind

LOGIN_COLS = [
    "syy",
    "smtCd",
    "unvfrStdrDeptCd",
    "stuno",
    "password",
    "hy",
    "deptCd",
    "notcClCd",
    "appcsKindCd",
]

MY_LIST_COLS = [
    "syy",
    "smtCd",
    "unvfrStdrDeptCd",
    "cmpsjHyDivCd",
    "cmpsjDivCd",
    "serchDiv",
    "estblCrseDivCd",
    "stuno",
    "asignDeprtCd",
    "subjtCd",
    "corseDvclsNo",
]


def split_college_dept(dept_name: str) -> tuple[str, str]:
    """``IT문화예술대학 컴퓨터공학과`` 처럼 붙은 소속을 (대학, 학과)로 나눈다.

    Args:
        dept_name: 소속 원문.

    Returns:
        ``(대학, 학과)``. 대학을 못 찾으면 서원대학교.
    """
    text = (dept_name or "").strip()
    if not text:
        return "서원대학교", ""
    idx = text.find("대학")
    if idx >= 0:
        college = text[: idx + 2].strip()
        dept = text[idx + 2 :].strip()
        return college or "서원대학교", dept
    return "서원대학교", text


def session_org(sess: Session) -> tuple[str, str]:
    """프로필에 쓸 (대학, 학과).

    Args:
        sess: 세션.

    Returns:
        ``(대학, 학과)``.
    """
    college = (sess.college_name or "").strip()
    dept = (sess.dept_name or "").strip()
    if college and dept:
        if dept.startswith(college):
            rest = dept[len(college) :].strip()
            return college, rest or dept
        return college, dept
    split_c, split_d = split_college_dept(dept)
    return college or split_c, split_d


def session_label(sess: Session) -> str:
    """메뉴·칩에 쓰는 ``이름 (학번) · 학과``.

    Args:
        sess: 세션.

    Returns:
        한 줄 라벨.
    """
    sid = sess.student_id or "-"
    nm = sess.student_name
    dept = sess.dept_name
    if nm and dept:
        return f"{nm} ({sid}) · {dept}"
    if nm:
        return f"{nm} ({sid})"
    if dept:
        return f"{sid} · {dept}"
    return sid


def load_demo_profile(testdata_dir: str | Path, sess: Session) -> None:
    """``testdata/student.json`` 으로 이름·학과를 채운다.

    Args:
        testdata_dir: testdata 폴더.
        sess: 채울 세션.
    """
    path = Path(testdata_dir) / "student.json"
    if not path.is_file():
        if not sess.student_id:
            sess.student_id = "20241234"
        sess.student_name = "홍길동"
        sess.college_name = "서원대학교"
        sess.dept_name = "컴퓨터공학과"
        return
    root = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(root, dict):
        if root.get("stuno"):
            sess.student_id = str(root["stuno"])
        if root.get("stdntNm"):
            sess.student_name = str(root["stdntNm"])
        if root.get("colgNm") or root.get("collegeNm"):
            sess.college_name = str(root.get("colgNm") or root.get("collegeNm") or "")
        if root.get("deprtNm"):
            sess.dept_name = str(root["deprtNm"])
        if root.get("deptCd"):
            sess.dept_cd = str(root["deptCd"])
        if not sess.college_name:
            sess.college_name, _dept = split_college_dept(sess.dept_name)
            if _dept:
                sess.dept_name = _dept if "대학" in (sess.dept_name or "") else sess.dept_name


def _fill_from_ssv(body: str, sess: Session) -> None:
    """SSV 응답에서 이름·학번·학과를 채운다.

    Args:
        body: findAppcsLogin / findStunoInfo 본문.
        sess: 채울 세션.
    """
    def get(ds: str, col: str) -> str:
        """데이터셋 열. 없으면 빈 문자열.

        Args:
            ds: Dataset 이름.
            col: 열 이름.

        Returns:
            셀 값 또는 빈 문자열.
        """
        try:
            return ssv_field(body, ds, col)
        except ValueError:
            return ""

    name = get("dsStunoInfo", "stdntNm") or get("dsSession", "userNm")
    stuno = get("dsStunoInfo", "stuno") or get("dsSession", "persNo")
    dept = get("dsStunoInfo", "deprtNm") or get("dsSession", "deptNm")
    dcd = get("dsStunoInfo", "deptCd") or get("dsStunoInfo", "deprtCd")
    college = get("dsStunoInfo", "colgNm") or get("dsStunoInfo", "collegeNm") or get("dsSession", "colgNm")
    if name:
        sess.student_name = name
    if stuno:
        sess.student_id = stuno
        if not sess.user_no:
            sess.user_no = stuno
    if dept:
        sess.dept_name = dept
    if dcd:
        sess.dept_cd = dcd
    if college:
        sess.college_name = college
    elif sess.dept_name and not sess.college_name:
        sess.college_name, rest = split_college_dept(sess.dept_name)
        if rest:
            sess.dept_name = sess.dept_name


def _login_cells(syy: str, smt: str, stuno: str, pw: str) -> list[str]:
    """findAppcsLogin 행. 수강신청 버튼은 보내지 않는다.

    Args:
        syy: 학년도.
        smt: 학기 코드.
        stuno: 학번.
        pw: 비밀번호.

    Returns:
        LOGIN_COLS 순서의 셀.
    """
    return [syy, smt, "20000", stuno, pw, "", "", "L", "100"]


def _term_codes(http: HttpClient) -> tuple[str, str]:
    """학년도·학기 코드.

    Args:
        http: sugangh 클라이언트.

    Returns:
        ``(학년도, 학기코드)``. 실패하면 달력으로 추정.
    """
    ts = str(int(time.time() * 1000))
    form = SsvBuf()
    form.begin()
    form.add_param("flag", "1")
    form.add_param("univunvfrSchdlCd", "SAPL00010001")
    form.add_param("regDeptCd", "20000")
    form.add_param("applcDeptCd", "")
    form.add_param("applyCrseCd", "")
    form.add_param("dgriCrseCd", "")
    form.add_param("hy", "")
    form.add_param("syy", "")
    form.add_param("smtCd", "")
    form.add_param("requestTimeStr", ts)
    try:
        body, _ = http.post(SUGANG_TERM, SUGANG_URL, "text/xml", form.dumps(), ajax=True)
        try:
            term = ssv_field(body, "dsUnvfc", "reslt")
        except ValueError:
            term = ""
    except Exception:
        term = ""
    if len(term) >= 5:
        return term[:4], term[4:]
    now = datetime.now()
    return str(now.year), "20" if now.month >= 8 else "10"


def open_sugang(stuno: str, password: str, sess: Session) -> HttpClient | None:
    """sugangh 에 로그인하고 이름·학과를 채운다. 수강신청은 하지 않는다.

    Parameters
    ----------
    stuno : str
        학번.
    password : str
        비밀번호.
    sess : Session
        이름·학과를 채울 세션.

    Returns
    -------
    HttpClient or None
        로그인한 클라이언트. 학번/비밀번호가 없거나 홈을 못 열면 None.
    """
    if not stuno or not password:
        return None
    http = HttpClient()
    http.init(SUGANG_URL)
    try:
        http.get(SUGANG_HOME, referer=SUGANG_URL, ajax=False)
    except Exception:
        return None
    syy, smt = _term_codes(http)

    ts = str(int(time.time() * 1000))
    form = SsvBuf()
    form.begin()
    form.add_param("requestTimeStr", ts)
    form.dataset_begin("dsParam", LOGIN_COLS)
    form.row("U", _login_cells(syy, smt, stuno, password))
    form.row("O", [syy, smt, "20000", "", "", "", "", "L", ""])
    form.dataset_end()
    try:
        body, _ = http.post(SUGANG_LOGIN, SUGANG_URL, "text/xml", form.dumps(), ajax=True)
        _fill_from_ssv(body, sess)
    except Exception:
        pass

    ts = str(int(time.time() * 1000))
    form = SsvBuf()
    form.begin()
    form.add_param("requestTimeStr", ts)
    form.dataset_begin("dsParam", LOGIN_COLS)
    form.row("N", _login_cells(syy, smt, stuno, password))
    form.dataset_end()
    try:
        body, _ = http.post(SUGANG_STUNO, SUGANG_URL, "text/xml", form.dumps(), ajax=True)
        _fill_from_ssv(body, sess)
    except Exception:
        pass

    sess.syy = syy  # type: ignore[attr-defined]
    sess.smt_cd = smt  # type: ignore[attr-defined]
    return http


def fetch_profile(stuno: str, password: str, sess: Session) -> bool:
    """sugangh SSV 로 이름·학과를 가져온다. 수강신청은 하지 않는다.

    Args:
        stuno: 학번.
        password: 비밀번호.
        sess: 채울 세션.

    Returns:
        이름 또는 학과를 채웠으면 True.
    """
    http = open_sugang(stuno, password, sess)
    return bool(http and (sess.student_name or sess.dept_name))


def fetch_registered_subjects(stuno: str, password: str, sess: Session) -> list[TimetableSubject]:
    """확정 수강 목록(``findAppcsDtlsList``). 신청·취소는 보내지 않는다.

    Parameters
    ----------
    stuno : str
        학번.
    password : str
        비밀번호.
    sess : Session
        학과 코드·학년도를 읽을 세션.

    Returns
    -------
    list of TimetableSubject
        확정 과목. 로그인 실패면 빈 목록.
    """
    http = open_sugang(stuno, password, sess)
    if http is None:
        return []
    now = datetime.now()
    syy = getattr(sess, "syy", "") or str(now.year)
    smt = getattr(sess, "smt_cd", "") or ("20" if now.month >= 8 else "10")
    dept = sess.dept_cd or ""
    ts = str(int(time.time() * 1000))
    form = SsvBuf()
    form.begin()
    form.add_param("requestTimeStr", ts)
    form.dataset_begin("dsParam", MY_LIST_COLS)
    form.row(
        "N",
        [syy, smt, "20000", "", "", "0", "", stuno, dept, "", ""],
    )
    form.dataset_end()
    try:
        body, _ = http.post(SUGANG_MY_LIST, SUGANG_URL, "text/xml", form.dumps(), ajax=True)
    except Exception:
        return []
    out: list[TimetableSubject] = []
    seen: set[str] = set()
    for row in ssv_rows(body, "dsSapl231"):
        cd = str(row.get("subjtCd") or "")
        sec = str(row.get("corseDvclsNo") or "")
        key = f"{cd}-{sec}"
        if not cd or key in seen:
            continue
        seen.add(key)
        div = str(row.get("cmpsjDivCd") or "")
        div_nm = str(row.get("estblCrseDivNm") or row.get("cmpsjDivNm") or "")
        out.append(
            TimetableSubject(
                subjt_cd=cd,
                subjt_nm=str(row.get("subjtNm") or row.get("orgSubjtNm") or ""),
                corse_dvcls_no=sec,
                cmpsj_cdt=str(row.get("cmpsjCdt") or ""),
                chrg_instr=str(row.get("chrgInstrEmpnm") or ""),
                timtb_nm=str(row.get("timtbNm") or "").replace("\r\n", "\n").strip(),
                kind=course_kind(div, div_nm),
            )
        )
    return out
