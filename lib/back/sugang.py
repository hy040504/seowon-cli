"""수강신청 SSO 에서 이름·학번·학과를 가져온다."""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from lib.seowon import (
    SUGANG_HOME,
    SUGANG_LOGIN,
    SUGANG_STUNO,
    SUGANG_TERM,
    SUGANG_URL,
    Session,
)
from lib.back.http import HttpClient
from lib.back.ssv import SsvBuf, ssv_field

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


def session_label(sess: Session) -> str:
    """메뉴·칩에 쓰는 `이름 (학번) · 학과`."""
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
    """testdata/student.json 으로 이름·학과를 채운다."""
    path = Path(testdata_dir) / "student.json"
    if not path.is_file():
        if not sess.student_id:
            sess.student_id = "20241234"
        sess.student_name = "홍길동"
        sess.dept_name = "컴퓨터공학과"
        return
    root = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(root, dict):
        if root.get("stuno"):
            sess.student_id = str(root["stuno"])
        if root.get("stdntNm"):
            sess.student_name = str(root["stdntNm"])
        if root.get("deprtNm"):
            sess.dept_name = str(root["deprtNm"])
        if root.get("deptCd"):
            sess.dept_cd = str(root["deptCd"])


def _fill_from_ssv(body: str, sess: Session) -> None:
    """SSV 응답에서 이름·학번·학과를 채운다."""
    def get(ds: str, col: str) -> str:
        """데이터셋 열. 없으면 빈 문자열."""
        try:
            return ssv_field(body, ds, col)
        except ValueError:
            return ""

    name = get("dsStunoInfo", "stdntNm") or get("dsSession", "userNm")
    stuno = get("dsStunoInfo", "stuno") or get("dsSession", "persNo")
    dept = get("dsStunoInfo", "deprtNm") or get("dsSession", "deptNm")
    dcd = get("dsStunoInfo", "deptCd") or get("dsStunoInfo", "deprtCd")
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


def _login_cells(syy: str, smt: str, stuno: str, pw: str) -> list[str]:
    """findAppcsLogin 행. 수강신청 버튼은 보내지 않는다."""
    return [syy, smt, "20000", stuno, pw, "", "", "L", "100"]


def fetch_profile(stuno: str, password: str, sess: Session) -> bool:
    """sugangh SSV 로 이름·학과를 가져온다. 수강신청은 하지 않는다."""
    if not stuno or not password:
        return False
    http = HttpClient()
    http.init(SUGANG_URL)
    try:
        http.get(SUGANG_HOME, referer=SUGANG_URL, ajax=False)
    except Exception:
        return False

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
        syy, smt = term[:4], term[4:]
    else:
        now = datetime.now()
        syy = str(now.year)
        smt = "20" if now.month >= 8 else "10"

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

    return bool(sess.student_name or sess.dept_name)
